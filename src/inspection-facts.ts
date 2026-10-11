/** Join public Canvas selection, inventory and logical revision for Adapter object inspection. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { validateRequest, canonicalJSON } from 'hanaworlds-contracts'
import { callLocal, sameLocalContext, type DomainPort } from './local-protocol.ts'
import type { DesktopWorkshopTransport } from './workshop-transport.ts'
import { serviceIdentity } from './image-media.ts'
interface Services { canvas(): DomainPort | undefined; revision(): { read(worldRef: string): Promise<unknown> } | undefined }
export class DesktopInspectionFacts {
  private readonly active = new AsyncLocalStorage<{ invocationRef: string; request: string; facts: unknown }>()
  /** Resolve a Canvas inspection target against public inventory before entering the Adapter serial queue. */
  async run(raw: unknown, call: () => Promise<unknown>, canvasInspection?: unknown): Promise<unknown> {
    const facts = await this.derive(raw, canvasInspection)
    const current = this.transport.trustedInvocation()
    return this.active.run({ invocationRef: current.invocationRef, request: canonicalJSON(raw), facts }, call)
  }
  /** The Adapter callback receives only the snapshot captured for this exact live invocation. */
  read(raw: unknown): Promise<unknown> {
    const captured = this.active.getStore(), current = this.transport.trustedInvocation()
    if (!captured || captured.invocationRef !== current.invocationRef || captured.request !== canonicalJSON(raw)) {
      throw new Error('INSPECTION_FACTS_UNAVAILABLE')
    }
    return Promise.resolve(structuredClone(captured.facts))
  }
  constructor(private readonly transport: DesktopWorkshopTransport, private readonly services: Services) {}
  private async derive(raw: unknown, canvasInspection?: unknown): Promise<unknown> {
    const request = validateRequest('world-adapter/v8', 'InspectWorld', raw)
    const current = this.transport.trustedInvocation(), canvas = this.services.canvas(), oracle = this.services.revision()
    if (!canvas || !oracle) throw new Error('INSPECTION_FACTS_UNAVAILABLE')
    if (request.sessionRef !== current.sessionRef || !sameLocalContext(request.localContext, current.localContext)) throw new Error('LOCAL_CONTEXT_REQUIRED')
    const target = canvasInspection === undefined ? undefined : validateRequest('canvas/v7', 'InspectObject', canvasInspection)
    if (target && (target.sessionRef !== current.sessionRef || target.worldRef !== request.worldRef
      || !sameLocalContext(target.localContext, current.localContext)
      || canonicalJSON(target.sampledBounds) !== canonicalJSON(request.sampledBounds))) throw new Error('LOCAL_CONTEXT_REQUIRED')
    await current.check()
    const base = { contractVersion: 'canvas/v7', sessionRef: current.sessionRef, worldRef: current.localContext.worldRef }
    const { selection } = await callLocal(canvas, 'canvas/v7', 'ReadWorldSelectionContext', { ...base, requestId: randomUUID() })
    if (selection.status !== 'BOUND' || selection.context.currentSession !== current.sessionRef
      || !sameLocalContext(selection.context.localContext, current.localContext)
      || (!target && selection.context.orderedSelectedObjectRefs.length !== 1)) throw new Error('TARGET_REQUIRED')
    const objectRef = target ? target.objectRef : selection.context.orderedSelectedObjectRefs[0]
    const inventory = await callLocal(canvas, 'canvas/v7', 'ListObjects', { ...base, requestId: randomUUID(),
      localContext: current.localContext, expectedRevision: null })
    const object = inventory.objects.find(value => value.objectRef === objectRef)
    if (!object || object.worldRef !== request.worldRef || object.status !== 'READY'
      || (target && object.objectRevision !== target.expectedRevision)) throw new Error('TARGET_REQUIRED')
    const worldRevision = await oracle.read(request.worldRef)
    await current.check()
    if (serviceIdentity(this.services.canvas()) !== serviceIdentity(canvas)
      || serviceIdentity(this.services.revision()) !== serviceIdentity(oracle)
      || worldRevision !== request.expectedWorldRevision) throw new Error('CURRENT_WORLD_MISMATCH')
    return { current: true, worldRef: request.worldRef, worldRevision, objectRef, objectRevision: object.objectRevision }
  }
}
