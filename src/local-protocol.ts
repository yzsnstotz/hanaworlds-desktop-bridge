/** Current public protocol admission for Host-owned peer calls. */
import { checkContractHandshake, checkProtocolCompatibility, protocolRequirement, validateRequest, validateBoundResponse, type OperationMap, type LocalWorldContext } from 'hanaworlds-contracts'
export interface DomainPort {
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
/** Admit both directions and return only a successful correlated public result.
 * @param port - Captured peer service.
 * @param wire - Current protocol version.
 * @param operation - Public operation on that protocol.
 * @param raw - Request to validate before dispatch.
 * @returns Decoded non-null result; peer errors remain errors.
 */
export async function callLocal<W extends keyof OperationMap, N extends keyof OperationMap[W] & string>(
  port: DomainPort, wire: W, operation: N, raw: unknown): Promise<Result<W, N>> {
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
    readonly error: { readonly code: string } | null
  }
  if (response.error) throw new Error(response.error.code)
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
