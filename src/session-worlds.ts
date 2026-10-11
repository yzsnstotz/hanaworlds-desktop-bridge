/** Session ↔ current world, read from its owners; the bridge keeps no selection of its own (contracts 2.0.0 seam). */
import { randomUUID } from 'node:crypto'
import type { LocalWorldContext } from 'hanaworlds-contracts'
import { callLocal, sameLocalContext, type DomainPort } from './local-protocol.ts'
import type { DesktopWorldLifecycle } from './world-lifecycle.ts'
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
  private readonly connecting = new Set<string>()
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
  /** Product diagnostics keep the selected world visible after the live connection disappears. */
  async context(sessionRef: string) {
    if (!this.services.session(sessionRef)) throw new Error('SESSION_NOT_FOUND')
    try { await this.discover(sessionRef) }
    catch (error) { if (!(error instanceof Error) || !error.message.startsWith('WORLD_NOT_BOUND:')) throw error }
    const localContext = await this.localContext(sessionRef)
    return { sessionId: sessionRef, worldRef: this.worlds.get(sessionRef) ?? null,
      noLiveBinding: localContext === null, localContext }
  }
  /** Launch through lifecycle, then select its actual connection via Canvas; no engine pairing calls. */
  async connect(sessionRef: string, worldId: string, lifecycle: DesktopWorldLifecycle, assertLive: () => Promise<void>) {
    const session = this.services.session(sessionRef), canvas = this.services.canvas(), workshop = this.services.workshop()
    if (!session) throw new Error('SESSION_NOT_FOUND')
    if (!canvas) throw new Error('CANVAS_UNAVAILABLE')
    if (!workshop) throw new Error('WORKSHOP_UNAVAILABLE')
    if (this.connecting.has(sessionRef)) throw new Error('TRANSACTION_CONFLICT')
    this.connecting.add(sessionRef)
    const check = async () => {
      await assertLive()
      if (this.services.session(sessionRef) !== session) throw new Error('SESSION_NOT_FOUND')
      if (serviceIdentity(this.services.canvas()) !== serviceIdentity(canvas)) throw new Error('CANVAS_REPLACED')
      if (serviceIdentity(this.services.workshop()) !== serviceIdentity(workshop)) throw new Error('WORKSHOP_REPLACED')
    }
    try {
      await check()
      const snapshot = await callLocal(workshop, 'session/v5', 'StartOrResumeSession',
        { contractVersion: 'session/v5', requestId: randomUUID(), sessionRef, expectedRevision: null })
      await check()
      const launched = await lifecycle.call('launch', { worldId })
      await check()
      const selection = await callLocal(canvas, 'canvas/v7', 'ReadWorldSelectionContext',
        { contractVersion: 'canvas/v7', requestId: randomUUID(), sessionRef, worldRef: snapshot.context.activeWorldRef ?? launched.worldRef })
      await check()
      const selected = await callLocal(canvas, 'canvas/v7', 'SelectWorldConnection', {
        contractVersion: 'canvas/v7', requestId: randomUUID(), sessionRef, worldRef: launched.worldRef,
        connectionRef: launched.connectionRef, connectionIncarnationRef: launched.connectionIncarnationRef,
        expectedRevision: snapshot.context.sessionRevision,
        expectedContext: selection.selection.status === 'BOUND' ? selection.selection.context.localContext : null,
      })
      await check()
      const context = selected.localContext
      if (!context || selected.currentSession !== sessionRef || selected.activeWorldRef !== launched.worldRef
        || context.worldRef !== launched.worldRef || context.connectionRef !== launched.connectionRef
        || context.connectionIncarnationRef !== launched.connectionIncarnationRef) throw new Error('CURRENT_WORLD_MISMATCH')
      this.worlds.set(sessionRef, launched.worldRef)
      if (!sameLocalContext(await this.localContext(sessionRef), context)) throw new Error('CURRENT_WORLD_MISMATCH')
      await check()
      return { sessionId: sessionRef, worldRef: launched.worldRef, localContext: context, noLiveBinding: false }
    } finally { this.connecting.delete(sessionRef) }
  }
  /** The live Canvas selection of a discovered Session, or null when it is not bound to that world now. */
  async localContext(sessionRef: string): Promise<LocalWorldContext | null> {
    const session = this.services.session(sessionRef)
    if (!session) return null
    const worldRef = this.worlds.get(sessionRef), canvas = this.services.canvas()
    if (worldRef === undefined || !canvas) return null
    const read = await callLocal(canvas, 'canvas/v7', 'ReadWorldSelectionContext',
      { contractVersion: 'canvas/v7', sessionRef, requestId: randomUUID(), worldRef })
    if (this.services.session(sessionRef) !== session || this.worlds.get(sessionRef) !== worldRef
      || serviceIdentity(this.services.canvas()) !== serviceIdentity(canvas)) throw new Error('CURRENT_WORLD_MISMATCH')
    if (read.sessionRef !== sessionRef || read.worldRef !== worldRef || read.selection.status !== 'BOUND'
      || read.selection.context.currentSession !== sessionRef) return null
    return read.selection.context.localContext
  }
  forget(sessionRef: string): void { this.worlds.delete(sessionRef) }
}
