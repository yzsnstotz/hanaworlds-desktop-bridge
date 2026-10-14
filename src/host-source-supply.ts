/** Bridge-owned runtime capabilities for the two existing provider-owned Host handoffs. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import { admitSourceScope, admitProfileRequest, admitProfileResponse, admitMaterials, sourceRefusal,
  type MaterialSourceConnection, type MaterialSourcesHostFacts,
  type ReadWriteProfileRequest, type ReadWriteProfileResponse } from './host-source-protocol.ts'

export type CanvasConfigSourceReader = (this: Context, scope: MaterialSourceConnection,
  request: ReadWriteProfileRequest) => Promise<ReadWriteProfileResponse>
export type MaterialSourceReader = (this: Context, scope: MaterialSourceConnection,
  signal: AbortSignal) => Promise<MaterialSourcesHostFacts>
export interface CanvasConfigReceiver {
  readonly ready?: PromiseLike<unknown>
  attachConfigSource?(context: Context, reader: CanvasConfigSourceReader): () => void
}
export interface WorkshopMaterialReceiver {
  attachMaterialSource?(context: Context, reader: MaterialSourceReader): () => void
}
export interface WorldSourcePort {
  call?(operation: string, request: unknown): Promise<unknown>
  readMaterialSources?(scope: MaterialSourceConnection): Promise<unknown>
}
type Kind = 'config' | 'material'
type Impl = NonNullable<ReturnType<Context['reflect']['_getImpl']>>
interface Observation { state: 'WAITING' | 'ATTACHED' | 'UNAVAILABLE'; reason: string | null }
const snapshot = (impl: Impl) => ({ impl, value: impl.value, fiber: impl.fiber })
type Registration = ReturnType<typeof snapshot>

/** No persistent state, source cache, polling, new service or source role. */
export class DesktopSourceSupply {
  private readonly observations: Record<Kind, Observation> = {
    config: { state: 'WAITING', reason: 'CANVAS_CONFIG_SOURCE_NOT_ATTACHED' },
    material: { state: 'WAITING', reason: 'WORKSHOP_MATERIAL_SOURCE_NOT_ATTACHED' },
  }
  constructor(private readonly ctx: Context) {
    // A dependent fiber runs only after the actual Bridge identity has become ACTIVE.
    ctx.inject(['hanaworldsWorldInspectionContext'], identity => {
      identity.inject(['hanaworldsCanvasV5'], consumer => this.attach('config', consumer))
      identity.inject(['hanaworldsWorkshop'], consumer => this.attach('material', consumer))
    })
  }
  status() {
    return { config: { ...this.observations.config }, material: { ...this.observations.material } }
  }
  private current(name: string): Registration {
    const impl = this.ctx.reflect._getImpl(name)
    if (!impl) throw sourceRefusal('CAPABILITY_UNAVAILABLE')
    return snapshot(impl)
  }
  private check(name: string, registration: Registration): void {
    const current = this.ctx.reflect._getImpl(name)
    if (!current || current !== registration.impl || current.value !== registration.value || current.fiber !== registration.fiber) throw sourceRefusal('CAPABILITY_UNAVAILABLE')
    for (let fiber = current.fiber; ; fiber = fiber.parent.fiber) {
      if (fiber.state !== FiberState.ACTIVE) throw sourceRefusal('CAPABILITY_UNAVAILABLE')
      if (fiber === fiber.parent.fiber) break
    }
  }
  private attach(kind: Kind, consumer: Context): void {
    const context = this.ctx.fiber.ctx, owner = this.current('hanaworldsWorldInspectionContext')
    const peerName = kind === 'config' ? 'hanaworldsCanvasV5' : 'hanaworldsWorkshop'
    const peer = this.current(peerName)
    const value = consumer.get(peerName) as CanvasConfigReceiver & WorkshopMaterialReceiver
    let open = true, detach: (() => void) | undefined
    consumer.effect(() => () => {
      open = false
      detach?.()
      this.observations[kind] = { state: 'UNAVAILABLE', reason: 'HOST_SOURCE_HANDOFF_DETACHED' }
    })
    const check = (receiver: unknown) => {
      if (!open || receiver !== context || context !== owner.fiber.ctx) throw sourceRefusal('CAPABILITY_UNAVAILABLE')
      this.check('hanaworldsWorldInspectionContext', owner)
      this.check(peerName, peer)
    }
    const supplier = this
    const configStack = new AsyncLocalStorage<boolean>()
    const configReader: CanvasConfigSourceReader = async function (scopeRaw, requestRaw) {
      check(this)
      const scope = admitSourceScope(scopeRaw), request = admitProfileRequest(requestRaw)
      if (request.worldRef !== scope.worldRef) throw sourceRefusal('CURRENT_WORLD_MISMATCH')
      if (configStack.getStore()) throw sourceRefusal('CAPABILITY_UNAVAILABLE')
      const facts = supplier.current('hanaworldsWorldFacts')
      const source = this.get('hanaworldsWorldFacts') as WorldSourcePort
      if (typeof source.call !== 'function') throw sourceRefusal('CAPABILITY_UNAVAILABLE')
      const response = await configStack.run(true, () => source.call!('ReadWriteProfile', request))
      check(this); supplier.check('hanaworldsWorldFacts', facts)
      return admitProfileResponse(response, request, scope)
    }
    const materialReader: MaterialSourceReader = async function (scopeRaw, signal) {
      check(this)
      if (!(signal instanceof AbortSignal)) throw sourceRefusal('SCHEMA_INVALID', 'INVALID_SHAPE', 'decode')
      signal.throwIfAborted()
      const scope = admitSourceScope(scopeRaw), facts = supplier.current('hanaworldsWorldFacts')
      const source = this.get('hanaworldsWorldFacts') as WorldSourcePort
      if (typeof source.readMaterialSources !== 'function') throw sourceRefusal('CAPABILITY_UNAVAILABLE')
      const response = await source.readMaterialSources(scope)
      signal.throwIfAborted(); check(this); supplier.check('hanaworldsWorldFacts', facts)
      return admitMaterials(response, scope)
    }
    const finish = () => {
      if (!open) return
      check(context)
      const method = kind === 'config' ? value.attachConfigSource : value.attachMaterialSource
      if (!method) {
        this.observations[kind] = { state: 'UNAVAILABLE', reason: kind === 'config'
          ? 'CANVAS_ATTACH_CONFIG_SOURCE_UNAVAILABLE' : 'WORKSHOP_ATTACH_MATERIAL_SOURCE_UNAVAILABLE' }
        return
      }
      // Keep the original tracked peer receiver and the actual Bridge Context argument.
      detach = kind === 'config' ? value.attachConfigSource!(context, configReader)
        : value.attachMaterialSource!(context, materialReader)
      if (typeof detach !== 'function') throw sourceRefusal('SCHEMA_INVALID')
      this.observations[kind] = { state: 'ATTACHED', reason: null }
    }
    if (kind === 'config') {
      // Readiness is not a fiber-loading promise: disposal must never wait for it.
      void Promise.resolve(value.ready).then(finish).catch(error => {
        if (open) this.observations[kind] = { state: 'UNAVAILABLE', reason: error instanceof Error ? error.message : 'CANVAS_READY_FAILED' }
      })
    } else finish()
  }
}
