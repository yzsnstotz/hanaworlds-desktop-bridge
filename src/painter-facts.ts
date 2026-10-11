/** Host binding of Painter's public current-facts port to Workshop's read-only accessor. */
import { validateRequest, validateType, validateBuildProposalContext, validateRegionProposalRequest, type BuildProposalProviderFacts, type LocalRequestFacts, type LocalWorldContext } from 'hanaworlds-contracts'
import type { DesktopWorkshopTransport } from './workshop-transport.ts'
import { sameLocalContext } from './local-protocol.ts'
export class DesktopPainterFacts {
  constructor(private readonly transport: DesktopWorkshopTransport,
    private readonly currentContext: (sessionRef: string) => Promise<LocalWorldContext | null> = async () => null) {}
  /** painter-region/v1: public LocalRequestFacts from the live Adapter/Canvas selection and Workshop's own snapshot. */
  private async region(raw: unknown, options: { signal?: AbortSignal }): Promise<LocalRequestFacts> {
    options.signal?.throwIfAborted()
    const current = this.transport.trustedInvocation()
    const request = validateRegionProposalRequest(raw)
    if (current.operation !== 'submitWriteProposal' || request.sessionRef !== current.sessionRef
      || !sameLocalContext(request.localContext, current.localContext)) throw new Error('LOCAL_CONTEXT_REQUIRED')
    const turn = current.turnFacts
    if (!turn) throw new Error('PAINTER_FACTS_CAPABILITY_UNAVAILABLE')
    await current.check()
    const currentContext = await this.currentContext(current.sessionRef)
    await current.check(); options.signal?.throwIfAborted()
    // Painter decides a mismatch with validateCurrentRequest; the Host never copies request fields as facts.
    return validateType('LocalRequestFacts', { currentContext, sessionRef: current.sessionRef,
      currentTurnRevision: turn.turnRevision, currentBriefDigest: turn.briefDigest,
      requestState: 'ACTIVE', replay: 'NEW', priorRequestDigest: null })
  }
  /** Read current public facts within the same live Workshop dispatch, never from model values. */
  async read(raw: unknown, operation: string,
    options: { signal?: AbortSignal } = {}): Promise<BuildProposalProviderFacts | LocalRequestFacts> {
    if (operation === 'ValidateRegionProposal') return this.region(raw, options)
    if (operation !== 'ValidateBuildProposal') throw new Error('PAINTER_FACTS_CAPABILITY_UNAVAILABLE')
    options.signal?.throwIfAborted()
    const current = this.transport.trustedInvocation()
    const request = validateRequest('painter/v6', 'ValidateBuildProposal', raw)
    if (request.sessionRef !== current.sessionRef || !sameLocalContext(request.localContext, current.localContext)) throw new Error('LOCAL_CONTEXT_REQUIRED')
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Captured with its owner and invoked using call below.
    const read = current.workshop.readBuildProposalProviderFacts
    if (!read) throw new Error('WORKSHOP_PROPOSAL_FACTS_UNAVAILABLE')
    await current.check()
    const facts = validateType('BuildProposalProviderFacts', await read.call(current.workshop, request))
    await current.check(); options.signal?.throwIfAborted()
    validateBuildProposalContext(request, facts)
    return facts
  }
}
