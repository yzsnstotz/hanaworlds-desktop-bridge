import { createHash } from 'node:crypto'
import type { SessionHeader } from '@deepseek-ai/dsh-session/types'

/** Compare current Core metadata using its current JSONL encoder's explicit default depth. */
export function sessionIncarnation(live: SessionHeader, saved: SessionHeader): string {
  const encode = (header: SessionHeader): string => JSON.stringify(Object.entries({ ...header,
    delegationDepth: header.delegationDepth ?? 0 }).sort(([a], [b]) => a.localeCompare(b)))
  const encoded = encode(saved)
  if (encode(live) !== encoded) throw new Error('SESSION_REPLACED')
  return `core-header:${createHash('sha256').update(encoded).digest('hex')}`
}
