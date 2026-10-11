/** In-process dispatch ordering: Workshop calls Canvas; only Canvas calls Adapter mutators. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { validateRequest, validateBoundResponse, validateType, type MaterialSourceFactsPort } from 'hanaworlds-contracts'
import { sameLocalContext, type DomainPort } from './local-protocol.ts'
import type { DesktopWorkshopTransport } from './workshop-transport.ts'
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
}
export interface RegionCallPort { readonly protocolHandshake: unknown; call(operation: string, request: unknown): Promise<unknown> }
const canvasRegionOperations = new Set(['ApplyRegionCommit', 'UndoRegionCommit'])
interface Invocation { captured: ReturnType<DesktopWorkshopTransport['trustedInvocation']>; canvas: DomainPort; adapter: DomainPort | undefined; open: boolean }
const adapterReads = new Set(['DiscoverConnections', 'ListWorlds', 'ReadLocalConnection', 'InspectWorld', 'InspectRegion'])
const canvasReads = new Set(['ReadWorldSelectionContext', 'ListWorldConnections', 'SelectWorldConnection', 'SwitchWorldConnection', 'ListObjects'])
const retirementOperations = new Set(['ListWorldSelections', 'ReserveWorldRetirement', 'ReleaseWorldRetirement'])
function deny(): never { throw new Error('LOCAL_DISPATCH_REQUIRED') }
/** The call stack, not a serialized role or permission field, separates internal world writes. */
export class DesktopBuildBridge {
  private readonly retirement = new AsyncLocalStorage<{ canvas: DomainPort; worldRef: string; open: boolean }>()
  private readonly active = new AsyncLocalStorage<Invocation>()
  private readonly checking = new AsyncLocalStorage<boolean>()
  private readonly canvasCall = new AsyncLocalStorage<Invocation>()
  private readonly canvasInspection = new AsyncLocalStorage<unknown>()
  private readonly wrapped = new WeakSet<object>()
  private readonly disposers: (() => void)[] = []
  constructor(private readonly transport: DesktopWorkshopTransport, private readonly services: Services) { this.bind() }
  private bind(): void {
    const canvas = this.services.canvas(), adapter = this.services.adapter()
    if (canvas) this.wrap(canvas, 'canvas')
    if (adapter) this.wrap(adapter, 'adapter')
    const region = this.services.canvasRegion?.()
    if (region) this.wrapRegion(region)
  }
  /** Canvas region transactions run only inside a live Host region dispatch for the same Session/world. */
  private wrapRegion(port: RegionCallPort): void {
    if (this.wrapped.has(same(port) ?? port)) return
    const registered = same(port) ?? port
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Restored verbatim and called with its owning service.
    const original = registered.call
    const { active, checking } = this
    const wrapper = async function(this: RegionCallPort, operation: string, raw: unknown): Promise<unknown> {
      const scope = active.getStore()
      if (!scope?.open || !canvasRegionOperations.has(operation)) deny()
      const decode = validateRequest as (wire: string, operation: string, raw: unknown) => Record<string, unknown>
      const request = decode('canvas-region/v3', operation, raw)
      const current = scope.captured.localContext
      if (request.sessionRef !== scope.captured.sessionRef || request.worldRef !== current.worldRef
        || !sameLocalContext(request.localContext as typeof current, current)) deny()
      await checking.run(true, () => scope.captured.check())
      const response = await original.call(this, operation, request)
      await checking.run(true, () => scope.captured.check())
      return response
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
      if (kind === 'adapter' && !adapterReads.has(operation) && canvasCall.getStore() !== scope) deny()
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
      const call = () => original.call(this, operation, request)
      const response = kind === 'canvas' ? await canvasCall.run(scope, () =>
        canvasInspection.run(operation === 'InspectObject' ? request : undefined, call))
        : operation === 'InspectWorld' && services.inspection
          ? await services.inspection().run(request, call, canvasInspection.getStore()) : await call()
      await checking.run(true, () => scope.captured.check())
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
    const scope: Invocation = { captured, canvas, adapter: this.services.adapter(), open: true }
    return this.active.run(scope, async () => { try { return await call() } finally { scope.open = false } })
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
