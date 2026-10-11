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
import type { DesktopSessionWorlds } from './session-worlds.ts'
import type { DesktopDeploymentPolicy } from './deployment-policy.ts'

export const VIEW_PATH = '/api-hanaworlds-view'
export const WORKSHOP_PATH = '/api-hanaworlds-workshop'
export const DEPLOYMENT_PATH = '/api-hanaworlds-deployment'
export const REGION_PATH = '/api-hanaworlds-region'
/** Request bodies are small JSON objects; anything larger is refused before parsing. */
const MAX_BODY_BYTES = 64 * 1024

interface Connection { requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined }
export interface RouteServices {
  views: DesktopViewBindings
  confirm: DesktopWorkshopConfirmations
  transport: DesktopWorkshopTransport
  worlds: DesktopSessionWorlds
  policy: DesktopDeploymentPolicy
  region(): Promise<unknown>
  tools(): Promise<unknown>
}
class RequestError extends Error { constructor(readonly status: number, message: string) { super(message) } }
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
        send(res, error instanceof RequestError ? error.status : 409, { error: error instanceof Error ? error.message : String(error) })
      }
    } }), `hanaworlds-desktop-bridge: ${path}`)

  const { views, confirm, transport, worlds, policy } = services
  ctx.effect(() => () => {
    for (const key of windows) { views.clear(key); confirm.clear(key) }
    windows.clear()
  }, 'HanaWorlds view teardown')
  route(VIEW_PATH, {
    'POST window': async () => { const key = randomUUID(); windows.add(key); return { windowKey: key } },
    'GET candidates': async () => ({ candidates: views.candidates() }),
    'POST select': async (req) => {
      const input = await body(req), key = windowKey(input), sessionId = text(input, 'sessionId')
      await worlds.discover(sessionId)
      const lease = await views.select(key, sessionId)
      try { await transport.bindCurrentWorld(sessionId, async () => { await views.read(key, lease) }) }
      catch (error) { views.clear(key); throw error }
      return { lease, sessionId }
    },
    'POST read': async (req) => { const input = await body(req); return { view: await views.read(windowKey(input), text(input, 'lease')) } },
    'POST clear': async (req) => {
      const key = windowKey(await body(req))
      views.clear(key); confirm.clear(key)
      return { cleared: true }
    },
    'POST close': async (req) => {
      const key = windowKey(await body(req))
      views.clear(key); confirm.clear(key); windows.delete(key)
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
  route(REGION_PATH, { 'GET ': async () => services.region() })
  route('/api-hanaworlds-skill-tools', { 'GET ': async () => services.tools() })
}
