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
  const reservations = new Map<string, string>()
  const retired = new Set<string>()
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
      if (!['ReadWorldSelectionContext', 'SelectWorldConnection', 'ListWorldSelections', 'ReserveWorldRetirement', 'ReleaseWorldRetirement'].includes(operation)) throw new Error('FIXTURE_UNSUPPORTED_CANVAS_OPERATION')
      const request: any = validateRequest('canvas/v7', operation as never, raw)
      requests.push({ operation, request })
      const reply = (result: unknown, code?: string) => validateBoundResponse('canvas/v7', operation as never, request, {
        contractVersion: 'canvas/v7', requestId: request.requestId, result,
        error: code ? { code, phase: 'validate', retryability: 'AFTER_NEW_FACTS', mutationState: 'NONE',
          transactionRef: null, causeCode: null, reason: code === 'WORLD_NOT_FOUND' ? 'IDENTITY_UNVERIFIED' : 'SCOPE_DENIED' } : null,
      })
      const revision = () => `FIXTURE/inventory/${generation}`
      // Durable selections survive disconnect/revoke; retirement must include them.
      const selecting = () => [...contexts].filter(([, context]) => context.worldRef === request.worldRef).map(([id]) => id)
      if (operation === 'ListWorldSelections') return reply({ worldRef: request.worldRef, inventoryRevision: revision(),
        sessionRefs: selecting(), retirementReservationRef: reservations.get(request.worldRef) ?? null })
      if (operation === 'ReserveWorldRetirement') {
        if (selecting().length || reservations.has(request.worldRef) || request.expectedInventoryRevision !== revision()) return reply(null, 'TRANSACTION_CONFLICT')
        const reservationRef = `FIXTURE/reservation/${generation}`
        reservations.set(request.worldRef, reservationRef)
        return reply({ worldRef: request.worldRef, reservationRef, inventoryRevision: revision() })
      }
      if (operation === 'ReleaseWorldRetirement') {
        if (reservations.get(request.worldRef) !== request.reservationRef) return reply(null, 'TRANSACTION_CONFLICT')
        reservations.delete(request.worldRef)
        if (request.outcome === 'RETIRED') retired.add(request.worldRef)
        generation++
        return reply({ worldRef: request.worldRef, reservationRef: request.reservationRef, outcome: request.outcome, inventoryRevision: revision() })
      }
      if (operation === 'SelectWorldConnection') {
        if (retired.has(request.worldRef)) return reply(null, 'WORLD_NOT_FOUND')
        if (reservations.has(request.worldRef)) return reply(null, 'TRANSACTION_CONFLICT')
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
