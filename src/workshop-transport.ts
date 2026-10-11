/** Host-only session association and strict current-protocol Workshop dispatch. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { validateRequest, validateBoundResponse, checkContractHandshake, validateType, validateRegionProposalRequest, type LocalWorldContext, type SessionSnapshot } from 'hanaworlds-contracts'
import { sameLocalContext, type DomainPort } from './local-protocol.ts'
import { serviceIdentity as same } from './image-media.ts'
const operations = new Set(['StartOrResumeSession', 'SwitchWorldContext', 'AppendMultimodalTurn', 'AnswerClarification',
  'ReadSessionTurnDetails', 'ReadCurrentUndoStatus', 'UndoCurrentBuild', 'AdvanceCurrentBuild', 'InvokeAction'])
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function deny(): never { throw new Error('LOCAL_CONTEXT_REQUIRED') }
interface Services {
  session(id: string): object | undefined
  localContext(id: string): Promise<LocalWorldContext | null>
  workshop(): DomainPort | undefined
  recordInput(sessionRef: string, requestId: string, text: string): Promise<void>
  domain?(): { run(call: () => Promise<unknown>): Promise<unknown> } | undefined
}
interface Scope {
  open: boolean
  session: object
  sessionRef: string
  localContext: LocalWorldContext
  port: DomainPort
  operation: string
  request: Record<string, unknown>
  invocationRef: string
  /** Workshop's own public snapshot of the current turn, read before a region proposal takes its lock. */
  turnFacts?: { turnRevision: string; briefDigest: string | null }
  assertLive(): Promise<void>
}
/** Workshop 0.4.0 region write-method methods dispatched by the Host on behalf of the skill. */
export type RegionOperation = 'readWriteProposalContext' | 'submitWriteProposal' | 'advanceRegionBuild' | 'undoRegionBuild'
/** Captures actual Session and connection objects; JSON cannot create an invocation. */
export class DesktopWorkshopTransport {
  private readonly active = new AsyncLocalStorage<Scope>()
  private readonly busy = new Set<string>()
  private readonly reads = new Map<string, Promise<void>>()
  constructor(private readonly services: Services) {}
  private async check(scope: Scope): Promise<void> {
    await scope.assertLive()
    const current = await this.services.localContext(scope.sessionRef)
    if (!scope.open || this.services.session(scope.sessionRef) !== scope.session || same(this.services.workshop()) !== same(scope.port)
      || !sameLocalContext(current, scope.localContext)) deny()
    await scope.assertLive()
  }
  /** Capture the current in-process dispatch for internal peer call ordering. */
  trustedInvocation() {
    const scope = this.active.getStore()
    if (!scope?.open || same(this.services.workshop()) !== same(scope.port)
      || this.services.session(scope.sessionRef) !== scope.session) deny()
    return { parent: scope.request, operation: scope.operation, workshop: scope.port, localContext: scope.localContext,
      sessionRef: scope.sessionRef, invocationRef: scope.invocationRef, turnFacts: scope.turnFacts, check: () => this.check(scope) }
  }
  async dispatch(operation: string, raw: unknown, persistInput = false,
    assertLive: () => Promise<void> = async () => {}): Promise<unknown> {
    const read = ['StartOrResumeSession', 'ReadSessionTurnDetails', 'ReadCurrentUndoStatus'].includes(operation)
    if (!read) return this.dispatchNow(operation, raw, persistInput, assertLive)
    if (!record(raw) || typeof raw.sessionRef !== 'string') deny()
    const sessionRef = raw.sessionRef, session = this.services.session(sessionRef), port = this.services.workshop()
    const context = await this.services.localContext(sessionRef)
    const previous = this.reads.get(sessionRef) ?? Promise.resolve()
    const result = previous.then(async () => {
      await assertLive()
      if (!session || !context || this.services.session(sessionRef) !== session
        || same(this.services.workshop()) !== same(port)
        || !sameLocalContext(await this.services.localContext(sessionRef), context)) deny()
      return this.dispatchNow(operation, raw, persistInput, assertLive)
    })
    const settled = result.then(() => {}, () => {})
    this.reads.set(sessionRef, settled)
    try { return await result }
    finally { if (this.reads.get(sessionRef) === settled) this.reads.delete(sessionRef) }
  }
  /** Synchronize Workshop from the current Canvas selection before publishing a new native view.
   * @param sessionRef - Selected live Core Session.
   * @param assertLive - Recheck the window lease before and after every public operation.
   * @returns Workshop snapshot with exactly the current local world and selection.
   */
  async bindCurrentWorld(sessionRef: string, assertLive: () => Promise<void>): Promise<SessionSnapshot> {
    await assertLive()
    const context = await this.services.localContext(sessionRef)
    if (!context) deny()
    const input = { contractVersion: 'session/v5' as const, requestId: randomUUID(), sessionRef, expectedRevision: null }
    const packet = validateBoundResponse('session/v5', 'StartOrResumeSession', input,
      await this.dispatch('StartOrResumeSession', input, false, assertLive))
    if (packet.error) throw new Error(packet.error.code)
    if (!packet.result) deny()
    let snapshot = packet.result
    if (!sameLocalContext(snapshot.context.localContext, context)) {
      const input = { contractVersion: 'session/v5' as const, requestId: randomUUID(), sessionRef,
        expectedRevision: snapshot.context.sessionRevision, worldRef: context.worldRef,
        selectionRevision: context.selectionRevision, localContext: context }
      const switched = validateBoundResponse('session/v5', 'SwitchWorldContext', input,
        await this.dispatch('SwitchWorldContext', input, false, assertLive))
      if (switched.error) throw new Error(switched.error.code)
      if (!switched.result) deny()
      snapshot = switched.result
    }
    await assertLive()
    if (snapshot.context.currentSession !== sessionRef || snapshot.context.activeWorldRef !== context.worldRef
      || !sameLocalContext(snapshot.context.localContext, context)
      || !sameLocalContext(await this.services.localContext(sessionRef), context)) deny()
    return snapshot
  }
  private async dispatchNow(operation: string, raw: unknown, persistInput: boolean,
    assertLive: () => Promise<void>): Promise<unknown> {
    if (!operations.has(operation) || !record(raw) || typeof raw.sessionRef !== 'string') deny()
    const sessionRef = raw.sessionRef, session = this.services.session(sessionRef), context = await this.services.localContext(sessionRef)
    if (!session || !context || this.services.session(sessionRef) !== session) deny()
    const port = this.services.workshop()
    if (!port) throw new Error('WORKSHOP_UNAVAILABLE')
    checkContractHandshake(port.contractHandshake)
    const wire = operation === 'InvokeAction' ? 'interaction-surface/v5' : 'session/v5'
    // Operation membership above and public decoding validate this dynamic native IPC boundary.
    const admit = validateRequest as (wire: string, operation: string, raw: unknown) => Record<string, unknown>
    const request = admit(wire, operation, raw)
    if (operation !== 'StartOrResumeSession' && (!record(request.localContext)
      || !sameLocalContext(request.localContext as LocalWorldContext, context))) deny()
    if ('worldRef' in request && request.worldRef !== context.worldRef) deny()
    if (this.busy.has(sessionRef)) throw new Error('WORKSHOP_BUSY')
    this.busy.add(sessionRef)
    const scope: Scope = { open: true, session, sessionRef, localContext: { ...context }, port, operation, request,
      invocationRef: randomUUID(), assertLive }
    try {
      await this.check(scope)
      if (persistInput && ['AppendMultimodalTurn', 'AnswerClarification'].includes(operation)) {
        const text = operation === 'AnswerClarification' ? request.answer : request.text
        if (typeof text !== 'string' || typeof request.requestId !== 'string') deny()
        await this.services.recordInput(sessionRef, request.requestId, text)
      }
      await this.check(scope)
      const result = await this.active.run(scope, () => {
        const domain = this.services.domain?.()
        return domain ? domain.run(() => port.call(operation, request)) : port.call(operation, request)
      })
      await this.check(scope)
      const decode = validateBoundResponse as (wire: string, operation: string, request: unknown, response: unknown) => unknown
      const response = decode(wire, operation, request, result)
      if (record(response) && response.error === null && record(response.result)) {
        const value = response.result
        if (operation === 'UndoCurrentBuild' && (!record(value.beforeHead) || !record(value.afterHead)
          || value.beforeHead.historyRevision !== request.expectedHistoryRevision
          || value.afterHead.historyRevision === value.beforeHead.historyRevision
          || value.afterHead.headTransactionId === value.beforeHead.headTransactionId)) throw new Error('UNDO_HISTORY_MISMATCH')
        if (operation === 'AdvanceCurrentBuild' && value.outcome === 'VERIFIED') {
          const receipt = value.receipt
          if (!record(receipt) || receipt.status !== 'VERIFIED' || receipt.readbackDigest === null
            || receipt.observedWorldRevision === null || !record(receipt.localContext)
            || !sameLocalContext(receipt.localContext as LocalWorldContext, context)) throw new Error('BUILD_READBACK_MISMATCH')
        }
      }
      return response
    } finally { scope.open = false; this.busy.delete(sessionRef) }
  }
  /** Run the two public proposal methods in the same Host-owned business scope. */
  async proposal(operation: 'readBuildProposalContext' | 'submitBuildProposal', raw: unknown,
    assertLive: () => Promise<void> = async () => {}): Promise<unknown> {
    const request = operation === 'readBuildProposalContext'
      ? validateRequest('session/v5', 'AdvanceCurrentBuild', raw)
      : validateRequest('painter/v6', 'ValidateBuildProposal', raw)
    const session = this.services.session(request.sessionRef), context = await this.services.localContext(request.sessionRef)
    const port = this.services.workshop()
    if (!session || !context || !port || !sameLocalContext(request.localContext, context) || request.worldRef !== context.worldRef) deny()
    checkContractHandshake(port.contractHandshake)
    if (this.busy.has(request.sessionRef)) throw new Error('WORKSHOP_BUSY')
    const scope: Scope = { open: true, session, sessionRef: request.sessionRef, localContext: { ...context }, port,
      operation, request, invocationRef: randomUUID(), assertLive }
    this.busy.add(request.sessionRef)
    try {
      await this.check(scope)
      const invoke = async () => {
        if (operation === 'readBuildProposalContext') {
          if (!port.readBuildProposalContext) throw new Error('WORKSHOP_PROPOSAL_CONTEXT_UNAVAILABLE')
          const input = validateRequest('session/v5', 'AdvanceCurrentBuild', request)
          const result = validateType('BuildProposalContext', await port.readBuildProposalContext(input))
          if (result.sessionRef !== input.sessionRef || result.worldRef !== input.worldRef
            || result.turnRevision !== input.expectedTurnRevision || !sameLocalContext(result.localContext, input.localContext)) deny()
          return result
        }
        if (!port.submitBuildProposal) throw new Error('WORKSHOP_PROPOSAL_SUBMIT_UNAVAILABLE')
        const input = validateRequest('painter/v6', 'ValidateBuildProposal', request)
        return validateBoundResponse('painter/v6', 'ValidateBuildProposal', input, await port.submitBuildProposal(input))
      }
      const result = await this.active.run(scope, () => this.services.domain?.()?.run(invoke) ?? invoke())
      await this.check(scope)
      return result
    } finally { scope.open = false; this.busy.delete(request.sessionRef) }
  }
  /** Run one Workshop region write-method call in the same Host-owned Session/current-world scope as the
   * cell path; Painter facts, Canvas region writes and the Adapter region port are only reachable inside it. */
  async region(operation: RegionOperation, raw: unknown, assertLive: () => Promise<void> = async () => {}): Promise<unknown> {
    const request: Record<string, unknown> = operation === 'submitWriteProposal'
      ? { ...validateRegionProposalRequest(raw) }
      : { ...validateRequest('session/v5', operation === 'undoRegionBuild' ? 'UndoCurrentBuild' : 'AdvanceCurrentBuild', raw) }
    const sessionRef = request.sessionRef as string, session = this.services.session(sessionRef)
    const context = await this.services.localContext(sessionRef), port = this.services.workshop()
    if (!session || !context || !port || !sameLocalContext(request.localContext as LocalWorldContext, context)
      || request.worldRef !== context.worldRef) deny()
    const method = port[operation]
    if (typeof method !== 'function') throw new Error(`WORKSHOP_REGION_UNAVAILABLE: Workshop must provide ${operation} (hanaworlds-workshop 0.4.0)`)
    checkContractHandshake(port.contractHandshake)
    if (this.busy.has(sessionRef)) throw new Error('WORKSHOP_BUSY')
    const scope: Scope = { open: true, session, sessionRef, localContext: { ...context }, port, operation, request,
      invocationRef: randomUUID(), assertLive }
    this.busy.add(sessionRef)
    try {
      await this.check(scope)
      if (operation === 'submitWriteProposal') {
        // Workshop holds its Session lock while Painter calls back, so the turn facts are read from its
        // public snapshot first; Workshop re-reads its own region context after Painter returns.
        const read = { contractVersion: 'session/v5', requestId: randomUUID(), sessionRef, expectedRevision: null }
        const snapshot = validateBoundResponse('session/v5', 'StartOrResumeSession', read, await port.call('StartOrResumeSession', read))
        if (snapshot.error) throw new Error(snapshot.error.code)
        const turn = snapshot.result?.turns.at(-1)
        if (!turn) throw new Error('INTENT_UNCONFIRMED')
        scope.turnFacts = { turnRevision: turn.turnRevision, briefDigest: turn.referenceBriefDigest }
        await this.check(scope)
      }
      const invoke = () => operation === 'readWriteProposalContext' || operation === 'submitWriteProposal'
        ? (port[operation] as (m: 'REGION', r: unknown) => Promise<unknown>).call(port, 'REGION', request)
        : (port[operation] as (r: unknown) => Promise<unknown>).call(port, request)
      const result = await this.active.run(scope, () => this.services.domain?.()?.run(invoke) ?? invoke())
      await this.check(scope)
      if (!record(result)) throw new Error('WORKSHOP_REGION_RESULT_INVALID')
      if ((operation === 'advanceRegionBuild' || operation === 'undoRegionBuild') && result.error === null
        && (result.sessionRef !== sessionRef || result.worldRef !== context.worldRef)) throw new Error('WORLD_CONNECTION_CHANGED')
      if (operation === 'readWriteProposalContext' && (result.sessionRef !== sessionRef || result.worldRef !== context.worldRef
        || !sameLocalContext(result.localContext as LocalWorldContext, context))) throw new Error('WORLD_CONNECTION_CHANGED')
      return result
    } finally { scope.open = false; this.busy.delete(sessionRef) }
  }
  /** Renderer input names business values; the native Host supplies all current association fields. */
  async invoke(sessionRef: string, raw: unknown, assertLive: () => Promise<void> = async () => {}): Promise<unknown> {
    if (!record(raw) || !record(raw.input)) deny()
    const input = raw.input
    if (input.sessionRef !== undefined && input.sessionRef !== sessionRef) deny()
    const context = await this.services.localContext(sessionRef)
    if (!context || !this.services.session(sessionRef)) deny()
    if (raw.operation === 'context') return input.sessionRef === undefined ? { sessions: [{ sessionRef, label: sessionRef }] }
      : { status: 'bound', sessionRef, worldRef: context.worldRef, localContext: context }
    if (raw.operation !== 'workshop' || typeof input.operation !== 'string' || !record(input.payload)) deny()
    for (const key of ['actorRef', 'authorizationRef', 'sessionRef', 'worldRef', 'localContext', 'bindingRef', 'grantEpoch', 'allowedActions', 'callerRole']) {
      if (Object.hasOwn(input.payload, key)) deny()
    }
    const operation = input.operation
    const body = { ...input.payload, contractVersion: operation === 'InvokeAction' ? 'interaction-surface/v5' : 'session/v5',
      requestId: input.payload.requestId ?? randomUUID(), sessionRef,
      ...(operation === 'StartOrResumeSession' ? {} : { localContext: context }),
      ...(['SwitchWorldContext', 'AdvanceCurrentBuild', 'ReadCurrentUndoStatus', 'UndoCurrentBuild'].includes(operation) ? { worldRef: context.worldRef } : {}),
      ...(operation === 'SwitchWorldContext' ? { selectionRevision: context.selectionRevision } : {}) }
    return this.dispatch(operation, body, true, assertLive)
  }
}
