/** C-world-lifecycle consumer. The source owns names, templates and opaque creation facts. */
import { randomUUID } from 'node:crypto'
import { validateRequest, validateBoundResponse, type WorldLifecyclePort, type OperationMap } from 'hanaworlds-contracts'
import { serviceIdentity } from './image-media.ts'
type Operations = OperationMap['world-lifecycle/v2']
export class DesktopWorldLifecycle {
  constructor(private readonly port: () => WorldLifecyclePort | undefined) {}
  async call<N extends Exclude<keyof Operations, 'delete'>>(operation: N, input: unknown = {}): Promise<NonNullable<Operations[N]['response']['result']>> {
    // World deletion is admitted only after desktop-bridge-05's Canvas retirement gate.
    if ((operation as string) === 'delete') throw new Error('TRANSACTION_CONFLICT: world retirement gate required')
    const port = this.port()
    if (!port) throw new Error('ADAPTER_UNAVAILABLE: needs hanaworldsWorldLifecycle (C-world-lifecycle)')
    const request = validateRequest('world-lifecycle/v2', operation, {
      ...(input as object), contractVersion: 'world-lifecycle/v2', requestId: randomUUID(),
    })
    const invoke = port[operation] as (request: unknown) => Promise<unknown>
    if (typeof invoke !== 'function') throw new Error(`ADAPTER_UNAVAILABLE: lifecycle ${operation} missing`)
    const response = validateBoundResponse('world-lifecycle/v2', operation, request, await invoke.call(port, request)) as Operations[N]['response']
    if (serviceIdentity(this.port()) !== serviceIdentity(port)) throw new Error('WORLD_LIFECYCLE_REPLACED')
    if (response.error) throw new Error(response.error.code)
    if (response.result === null) throw new Error('LOCAL_RESULT_UNAVAILABLE')
    return response.result as NonNullable<Operations[N]['response']['result']>
  }
}
