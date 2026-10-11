/** In-process dispatch ordering: Workshop calls Canvas; only Canvas calls Adapter mutators. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { validateRequest, validateBoundResponse, validateRegionCommit, validateType,
  checkProtocolCompatibility, protocolRequirement, regionCapabilities, type MaterialSourceFactsPort } from 'hanaworlds-contracts'
import { callLocal, sameLocalContext, type DomainPort } from './local-protocol.ts'
import type { DesktopWorkshopTransport } from './workshop-transport.ts'
import type { DesktopBindingView } from './view-binding.ts'
import { serviceIdentity as same } from './image-media.ts'
export type { DomainPort } from './local-protocol.ts'
export interface NativeFactsPort {
  readCatalogue(worldRef: string): Promise<unknown>
  /** contracts 0.4.2 additive method; an older Adapter lacks it and the Host reports that gap. */
  readMaterialSources?: MaterialSourceFactsPort['readMaterialSources']
  /** Adapter G3 public callback evidence bound to one paired Catalogue snapshot. */
  readWritePathEvidence?(worldRef: string): Promise<unknown>
  readScopedState(connectionRef: string, positions: readonly (readonly [number, number, number])[]): Promise<{
    worldRef: string
    stateProfile: unknown
    cells: readonly unknown[]
  }>
}
interface Services {
  inspection?(): { run(raw: unknown, call: () => Promise<unknown>, canvasInspection?: unknown): Promise<unknown> }
  canvas(): DomainPort | undefined
  adapter(): DomainPort | undefined
  nativeFacts(): NativeFactsPort | undefined
  /** Canvas's own `hanaworldsCanvasRegionV1`; Canvas alone reaches the Adapter region port. */
  canvasRegion?(): RegionCallPort | undefined
  adapterRegion?(): RegionCallPort | undefined
}
export interface RegionCallPort { readonly protocolHandshake: unknown; call(operation: string, request: unknown): Promise<unknown> }
const canvasRegionOperations = new Set(['ApplyRegionCommit', 'UndoRegionCommit'])
const adapterRegionOperations = new Set(['ReadRegion', 'WriteRegion'])
const requireRegionProtocol = (wire: string, handshake: unknown) => checkProtocolCompatibility(handshake ?? null,
  [protocolRequirement(wire, regionCapabilities.map(capability => capability.id).filter(id => id.startsWith(`${wire}:`)).sort())])
interface Invocation {
  captured: ReturnType<DesktopWorkshopTransport['trustedInvocation']>
  canvas: DomainPort
  adapter: DomainPort | undefined
  canvasRegion: RegionCallPort | undefined
  adapterRegion: RegionCallPort | undefined
  open: boolean
}
interface CanvasCall { scope: Invocation; open: boolean }
const adapterReads = new Set(['DiscoverConnections', 'ListWorlds', 'ReadLocalConnection', 'InspectWorld', 'InspectRegion'])
const canvasReads = new Set(['ReadWorldSelectionContext', 'ListWorldConnections', 'SelectWorldConnection', 'SwitchWorldConnection', 'ListObjects', 'HistoryQuery'])
const retirementOperations = new Set(['ListWorldSelections', 'ReserveWorldRetirement', 'ReleaseWorldRetirement'])
function deny(): never { throw new Error('LOCAL_DISPATCH_REQUIRED') }
/** The call stack, not a serialized role or permission field, separates internal world writes. */
export class DesktopBuildBridge {
  private readonly retirement = new AsyncLocalStorage<{ canvas: DomainPort; worldRef: string; open: boolean }>()
  private readonly active = new AsyncLocalStorage<Invocation>()
  private readonly checking = new AsyncLocalStorage<boolean>()
  private readonly canvasCall = new AsyncLocalStorage<CanvasCall>()
  private readonly regionCanvasCall = new AsyncLocalStorage<CanvasCall>()
  private readonly canvasInspection = new AsyncLocalStorage<unknown>()
  private readonly wrapped = new WeakSet<object>()
  private readonly disposers: (() => void)[] = []
  constructor(private readonly transport: DesktopWorkshopTransport, private readonly services: Services) { this.bind() }
  private bind(): void {
    const canvas = this.services.canvas(), adapter = this.services.adapter()
    if (canvas) this.wrap(canvas, 'canvas')
    if (adapter) this.wrap(adapter, 'adapter')
    const region = this.services.canvasRegion?.(), adapterRegion = this.services.adapterRegion?.()
    if (region) this.wrapRegion(region, 'canvas')
    if (adapterRegion) this.wrapRegion(adapterRegion, 'adapter')
  }
  /** Canvas region transactions run only inside a live Host region dispatch for the same Session/world. */
  private wrapRegion(port: RegionCallPort, kind: 'canvas' | 'adapter'): void {
    if (this.wrapped.has(same(port) ?? port)) return
    const registered = same(port) ?? port
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Restored verbatim and called with its owning service.
    const original = registered.call
    const { active, checking, services, canvasCall, regionCanvasCall } = this
    const wrapper = async function(this: RegionCallPort, operation: string, raw: unknown): Promise<unknown> {
      const scope = active.getStore()
      if (!scope?.open || !(kind === 'canvas' ? canvasRegionOperations : adapterRegionOperations).has(operation)) deny()
      const frame = regionCanvasCall.getStore()
      const liveFrame = () => { if (kind === 'adapter' && (!frame?.open || frame.scope !== scope)) deny() }
      liveFrame()
      const peers = () => {
        if (same(services.canvasRegion?.()) !== same(scope.canvasRegion)
          || same(services.adapterRegion?.()) !== same(scope.adapterRegion)
          || same(port) !== same(kind === 'canvas' ? scope.canvasRegion : scope.adapterRegion)) deny()
      }
      peers()
      const decode = validateRequest as (wire: string, operation: string, raw: unknown) => Record<string, unknown>
      const wire = kind === 'canvas' ? 'canvas-region/v3' : 'world-adapter-region/v3'
      requireRegionProtocol(wire, port.protocolHandshake)
      if (kind === 'canvas') requireRegionProtocol('world-adapter-region/v3', scope.adapterRegion?.protocolHandshake)
      const request = decode(wire, operation, raw)
      const current = scope.captured.localContext
      if (request.sessionRef !== scope.captured.sessionRef || request.worldRef !== current.worldRef
        || !sameLocalContext(request.localContext as typeof current, current)) deny()
      await checking.run(true, () => scope.captured.check())
      peers()
      liveFrame()
      const call = () => original.call(this, operation, request)
      const response = kind === 'canvas'
        ? await (() => {
          const frame = { scope, open: true }
          return canvasCall.run(frame, () => regionCanvasCall.run(frame,
            async () => { try { return await call() } finally { frame.open = false } }))
        })() : await call()
      await checking.run(true, () => scope.captured.check())
      peers()
      liveFrame()
      if (kind === 'canvas' && operation === 'ApplyRegionCommit') return validateRegionCommit(request, response)
      const validate = validateBoundResponse as (wire: string, operation: string, request: unknown, response: unknown) => unknown
      return validate(wire, operation, request, response)
    }
    registered.call = wrapper; this.wrapped.add(registered)
    this.disposers.push(() => { if (registered.call === wrapper) registered.call = original })
  }
  private wrap(port: DomainPort, kind: 'canvas' | 'adapter'): void {
    if (this.wrapped.has(same(port) ?? port)) return
    const registered = same(port) ?? port
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Restored verbatim and called with its owning service.
    const original = registered.call
    const { active, services, canvasCall, checking, canvasInspection, retirement } = this
    const wrapper = async function(this: DomainPort, operation: string, raw: unknown): Promise<unknown> {
      const retiring = retirement.getStore()
      if (kind === 'canvas' && retiring?.open && retirementOperations.has(operation)) {
        // Retirement is world-scoped and independent of a selected Session's build authorization.
        const decode = validateRequest as (wire: string, operation: string, raw: unknown) => Record<string, unknown>
        const request = decode('canvas/v7', operation, raw)
        if (same(port) !== same(retiring.canvas) || request.worldRef !== retiring.worldRef) deny()
        // Release must reach the captured reservation owner even if the live registration changed.
        if (operation !== 'ReleaseWorldRetirement' && same(services.canvas()) !== same(retiring.canvas)) deny()
        const response = await original.call(this, operation, request)
        const validate = validateBoundResponse as (wire: string, operation: string, request: unknown, response: unknown) => unknown
        return validate('canvas/v7', operation, request, response)
      }
      const scope = active.getStore()
      if (!scope?.open) {
        if (!(kind === 'canvas' ? canvasReads : adapterReads).has(operation)) deny()
        return original.call(this, operation, raw)
      }
      if (same(services.canvas()) !== same(scope.canvas) || same(services.adapter()) !== same(scope.adapter)
        || same(port) !== same(kind === 'canvas' ? scope.canvas : scope.adapter)) deny()
      const frame = canvasCall.getStore()
      const liveFrame = () => {
        if (kind === 'adapter' && !adapterReads.has(operation) && (!frame?.open || frame.scope !== scope)) deny()
      }
      liveFrame()
      const wire = kind === 'canvas' ? 'canvas/v7' : 'world-adapter/v8'
      const decode = validateRequest as (wire: string, operation: string, raw: unknown) => Record<string, unknown>
      const request = decode(wire, operation, raw)
      const current = scope.captured.localContext
      if (request.sessionRef !== scope.captured.sessionRef || ('worldRef' in request && request.worldRef !== current.worldRef)) deny()
      if ('localContext' in request && !sameLocalContext(request.localContext as typeof current, current)) deny()
      if (checking.getStore()) {
        if (!['ReadWorldSelectionContext', 'ReadLocalConnection'].includes(operation)) deny()
        return original.call(this, operation, request)
      }
      await checking.run(true, () => scope.captured.check())
      liveFrame()
      const call = () => original.call(this, operation, request)
      const response = kind === 'canvas' ? await (() => {
        const frame = { scope, open: true }
        return canvasCall.run(frame, async () => {
          try { return await canvasInspection.run(operation === 'InspectObject' ? request : undefined, call) }
          finally { frame.open = false }
        })
      })()
        : operation === 'InspectWorld' && services.inspection
          ? await services.inspection().run(request, call, canvasInspection.getStore()) : await call()
      await checking.run(true, () => scope.captured.check())
      liveFrame()
      const validate = validateBoundResponse as (wire: string, operation: string, request: unknown, response: unknown) => unknown
      return validate(wire, operation, request, response)
    }
    registered.call = wrapper; this.wrapped.add(registered)
    this.disposers.push(() => { if (registered.call === wrapper) registered.call = original })
  }
  /** Internal product deletion scope. Never exported as a route or serialized authority. */
  async runWorldRetirement<T>(worldRef: string, work: () => Promise<T>): Promise<T> {
    this.bind()
    const canvas = this.services.canvas()
    if (!canvas) throw new Error('CANVAS_UNAVAILABLE')
    const scope = { canvas, worldRef, open: true }
    return this.retirement.run(scope, async () => { try { return await work() } finally { scope.open = false } })
  }
  async run(call: () => Promise<unknown>): Promise<unknown> {
    this.bind()
    const captured = this.transport.trustedInvocation(), canvas = this.services.canvas()
    if (!canvas) throw new Error('CANVAS_UNAVAILABLE')
    const scope: Invocation = { captured, canvas, adapter: this.services.adapter(),
      canvasRegion: this.services.canvasRegion?.(), adapterRegion: this.services.adapterRegion?.(), open: true }
    return this.active.run(scope, async () => { try { return await call() } finally { scope.open = false } })
  }
  /** Read panel records from the captured Canvas, fenced by the page lease on both sides of every call. */
  private panelReader(view: DesktopBindingView, assertLive: () => Promise<void>) {
    this.bind()
    const canvas = this.services.canvas()
    if (!canvas) throw new Error('CANVAS_UNAVAILABLE')
    const check = async () => {
      await assertLive()
      if (same(this.services.canvas()) !== same(canvas)) throw new Error('CANVAS_REPLACED')
    }
    const fields = () => ({ contractVersion: 'canvas/v7' as const, requestId: randomUUID(),
      sessionRef: view.sessionId, worldRef: view.worldRef, localContext: view.localContext })
    return {
      async objects() {
        await check()
        const result = await callLocal(canvas, 'canvas/v7', 'ListObjects', { ...fields(), expectedRevision: null })
        await check()
        if (result.objects.some(object => object.worldRef !== view.worldRef)) throw new Error('CURRENT_WORLD_MISMATCH')
        return result
      },
      async history(objectRef: string) {
        await check()
        const result = await callLocal(canvas, 'canvas/v7', 'HistoryQuery', { ...fields(), objectRef, expectedHistoryRevision: null })
        await check()
        if (result.objectRef !== objectRef) throw new Error('HISTORY_OBJECT_MISMATCH')
        return result
      },
    }
  }
  async objects(view: DesktopBindingView, assertLive: () => Promise<void>) {
    return this.panelReader(view, assertLive).objects()
  }
  async history(view: DesktopBindingView, objectRef: string, assertLive: () => Promise<void>) {
    const reader = this.panelReader(view, assertLive), inventory = await reader.objects()
    if (!inventory.objects.some(object => object.objectRef === objectRef)) throw new Error('OBJECT_NOT_IN_CURRENT_WORLD')
    return reader.history(objectRef)
  }
  /** Canvas owns both inventories; the bridge never constructs history entries from a build receipt. */
  async panels(view: DesktopBindingView, assertLive: () => Promise<void>) {
    const reader = this.panelReader(view, assertLive), objects = await reader.objects()
    const histories = []
    for (const object of objects.objects) histories.push(await reader.history(object.objectRef))
    return { objects, histories }
  }
  /** Read only the actual Adapter public scoped-state port; logical revisions belong to Canvas. */
  async stateProfile(worldRef: string): Promise<unknown> {
    const current = this.transport.trustedInvocation(), port = this.services.nativeFacts()
    if (!port) throw new Error('NATIVE_FACTS_UNAVAILABLE')
    if (worldRef !== current.localContext.worldRef) deny()
    await current.check()
    const result = await port.readScopedState(current.localContext.connectionRef, [])
    if (same(this.services.nativeFacts()) !== same(port) || result.worldRef !== worldRef) deny()
    await current.check()
    return validateType('StateProfile', result.stateProfile)
  }
  /** Read the paired world's full material catalogue from the public Adapter supplier. */
  async catalogue(worldRef: string): Promise<unknown> {
    const current = this.transport.trustedInvocation(), port = this.services.nativeFacts()
    if (!port) throw new Error('NATIVE_FACTS_UNAVAILABLE')
    if (worldRef !== current.localContext.worldRef) deny()
    await current.check()
    const result = await port.readCatalogue(worldRef)
    if (same(this.services.nativeFacts()) !== same(port)) deny()
    await current.check()
    return validateType('Catalogue', result)
  }
  close(): void { for (const dispose of this.disposers.splice(0).reverse()) dispose() }
}
