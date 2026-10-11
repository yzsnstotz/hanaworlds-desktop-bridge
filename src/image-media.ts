/** Core-owned image membership and verified native attachment bytes for building tools. */
import { symbols } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { validateType, type MediaBinding } from 'hanaworlds-contracts'

/** Request projection budgets of the fixed Codex subscription provider. */
export const desktopImagePolicy = Object.freeze({ maxPixels: 2048 * 2048, maxBytes: 1024 * 1024 })
interface Services {
  attachments(): AttachmentStore | undefined
  readEvents(session: Session, from: number, count: number): Promise<readonly SessionEvent[]>
}
type Check = () => Promise<void>
type ImageMediaType = import('hanaworlds-contracts').MediaType
/** Cordis creates a new context proxy on lookup; its public original symbol identifies the registration. */
export function serviceIdentity<T extends object>(service: T | undefined): T | undefined {
  return (service as (T & { [symbols.original]?: T }) | undefined)?.[symbols.original] ?? service
}
/** Native store media types as the contracts' canonical sorted set (PublicCapabilities.imageMediaTypes). */
export function desktopImageMediaTypes(native: readonly string[]): ImageMediaType[] {
  return [...new Set(native)].sort() as ImageMediaType[]
}
/** Membership comes from durable human uploads and successful native tool image results. */
export class DesktopImageMedia {
  constructor(private readonly services: Services) {}
  private async refs(session: Session, check: Check): Promise<Map<string, ImageAttachmentRef>> {
    const refs = new Map<string, ImageAttachmentRef>()
    for (let end = Number(session.seq); end > 0;) {
      await check()
      const from = Math.max(0, end - 64)
      const events = await this.services.readEvents(session, from, end - from)
      await check()
      for (const event of events) {
        if (event.surfaceOp !== 'append') continue
        const content = event.type === 'user/message' && event.data.source.kind === 'user' ? event.data.content
          : event.type === 'tool/result' && !event.data.message.isError ? event.data.message.content : []
        for (const part of content) if (part.type === 'image') refs.set(part.attachment.attachmentId, part.attachment)
      }
      end = from
    }
    return refs
  }
  /** Read only an image present in this live Session, checking lifecycle before and after storage.
   * @param session - actual current Core Session.
   * @param attachmentRef - selected opaque reference, never membership evidence.
   * @param check - current Agent, cancellation and Session checks.
   * @returns verified stored raster and its native reference.
   */
  async read(session: Session, attachmentRef: string, check: Check) {
    const refs = await this.refs(session, check), ref = refs.get(attachmentRef)
    if (!ref) throw new Error('ATTACHMENT_NOT_IN_SESSION')
    const attachments = this.services.attachments()
    if (!attachments) throw new Error('IMAGE_MEDIA_UNAVAILABLE')
    await check()
    const stored = await attachments.readImage(ref)
    await check()
    if (serviceIdentity(attachments) !== serviceIdentity(this.services.attachments())) throw new Error('IMAGE_MEDIA_REPLACED')
    if (stored.ref.attachmentId !== ref.attachmentId || stored.ref.mediaType !== ref.mediaType
      || stored.ref.bytes !== ref.bytes || stored.ref.width !== ref.width || stored.ref.height !== ref.height
      || stored.data.byteLength !== ref.bytes) throw new Error('MEDIA_DIGEST_MISMATCH')
    return stored
  }
  /** Derive public media facts from actual stored bytes, without claiming a model request occurred.
   * @param session - actual current Core Session.
   * @param selected - exact selected ids; omission lists all conversation images.
   * @param check - current lifecycle checks.
   * @returns stored-image bindings; request projection fields remain null until provider dispatch.
   */
  async bindings(session: Session, selected: readonly string[] | undefined, check: Check): Promise<MediaBinding[]> {
    const ids = selected ?? [...(await this.refs(session, check)).keys()]
    const bindings: MediaBinding[] = []
    for (const id of new Set(ids)) {
      const { ref, data } = await this.read(session, id, check)
      bindings.push(validateType('MediaBinding', { attachmentRef: ref.attachmentId,
        storedBytesDigest: createHash('sha256').update(data).digest('hex'), projectionVariantId: null,
        projectionBytesDigest: null, mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height }))
    }
    return bindings
  }
}
