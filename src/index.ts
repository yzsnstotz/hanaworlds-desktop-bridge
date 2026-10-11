/** Cordis composition extracted from desktop-host@bd964cdf; no Electron process or bootstrap. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import { validateType } from 'hanaworlds-contracts'
import { DesktopBuildBridge, type DomainPort, type NativeFactsPort } from './build-bridge.ts'
import { DesktopDeploymentPolicy, type CompilerConfigPort, type WriteProfilePort } from './deployment-policy.ts'
import { DesktopWorldInspectionContext } from './world-inspection-context.ts'
import { DesktopPluginRoles } from './plugin-roles.ts'
import { DesktopInspectionFacts } from './inspection-facts.ts'
import { DesktopPainterFacts } from './painter-facts.ts'
import { DesktopImageMedia, desktopImageMediaTypes, serviceIdentity } from './image-media.ts'
import { DesktopRegionPorts, type RegionPort, type PainterRegionEntry, type BrushRegionEntry } from './region-ports.ts'
import { DesktopWorldLifecycle } from './world-lifecycle.ts'
import { DesktopSessionWorlds } from './session-worlds.ts'
import { DesktopWorkshopTransport } from './workshop-transport.ts'
import { DesktopSkillSubmission } from './skill-submission.ts'
import { installDesktopViewBindings, type DesktopViewBindings } from './view-binding.ts'
import { DesktopWorkshopConfirmations, type DesktopWorkshopPort } from './workshop-confirm.ts'
import { installRoutes } from './routes.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    hanaworldsWorldLifecycle: import('hanaworlds-contracts').WorldLifecyclePort
    hanaworldsCanvasV5: DomainPort
    hanaworldsWorldAdapterV6: DomainPort
    /** World-source facts, including the named C-world-facts reads when advertised by the source. */
    hanaworldsWorldFacts: NativeFactsPort & Partial<WriteProfilePort>
    /** Bridge projection of the complete ReadWriteProfile compilationConfig. */
    hanaworldsCompilerConfig: CompilerConfigPort
    hanaworldsWorldRevisionOracle: { read(worldRef: string): Promise<unknown> }
    hanaworldsPainterV2PictureBlocks: PainterRegionEntry
    hanaworldsBrushV3: BrushRegionEntry
    hanaworldsCanvasRegionV1: RegionPort
    hanaworldsWorldAdapterRegionV1: RegionPort
    hanaworldsPainterRegionV1: RegionPort
    hanaworldsBrushRegionV1: RegionPort
    hanaworldsCatalogue: { read(worldRef: string): Promise<unknown> }
    hanaworldsSafetyProfile: { read(confirmedIntent: unknown): unknown }
    hanaworldsWorldInspectionContext: DesktopWorldInspectionContext & { read(request: unknown): Promise<unknown> }
      & Pick<DesktopPluginRoles, 'ReadPluginRoles'>
    hanaworldsPainterLocalFacts: DesktopPainterFacts
    hanaworldsCapabilities: import('hanaworlds-contracts').PublicCapabilities
    hanaworldsMediaAuthority: { verify(input: { sessionRef: string; attachmentRef: string }): Promise<boolean> }
    hanaworldsDesktopBridge: {
      transport: DesktopWorkshopTransport
      views: DesktopViewBindings
      confirmations: DesktopWorkshopConfirmations
      images: DesktopImageMedia
      deployment: DesktopDeploymentPolicy
      worlds: DesktopSessionWorlds
      lifecycle: DesktopWorldLifecycle
      build: DesktopBuildBridge
    }
  }
}

export const name = 'hanaworlds-desktop-bridge'
export const inject = ['webServer', 'connection', 'sessions', 'hanaworldsWorkshop', 'hanaworldsCanvasV5']

/** Reuse the host's services; all registrations and peer wrappers belong to this plugin fiber. */
export function apply(ctx: Context): void {
  const sessions = ctx.sessions
  const worlds = new DesktopSessionWorlds({ session: id => sessions.get(SessionId(id)),
    workshop: () => ctx.get('hanaworldsWorkshop'), canvas: () => ctx.get('hanaworldsCanvasV5') })
  const lifecycle = new DesktopWorldLifecycle(() => ctx.get('hanaworldsWorldLifecycle'), () => ctx.get('hanaworldsCanvasV5'),
    (worldRef, work) => build.runWorldRetirement(worldRef, work))
  const persistence = () => ctx.get('sessionPersistence')
  const transport: DesktopWorkshopTransport = new DesktopWorkshopTransport({
    session: id => sessions.get(SessionId(id)), localContext: id => worlds.localContext(id),
    workshop: () => ctx.get('hanaworldsWorkshop') as DomainPort | undefined, domain: () => build,
    async recordInput(id, requestId, text) {
      const session = sessions.get(SessionId(id)), store = persistence()
      if (!session || !store) throw new Error('SESSION_DURABILITY_UNAVAILABLE')
      const event = session.append('user/message', { id: requestId as never, role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text }] }, { surfaceOp: 'append' })
      if (!await sessions.flush(session)) throw new Error('SESSION_DURABILITY_UNAVAILABLE')
      const handle = await store.open(session.id, 'read')
      try {
        const saved = (await handle.read(event.seq, 1)).events[0]
        if (saved?.type !== 'user/message' || saved.data.id !== requestId || saved.data.content[0]?.type !== 'text'
          || saved.data.content[0].text !== text) throw new Error('SESSION_DURABILITY_UNAVAILABLE')
      } finally { await handle.close() }
    },
  })
  const inspection = new DesktopInspectionFacts(transport, { canvas: () => ctx.get('hanaworldsCanvasV5'),
    revision: () => ctx.get('hanaworldsWorldRevisionOracle') })
  const build = new DesktopBuildBridge(transport, { canvas: () => ctx.get('hanaworldsCanvasV5'),
    adapter: () => ctx.get('hanaworldsWorldAdapterV6'), nativeFacts: () => ctx.get('hanaworldsWorldFacts'),
    canvasRegion: () => ctx.get('hanaworldsCanvasRegionV1'), adapterRegion: () => ctx.get('hanaworldsWorldAdapterRegionV1'),
    inspection: () => inspection })
  ctx.effect(() => () => build.close(), 'HanaWorlds peer dispatch teardown')
  const canvasIdentities = new WeakMap<object, string>()
  const views = installDesktopViewBindings(ctx, {
    get identity() {
      const canvas = serviceIdentity(ctx.get('hanaworldsCanvasV5'))
      if (!canvas) return ''
      let identity = canvasIdentities.get(canvas)
      if (!identity) { identity = `desktop-bridge:${randomUUID()}`; canvasIdentities.set(canvas, identity) }
      return identity
    },
    get source() { return ctx.get('hanaworldsCanvasV5')?.source === 'FIXTURE' ? 'FIXTURE' : 'ADAPTER' },
    currentContext: id => worlds.localContext(id) })
  const policy = new DesktopDeploymentPolicy({ facts: () => ctx.get('hanaworldsWorldFacts') })
  const readEvents = async (session: import('@deepseek-ai/dsh-session').Session, from: number, count: number) => {
    const store = persistence()
    if (!store) throw new Error('SESSION_DURABILITY_UNAVAILABLE')
    const handle = await store.open(session.id, 'read')
    try { return (await handle.read(SessionLogOffset(from), count)).events } finally { await handle.close() }
  }
  const images = new DesktopImageMedia({ attachments: () => ctx.get('attachments'), readEvents })
  ctx.provide('hanaworldsCatalogue', { read: (worldRef: string) => build.catalogue(worldRef) })
  ctx.provide('hanaworldsCompilerConfig', { read: (worldRef: string) => policy.compiler(worldRef) })
  ctx.provide('hanaworldsSafetyProfile', { read: (intent: unknown) => policy.safety(intent) })
  const inspectionContext = new DesktopWorldInspectionContext({ session: id => sessions.get(SessionId(id)),
    canvas: () => ctx.get('hanaworldsCanvasV5') })
  // C-world-inspection 2.9.0 ReadPluginRoles rides on the same provider service; it adds no new service.
  const pluginRoles = new DesktopPluginRoles(ctx)
  ctx.provide('hanaworldsWorldInspectionContext', Object.assign(inspectionContext, { read: (raw: unknown) => inspection.read(raw),
    ReadPluginRoles: (raw: unknown) => pluginRoles.ReadPluginRoles(raw) }))
  ctx.provide('hanaworldsPainterLocalFacts', new DesktopPainterFacts(transport, id => worlds.localContext(id)))
  ctx.provide('hanaworldsCapabilities', validateType('PublicCapabilities', {
    providerRef: name, capabilityRevision: 'desktop-bridge/v2.0.0', worldRef: null, engineBounds: null,
    worldGeometry: null, limits: [], recoveryGuarantee: null, stateProfile: null, sessionDeleteSupported: false,
    model: null, engineGuards: null, imageMediaTypes: desktopImageMediaTypes(ctx.get('attachments')?.imageLimits.mediaTypes ?? []),
  }))
  ctx.provide('hanaworldsMediaAuthority', { async verify(input: { sessionRef: string; attachmentRef: string }) {
    const agent = ctx.get('agents')?.currentInitiator()
    if (!agent || agent.session.id !== input.sessionRef) throw new Error('AGENT_SESSION_REQUIRED')
    const check = async () => {
      if (ctx.get('agents')?.get(agent.id) !== agent || sessions.get(agent.session.id) !== agent.session) throw new Error('AGENT_SESSION_REQUIRED')
      if (!await sessions.flush(agent.session)) throw new Error('SESSION_DURABILITY_UNAVAILABLE')
    }
    await images.read(agent.session, input.attachmentRef, check)
    return true
  } })
  const region = new DesktopRegionPorts({ painter: () => ctx.get('hanaworldsPainterV2PictureBlocks'),
    brush: () => ctx.get('hanaworldsBrushV3'), canvasRegion: () => ctx.get('hanaworldsCanvasRegionV1'),
    adapterRegion: () => ctx.get('hanaworldsWorldAdapterRegionV1') })
  const painter = region.painterPort(), brush = region.brushPort()
  if (painter) ctx.provide('hanaworldsPainterRegionV1', painter)
  if (brush) ctx.provide('hanaworldsBrushRegionV1', brush)
  const workshopBridge: DesktopWorkshopPort = {
    get contractHandshake() { return ctx.get('hanaworldsWorkshop')?.contractHandshake },
    get source() { return ctx.get('hanaworldsWorkshop')?.source },
    call: (operation, request) => transport.dispatch(operation, request, operation === 'AppendMultimodalTurn'),
  }
  const submissions = new DesktopSkillSubmission({ agent: session => ctx.get('agents')?.get(session.id),
    controller: () => ctx.get('sessionController'), flush: session => sessions.flush(session),
    async open(session) {
      const store = persistence()
      if (!store) throw new Error('SESSION_DURABILITY_UNAVAILABLE')
      return store.open(session.id, 'read')
    } })
  const confirm = new DesktopWorkshopConfirmations({ bindings: views, sessions, workshop: () => workshopBridge,
    workshopIdentity: () => serviceIdentity(ctx.get('hanaworldsWorkshop')),
    runSkill: (session, text, check) => submissions.run(session, text, check),
    pending: (sessionRef, snapshot, context) => transport.pending(sessionRef, snapshot, context) })
  ctx.provide('hanaworldsDesktopBridge', { transport, views, confirmations: confirm, images, deployment: policy, worlds, lifecycle, build })
  installRoutes(ctx, { views, confirm, transport, worlds, lifecycle, policy, build, region: async () => region.status(),
    pluginRoles: () => pluginRoles.ReadPluginRoles({ contractVersion: 'world-inspection/v1', requestId: randomUUID() }),
    async tools() {
      const tools = ctx.get('tools'), skills = ctx.get('skills')
      if (!tools) throw new Error('TOOLS_REGISTRY_UNAVAILABLE')
      if (!skills) throw new Error('SKILLS_REGISTRY_UNAVAILABLE')
      return { tools: tools.schemas(), skills: await skills.snapshot() }
    } })
}
