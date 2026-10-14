/** C-world-inspection v2: read-only evidence from the current official Loader and Cordis root.
 * Protocol structures belong to this provider; no contract package or peer implementation is imported.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { findPackageJSON } from 'node:module'
import { fileURLToPath } from 'node:url'
import { FiberState, type Context, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import { serviceIdentity } from './image-media.ts'

export interface ReadPluginEvidenceRequest { contractVersion: 'world-inspection/v1'; requestId: string }
/** Diagnostic strings allow empty values; they are not Ref identifiers. */
export interface RuntimeFault { name: string; message: string; code: string | null }
export interface PluginEvidence {
  entryId: string
  instanceRef: string
  moduleName: string
  package: { name: string; version: string } | null
  state: 'ACTIVE' | 'FAILED'
  contributions: { services: string[] }
  fault: RuntimeFault | null
  metadataError: { code: 'METADATA_UNAVAILABLE'; reason: string } | null
}
export interface PluginEvidencePublicError {
  code: 'SCHEMA_INVALID' | 'UNKNOWN_REQUIRED_FIELD' | 'PAYLOAD_VERSION_MISMATCH' | 'CAPABILITY_UNAVAILABLE'
  phase: 'decode' | 'validate'
  retryability: 'NEVER' | 'AFTER_NEW_FACTS'
  mutationState: 'NONE'
  transactionRef: null
  causeCode: null
  reason: string
}
export interface ReadPluginEvidenceResponse {
  contractVersion: 'world-inspection/v1'
  requestId: string
  result: { plugins: PluginEvidence[] } | null
  error: PluginEvidencePublicError | null
}
/** JSON-observable rejection; consumers do not share private exception identity. */
export class PluginEvidenceRejection extends Error {
  readonly contractVersion = 'world-inspection/v1'
  constructor(readonly requestId: string | null, readonly publicError: PluginEvidencePublicError) {
    super(publicError.code)
    this.name = 'PluginEvidenceRejection'
  }
}

// Structural views of the existing Loader dependency APIs, not a new service or runtime.
interface Entry {
  id: string
  options: { name: string; group?: boolean | null }
  disabled: boolean
  fiber?: Fiber
  parent: { tree: { ctx: Context & { baseUrl?: string } } }
}
interface ModuleJob { module?: { url: string; getNamespace(): unknown } }
interface ModuleCache {
  version: 'v1' | 'v2'
  loadCache: { get(url: string): ModuleJob | undefined }
  resolveSync: (...args: any[]) => { url: string }
}
interface Loader {
  ctx: Context
  entries(): Iterable<Entry>
  internal?: ModuleCache
  unwrapExports(namespace: unknown): Plugin
}
interface Impl { name: string; fiber: Fiber; value?: unknown }
interface CurrentEntry {
  entry: Entry
  fiber: Fiber
  uid: number
  state: FiberState.ACTIVE | FiberState.FAILED
  entryId: string
  moduleName: string
  instanceRef: string
}
const isRef = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const visible = (state: FiberState) => state === FiberState.ACTIVE || state === FiberState.FAILED
const publicError = (code: PluginEvidencePublicError['code'], reason: string): PluginEvidencePublicError => ({
  code, phase: code === 'CAPABILITY_UNAVAILABLE' ? 'validate' : 'decode',
  retryability: code === 'CAPABILITY_UNAVAILABLE' ? 'AFTER_NEW_FACTS' : 'NEVER',
  mutationState: 'NONE', transactionRef: null, causeCode: null, reason,
})
function decode(raw: unknown): ReadPluginEvidenceRequest {
  const object = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null
  const id = object && isRef(object.requestId) ? object.requestId : null
  const reject = (code: PluginEvidencePublicError['code'], reason: string): never => {
    throw new PluginEvidenceRejection(id, publicError(code, reason))
  }
  if (!object) reject('SCHEMA_INVALID', 'INVALID_REQUEST')
  if (Reflect.ownKeys(object!).some(key => key !== 'contractVersion' && key !== 'requestId')) reject('UNKNOWN_REQUIRED_FIELD', 'UNKNOWN_FIELD')
  if (!id || !Object.hasOwn(object!, 'contractVersion') || !Object.hasOwn(object!, 'requestId')
    || typeof object!.contractVersion !== 'string') reject('SCHEMA_INVALID', 'INVALID_REQUEST')
  if (object!.contractVersion !== 'world-inspection/v1') reject('PAYLOAD_VERSION_MISMATCH', 'UNSUPPORTED_CONTRACT_VERSION')
  return { contractVersion: 'world-inspection/v1', requestId: id! }
}

/** Refuse lossy JSON serialization (cycles, nonfinite numbers, dropped properties or custom toJSON). */
function isJSON(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || ancestors.has(value)) return false
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false
  ancestors.add(value)
  const keys = Reflect.ownKeys(value)
  const dataKeys = Array.isArray(value) ? keys.filter(key => key !== 'length') : keys
  const valid = (!Array.isArray(value) || (dataKeys.length === value.length
    && dataKeys.every((key, index) => key === String(index))))
    && dataKeys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      return typeof key === 'string' && descriptor.enumerable && 'value' in descriptor
        && isJSON(descriptor.value, ancestors)
    })
  ancestors.delete(value)
  return valid
}
function diagnostic(reason: unknown): RuntimeFault {
  if (reason instanceof Error) {
    const code = (reason as Error & { code?: unknown }).code
    return { name: reason.name, message: reason.message, code: typeof code === 'string' ? code : null }
  }
  let message: string
  if (typeof reason === 'string') message = reason
  else {
    try { message = isJSON(reason) ? JSON.stringify(reason) : `UNSERIALIZABLE_REJECTION:${typeof reason}` }
    catch { message = `UNSERIALIZABLE_REJECTION:${typeof reason}` }
  }
  return { name: 'NonError', message, code: null }
}

/** A provenance token is private and cannot be minted by a request or a path string. */
interface ManifestScope { module: object; path: string; current(): void }
const manifestScopes = new WeakMap<object, ManifestScope>()
/** Exactly one already-proven manifest. No ancestor search, fallback, import or cached identity. */
function packageIdentity(token: object): { name: string; version: string } {
  const scope = manifestScopes.get(token)
  if (!scope) throw new Error('MANIFEST_SCOPE_UNVERIFIED')
  scope.current()
  let bytes: string
  try { bytes = readFileSync(scope.path, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('PACKAGE_MANIFEST_MISSING')
    throw new Error('PACKAGE_MANIFEST_UNREADABLE')
  }
  scope.current()
  let manifest: { name?: unknown; version?: unknown } | null
  try { manifest = JSON.parse(bytes) } catch { throw new Error('PACKAGE_MANIFEST_INVALID') }
  if (!manifest || !isRef(manifest.name)) throw new Error('PACKAGE_NAME_MISSING')
  if (!isRef(manifest.version)) throw new Error('PACKAGE_VERSION_MISSING')
  return { name: manifest.name, version: manifest.version }
}

export class DesktopPluginEvidence {
  private readonly identities = new WeakMap<Fiber, string>()
  private closed = false
  private readonly bridgeUid: number | null
  constructor(private readonly ctx: Context) {
    this.bridgeUid = ctx.fiber.uid
    // uid survives dependency-driven reactivation; the public lifecycle event revokes its old activation.
    ctx.on('internal/status', (fiber, previous) => {
      if (fiber.ctx.root === ctx.root && fiber.state !== previous) this.identities.delete(fiber)
    }, { global: true })
    ctx.effect(() => () => { this.closed = true }, 'Plugin evidence reader teardown')
  }
  private active() { return !this.closed && this.ctx.fiber.uid === this.bridgeUid && this.ctx.fiber.state === FiberState.ACTIVE }
  private loader(): Loader | undefined {
    return serviceIdentity((this.ctx as unknown as { get(name: 'loader'): Loader | undefined }).get('loader'))
  }
  private inventory(loader: Loader): CurrentEntry[] {
    if (loader.ctx.root !== this.ctx.root) throw new Error('LOADER_ROOT_MISMATCH')
    const entries: CurrentEntry[] = []
    for (const entry of loader.entries()) {
      const fiber = entry.fiber
      if (entry.options.group || entry.disabled || !fiber || !visible(fiber.state) || fiber.uid === null) continue
      if (!isRef(entry.id) || !isRef(entry.options.name) || fiber.ctx.root !== this.ctx.root
        || (fiber as Fiber & { entry?: Entry }).entry !== entry) throw new Error('LOADER_ENTRY_UNVERIFIED')
      let instanceRef = this.identities.get(fiber)
      if (!instanceRef) { instanceRef = randomUUID(); this.identities.set(fiber, instanceRef) }
      entries.push({ entry, fiber, uid: fiber.uid, state: fiber.state as CurrentEntry['state'],
        entryId: entry.id, moduleName: entry.options.name, instanceRef })
    }
    entries.sort((a, b) => a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0)
    if (new Set(entries.map(row => row.entryId)).size !== entries.length) throw new Error('LOADER_ENTRY_DUPLICATED')
    return entries
  }
  private services(): [symbol, Impl, unknown][] {
    const store = this.ctx.root.reflect?.store
    if (!store || typeof store !== 'object') throw new Error('SERVICE_STORE_UNREADABLE')
    return Object.getOwnPropertySymbols(store).map(key => {
      const impl = store[key]
      if (!impl || !isRef(impl.name) || !impl.fiber) throw new Error('SERVICE_RECORD_UNREADABLE')
      return [key, impl, impl.value]
    })
  }
  private owner(fiber: Fiber): Entry | undefined {
    const visited = new Set<Fiber>()
    for (let current = fiber; !visited.has(current); current = current.parent.fiber) {
      visited.add(current)
      if (current.state !== FiberState.ACTIVE || current.ctx.root !== this.ctx.root) return undefined
      const entry = (current as Fiber & { entry?: Entry }).entry
      if (entry) return entry
    }
    return undefined
  }
  private metadata(loader: Loader, row: CurrentEntry): Pick<PluginEvidence, 'package' | 'metadataError'> {
    try {
      if (row.moduleName.startsWith('cordis:')) throw new Error('BUILTIN_HAS_NO_PACKAGE')
      const cache = loader.internal
      if (!cache) throw new Error('LOADED_MODULE_CACHE_UNAVAILABLE')
      const base = row.entry.parent.tree.ctx.baseUrl
      const resolved = cache.version === 'v2'
        ? cache.resolveSync(base, { specifier: row.moduleName })
        : cache.resolveSync(row.moduleName, base, {})
      // Inspect only an already loaded namespace. Never import, load or evaluate a module to answer a read.
      const module = cache.loadCache.get(resolved.url)?.module
      if (!module || module.url !== resolved.url) throw new Error('LOADED_MODULE_UNAVAILABLE')
      const callback = this.ctx.registry.resolve(loader.unwrapExports(module.getNamespace()))
      if (!callback || callback !== row.fiber.runtime?.callback) throw new Error('LOADED_CALLBACK_MISMATCH')
      const current = () => {
        if (!this.active() || this.loader() !== loader || loader.ctx.root !== this.ctx.root
          || ![...loader.entries()].includes(row.entry) || row.entry.disabled
          || row.entry.fiber !== row.fiber || row.fiber.uid !== row.uid || row.fiber.state !== row.state
          || row.fiber.ctx.root !== this.ctx.root || (row.fiber as Fiber & { entry?: Entry }).entry !== row.entry
          || this.identities.get(row.fiber) !== row.instanceRef || loader.internal !== cache
          || cache.loadCache.get(resolved.url)?.module !== module
          || this.ctx.registry.resolve(loader.unwrapExports(module.getNamespace())) !== callback) {
          throw new Error('MANIFEST_INSTANCE_CHANGED')
        }
      }
      current()
      const file = fileURLToPath(module.url)
      // Node's already-loaded package scope must also fit an independently bounded plugin
      // root: an installed (scoped or unscoped) node_modules package, or a standalone entry's
      // own directory. Never borrow a parent project/host scope for an unassociated file.
      const parts = file.split(sep), index = parts.lastIndexOf('node_modules')
      const end = index + (parts[index + 1]?.startsWith('@') ? 3 : 2)
      const root = index < 0 ? dirname(file) : parts.slice(0, end).join(sep)
      const path = join(root, 'package.json')
      if (findPackageJSON(module.url) !== path) throw new Error('MODULE_PACKAGE_SCOPE_UNPROVEN')
      current()
      const token = Object.freeze({})
      manifestScopes.set(token, { module, path, current })
      try { return { package: packageIdentity(token), metadataError: null } }
      finally { manifestScopes.delete(token) }
    } catch (error) {
      return { package: null, metadataError: { code: 'METADATA_UNAVAILABLE',
        reason: error instanceof Error && error.message ? error.message : 'PACKAGE_METADATA_UNREADABLE' } }
    }
  }
  async ReadPluginEvidence(raw: unknown): Promise<ReadPluginEvidenceResponse> {
    const request = decode(raw)
    if (!this.active()) throw new PluginEvidenceRejection(request.requestId, publicError('CAPABILITY_UNAVAILABLE', 'BRIDGE_INACTIVE'))
    const packet = (result: ReadPluginEvidenceResponse['result'], error: PluginEvidencePublicError | null): ReadPluginEvidenceResponse =>
      ({ ...request, result, error })
    try {
      const loader = this.loader()
      if (!loader) throw new Error('LOADER_UNAVAILABLE')
      const current = this.inventory(loader), registrations = this.services()
      const check = () => {
        if (!this.active() || this.loader() !== loader) throw new Error('BRIDGE_OR_LOADER_CHANGED')
        const next = this.inventory(loader), services = this.services()
        if (next.length !== current.length || next.some((row, index) => {
          const previous = current[index]!
          return row.entry !== previous.entry || row.fiber !== previous.fiber || row.uid !== previous.uid
            || row.state !== previous.state || row.instanceRef !== previous.instanceRef
            || row.entryId !== previous.entryId || row.moduleName !== previous.moduleName
        })) throw new Error('PLUGIN_INSTANCE_CHANGED')
        if (services.length !== registrations.length || services.some(([key, impl, value], index) => {
          const before = registrations[index]!
          return key !== before[0] || impl !== before[1] || value !== before[2]
        })) throw new Error('SERVICE_REGISTRATION_CHANGED')
      }
      const plugins: PluginEvidence[] = []
      for (const row of current) {
        check()
        const metadata = this.metadata(loader, row)
        let fault: RuntimeFault | null = null
        if (row.state === FiberState.FAILED) {
          let rejected = false, reason: unknown
          try { await row.fiber.await() } catch (error) { rejected = true; reason = error }
          check()
          if (!rejected) throw new Error('FAILED_FIBER_REASON_UNAVAILABLE')
          fault = diagnostic(reason)
        }
        plugins.push({ entryId: row.entryId, instanceRef: row.instanceRef, moduleName: row.moduleName,
          ...metadata, state: row.state === FiberState.ACTIVE ? 'ACTIVE' : 'FAILED', fault,
          contributions: { services: [...new Set(registrations.filter(([, impl]) =>
            this.owner(impl.fiber) === row.entry).map(([, impl]) => impl.name))].sort() } })
      }
      check()
      return packet({ plugins }, null)
    } catch (error) {
      return packet(null, publicError('CAPABILITY_UNAVAILABLE',
        error instanceof Error && error.message ? error.message : 'PLUGIN_EVIDENCE_UNREADABLE'))
    }
  }
}
