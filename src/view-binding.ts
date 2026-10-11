/** Host-owned association of a native window, a live Core Session and current local world. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { validateType, type LocalWorldContext } from 'hanaworlds-contracts'
import { sameLocalContext } from './local-protocol.ts'
import type {} from '@deepseek-ai/dsh-session'
export interface LocalContextPort {
  readonly identity: string
  readonly source: 'ADAPTER' | 'FIXTURE'
  currentContext(sessionId: string): Promise<LocalWorldContext | null>
}
export interface DesktopBindingView {
  readonly sessionId: string
  readonly worldRef: string
  readonly localContext: LocalWorldContext
  readonly serviceIdentity: string
  readonly source: LocalContextPort['source']
}
interface SelectedView {
  readonly session: object
  readonly sessionId: string
  readonly port: LocalContextPort
  readonly serviceIdentity: string
  readonly context: LocalWorldContext
  readonly lease: string
}
function fail(code: string): never { throw new Error(`HANAWORLDS_VIEW_${code}`) }
/** A view handle is local UI state; it grants no world operation. */
export class DesktopViewBindings {
  private readonly selected = new Map<string, SelectedView>()
  private readonly generations = new Map<string, number>()
  constructor(
    private readonly sessions: { get(id: string): object | undefined; list(): readonly (string | { readonly id: string })[] },
    private readonly local: () => LocalContextPort | undefined,
    private readonly recordReadFailure?: (error: unknown, detail: unknown) => Promise<void>,
  ) {}
  candidates(): string[] { return this.sessions.list().map(value => typeof value === 'string' ? value : value.id) }
  clear(windowKey: string): void {
    this.generations.set(windowKey, (this.generations.get(windowKey) ?? 0) + 1); this.selected.delete(windowKey)
  }
  async select(windowKey: string, sessionId: string): Promise<string> {
    this.clear(windowKey)
    const generation = this.generations.get(windowKey), session = this.sessions.get(sessionId)
    if (!session) fail('SESSION_UNAVAILABLE')
    const port = this.local()
    if (!port || !port.identity) fail('LOCAL_WORLD_UNAVAILABLE')
    const identity = port.identity, observed = await port.currentContext(sessionId)
    if (this.generations.get(windowKey) !== generation) fail('STALE_VIEW')
    if (this.sessions.get(sessionId) !== session) fail('SESSION_UNAVAILABLE')
    if (this.local() !== port || port.identity !== identity) fail('SERVICE_CHANGED')
    if (!observed) fail('LOCAL_WORLD_UNAVAILABLE')
    const context = validateType('LocalWorldContext', observed), lease = randomUUID()
    this.selected.set(windowKey, { session, sessionId, port, serviceIdentity: identity, context: { ...context }, lease })
    return lease
  }
  async read(windowKey: string, lease: string): Promise<DesktopBindingView> {
    const selected = this.selected.get(windowKey)
    if (!selected || selected.lease !== lease) fail('STALE_VIEW')
    const readRef = randomUUID()
    let observedContext: unknown, observedContextStatus = 'NOT_READ'
    const check = () => {
      if (this.selected.get(windowKey) !== selected) fail('STALE_VIEW')
      if (this.sessions.get(selected.sessionId) !== selected.session) fail('SESSION_UNAVAILABLE')
      if (this.local() !== selected.port || selected.port.identity !== selected.serviceIdentity) fail('SERVICE_CHANGED')
    }
    try {
      check()
      const observed = await selected.port.currentContext(selected.sessionId)
      observedContext = observed; observedContextStatus = 'OBSERVED'
      check()
      if (!observed || !sameLocalContext(validateType('LocalWorldContext', observed), selected.context)) fail('CONTEXT_CHANGED')
      return { sessionId: selected.sessionId, worldRef: selected.context.worldRef, localContext: { ...selected.context },
        serviceIdentity: selected.serviceIdentity, source: selected.port.source }
    } catch (error) {
      const currentOwnerChanged = this.selected.get(windowKey) !== selected
      if (!currentOwnerChanged) this.clear(windowKey)
      try {
        await this.recordReadFailure?.(error, { readRef, windowKey, sessionRef: selected.sessionId,
          viewLease: selected.lease, savedContext: { ...selected.context }, observedContext,
          observedContextStatus, currentOwnerChanged })
      } catch { console.error('VIEW_READ_DIAGNOSTIC_UNAVAILABLE') }
      throw error
    }
  }
}
/** Install view association over the actual Core Session store and current-world reader.
 * @param ctx - Running Host context.
 * @param local - Host-owned current connection reader.
 * @param recordReadFailure - Private failure receipt writer; it never grants authority.
 * @returns Fresh view handles scoped to this Host instance.
 */
export function installDesktopViewBindings(ctx: Context, local: LocalContextPort,
  recordReadFailure?: (error: unknown, detail: unknown) => Promise<void>): DesktopViewBindings {
  const sessions = ctx.get('sessions')
  if (!sessions) throw new Error('HanaWorlds view: Core Session service unavailable')
  return new DesktopViewBindings({ get: id => sessions.get(id as Parameters<typeof sessions.get>[0]),
    list: () => sessions.list() }, () => local, recordReadFailure)
}
