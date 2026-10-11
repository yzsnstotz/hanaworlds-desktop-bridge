/**
 * Plugin HTTP routes over ctx.webServer, replacing the Electron IPC/preload channels of hanaworlds-desktop@bd964cdf
 * (apps/desktop/src/{ipc,preload-app,host-process}.ts: view-candidates/select/read/clear, workshop-prepare/confirm/
 * read/invoke). Electron keyed a binding by its native BrowserWindow; here the plugin itself issues the page's
 * window key, so the page needs no native menu or shell to hold one.
 *
 * Every route first asks the composition's `connection` service for a rejection (Host/Origin fence and login
 * cookie), the same single security home dsh's open-in-app routes use.
 */
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { DesktopViewBindings } from './view-binding.ts'
import type { DesktopWorkshopConfirmations } from './workshop-confirm.ts'
import type { DesktopWorkshopTransport } from './workshop-transport.ts'
import type { DesktopWorldLifecycle } from './world-lifecycle.ts'
import type { DesktopSessionWorlds } from './session-worlds.ts'
import type { DesktopDeploymentPolicy } from './deployment-policy.ts'
import type { DesktopBuildBridge } from './build-bridge.ts'
import type { DesktopBindingView } from './view-binding.ts'
import { RelayedContractError } from './local-protocol.ts'

export const VIEW_PATH = '/api-hanaworlds-view'
export const WORKSHOP_PATH = '/api-hanaworlds-workshop'
export const DEPLOYMENT_PATH = '/api-hanaworlds-deployment'
export const WORLDS_PATH = '/api-hanaworlds-worlds'
export const REGION_PATH = '/api-hanaworlds-region'
export const BUILD_PATH = '/api-hanaworlds-build'
export const OBJECTS_PATH = '/api-hanaworlds-objects'
/** Request bodies are small JSON objects; anything larger is refused before parsing. */
const MAX_BODY_BYTES = 64 * 1024

interface Connection { requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined }
export interface RouteServices {
  views: DesktopViewBindings
  confirm: DesktopWorkshopConfirmations
  transport: DesktopWorkshopTransport
  worlds: DesktopSessionWorlds
  lifecycle: DesktopWorldLifecycle
  policy: DesktopDeploymentPolicy
  build: DesktopBuildBridge
  region(): Promise<unknown>
  tools(): Promise<unknown>
}
class RequestError extends Error { constructor(readonly status: number, message: string) { super(message) } }
/** A peer's whole public Error (code, reason, mutationState, target worldRef …) beside the existing `error` text. */
const contractError = (error: unknown) => error instanceof RelayedContractError ? { contractError: error.publicError } : {}
const bad = (message: string): never => { throw new RequestError(400, message) }

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new RequestError(415, 'JSON_REQUIRED')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) throw new RequestError(413, 'BODY_TOO_LARGE')
    chunks.push(chunk)
  }
  let value: unknown
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { bad('JSON_INVALID') }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) bad('JSON_OBJECT_REQUIRED')
  return value as Record<string, unknown>
}
const text = (input: Record<string, unknown>, key: string): string => {
  const value = input[key]
  return typeof value === 'string' && value.length > 0 ? value : bad(`${key.toUpperCase()}_REQUIRED`)
}

/** Register the bridge routes; each registration is disposed with the plugin. */
export function installRoutes(ctx: Context, services: RouteServices): void {
  const connection = Reflect.get(ctx, 'connection') as Connection
  /** Window keys the plugin issued; a binding exists only under a key from this set. */
  const windows = new Set<string>()
  const generations = new Map<string, number>()
  const windowKey = (input: Record<string, unknown>): string => {
    const key = text(input, 'windowKey')
    if (!windows.has(key)) throw new RequestError(404, 'WINDOW_KEY_UNKNOWN: ask POST /api-hanaworlds-view/window for a key first')
    return key
  }
  const route = (path: string, methods: Record<string, (req: IncomingMessage, sub: string) => Promise<unknown>>) =>
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path, handler: async (req, res) => {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) { res.statusCode = rejection; res.end(); return }
      const url = new URL(String(req.url), 'http://localhost'), sub = url.pathname.slice(path.length).replace(/^\//, '')
      const handle = methods[`${String(req.method)} ${sub}`]
      if (!handle) { send(res, 404, { error: 'ROUTE_NOT_FOUND' }); return }
      try { send(res, 200, await handle(req, sub)) }
      catch (error) {
        send(res, error instanceof RequestError ? error.status : 409,
          { error: error instanceof Error ? error.message : String(error), ...contractError(error) })
      }
    } }), `hanaworlds-desktop-bridge: ${path}`)

  const { views, confirm, transport, worlds, lifecycle, policy, build } = services
  ctx.effect(() => () => {
    for (const key of windows) { views.clear(key); confirm.clear(key) }
    windows.clear(); generations.clear()
  }, 'HanaWorlds view teardown')
  const invalidate = (key: string) => {
    generations.set(key, (generations.get(key) ?? 0) + 1)
    views.clear(key); confirm.clear(key)
  }
  const begin = (key: string) => {
    invalidate(key)
    const generation = generations.get(key)
    return async () => {
      if (!windows.has(key) || generations.get(key) !== generation) throw new Error('HANAWORLDS_VIEW_STALE_VIEW')
    }
  }
  const publish = async (key: string, sessionId: string, check: () => Promise<void>) => {
    await check()
    const lease = await views.select(key, sessionId)
    try {
      await check()
      await transport.bindCurrentWorld(sessionId, async () => { await check(); await views.read(key, lease) })
      await check()
      const view = await views.read(key, lease)
      return { lease, sessionId, worldRef: view.worldRef, localContext: view.localContext, noLiveBinding: false }
    } catch (error) {
      // A stale request must never clear a successor's lease.
      try { await check(); views.clear(key); confirm.clear(key) } catch {}
      throw error
    }
  }
  const fields = (input: Record<string, unknown>, allowed: readonly string[]) => {
    if (Object.keys(input).some(key => !allowed.includes(key))) bad('UNKNOWN_FIELD')
    return input
  }
  const bound = async (input: Record<string, unknown>) => {
    const key = windowKey(input), lease = text(input, 'lease')
    const view = await views.read(key, lease)
    return { view, check: async () => { await views.read(key, lease) } }
  }
  const advanceInput = async (req: IncomingMessage) => {
    const input = fields(await body(req), ['windowKey', 'lease', 'payload'])
    if (typeof input.payload !== 'object' || input.payload === null || Array.isArray(input.payload)) bad('PAYLOAD_REQUIRED')
    const payload = fields(input.payload as Record<string, unknown>, ['expectedTurnRevision', 'requestId'])
    text(payload, 'expectedTurnRevision')
    if (payload.requestId !== undefined) text(payload, 'requestId')
    return { ...await bound(input), payload }
  }
  const refreshed = async (result: unknown, view: DesktopBindingView, check: () => Promise<void>) => {
    // A committed build must remain reviewable if a subsequent read fails. Never repeat a mutation.
    let panels = null, panelError = null, failure: unknown = null
    try { panels = await build.panels(view, check) }
    catch (error) { failure = error; panelError = error instanceof Error ? error.message : String(error) }
    await check()
    const relayed = failure instanceof RelayedContractError ? { panelContractError: failure.publicError } : {}
    return { result, panels, panelError, ...relayed }
  }
  route(OBJECTS_PATH, {
    'POST list': async req => {
      const { view, check } = await bound(fields(await body(req), ['windowKey', 'lease']))
      return build.objects(view, check)
    },
    'POST history': async req => {
      const input = fields(await body(req), ['windowKey', 'lease', 'objectRef'])
      const objectRef = text(input, 'objectRef'), { view, check } = await bound(input)
      return build.history(view, objectRef, check)
    },
    'POST panels': async req => {
      const { view, check } = await bound(fields(await body(req), ['windowKey', 'lease']))
      return build.panels(view, check)
    },
  })
  route(BUILD_PATH, { 'POST advance': async req => {
    const { view, check, payload } = await advanceInput(req)
    const result = await transport.invoke(view.sessionId, { operation: 'workshop',
      input: { operation: 'AdvanceCurrentBuild', payload } }, check)
    return refreshed(result, view, check)
  } })
  route(WORLDS_PATH, {
    'GET describe': async () => lifecycle.call('describe'),
    'GET list': async () => lifecycle.call('list'),
    'POST create': async req => {
      const input = fields(await body(req), ['templateId', 'displayName'])
      return lifecycle.call('create', { templateId: text(input, 'templateId'), displayName: text(input, 'displayName') })
    },
    'POST describe-delete': async req => {
      const input = fields(await body(req), ['worldId'])
      return lifecycle.call('describeDelete', { worldId: text(input, 'worldId') })
    },
    'POST delete': async req => {
      const input = fields(await body(req), ['worldId', 'confirmationName'])
      return lifecycle.deleteWorld(text(input, 'worldId'), text(input, 'confirmationName'))
    },
    'POST play': async req => {
      const input = fields(await body(req), ['worldId'])
      if (!(await lifecycle.call('describe')).canPlay) throw new Error('CAPABILITY_UNAVAILABLE')
      return lifecycle.call('play', { worldId: text(input, 'worldId') })
    },
    'POST context': async req => {
      const input = fields(await body(req), ['windowKey', 'sessionId'])
      windowKey(input)
      return worlds.context(text(input, 'sessionId'))
    },
    'POST connect': async req => {
      const input = fields(await body(req), ['windowKey', 'sessionId', 'worldId'])
      const key = windowKey(input), sessionId = text(input, 'sessionId'), worldId = text(input, 'worldId'), check = begin(key)
      await worlds.connect(sessionId, worldId, lifecycle, check)
      return publish(key, sessionId, check)
    },
    'POST stop': async req => {
      const input = fields(await body(req), ['windowKey', 'lease']), key = windowKey(input)
      const generation = generations.get(key)
      const view = await views.read(key, text(input, 'lease'))
      const stopped = await lifecycle.call('stop', { connectionRef: view.localContext.connectionRef })
      if (windows.has(key) && generations.get(key) === generation) invalidate(key)
      return stopped
    },
  })
  route(VIEW_PATH, {
    'POST window': async () => { const key = randomUUID(); windows.add(key); return { windowKey: key } },
    'GET candidates': async () => ({ candidates: views.candidates() }),
    'POST select': async (req) => {
      const input = await body(req), key = windowKey(input), sessionId = text(input, 'sessionId')
      const check = begin(key)
      await worlds.discover(sessionId)
      await check()
      return publish(key, sessionId, check)
    },
    'POST read': async (req) => { const input = await body(req); return { view: await views.read(windowKey(input), text(input, 'lease')) } },
    'POST clear': async (req) => {
      const key = windowKey(await body(req))
      invalidate(key)
      return { cleared: true }
    },
    'POST close': async (req) => {
      const key = windowKey(await body(req))
      invalidate(key); windows.delete(key); generations.delete(key)
      return { closed: true }
    },
  })
  route(WORKSHOP_PATH, {
    'POST prepare': async (req) => {
      const input = await body(req)
      return { view: await confirm.prepare(windowKey(input), text(input, 'lease'), typeof input.text === 'string' ? input.text : '') }
    },
    'POST confirm': async (req) => { const input = await body(req); return { view: await confirm.confirm(windowKey(input), text(input, 'lease')) } },
    'POST read': async (req) => { const input = await body(req); return { view: await confirm.read(windowKey(input), text(input, 'lease')) } },
    'POST invoke': async (req) => {
      const input = await body(req), key = windowKey(input), lease = text(input, 'lease')
      const view = await views.read(key, lease)
      const result = await transport.invoke(view.sessionId, input.input, async () => { await views.read(key, lease) })
      await views.read(key, lease)
      const interaction = input.input as { operation?: string; input?: { operation?: string } } | undefined
      if (interaction?.operation === 'workshop' && interaction.input?.operation === 'AdvanceCurrentBuild') {
        return refreshed(result, view, async () => { await views.read(key, lease) })
      }
      return { result }
    },
  })
  route(DEPLOYMENT_PATH, {
    'POST ': async (req) => {
      const input = await body(req)
      const worldRef = input.windowKey === undefined ? null : (await views.read(windowKey(input), text(input, 'lease'))).worldRef
      return policy.describe(worldRef)
    },
  })
  route(REGION_PATH, {
    'GET ': async () => services.region(),
    'POST proposal': async req => {
      const input = fields(await body(req), ['windowKey', 'lease', 'payload'])
      if (typeof input.payload !== 'object' || input.payload === null || Array.isArray(input.payload)) bad('PAYLOAD_REQUIRED')
      const payload = fields(input.payload as Record<string, unknown>, ['requestId', 'turnRevision', 'intent', 'intentDigest',
        'referenceBrief', 'referenceBriefDigest', 'catalogue', 'catalogueDigest', 'proposal'])
      const { view, check } = await bound(input)
      const result = await transport.region('submitWriteProposal', { ...payload, contractVersion: 'painter-region/v3',
        requestId: payload.requestId ?? randomUUID(), invocationId: randomUUID(), sessionRef: view.sessionId,
        worldRef: view.worldRef, localContext: view.localContext }, check)
      return { result }
    },
    'POST context': async req => {
      const { view, check, payload } = await advanceInput(req)
      const result = await transport.region('readWriteProposalContext', { ...payload, contractVersion: 'session/v5',
        requestId: payload.requestId ?? randomUUID(), sessionRef: view.sessionId, worldRef: view.worldRef, localContext: view.localContext }, check)
      return { result }
    },
    'POST advance': async req => {
      const { view, check, payload } = await advanceInput(req)
      const result = await transport.region('advanceRegionBuild', { ...payload, contractVersion: 'session/v5',
        requestId: payload.requestId ?? randomUUID(), sessionRef: view.sessionId, worldRef: view.worldRef, localContext: view.localContext }, check)
      return refreshed(result, view, check)
    },
  })
  route('/api-hanaworlds-skill-tools', { 'GET ': async () => services.tools() })
}
