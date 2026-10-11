/** C-world-lifecycle consumer. The source owns names, templates and opaque creation facts. */
import { randomUUID } from 'node:crypto'
import { validateRequest, validateBoundResponse, requireWorldRetirable, type WorldLifecyclePort, type OperationMap } from 'hanaworlds-contracts'
import { serviceIdentity } from './image-media.ts'
import { callLocal, type DomainPort } from './local-protocol.ts'
type Operations = OperationMap['world-lifecycle/v2']
export class DesktopWorldLifecycle {
  constructor(private readonly port: () => WorldLifecyclePort | undefined,
    private readonly canvas: () => DomainPort | undefined = () => undefined,
    private readonly retirement: <T>(worldRef: string, work: () => Promise<T>) => Promise<T> = (_worldRef, work) => work()) {}
  async call<N extends Exclude<keyof Operations, 'delete'>>(operation: N, input: unknown = {}): Promise<NonNullable<Operations[N]['response']['result']>> {
    // Generic dispatch must never bypass the retirement gate.
    if ((operation as string) === 'delete') throw new Error('TRANSACTION_CONFLICT: world retirement gate required')
    const port = this.port()
    if (!port) throw new Error('ADAPTER_UNAVAILABLE: needs hanaworldsWorldLifecycle (C-world-lifecycle)')
    const result = await this.invoke(port, operation, input)
    if (serviceIdentity(this.port()) !== serviceIdentity(port)) throw new Error('WORLD_LIFECYCLE_REPLACED')
    return result
  }
  /** Name confirmation and selection exclusion are bridge product logic; Canvas owns the lock. */
  async deleteWorld(worldId: string, confirmationName: string) {
    const port = this.port(), canvas = this.canvas()
    if (!port) throw new Error('ADAPTER_UNAVAILABLE: needs hanaworldsWorldLifecycle (C-world-lifecycle)')
    if (!canvas) throw new Error('CANVAS_UNAVAILABLE')
    const check = () => {
      if (serviceIdentity(this.port()) !== serviceIdentity(port)) throw new Error('WORLD_LIFECYCLE_REPLACED')
      if (serviceIdentity(this.canvas()) !== serviceIdentity(canvas)) throw new Error('CANVAS_REPLACED')
    }
    const description = await this.invoke(port, 'describeDelete', { worldId })
    check()
    if (confirmationName !== description.confirmationName) throw new Error('TRANSACTION_CONFLICT: 请按世界名字确认删除')
    const worldRef = description.worldRef
    return this.retirement(worldRef, async () => {
      const inventory = await callLocal(canvas, 'canvas/v7', 'ListWorldSelections', {
        contractVersion: 'canvas/v7', requestId: randomUUID(), worldRef,
      })
      check()
      const selected = (sessionRefs: readonly string[]) => new Error(`TRANSACTION_CONFLICT: 世界正被对话 ${sessionRefs.join('、')} 选为当前世界；先在那个对话里切到别的世界`)
      if (inventory.sessionRefs.length) throw selected(inventory.sessionRefs)
      requireWorldRetirable(inventory)
      const reservation = await callLocal(canvas, 'canvas/v7', 'ReserveWorldRetirement', {
        contractVersion: 'canvas/v7', requestId: randomUUID(), worldRef, expectedInventoryRevision: inventory.inventoryRevision,
      }).catch(async error => {
        // A selection can race the inventory read. Diagnose that conflict without retrying deletion.
        check()
        if (error instanceof Error && error.message === 'TRANSACTION_CONFLICT') {
          const current = await callLocal(canvas, 'canvas/v7', 'ListWorldSelections', {
            contractVersion: 'canvas/v7', requestId: randomUUID(), worldRef,
          })
          check()
          if (current.sessionRefs.length) throw selected(current.sessionRefs)
        }
        throw error
      })
      let retired = false, failure: unknown
      try {
        check()
        const result = await this.invoke(port, 'delete', { worldId, confirmationName })
        if (result.worldRef !== worldRef) throw new Error('CURRENT_WORLD_MISMATCH')
        retired = true
        check()
        return result
      } catch (error) { failure = error; throw error }
      finally {
        try {
          await callLocal(canvas, 'canvas/v7', 'ReleaseWorldRetirement', {
            contractVersion: 'canvas/v7', requestId: randomUUID(), worldRef,
            reservationRef: reservation.reservationRef, outcome: retired ? 'RETIRED' : 'ABORTED',
          })
        } catch (releaseError) {
          if (failure !== undefined) throw new AggregateError([failure, releaseError],
            `${failure instanceof Error ? failure.message : String(failure)}; WORLD_RETIREMENT_RELEASE_FAILED: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`)
          throw new Error(`WORLD_RETIREMENT_RELEASE_FAILED (${retired ? 'RETIRED' : 'ABORTED'}): ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`, { cause: releaseError })
        }
        if (failure === undefined) check()
      }
    })
  }
  private async invoke<N extends keyof Operations>(port: WorldLifecyclePort, operation: N, input: unknown): Promise<NonNullable<Operations[N]['response']['result']>> {
    const request = validateRequest('world-lifecycle/v2', operation, {
      ...(input as object), contractVersion: 'world-lifecycle/v2', requestId: randomUUID(),
    })
    const invoke = port[operation] as (request: unknown) => Promise<unknown>
    if (typeof invoke !== 'function') throw new Error(`ADAPTER_UNAVAILABLE: lifecycle ${operation} missing`)
    const response = validateBoundResponse('world-lifecycle/v2', operation, request, await invoke.call(port, request)) as Operations[N]['response']
    if (response.error) throw new Error(response.error.code)
    if (response.result === null) throw new Error('LOCAL_RESULT_UNAVAILABLE')
    return response.result as NonNullable<Operations[N]['response']['result']>
  }
}
