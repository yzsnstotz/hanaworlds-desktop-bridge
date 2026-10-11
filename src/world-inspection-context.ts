/** C-world-inspection provider: Canvas owns session/world/object selection facts. */
import { randomUUID } from 'node:crypto'
import { validateRequest, validateBoundResponse, contractHandshake, type ReadInspectionContextResponse } from 'hanaworlds-contracts'
import { callLocal, type DomainPort } from './local-protocol.ts'
import { serviceIdentity } from './image-media.ts'
interface Services { session(id: string): object | undefined; canvas(): DomainPort | undefined }
export class DesktopWorldInspectionContext {
  readonly contractHandshake = contractHandshake
  constructor(private readonly services: Services) {}
  async ReadInspectionContext(raw: unknown): Promise<ReadInspectionContextResponse> {
    const request = validateRequest('world-inspection/v1', 'ReadInspectionContext', raw)
    const packet = (result: ReadInspectionContextResponse['result'], code?: 'SESSION_NOT_FOUND' | 'WORLD_NOT_BOUND') =>
      validateBoundResponse('world-inspection/v1', 'ReadInspectionContext', request, {
        contractVersion: 'world-inspection/v1', requestId: request.requestId, result,
        error: code ? { code, phase: 'validate', retryability: 'AFTER_NEW_FACTS', mutationState: 'NONE',
          transactionRef: null, causeCode: null, reason: 'REQUIRED_FACT_UNKNOWN' } : null,
      })
    const session = this.services.session(request.sessionRef), canvas = this.services.canvas()
    if (!session) return packet(null, 'SESSION_NOT_FOUND')
    if (!canvas) return packet(null, 'WORLD_NOT_BOUND')
    const read = await callLocal(canvas, 'canvas/v7', 'ReadWorldSelectionContext', {
      contractVersion: 'canvas/v7', requestId: randomUUID(), sessionRef: request.sessionRef, worldRef: request.worldRef,
    })
    if (this.services.session(request.sessionRef) !== session) return packet(null, 'SESSION_NOT_FOUND')
    if (serviceIdentity(this.services.canvas()) !== serviceIdentity(canvas) || read.selection.status !== 'BOUND') return packet(null, 'WORLD_NOT_BOUND')
    const context = read.selection.context
    if (context.currentSession !== request.sessionRef || context.activeWorldRef !== request.worldRef
      || context.localContext?.worldRef !== request.worldRef) return packet(null, 'WORLD_NOT_BOUND')
    return packet({ sessionRef: request.sessionRef, worldRef: request.worldRef,
      localContext: context.localContext, orderedSelectedObjectRefs: context.orderedSelectedObjectRefs })
  }
}
