/** Adapted from bd964cdf deferred/authorized-039/src/view-fixture.ts.deferred.
 * SOURCE/FIXTURE only: the old in-game grants become published canvas/v7 selection facts.
 * Core Sessions are installed by the test harness; this peer owns no real world lifecycle.
 */
import { contractHandshake, validateRequest, validateBoundResponse, validateType } from 'hanaworlds-contracts'

export const fixtureIds = ['hanaworlds-view-alpha', 'hanaworlds-view-beta']
export function createViewFixture() {
  const contexts = new Map(fixtureIds.map((id, index) => [id, validateType('LocalWorldContext', {
    connectionRef: `FIXTURE/connection/${index + 1}`, connectionIncarnationRef: 'FIXTURE/incarnation/1',
    worldRef: `FIXTURE/world/${index + 1}`, selectionRevision: 'FIXTURE/selection/1',
  })]))
  const absent = new Set<string>()
  let generation = 1
  const requests: { operation: string; request: any }[] = []
  return {
    source: 'FIXTURE' as const, contractHandshake, requests,
    context(id: string) { return absent.has(id) ? null : contexts.get(id) ?? null },
    act(id: string, action: 'revoke' | 'regrant' | 'disconnect' | 'reconnect') {
      const previous = contexts.get(id)
      if (!previous) throw new Error('FIXTURE_SESSION_UNKNOWN')
      if (action === 'revoke' || action === 'disconnect') absent.add(id)
      else { generation++; absent.delete(id); contexts.set(id, { ...previous,
        selectionRevision: `FIXTURE/selection/${generation}`,
        connectionIncarnationRef: `FIXTURE/incarnation/${generation}` }) }
    },
    async call(operation: string, raw: unknown) {
      if (!['ReadWorldSelectionContext', 'SelectWorldConnection'].includes(operation)) throw new Error('FIXTURE_UNSUPPORTED_CANVAS_OPERATION')
      const request: any = validateRequest('canvas/v7', operation as never, raw)
      requests.push({ operation, request })
      if (operation === 'SelectWorldConnection') {
        generation++; absent.delete(request.sessionRef)
        const context = validateType('LocalWorldContext', { connectionRef: request.connectionRef,
          connectionIncarnationRef: request.connectionIncarnationRef, worldRef: request.worldRef,
          selectionRevision: `FIXTURE/selection/${generation}` })
        contexts.set(request.sessionRef, context)
        return validateBoundResponse('canvas/v7', 'SelectWorldConnection', request, {
          contractVersion: 'canvas/v7', requestId: request.requestId, error: null,
          result: { currentSession: request.sessionRef, activeWorldRef: context.worldRef, orderedSelectedObjectRefs: [],
            sessionRevision: request.expectedRevision, selectionRevision: context.selectionRevision, localContext: context },
        })
      }
      const context = this.context(request.sessionRef)
      const selection = context && context.worldRef === request.worldRef
        ? { status: 'BOUND', connectionRef: context.connectionRef, context: {
          currentSession: request.sessionRef, activeWorldRef: context.worldRef, orderedSelectedObjectRefs: [],
          sessionRevision: 'FIXTURE/canvas/revision/1', selectionRevision: context.selectionRevision, localContext: context,
        } }
        : { status: 'UNBOUND', sessionRef: request.sessionRef, sessionRevision: 'FIXTURE/canvas/revision/1' }
      return validateBoundResponse('canvas/v7', operation, request, { contractVersion: 'canvas/v7', requestId: request.requestId,
        result: { sessionRef: request.sessionRef, worldRef: request.worldRef,
          inventory: { capabilityRevision: 'FIXTURE/inventory/1', connections: [] }, selection }, error: null })
    },
  }
}
