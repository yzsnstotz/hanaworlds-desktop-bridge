/** Adapted from bd964cdf deferred/authorized-039/src/workshop-fixture.ts.deferred.
 * SOURCE/FIXTURE: in-memory projection of Workshop turns, never a production model or build engine.
 * Obsolete authorization JSON was removed; every request/response uses released session/v5.
 */
import { randomUUID } from 'node:crypto'
import { contractHandshake, validateRequest, validateBoundResponse, validateType } from 'hanaworlds-contracts'
import type { createViewFixture } from './view-fixture.ts'

export const fixtureCapabilities = validateType('PublicCapabilities', {
  providerRef: 'FIXTURE/workshop', capabilityRevision: 'FIXTURE/revision/1', worldRef: null, engineBounds: null,
  worldGeometry: null, limits: [], recoveryGuarantee: null, stateProfile: null, sessionDeleteSupported: false,
  imageMediaTypes: [], model: 'FIXTURE/model', engineGuards: null,
})
export const fixtureControls = { purpose: null, dimensions: null, entrancePortalRefs: [], styleText: null, siteRules: null }

export function createWorkshopFixture(canvas: ReturnType<typeof createViewFixture>) {
  const states = new Map<string, { revision: string; turns: any[]; pending: any; localContext: any }>()
  const requests: { operation: string; request: any }[] = []
  const failures = new Map<string, (request: any) => unknown>()
  const state = (id: string) => {
    if (!states.has(id)) states.set(id, { revision: 'FIXTURE/session/1', turns: [], pending: null, localContext: canvas.context(id) })
    return states.get(id)!
  }
  const snapshot = (id: string, current: ReturnType<typeof state>) => ({
    context: { currentSession: id, activeWorldRef: current.localContext?.worldRef ?? null, orderedSelectedObjectRefs: [],
      sessionRevision: current.revision, selectionRevision: current.localContext?.selectionRevision ?? '0', localContext: current.localContext },
    turns: current.turns.map(t => ({ turnRef: t.turnRef, turnRevision: t.turnRevision, text: t.text, media: [],
      referenceBriefDigest: null, intentDigest: null, actionReceiptDigest: null })), capabilities: fixtureCapabilities, sessionDeleteSupported: false,
  })
  return {
    source: 'FIXTURE' as const, contractHandshake, requests, failures,
    pending(id: string) { return state(id).pending },
    snapshot(id: string) { return snapshot(id, state(id)) },
    async describeWriteTools() { return { source: 'FIXTURE', methods: [] } },
    async call(operation: string, raw: unknown) {
      const request: any = validateRequest('session/v5', operation as never, raw)
      requests.push({ operation, request })
      const failure = failures.get(operation)
      if (failure) return failure(request)
      const current = state(request.sessionRef)
      const packet = (result: unknown, error: unknown = null) => validateBoundResponse('session/v5', operation as never, request,
        { contractVersion: 'session/v5', requestId: request.requestId, result, error })
      if (request.expectedRevision != null && request.expectedRevision !== current.revision) return packet(null, {
        code: 'STALE_REVISION', phase: 'validate', retryability: 'AFTER_NEW_FACTS', mutationState: 'NONE',
        transactionRef: null, causeCode: null, reason: 'REVISION_CHANGED',
      })
      if (operation === 'StartOrResumeSession') return packet(snapshot(request.sessionRef, current))
      if (operation === 'SwitchWorldContext') {
        current.localContext = request.localContext; current.revision = `FIXTURE/revision/${randomUUID()}`
        return packet(snapshot(request.sessionRef, current))
      }
      if (operation === 'ReadSessionTurnDetails') return packet({ sessionRef: request.sessionRef, sessionRevision: current.revision,
        turns: current.turns.map(t => ({ turnRef: t.turnRef, turnRevision: t.turnRevision,
          userText: t.text, resultText: t.resultText, confirmedBrief: t.confirmedBrief ?? null })) })
      let turn: any
      if (operation === 'AppendMultimodalTurn') {
        if (current.pending) throw new Error('FIXTURE_PENDING_ROUND')
        turn = { turnRef: request.turnRef, turnRevision: `FIXTURE/turn/${randomUUID()}`, text: request.text,
          resultText: '请确认当前工作坊轮次（FIXTURE）。' }
        current.turns.push(turn)
        current.pending = { sessionRef: request.sessionRef, turnRevision: turn.turnRevision, invocationId: request.requestId,
          clarificationId: `FIXTURE/clarification/${randomUUID()}`, code: 'AMBIGUOUS_INTENT', question: turn.resultText }
      } else if (operation === 'AnswerClarification') {
        turn = current.turns.at(-1)
        if (!turn || current.pending?.clarificationId !== request.clarificationId || turn.turnRef !== request.turnRef) throw new Error('FIXTURE_WRONG_ROUND')
        turn.resultText = '已确认当前工作坊轮次（FIXTURE）。'; current.pending = null
        turn.confirmedBrief = { contractVersion: 'ReferenceBrief/v5', sessionRef: request.sessionRef,
          turnRevision: turn.turnRevision, briefRevision: `FIXTURE/brief/${randomUUID()}`, media: [], text: turn.text,
          controls: fixtureControls }
      } else throw new Error('FIXTURE_UNSUPPORTED_SESSION_OPERATION')
      current.revision = `FIXTURE/revision/${randomUUID()}`
      return packet({ sessionRef: request.sessionRef, turnRef: turn.turnRef, turnRevision: turn.turnRevision,
        briefDigest: null, model: 'FIXTURE/model', resultText: turn.resultText, clarification: current.pending })
    },
  }
}
