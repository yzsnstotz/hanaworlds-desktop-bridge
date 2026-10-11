/** Component counterparties only: Canvas owns these records; no engine or model writes. */
import { validateRequest, validateBoundResponse, validateRegionCommit, contractProtocols, regionCapabilities } from 'hanaworlds-contracts'
import region from 'hanaworlds-contracts/fixtures/region' with { type: 'json' }

export function installBuildFixture(ctx: any, canvas: any, workshop: any) {
  const objects: any[] = [], histories = new Map<string, any>(), calls: string[] = []
  const state = { mode: 'VERIFIED', corrupt: '', panelError: false, panelRefusal: null as null | ((request: any) => unknown) }
  const handshake = { ...region.peerHandshake, component: 'FIXTURE/region-peers',
    protocols: [...contractProtocols].sort((a, b) => a.protocol < b.protocol ? -1 : a.protocol > b.protocol ? 1 : 0),
    capabilities: regionCapabilities.map(c => c.id).sort() }
  const canvasCall = canvas.call, workshopCall = workshop.call
  const d = 'a'.repeat(64)
  const record = (request: any, tx: string) => {
    const objectRef = `FIXTURE/object/${objects.length + 1}`, revision = `FIXTURE/history/${objects.length + 1}`
    const object = { worldRef: request.worldRef, objectRef, objectRevision: revision, displayName: null,
      nameRevision: null, creationSequence: objects.length, status: 'READY' }
    objects.push(object)
    histories.set(objectRef, { worldRef: request.worldRef, objectRef, historyRevision: revision, headTransactionId: tx,
      entries: [{ transactionId: tx, originTransactionId: null, affectedObjectRefs: [objectRef], operationDigest: d,
        beforeImageDigest: d, expectedAfterReadbackDigest: d, receiptDigest: d, historyRevision: revision, status: 'VERIFIED' }],
      undoAvailable: true, redoAvailable: false })
    return object
  }
  canvas.call = async function(op: string, raw: any) {
    if (!['ListObjects', 'HistoryQuery', 'CreateObject'].includes(op)) return canvasCall.call(this, op, raw)
    const request: any = validateRequest('canvas/v7', op as never, raw)
    calls.push(op)
    if (state.panelError && op !== 'CreateObject') throw new Error('FIXTURE_PANEL_UNAVAILABLE')
    if (state.panelRefusal && op !== 'CreateObject') return state.panelRefusal(request)
    const result = op === 'CreateObject' ? record(request, request.transactionId)
      : op === 'ListObjects' ? { worldRef: request.worldRef, registryRevision: `FIXTURE/registry/${objects.length}`,
        objects: objects.filter(o => o.worldRef === request.worldRef) }
        : histories.get(request.objectRef)
    const packet = validateBoundResponse('canvas/v7', op as never, request, {
      contractVersion: 'canvas/v7', requestId: request.requestId, result, error: null,
    })
    return state.corrupt === op ? { ...packet, requestId: 'foreign-request' } : packet
  }
  const create = (request: any, tx: string) => canvas.call('CreateObject', {
    contractVersion: 'canvas/v7', requestId: `${request.requestId}/object`, sessionRef: request.sessionRef,
    worldRef: request.worldRef, objectRef: `FIXTURE/object/${objects.length + 1}`, transactionId: tx,
    verifiedReceiptDigest: d, expectedRevision: `FIXTURE/registry/${objects.length}`, localContext: request.localContext,
  })
  workshop.call = async function(op: string, raw: any) {
    if (op !== 'AdvanceCurrentBuild') return workshopCall.call(this, op, raw)
    const request: any = validateRequest('session/v5', op, raw)
    calls.push(op)
    const turn = workshop.snapshot(request.sessionRef).turns.at(-1)
    if (!turn || workshop.pending(request.sessionRef)) return { contractVersion: 'session/v5', requestId: request.requestId,
      result: null, error: { code: 'INTENT_UNCONFIRMED', phase: 'validate', retryability: 'AFTER_NEW_FACTS',
        mutationState: 'NONE', transactionRef: null, causeCode: null, reason: 'SCOPE_DENIED' }, guardRefusal: null }
    if (state.mode === 'PENDING') return { contractVersion: 'session/v5', requestId: request.requestId, error: null,
      guardRefusal: null, result: { sessionRef: request.sessionRef, worldRef: request.worldRef,
        turnRevision: request.expectedTurnRevision, stage: 'PLAN', outcome: 'PENDING' } }
    const tx = `FIXTURE/transaction/${objects.length + 1}`
    await create(request, tx)
    return { contractVersion: 'session/v5', requestId: request.requestId, error: null, guardRefusal: null,
      result: { sessionRef: request.sessionRef, worldRef: request.worldRef, turnRevision: request.expectedTurnRevision,
        stage: 'COMPLETE', outcome: 'VERIFIED', receipt: { contractVersion: 'canvas/v7', transactionId: tx,
          operationDigest: d, transactionPayloadDigest: d, status: 'VERIFIED', previousWorldRevision: 'world-1',
          observedWorldRevision: 'world-2', readbackDigest: d, restoreStatus: 'NOT_REQUIRED', error: null,
          localContext: request.localContext, guardRefusal: null, applyFailure: null } } }
  }
  const painter = { protocolHandshake: () => handshake, async call(op: string) { calls.push(op); return region.proposalResponse } }
  const brush = { protocolHandshake: () => handshake, compileRegion() { calls.push('CompileRegionBuild'); return region.compileResponse } }
  const canvasRegion = { protocolHandshake: handshake, async call(op: string, request: any) {
    calls.push(op)
    await ctx.hanaworldsWorldAdapterRegionV1.call('WriteRegion', {
      ...region.writeRequest, sessionRef: request.sessionRef, localContext: request.localContext,
    })
    await create(request, request.transactionId)
    return validateRegionCommit(request, { ...region.commitResponse, requestId: request.requestId,
      result: { ...region.commitResponse.result, localContext: request.localContext } })
  } }
  ctx.provide('hanaworldsPainterV2PictureBlocks', painter)
  ctx.provide('hanaworldsBrushV3', brush)
  ctx.provide('hanaworldsCanvasRegionV1', canvasRegion)
  const adapterRegion = { protocolHandshake: region.peerHandshake, async call(op: string, raw: unknown) {
    const request: any = validateRequest('world-adapter-region/v3', op as never, raw)
    calls.push(op)
    return { ...region.writeResponse, requestId: request.requestId, result: { ...region.writeResponse.result, localContext: request.localContext } }
  } }
  ctx.provide('hanaworldsWorldAdapterRegionV1', adapterRegion)
  workshop.readWriteProposalContext = async (_method: string, request: any) => ({ sessionRef: request.sessionRef,
    worldRef: request.worldRef, localContext: request.localContext })
  workshop.submitWriteProposal = async (_method: string, request: any) =>
    ctx.hanaworldsPainterRegionV1.call('ValidateRegionProposal', request)
  workshop.advanceRegionBuild = async (request: any) => {
    calls.push('advanceRegionBuild')
    await ctx.hanaworldsBrushRegionV1.call('CompileRegionBuild', region.compileRequest)
    const response = await ctx.hanaworldsCanvasRegionV1.call('ApplyRegionCommit', {
      ...region.commitRequest, sessionRef: request.sessionRef, requestId: request.requestId, localContext: request.localContext,
    })
    return { sessionRef: request.sessionRef, worldRef: request.worldRef, receipt: response.result, error: response.error }
  }
  return { objects, histories, calls, state, region, painter, brush, canvasRegion, adapterRegion }
}
