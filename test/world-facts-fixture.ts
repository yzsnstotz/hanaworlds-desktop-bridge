/** C-world-facts component double from the published SDK examples; no engine or live world. */
import fixture from 'hanaworlds-contracts/fixtures/world-source-facts' with { type: 'json' }
import { contractHandshake, validateRequest, validateBoundResponse, validateType } from 'hanaworlds-contracts'

export function createWriteProfileFixture(unavailable = false) {
  const examples = fixture.exchanges.filter(row => row.operation === 'ReadWriteProfile')
  const profile = validateType('WriteProfile', examples[unavailable ? 1 : 0].response.result)
  const requests: unknown[] = []
  return {
    source: 'FIXTURE' as const, contractHandshake, profile, requests,
    error: null as 'ADAPTER_UNAVAILABLE' | 'CAPABILITY_UNAVAILABLE' | null,
    async call(operation: string, raw: unknown) {
      if (operation !== 'ReadWriteProfile') throw new Error('FIXTURE_UNSUPPORTED_WORLD_FACTS_OPERATION')
      const request = validateRequest('world-facts/v1', 'ReadWriteProfile', raw)
      requests.push(request)
      return validateBoundResponse('world-facts/v1', 'ReadWriteProfile', request, {
        contractVersion: 'world-facts/v1', requestId: request.requestId,
        result: this.error ? null : { ...this.profile, connection: { ...this.profile.connection, worldRef: request.worldRef } },
        error: this.error ? { code: this.error, phase: 'validate', retryability: 'AFTER_NEW_FACTS', mutationState: 'NONE',
          transactionRef: null, causeCode: null, reason: 'REQUIRED_FACT_UNKNOWN' } : null,
      })
    },
  }
}
