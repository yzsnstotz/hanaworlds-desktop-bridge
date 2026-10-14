/** Runs only inside the default-strict installed production consumer. Peers are document fixtures. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { setImmediate } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import * as bridge from 'hanaworlds-desktop-bridge'
const requireInstalled = createRequire(import.meta.resolve('hanaworlds-desktop-bridge'))
const { Context, Service, symbols } = await import(pathToFileURL(requireInstalled.resolve('@deepseek-ai/cordis')))
const { SessionStore } = await import(pathToFileURL(requireInstalled.resolve('@deepseek-ai/dsh-session')))
const { WebServer } = await import(pathToFileURL(requireInstalled.resolve('@deepseek-ai/dsh-host-webserver')))
assert.throws(() => requireInstalled.resolve('hanaworlds-contracts'), { code: 'MODULE_NOT_FOUND' })
const examples = JSON.parse(readFileSync(new URL('./host-source-examples.json', import.meta.url)))
const config = examples.configNormal, trace = [], checks = []
const material = name => {
  const value = structuredClone(examples.materialCases.find(row => row.case === name).outcome.result)
  value.textures = value.textures.map(row => ({ ...row, bytes: Uint8Array.from(row.bytes) }))
  return value
}
const scope = examples.materialCases.find(row => row.case === 'material-normal').input
const record = value => JSON.parse(JSON.stringify(value, (key, item) => item instanceof Uint8Array ? [...item] : item))
for (const order of ['bridge-first', 'peers-first']) {
  const ctx = new Context(), fibers = [], bindings = {}, state = { profile: structuredClone(config.response), material: material('material-normal') }
  const own = fiber => { fibers.push(fiber); return fiber }
  try {
    await own(ctx.plugin(SessionStore))
    await own(ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }))
    ctx.provide('connection', { requestRejection: () => 403 })
    const attach = (kind, owner, reader) => {
      const registration = ctx.reflect._getImpl('hanaworldsWorldInspectionContext')
      assert.equal(owner, registration.fiber.ctx)
      assert.equal(owner.root, ctx.root)
      const binding = { owner, reader, open: true }; bindings[kind] = binding
      return () => { binding.open = false }
    }
    class Source extends Service {
      constructor(c) { super(c, 'hanaworldsWorldFacts') }
      async read(kind, input) {
        assert.equal(this.ctx.fiber, ctx.reflect._getImpl('hanaworldsWorldInspectionContext').fiber)
        if (state.entered) state.entered()
        if (state.gate) await state.gate
        if (state.error) throw state.error
        const value = structuredClone(kind === 'config' ? state.profile : state.material)
        trace.push({ order, kind, request: record(input), result: record(value) })
        return value
      }
      call(operation, request) { assert.equal(operation, 'ReadWriteProfile'); return this.read('config', request) }
      readMaterialSources(input) { return this.read('material', input) }
      readCatalogue() { assert.fail('Bridge must not read source Catalogue') }
    }
    const source = own(ctx.plugin(Source)); await source
    let fiber
    if (order === 'bridge-first') fiber = own(ctx.plugin(bridge))
    const compiler = { read: async () => structuredClone(config.normal.compiler) }
    const observations = { read: async () => structuredClone(config.normal.report) }
    await own(ctx.plugin({ name: 'DOCUMENT_FIXTURE/receivers', apply(c) {
      const unsupported = () => { throw new Error('UNEXPECTED_FIXTURE_WIRE_CALL') }
      c.provide('hanaworldsCanvasV5', { ready: Promise.resolve(), call: unsupported,
        attachConfigSource: (owner, reader) => attach('config', owner, reader) })
      c.provide('hanaworldsWorkshop', { call: unsupported,
        attachMaterialSource: (owner, reader) => attach('material', owner, reader) })
      c.provide('hanaworldsCompilerConfig', compiler)
      c.provide('hanaworldsCanvasConfigSupply', observations)
    } }))
    if (!fiber) fiber = own(ctx.plugin(bridge))
    await fiber.await(); await setImmediate()
    assert.equal(bindings.config.open, true); assert.equal(bindings.material.open, true)
    const call = (kind, signal = new AbortController().signal, receiver = bindings[kind].owner) =>
      Reflect.apply(bindings[kind].reader, receiver, kind === 'config' ? [config.scope, config.request] : [scope, signal])
    const equal = (a, b) => assert.deepEqual(record(a), record(b))
    equal(await call('config'), config.response)
    for (const name of ['material-normal', 'missing-texture', 'texture-budget', 'decode-failed', 'same-instance-recovery']) {
      state.material = material(name)
      const value = await call('material'); equal(value, state.material)
      for (const texture of value.textures) {
        assert.ok(texture.bytes instanceof Uint8Array)
        assert.equal(createHash('sha256').update(texture.bytes).digest('hex'), texture.bytesDigest)
      }
    }
    for (const kind of ['config', 'material']) {
      for (const forged of [{}, new Context(), Object.create(bindings[kind].owner)]) await assert.rejects(call(kind, undefined, forged))
      const error = Object.assign(new Error('original source unknown', { cause: new Error('original source cause') }), {
        publicError: { code: 'ADAPTER_UNAVAILABLE', phase: 'readback', retryability: 'NEVER', mutationState: 'UNKNOWN',
          transactionRef: 'opaque:unknown', causeCode: 'EIO', reason: 'REQUIRED_FACT_UNKNOWN' },
      })
      state.error = error
      await assert.rejects(call(kind), actual => actual === error)
      state.error = undefined
      await call(kind)
    }
    const cancel = new AbortController(), reason = new Error('original cancellation')
    cancel.abort(reason)
    await assert.rejects(call('material', cancel.signal), error => error === reason)
    state.material = material('material-normal')
    state.material.textures[0].bytes[0] ^= 1
    await assert.rejects(call('material'), error => error.publicError?.code === 'MEDIA_DIGEST_MISMATCH')
    state.material = material('same-instance-recovery'); await call('material')
    // The in-flight result must not survive a real source registration change.
    let release, entered
    state.gate = new Promise(resolve => { release = resolve })
    const started = new Promise(resolve => { entered = resolve }); state.entered = entered
    const pending = call('material').then(value => ({ value }), error => ({ error }))
    await Promise.race([started, pending.then(() => assert.fail('source not entered'))])
    await source.dispose(); await own(ctx.plugin(Source)); release()
    assert.ok('error' in await pending)
    delete state.gate; delete state.entered
    await call('material')
    const old = { ...bindings }
    await fiber.dispose()
    assert.equal(old.config.open, false); assert.equal(old.material.open, false)
    assert.equal((ctx.get('hanaworldsCompilerConfig')[symbols.original] ?? ctx.get('hanaworldsCompilerConfig')), compiler)
    assert.equal((ctx.get('hanaworldsCanvasConfigSupply')[symbols.original] ?? ctx.get('hanaworldsCanvasConfigSupply')), observations)
    await assert.rejects(Reflect.apply(old.material.reader, old.material.owner, [scope, new AbortController().signal]))
    fiber = own(ctx.plugin(bridge)); await fiber.await(); await setImmediate()
    assert.notEqual(bindings.material.owner, old.material.owner)
    await call('material'); await call('config')
    checks.push({ order, fullValues: true, typedBytes: true, unknownNull: true, originalErrorCause: true,
      cancellation: true, forgedReceiverRoot: true, sourceReplacement: true, unloadReattach: true, soleCanvasOwner: true })
  } finally { for (const fiber of fibers.reverse()) await fiber.dispose() }
}
writeFileSync(new URL('./host-source-proof.json', import.meta.url), JSON.stringify({
  evidence: 'STRICT_INSTALLED_COMPONENT_DOCUMENT_FIXTURES', runtime: import.meta.resolve('hanaworlds-desktop-bridge'),
  sources: examples.sources, checks, exchanges: trace, realLoaderWorldAgentAuthorization: 'NOT_RUN', owner: 'NOT_RUN',
}, null, 2) + '\n')
console.log(JSON.stringify({ installedHostHandoffs: 'PASS', orders: checks.length, exchanges: trace.length,
  sourceSDKRuntime: 'ABSENT', peerEvidence: 'DOCUMENT_FIXTURE', realHostWorldAuthorization: 'NOT_RUN' }))
