/** Current public protocol admission for Host-owned peer calls. */
import { checkContractHandshake, checkProtocolCompatibility, protocolRequirement, validateRequest, validateBoundResponse, targetWorldRef,
  ContractError, type OperationMap, type LocalWorldContext, type Error as PublicError } from 'hanaworlds-contracts'
export interface DomainPort {
  /** C-canvas v2: current Catalogue is obtained only by Canvas's own source role. */
  readCatalogue?(request: import('./host-source-protocol.ts').CanvasCatalogueRequest): Promise<unknown>
  readonly contractHandshake: unknown
  /** A peer may advertise wire majors and capabilities independently of its package identity. */
  readonly protocolHandshake?: unknown
  readonly source?: 'FIXTURE' | undefined
  readBuildProposalProviderFacts?(request: import('hanaworlds-contracts').ValidateBuildProposalRequest): Promise<unknown>
  readBuildProposalContext?(request: import('hanaworlds-contracts').AdvanceCurrentBuildRequest): Promise<unknown>
  submitBuildProposal?(request: import('hanaworlds-contracts').ValidateBuildProposalRequest): Promise<unknown>
  /** Workshop 0.4.0 write-method surface (contracts 0.5.0 WriteMethodDescriptor). */
  describeWriteTools?(sessionRef?: string | null): Promise<unknown>
  readWriteProposalContext?(method: 'PER_CELL' | 'REGION', request: unknown): Promise<unknown>
  submitWriteProposal?(method: 'PER_CELL' | 'REGION', request: unknown): Promise<unknown>
  advanceRegionBuild?(request: unknown): Promise<unknown>
  undoRegionBuild?(request: unknown): Promise<unknown>
  /** Canvas 0.6.1 public durable Session selection; null means no stored selection. */
  current?(sessionRef: string): unknown
  call(operation: string, request: unknown): Promise<unknown>
}
type Result<W extends keyof OperationMap, N extends keyof OperationMap[W]> =
  OperationMap[W][N] extends { response: { result: infer R } } ? NonNullable<R> : never
/** A peer's public Error carried through the Host unchanged: every field, including the 2.7.0 target
 * `worldRef` and `mutationState`, stays in `publicError`; the message stays the bare code for existing callers. */
export class RelayedContractError extends ContractError {
  constructor(error: PublicError, message: string = error.code) {
    const { code, phase, reason, ...details } = error
    super(code, phase, reason, details)
    this.name = 'RelayedContractError'
    this.message = message
  }
}

/** The target world a peer error names must be the one the admitted request or the Host's real binding
 * determines; the SDK already binds request selectors, this adds the Host's own Session binding.
 * With neither fact the provider's own statement passes as-is: the Host never adds or guesses a world.
 * @param request - Admitted request the error answers.
 * @param error - Decoded public Error.
 * @param boundWorldRef - Host's current real Session→world binding, if any.
 */
export function checkErrorWorld(request: unknown, error: PublicError, boundWorldRef?: string): void {
  if (error.worldRef === undefined) return
  const sessionRef = (request as { sessionRef?: unknown }).sessionRef
  const target = targetWorldRef(request, typeof sessionRef === 'string' && boundWorldRef !== undefined
    ? { [sessionRef]: boundWorldRef } : {})
  if (target !== undefined && error.worldRef !== target) throw new ContractError('CURRENT_WORLD_MISMATCH', 'validate', 'REVISION_CHANGED')
}

/** Throw a decoded peer error without reducing it to its code. */
export function relayError(request: unknown, error: PublicError, boundWorldRef?: string, message?: string): never {
  checkErrorWorld(request, error, boundWorldRef)
  throw new RelayedContractError(error, message)
}

/** Admit both directions and return only a successful correlated public result.
 * @param port - Captured peer service.
 * @param wire - Current protocol version.
 * @param operation - Public operation on that protocol.
 * @param raw - Request to validate before dispatch.
 * @param boundWorldRef - The Host's current real Session→world binding, when it has one.
 * @returns Decoded non-null result; a peer error is thrown as {@link RelayedContractError}.
 */
export async function callLocal<W extends keyof OperationMap, N extends keyof OperationMap[W] & string>(
  port: DomainPort, wire: W, operation: N, raw: unknown, boundWorldRef?: string): Promise<Result<W, N>> {
  if (port.protocolHandshake !== undefined) {
    const capabilities = wire === 'world-adapter/v8'
      ? ['world-adapter/v8:callback-free-write', 'world-adapter/v8:write-path-state-facts'] : []
    checkProtocolCompatibility(port.protocolHandshake, [protocolRequirement(wire, capabilities)])
  } else {
    checkContractHandshake(port.contractHandshake, { wires: [wire], factProfiles: [] })
  }
  const request = validateRequest(wire, operation, raw)
  const response = validateBoundResponse(wire, operation, request, await port.call(operation, request)) as {
    readonly result: unknown
    readonly error: PublicError | null
  }
  if (response.error) relayError(request, response.error, boundWorldRef)
  if (response.result === null) throw new Error('LOCAL_RESULT_UNAVAILABLE')
  return response.result as Result<W, N>
}

/** Compare connection/selection facts without relying on decoder object prototypes.
 * @param left - Current decoded context, or an unbound observation.
 * @param right - Previously captured context.
 * @returns Whether every association field still matches.
 */
export function sameLocalContext(left: LocalWorldContext | null, right: LocalWorldContext): boolean {
  return left !== null && left.connectionRef === right.connectionRef && left.worldRef === right.worldRef
    && left.connectionIncarnationRef === right.connectionIncarnationRef && left.selectionRevision === right.selectionRevision
}
