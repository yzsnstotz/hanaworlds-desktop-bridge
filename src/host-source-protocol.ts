/** Document-owned admission. Successful validation returns the original complete value. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { sourceDefinitions, type MaterialSourceConnection, type MaterialSourceFacts,
  type FactsProviderIdentity, type CatalogueHostFacts, type ReadWriteProfileRequest,
  type ReadWriteProfileResponse, type CanvasCatalogueRequest } from './host-source-schema.ts'
export type { MaterialSourceConnection, ReadWriteProfileRequest, ReadWriteProfileResponse,
  CanvasCatalogueRequest, CatalogueHostFacts } from './host-source-schema.ts'
export interface TextureBytes { bytesDigest: string; bytes: Uint8Array }
export interface MaterialSourcesHostFacts {
  provider: FactsProviderIdentity; facts: MaterialSourceFacts; textures: TextureBytes[]
}

export function sourceRefusal(code: string, reason = 'REQUIRED_FACT_UNKNOWN', phase = 'validate'): Error {
  return Object.assign(new Error(code), { publicError: { code, phase, reason,
    retryability: phase === 'decode' ? 'NEVER' : 'AFTER_NEW_FACTS', mutationState: 'NONE',
    transactionRef: null, causeCode: null } })
}
const decoders = new Map<string, z.ZodType>()
function strictJSON(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') {
    for (let i = 0; i < value.length; i++) {
      const n = value.charCodeAt(i)
      if (n >= 0xd800 && n <= 0xdbff) {
        const next = value.charCodeAt(++i)
        if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      } else if (n >= 0xdc00 && n <= 0xdfff) return false
    }
    return true
  }
  if (typeof value !== 'object' || ancestors.has(value)) return false
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const keys = Reflect.ownKeys(value).filter(k => !(Array.isArray(value) && k === 'length'))
  if (Array.isArray(value) && (keys.length !== value.length || keys.some((k, i) => k !== String(i)))) return false
  ancestors.add(value)
  const valid = keys.every(k => typeof k === 'string' && strictJSON(k)
    && descriptors[k]?.enumerable && 'value' in descriptors[k]! && strictJSON(descriptors[k]!.value, ancestors))
  ancestors.delete(value)
  return valid
}
function decode<T>(name: keyof typeof sourceDefinitions, raw: unknown): T {
  if (!strictJSON(raw)) throw sourceRefusal('SCHEMA_INVALID', 'INVALID_SHAPE', 'decode')
  let decoder = decoders.get(name)
  if (!decoder) {
    decoder = z.fromJSONSchema({ $ref: `#/$defs/${name}`,
      $defs: sourceDefinitions } as unknown as Parameters<typeof z.fromJSONSchema>[0])
    decoders.set(name, decoder)
  }
  const result = decoder.safeParse(raw)
  if (!result.success) {
    // Closed objects are checked by the published schema, never stripped by its parser.
    const unknown = JSON.stringify(result.error.issues).includes('unrecognized_keys')
    throw sourceRefusal(unknown ? 'UNKNOWN_REQUIRED_FIELD' : 'SCHEMA_INVALID', 'INVALID_SHAPE', 'decode')
  }
  return raw as T
}
/** RFC8785 canonical JSON for already admitted strict JSON values; no opaque field is interpreted. */
function canonical(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
}
const digest = (domain: string, value: unknown) => createHash('sha256').update(domain + canonical(value), 'utf8').digest('hex')
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)
export function sameSourceConnection(a: MaterialSourceConnection, b: MaterialSourceConnection): boolean {
  return a.worldRef === b.worldRef && a.connectionRef === b.connectionRef
    && a.connectionIncarnationRef === b.connectionIncarnationRef
}
export const admitSourceScope = (raw: unknown) => decode<MaterialSourceConnection>('MaterialSourceConnection', raw)
export const admitProfileRequest = (raw: unknown) => decode<ReadWriteProfileRequest>('ReadWriteProfileRequest', raw)
export const admitCatalogueRequest = (raw: unknown) => decode<CanvasCatalogueRequest>('CanvasCatalogueRequest', raw)
export function admitProfileResponse(raw: unknown, request: ReadWriteProfileRequest, scope: MaterialSourceConnection): ReadWriteProfileResponse {
  const value = decode<ReadWriteProfileResponse>('ReadWriteProfileResponse', raw)
  if (value.requestId !== request.requestId || (value.result === null) === (value.error === null)) throw sourceRefusal('SCHEMA_INVALID')
  if (value.result) {
    const p = value.result
    if (!sameSourceConnection(p.connection, scope)) throw sourceRefusal('CURRENT_WORLD_MISMATCH')
    if (p.writeBackend.availability === 'KNOWN') {
      if (!p.compilationConfig || !same(p.writeBackend.writeBackend, p.compilationConfig.writeBackend)) throw sourceRefusal('CAPABILITY_UNAVAILABLE')
    } else if (p.compilationConfig !== null) throw sourceRefusal('SCHEMA_INVALID')
    if (p.writeMethods.length === 2 && p.writeMethods[0] !== 'PER_CELL') throw sourceRefusal('SCHEMA_INVALID')
  } else if (value.error?.worldRef !== undefined && value.error.worldRef !== scope.worldRef) throw sourceRefusal('CURRENT_WORLD_MISMATCH')
  return value
}
function exactObject(raw: unknown, fields: readonly string[]): asserts raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw sourceRefusal('SCHEMA_INVALID')
  const keys = Reflect.ownKeys(raw)
  if (keys.some(k => typeof k !== 'string' || !fields.includes(k))) throw sourceRefusal('UNKNOWN_REQUIRED_FIELD')
  if (keys.length !== fields.length) throw sourceRefusal('SCHEMA_INVALID')
}
export function admitMaterials(raw: unknown, scope: MaterialSourceConnection): MaterialSourcesHostFacts {
  exactObject(raw, ['provider', 'facts', 'textures'])
  decode('FactsProviderIdentity', raw.provider)
  const facts = decode<MaterialSourceFacts>('MaterialSourceFacts', raw.facts), s = facts.snapshot
  if (!sameSourceConnection(s.connection, scope)) throw sourceRefusal('CURRENT_WORLD_MISMATCH')
  const { sourceRevision, ...body } = s
  if (digest('HanaWorlds|material-sources/v2|material-sources|', body) !== sourceRevision) throw sourceRefusal('READBACK_MISMATCH')
  if (!Array.isArray(raw.textures)) throw sourceRefusal('SCHEMA_INVALID')
  const expected = new Map<string, { byteLength: number; mediaType: string }>()
  const refs = new Set<string>()
  let prior: (typeof s.materials)[number] | undefined
  for (const row of s.materials) {
    if (prior && (row.materialRef < prior.materialRef || (row.materialRef === prior.materialRef
      && (row.orientation === null || prior.orientation === null || row.orientation <= prior.orientation)))) throw sourceRefusal('SCHEMA_INVALID')
    prior = row; refs.add(row.materialRef)
    if (row.availability === 'KNOWN') {
      const t = row.texture, old = expected.get(t.bytesDigest)
      if (old && (old.byteLength !== t.byteLength || old.mediaType !== t.mediaType)) throw sourceRefusal('SCHEMA_INVALID')
      expected.set(t.bytesDigest, t)
    }
  }
  if (!same([...refs].sort(), Object.keys(facts.presentation).sort())) throw sourceRefusal('CATALOGUE_MISMATCH')
  const seen = new Set<string>()
  for (const texture of raw.textures) {
    exactObject(texture, ['bytesDigest', 'bytes'])
    const t = expected.get(texture.bytesDigest as string)
    if (!t || seen.has(texture.bytesDigest as string) || !(texture.bytes instanceof Uint8Array)
      || texture.bytes.byteLength !== t.byteLength || createHash('sha256').update(texture.bytes).digest('hex') !== texture.bytesDigest) throw sourceRefusal('MEDIA_DIGEST_MISMATCH')
    seen.add(texture.bytesDigest as string)
  }
  if (seen.size !== expected.size) throw sourceRefusal('MEDIA_DIGEST_MISMATCH')
  return raw as unknown as MaterialSourcesHostFacts
}
export function admitCatalogue(raw: unknown, scope: MaterialSourceConnection): CatalogueHostFacts {
  const value = decode<CatalogueHostFacts>('CatalogueHostFacts', raw), f = value.facts
  if (!sameSourceConnection(f.connection, scope)) throw sourceRefusal('CURRENT_WORLD_MISMATCH')
  if (digest('HanaWorlds|contracts@0.4.0|catalogue|', f.catalogue) !== f.catalogueDigest) throw sourceRefusal('CATALOGUE_MISMATCH')
  if (!same(Object.keys(f.presentation).sort(), Object.keys(f.catalogue.materials).sort())) throw sourceRefusal('CATALOGUE_MISMATCH')
  if (!Object.hasOwn(f.catalogue.materials, f.catalogue.emptyMaterialRef)) throw sourceRefusal('CATALOGUE_MISMATCH')
  const orientations = new Set<number>()
  for (const tags of Object.values(f.catalogue.materials)) {
    if (tags.orientations?.some((n, i, rows) => i > 0 && n <= rows[i - 1]!)) throw sourceRefusal('SCHEMA_INVALID')
    if (tags.unknownFields.some((n, i, rows) => i > 0 && n <= rows[i - 1]!)) throw sourceRefusal('SCHEMA_INVALID')
    for (const n of tags.orientations ?? []) orientations.add(n)
  }
  if (f.orientationIndex.some((row, i, rows) => i > 0 && row.orientation <= rows[i - 1]!.orientation)
    || [...orientations].some(n => !f.orientationIndex.some(row => row.orientation === n))) throw sourceRefusal('CATALOGUE_MISMATCH')
  return value
}
