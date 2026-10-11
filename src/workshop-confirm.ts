/** Trusted Desktop bridge from one selected Core Session to the public Workshop port. */
import { randomUUID } from 'node:crypto'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { validateRequest, validateBoundResponse } from 'hanaworlds-contracts'
import { sameLocalContext } from './local-protocol.ts'
import type { ClarificationNeed, LocalWorldContext, SessionSnapshot, SessionTurnDetails } from 'hanaworlds-contracts'
import { DesktopViewBindings, type DesktopBindingView } from './view-binding.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Workshop-owned public session/v5 port; no plugin-private storage crosses this seam. */
    hanaworldsWorkshop: DesktopWorkshopPort
  }
}

export interface DesktopWorkshopPort {
  /** The actual Workshop service may omit source; only the explicit fixture reports FIXTURE. */
  readonly source?: 'FIXTURE' | undefined
  readonly contractHandshake: unknown
  call(operation: string, request: unknown): Promise<unknown>
}

export interface DesktopWorkshopView {
  readonly sessionId: string
  readonly worldRef: string
  readonly source: 'WORKSHOP' | 'FIXTURE'
  readonly turns: readonly {
    readonly turnRef: string
    readonly userText: string
    readonly resultText: string
    readonly confirmedBrief: boolean
  }[]
  readonly modelReply?: string | null
  readonly pending: { readonly question: string; readonly userText: string; readonly clarificationId: string; readonly turnRevision: string } | null
}

interface Services {
  readonly bindings: DesktopViewBindings
  readonly sessions: { get(id: SessionId): Session | undefined }
  readonly workshop: () => DesktopWorkshopPort | undefined
  readonly workshopIdentity: () => object | undefined
  readonly runSkill: (session: Session, text: string, check: () => Promise<void>) => Promise<string | null>
  readonly pending: (sessionRef: string, snapshot: SessionSnapshot, context: LocalWorldContext) => ClarificationNeed | null
}

interface Trusted {
  readonly view: DesktopBindingView
  readonly session: Session
  readonly port: DesktopWorkshopPort
  readonly supplier: object
}

type Operation = 'StartOrResumeSession' | 'ReadSessionTurnDetails'

function fail(code: string): never { throw new Error(`HANAWORLDS_CONFIRM_${code}`) }

function sameView(left: DesktopBindingView, right: DesktopBindingView): boolean {
  return left.sessionId === right.sessionId && sameLocalContext(left.localContext, right.localContext)
    && left.serviceIdentity === right.serviceIdentity && left.source === right.source
}

/** Runtime contract admission applies before the port sees a request and after it answers. */
async function callWorkshop<T>(port: DesktopWorkshopPort, operation: Operation, body: object): Promise<T> {
  const validate = ((op: Operation, value: unknown) => validateRequest('session/v5', op, value)) as (op: Operation, value: unknown) => { readonly requestId: string }
  const response = ((op: Operation, request: unknown, value: unknown) => validateBoundResponse('session/v5', op, request, value)) as (op: Operation, request: unknown, value: unknown) => {
    readonly requestId: string
    readonly result: T | null
    readonly error: { readonly code: string } | null
  }
  const admitted = validate(operation, body)
  const packet = response(operation, admitted, await port.call(operation, admitted))
  if (packet.requestId !== admitted.requestId) fail('WORKSHOP_MISMATCH')
  if (packet.error !== null) fail(`WORKSHOP_${packet.error.code}`)
  if (packet.result === null) fail('WORKSHOP_EMPTY_RESULT')
  return packet.result
}

/** One Host-process instance; opaque leases and pending rounds never survive restart. */
export class DesktopWorkshopConfirmations {
  private readonly replies = new Map<string, { trusted: Trusted; reply: string | null }>()
  private readonly presented = new Map<string, { trusted: Trusted; pending: ClarificationNeed }>()
  private readonly busy = new Set<string>()

  constructor(private readonly services: Services) {}

  clear(windowKey: string): void { this.replies.delete(windowKey); this.presented.delete(windowKey) }

  private async trusted(windowKey: string, lease: string, _action: 'READ' | 'APPEND', expected?: Trusted): Promise<Trusted> {
    const view = await this.services.bindings.read(windowKey, lease)
    const session = this.services.sessions.get(SessionId(view.sessionId))
    if (session === undefined) fail('SESSION_UNAVAILABLE')
    const port = this.services.workshop()
    const supplier = this.services.workshopIdentity()
    if (port === undefined || !supplier || typeof port.call !== 'function') fail('WORKSHOP_UNAVAILABLE')
    if (expected !== undefined && (!sameView(view, expected.view)
      || session !== expected.session || port !== expected.port || supplier !== expected.supplier)) fail('SESSION_OR_CONTEXT_CHANGED')
    return { view, session, port, supplier }
  }

  private async checked(windowKey: string, lease: string, action: 'READ' | 'APPEND', expected: Trusted): Promise<void> {
    await this.trusted(windowKey, lease, action, expected)
  }

  private async snapshot(trusted: Trusted, windowKey: string, lease: string): Promise<SessionSnapshot> {
    const { view, port } = trusted
    const snapshot = await callWorkshop<SessionSnapshot>(port, 'StartOrResumeSession', {
      contractVersion: 'session/v5', sessionRef: view.sessionId,
      requestId: randomUUID(), expectedRevision: null,
    })
    await this.checked(windowKey, lease, 'READ', trusted)
    if (snapshot.context.currentSession !== view.sessionId || snapshot.context.activeWorldRef !== view.worldRef
      || !sameLocalContext(snapshot.context.localContext, view.localContext)) fail('WORKSHOP_MISMATCH')
    return snapshot
  }

  private async readBound(trusted: Trusted, windowKey: string, lease: string, present = true): Promise<DesktopWorkshopView> {
    const snapshot = await this.snapshot(trusted, windowKey, lease)
    const { view, port } = trusted
    const details = await callWorkshop<SessionTurnDetails>(port, 'ReadSessionTurnDetails', {
      contractVersion: 'session/v5', sessionRef: view.sessionId,
      requestId: randomUUID(), localContext: view.localContext,
    })
    await this.checked(windowKey, lease, 'READ', trusted)
    if (details.sessionRef !== view.sessionId || details.sessionRevision !== snapshot.context.sessionRevision
      || details.turns.length !== snapshot.turns.length
      || details.turns.some((item, index) => {
        const turn = snapshot.turns[index]
        return turn === undefined || item.turnRef !== turn.turnRef
          || item.turnRevision !== turn.turnRevision || item.userText !== turn.text
      })) fail('WORKSHOP_MISMATCH')
    const pending = this.services.pending(view.sessionId, snapshot, view.localContext)
    if (present) {
      if (pending) this.presented.set(windowKey, { trusted, pending })
      else this.presented.delete(windowKey)
    }
    const reply = this.replies.get(windowKey)
    return {
      sessionId: view.sessionId, worldRef: view.worldRef,
      source: port.source === 'FIXTURE' ? 'FIXTURE' : 'WORKSHOP',
      turns: details.turns.map(item => ({ turnRef: item.turnRef, userText: item.userText,
        resultText: item.resultText, confirmedBrief: item.confirmedBrief !== null })),
      modelReply: reply && reply.trusted.session === trusted.session && reply.trusted.port === port
        && reply.trusted.supplier === trusted.supplier && sameView(reply.trusted.view, view) ? reply.reply : null,
      pending: pending ? { question: pending.question, userText: details.turns.at(-1)?.userText ?? '',
        clarificationId: pending.clarificationId, turnRevision: pending.turnRevision } : null,
    }
  }

  async read(windowKey: string, lease: string): Promise<DesktopWorkshopView> {
    const trusted = await this.trusted(windowKey, lease, 'READ')
    return this.readBound(trusted, windowKey, lease)
  }

  async prepare(windowKey: string, lease: string, text: string): Promise<DesktopWorkshopView> {
    if (typeof text !== 'string' || text.trim().length === 0) fail('EMPTY_INPUT')
    return this.submit(windowKey, lease, text, false)
  }

  async confirm(windowKey: string, lease: string): Promise<DesktopWorkshopView> {
    return this.submit(windowKey, lease, '确认', true)
  }

  private async submit(windowKey: string, lease: string, text: string, confirmation: boolean): Promise<DesktopWorkshopView> {
    const trusted = await this.trusted(windowKey, lease, 'APPEND')
    const sessionId = trusted.view.sessionId
    if (this.busy.has(sessionId)) fail('BUSY')
    this.busy.add(sessionId)
    try {
      if (confirmation) {
        const shown = this.presented.get(windowKey)
        if (!shown) fail('NO_CURRENT_ROUND')
        await this.checked(windowKey, lease, 'APPEND', shown.trusted)
        const current = (await this.readBound(trusted, windowKey, lease, false)).pending
        if (!current || current.clarificationId !== shown.pending.clarificationId
          || current.turnRevision !== shown.pending.turnRevision || current.question !== shown.pending.question) fail('ROUND_CHANGED')
      }
      const reply = await this.services.runSkill(trusted.session, text,
        () => this.checked(windowKey, lease, 'APPEND', trusted))
      await this.checked(windowKey, lease, 'APPEND', trusted)
      this.replies.set(windowKey, { trusted, reply })
      return await this.readBound(trusted, windowKey, lease)
    } finally { this.busy.delete(sessionId) }
  }
}
