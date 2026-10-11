/** Native Workshop inputs use the host Session Controller and its selected model on the existing AgentLoop. */
import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionController, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionLogOffset } from '@deepseek-ai/dsh-session/types'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import { serviceIdentity } from './image-media.ts'

type SubmissionAgent = Pick<Agent, 'session' | 'status' | 'whenIdle'> & {
  readonly inbox: Pick<Agent['inbox'], 'nextTurn' | 'nextStep'>
}
interface Services {
  agent(session: Session): SubmissionAgent | undefined
  controller(): Pick<SessionController, 'prompt'> | undefined
  flush(session: Session): Promise<boolean>
  open(session: Session): Promise<Pick<SessionHandle, 'read' | 'close'>>
}
function fail(code: string): never { throw new Error(`HANAWORLDS_SKILL_${code}`) }
/** Submit one actual human input; a busy Agent or another human input refuses this UI result. */
export class DesktopSkillSubmission {
  constructor(private readonly services: Services) {}
  /** Use standard prompt admission, then read the actual durable model reply in this Agent interval.
   * @param session - Selected live Core Session.
   * @param text - Text the user entered or the exact confirmation button text.
   * @param check - Revalidate the native view and current local world.
   * @returns Actual model text, or null when that interval contains no model text.
   */
  async run(session: Session, text: string, check: () => Promise<void>): Promise<string | null> {
    await check()
    const agent = this.services.agent(session), controller = this.services.controller()
    if (!agent || agent.session !== session || !controller) fail('AGENT_UNAVAILABLE')
    if (agent.status !== 'idle' || agent.inbox.nextTurn.length || agent.inbox.nextStep.length) fail('AGENT_BUSY')
    const from = Number(session.seq), requestId = randomUUID() as SessionRequestId
    const live = async () => {
      await check()
      if (this.services.agent(session) !== agent || agent.session !== session || serviceIdentity(this.services.controller()) !== serviceIdentity(controller)) fail('SESSION_CHANGED')
    }
    await live()
    // Routing (including provider, model and reasoning effort) belongs to the host's Session selection.
    await controller.prompt({ requestId, sessionId: session.id, mode: 'queue',
      content: [{ type: 'text', text }] }, new AbortController().signal)
    await agent.whenIdle()
    await live()
    if (!await this.services.flush(session)) fail('DURABILITY_UNAVAILABLE')
    const end = Number(session.seq), handle = await this.services.open(session)
    let inputCount = 0, reply: string | null = null
    try {
      for (let offset = from; offset < end; offset += 64) {
        const events = (await handle.read(SessionLogOffset(offset), Math.min(64, end - offset))).events
        for (const event of events) {
          if (event.type === 'user/message' && event.data.source.kind === 'user') {
            if (!('rpcId' in event.data.source) || event.data.source.rpcId !== requestId) fail('SESSION_INPUT_CHANGED')
            inputCount++
          }
          if (event.type === 'assistant/message' && !event.data.interrupted) {
            const text = event.data.message.content.filter(p => p.type === 'text').map(p => p.text).join('\n')
            if (text.length) reply = text
          }
        }
      }
    } finally { await handle.close() }
    if (inputCount !== 1) fail('INPUT_NOT_DURABLE')
    await live()
    return reply
  }
}
