/** Session ↔ current world, read from its owners; the bridge keeps no selection of its own (contracts 2.0.0 seam). */
import { randomUUID } from 'node:crypto'
import type { LocalWorldContext } from 'hanaworlds-contracts'
import { callLocal, type DomainPort } from './local-protocol.ts'
import { serviceIdentity } from './image-media.ts'

interface Services {
  session(id: string): object | undefined
  workshop(): DomainPort | undefined
  canvas(): DomainPort | undefined
}

/**
 * Canvas alone owns the selection (canvas/v7 ReadWorldSelectionContext), and every Canvas read is scoped to a
 * worldRef. The worldRef a Session works in is Workshop's `activeWorldRef`, read once outside any dispatch so
 * the live checks inside a Workshop call never re-enter Workshop.
 */
export class DesktopSessionWorlds {
  private readonly worlds = new Map<string, string>()
  constructor(private readonly services: Services) {}
  /** Learn the Session's world from Workshop's own snapshot; a Session without one is named, not guessed. */
  async discover(sessionRef: string): Promise<string> {
    const session = this.services.session(sessionRef)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    const port = this.services.workshop()
    if (!port) throw new Error('WORKSHOP_UNAVAILABLE: needs hanaworldsWorkshop (C-session) to learn this session\'s world')
    const snapshot = await callLocal(port, 'session/v5', 'StartOrResumeSession',
      { contractVersion: 'session/v5', sessionRef, requestId: randomUUID(), expectedRevision: null })
    if (this.services.session(sessionRef) !== session) throw new Error('SESSION_NOT_FOUND')
    if (serviceIdentity(this.services.workshop()) !== serviceIdentity(port)) throw new Error('WORKSHOP_REPLACED')
    const worldRef = snapshot.context.activeWorldRef
    if (worldRef === null) {
      this.worlds.delete(sessionRef)
      throw new Error(`WORLD_NOT_BOUND: session ${sessionRef} has no world yet; it needs a world launched (C-world-lifecycle launch) and selected for it (C-canvas SelectWorldConnection) first`)
    }
    this.worlds.set(sessionRef, worldRef)
    return worldRef
  }
  /** The live Canvas selection of a discovered Session, or null when it is not bound to that world now. */
  async localContext(sessionRef: string): Promise<LocalWorldContext | null> {
    const worldRef = this.worlds.get(sessionRef), canvas = this.services.canvas()
    if (worldRef === undefined || !canvas) return null
    const read = await callLocal(canvas, 'canvas/v7', 'ReadWorldSelectionContext',
      { contractVersion: 'canvas/v7', sessionRef, requestId: randomUUID(), worldRef })
    if (read.sessionRef !== sessionRef || read.worldRef !== worldRef || read.selection.status !== 'BOUND'
      || read.selection.context.currentSession !== sessionRef) return null
    return read.selection.context.localContext
  }
  forget(sessionRef: string): void { this.worlds.delete(sessionRef) }
}
