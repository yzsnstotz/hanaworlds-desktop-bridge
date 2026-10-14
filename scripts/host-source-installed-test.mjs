/** Runs only inside the default-strict installed production consumer. Peers are document fixtures. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import * as bridge from 'hanaworlds-desktop-bridge'
const requireInstalled = createRequire(import.meta.resolve('hanaworlds-desktop-bridge'))
const { Context, Service, symbols } = await import(pathToFileURL(requireInstalled.resolve('@deepseek-ai/cordis')))
const { SessionStore, SessionId } = await import(pathToFileURL(requireInstalled.resolve('@deepseek-ai/dsh-session')))
const { WebServer } = await import(pathToFileURL(requireInstalled.resolve('@deepseek-ai/dsh-host-webserver')))
assert.throws(() => requireInstalled.resolve('hanaworlds-contracts'), { code: 'MODULE_NOT_FOUND' })
const examples = JSON.parse(readFileSync(new URL('./host-source-examples.json', import.meta.url)))
const probeData = JSON.parse(readFileSync(new URL('./probe-data.json', import.meta.url)))
const packageRoot = dirname(dirname(fileURLToPath(import.meta.resolve('hanaworlds-desktop-bridge'))))
const provenance = JSON.parse(readFileSync(join(packageRoot, 'lib/build-provenance.json')))
assert.deepEqual(provenance.sources, probeData.expectedHandoffBuild.sources, 'installed sources match this normal build')
assert.equal(provenance.lockSha256, probeData.expectedHandoffBuild.lockSha256)
for (const row of provenance.outputs) assert.equal(createHash('sha256').update(readFileSync(join(packageRoot, row.path))).digest('hex'), row.sha256)
const config = examples.configNormal, trace = [], checks = []
const material = name => {
  const value = structuredClone(examples.materialCases.find(row => row.case === name).outcome.result)
  value.textures = value.textures.map(row => ({ ...row, bytes: Uint8Array.from(row.bytes) }))
  return value
}
const scope = examples.materialCases.find(row => row.case === 'material-normal').input
const record = value => JSON.parse(JSON.stringify(value, (key, item) => item instanceof Uint8Array ? [...item] : item))
for (const order of ['bridge-first', 'peers-first']) {
  const ctx = new Context(), fibers = [], bindings = {}, registrations = [], state = { profile: structuredClone(config.response), material: material('material-normal') }
  const own = fiber => { fibers.push(fiber); return fiber }
  try {
    await own(ctx.plugin(SessionStore))
    await own(ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }))
    ctx.provide('connection', { requestRejection: () => 403 })
    const sessionRef = examples.imageNormal.projection.sessionRef
    const core = ctx.sessions.create(SessionId(sessionRef))
    const oldContext = probeData.selection.selection.context.localContext
    const aliases = new Map([[probeData.sessionRef, sessionRef], [oldContext.worldRef, scope.worldRef],
      [oldContext.connectionRef, scope.connectionRef], [oldContext.connectionIncarnationRef, scope.connectionIncarnationRef]])
    // Only counterpart opaque references are rebound. No principal/authorization object is synthesized.
    const rebound = raw => JSON.parse(JSON.stringify(raw, (key, value) => typeof value === 'string' ? aliases.get(value) ?? value : value))
    const selection = rebound(probeData.selection), snapshot = rebound(probeData.snapshot)
    const attach = (kind, owner, reader) => {
      const registration = ctx.reflect._getImpl('hanaworldsWorldInspectionContext')
      assert.equal(owner, registration.fiber.ctx)
      assert.equal(owner.root, ctx.root)
      const binding = { owner, reader, open: true }; bindings[kind] = binding
      registrations.push({ kind, binding })
      return () => { binding.open = false }
    }
    class Source extends Service {
      constructor(c) { super(c, 'hanaworldsWorldFacts') }
      async read(kind, input) {
        assert.equal(this.ctx.fiber, ctx.reflect._getImpl('hanaworldsWorldInspectionContext').fiber)
        if (state.entered) state.entered()
        if (state.gate) await state.gate
        if (state.error) {
          trace.push({ order, kind, request: record(input), result: null, failure: {
            name: state.error.name, message: state.error.message, publicError: state.error.publicError ?? null,
            cause: state.error.cause ? { name: state.error.cause.name, message: state.error.cause.message } : null,
          } })
          throw state.error
        }
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
    const peerPlugin = { name: 'DOCUMENT_FIXTURE/receivers', apply(c) {
      const unsupported = () => { throw new Error('UNEXPECTED_FIXTURE_WIRE_CALL') }
      const reply = (request, result) => ({ contractVersion: request.contractVersion, requestId: request.requestId, result, error: null })
      c.provide('hanaworldsCanvasV5', { ready: state.ready ?? Promise.resolve(), contractHandshake: probeData.handshake,
        async call(operation, request) { return operation === 'ReadWorldSelectionContext' ? reply(request, selection) : unsupported() },
        attachConfigSource: (owner, reader) => attach('config', owner, reader) })
      c.provide('hanaworldsWorkshop', { contractHandshake: probeData.handshake,
        async call(operation, request) { return operation === 'StartOrResumeSession' ? reply(request, snapshot) : unsupported() },
        attachMaterialSource: (owner, reader) => attach('material', owner, reader) })
      c.provide('hanaworldsCompilerConfig', compiler)
      c.provide('hanaworldsCanvasConfigSupply', observations)
    } }
    const peers = await own(ctx.plugin(peerPlugin))
    if (!fiber) fiber = own(ctx.plugin(bridge))
    await fiber.await(); await setImmediate()
    assert.equal(bindings.config.open, true); assert.equal(bindings.material.open, true)
    const call = (kind, signal = new AbortController().signal, receiver = bindings[kind].owner) =>
      Reflect.apply(bindings[kind].reader, receiver, kind === 'config' ? [config.scope, config.request] : [scope, signal])
    const equal = (a, b) => assert.deepEqual(record(a), record(b))
    assert.equal(ctx.sessions.get(SessionId(sessionRef)), core)
    const context = await ctx.get('hanaworldsDesktopBridge').worlds.context(sessionRef)
    assert.equal(context.noLiveBinding, false)
    assert.deepEqual({ worldRef: context.localContext.worldRef, connectionRef: context.localContext.connectionRef,
      connectionIncarnationRef: context.localContext.connectionIncarnationRef }, scope)
    await assert.rejects(ctx.get('hanaworldsDesktopBridge').worlds.context('absent-core-session'), /SESSION_NOT_FOUND/)
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
    // Scope/current-provider/typed coverage negatives exercise this installed Bridge admission.
    for (const field of ['worldRef', 'connectionRef', 'connectionIncarnationRef']) {
      state.profile = structuredClone(config.response); state.profile.result.connection[field] = `other:${field}`
      await assert.rejects(call('config'), error => error.publicError?.code === 'CURRENT_WORLD_MISMATCH')
      state.material = material('material-normal'); state.material.facts.snapshot.connection[field] = `other:${field}`
      await assert.rejects(call('material'), error => error.publicError?.code === 'CURRENT_WORLD_MISMATCH')
    }
    state.profile = structuredClone(config.response)
    state.material = material('material-normal'); delete state.material.provider.providerRevision
    await assert.rejects(call('material'), error => error.publicError?.code === 'SCHEMA_INVALID')
    for (const mutation of [value => { value.textures = [] }, value => { value.textures.push(structuredClone(value.textures[0])) },
      value => { value.textures[0].bytes = [...value.textures[0].bytes] }]) {
      state.material = material('material-normal'); mutation(state.material)
      await assert.rejects(call('material'), error => error.publicError?.code === 'MEDIA_DIGEST_MISMATCH')
    }
    state.material = material('same-instance-recovery'); await call('material')
    for (const kind of ['config', 'material']) {
      const error = Object.assign(new Error('original role refusal', { cause: new Error('original authority cause') }), {
        publicError: { code: 'CAPABILITY_UNAVAILABLE', phase: 'validate', retryability: 'AFTER_NEW_FACTS', mutationState: 'NONE',
          transactionRef: null, causeCode: null, reason: 'REQUIRED_FACT_UNKNOWN',
          worldRef: kind === 'config' ? config.scope.worldRef : scope.worldRef,
          source: { owner: 'world-source', operation: kind === 'config' ? 'ReadWriteProfile' : 'readMaterialSources',
            resource: 'opaque:authority', kind: 'PERMISSION', nativeCode: 'EACCES' } },
      })
      state.error = error
      await assert.rejects(call(kind), actual => actual === error && actual.cause === error.cause)
      state.error = undefined
      await call(kind)
    }
    for (const row of examples.materialCases.filter(row => row.case.startsWith('original-wire-ReadWriteProfile-'))) {
      state.profile = { ...structuredClone(row.outcome), requestId: config.request.requestId }
      equal(await call('config'), state.profile)
    }
    state.profile = structuredClone(config.response)
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
    // The configuration reader also rejects revocation, not just material replacement.
    let releaseConfig, enteredConfig
    state.gate = new Promise(resolve => { releaseConfig = resolve })
    const configStarted = new Promise(resolve => { enteredConfig = resolve }); state.entered = enteredConfig
    const pendingConfig = call('config').then(value => ({ value }), error => ({ error }))
    await Promise.race([configStarted, pendingConfig.then(() => assert.fail('config source not entered'))])
    await ctx.reflect._getImpl('hanaworldsWorldFacts').fiber.dispose()
    releaseConfig(); assert.ok('error' in await pendingConfig)
    delete state.gate; delete state.entered
    await own(ctx.plugin(Source)); await call('config')
    let releaseCancel, enteredCancel
    state.gate = new Promise(resolve => { releaseCancel = resolve })
    const cancelStarted = new Promise(resolve => { enteredCancel = resolve }); state.entered = enteredCancel
    const during = new AbortController(), duringReason = new Error('original in-flight cancellation')
    const pendingCancel = call('material', during.signal).then(value => ({ value }), error => ({ error }))
    await Promise.race([cancelStarted, pendingCancel.then(() => assert.fail('cancel source not entered'))])
    during.abort(duringReason); releaseCancel()
    assert.equal((await pendingCancel).error, duringReason)
    delete state.gate; delete state.entered
    const old = { ...bindings }
    await fiber.dispose()
    assert.equal(old.config.open, false); assert.equal(old.material.open, false)
    assert.equal((ctx.get('hanaworldsCompilerConfig')[symbols.original] ?? ctx.get('hanaworldsCompilerConfig')), compiler)
    assert.equal((ctx.get('hanaworldsCanvasConfigSupply')[symbols.original] ?? ctx.get('hanaworldsCanvasConfigSupply')), observations)
    await assert.rejects(Reflect.apply(old.material.reader, old.material.owner, [scope, new AbortController().signal]))
    fiber = own(ctx.plugin(bridge)); await fiber.await(); await setImmediate()
    assert.notEqual(bindings.material.owner, old.material.owner)
    await call('material'); await call('config')
    // No startup Promise may make unloading a never-ready peer depend on readiness.
    await peers.dispose()
    let releaseReady
    state.ready = new Promise(resolve => { releaseReady = resolve })
    const waitingPeer = await own(ctx.plugin(peerPlugin)); await fiber.await(); await setImmediate()
    const configAttachments = registrations.filter(row => row.kind === 'config').length
    const unloading = waitingPeer.dispose()
    const disposedWithoutReady = await Promise.race([unloading.then(() => true), setImmediate().then(() => false)])
    releaseReady(); await unloading; await setImmediate()
    assert.equal(disposedWithoutReady, true, 'pending Canvas ready must not block unload')
    assert.equal(registrations.filter(row => row.kind === 'config').length, configAttachments, 'late ready cannot attach an old peer')
    state.ready = Promise.resolve()
    await own(ctx.plugin(peerPlugin)); await fiber.await(); await setImmediate()
    assert.equal(registrations.filter(row => row.kind === 'config' && row.binding.open).length, 1)
    assert.equal(registrations.filter(row => row.kind === 'material' && row.binding.open).length, 1)
    await call('material'); await call('config')
    checks.push({ order, fullValues: true, typedBytes: true, unknownNull: true, originalErrorCause: true,
      cancellation: true, forgedReceiverRoot: true, sourceReplacement: true, unloadReattach: true, soleCanvasOwner: true,
      actualCoreWorldBinding: true, scopeWorldConnectionIncarnation: true, providerShape: true, textureCoverage: true,
      originalAuthorityRefusal: true, originalBusinessEnvelope: true, configSourceRevocation: true,
      inFlightCancellation: true, pendingReadyUnload: true, lateReadyRevoked: true })
  } finally { for (const fiber of fibers.reverse()) await fiber.dispose() }
}
writeFileSync(new URL('./host-source-proof.json', import.meta.url), JSON.stringify({
  evidence: 'STRICT_INSTALLED_COMPONENT_DOCUMENT_FIXTURES', runtime: import.meta.resolve('hanaworlds-desktop-bridge'),
  artifact: { tgzSha256: probeData.expectedHandoffBuild.tgzSha256,
    installedProvenanceSha256: createHash('sha256').update(readFileSync(join(packageRoot, 'lib/build-provenance.json'))).digest('hex'),
    compiledSources: provenance.sources, currentBuildMatchesInstalled: true, allInstalledOutputHashesMatch: true },
  sources: examples.sources, checks, exchanges: trace, realLoaderWorldAgentAuthorization: 'NOT_RUN', owner: 'NOT_RUN',
}, null, 2) + '\n')
console.log(JSON.stringify({ installedHostHandoffs: 'PASS', orders: checks.length, exchanges: trace.length,
  sourceSDKRuntime: 'ABSENT', peerEvidence: 'DOCUMENT_FIXTURE', realHostWorldAuthorization: 'NOT_RUN' }))
