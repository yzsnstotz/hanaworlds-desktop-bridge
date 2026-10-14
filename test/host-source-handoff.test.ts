/** Bridge's public apply -> formally published Canvas/Workshop reader registration.
 * Counterpart data are exact document examples, NOT real Adapter/Workshop authorization.
 * No sibling source, external SDK schemas or live Docs path is read by these tests.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { setImmediate } from 'node:timers/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import * as plugin from 'hanaworlds-desktop-bridge'
import examples from './host-source-examples.json' with { type: 'json' }
import { createViewFixture } from './view-fixture.ts'
import { createWorkshopFixture } from './workshop-fixture.ts'
import { serviceIdentity } from '../lib/image-media.js'
import { DesktopBuildBridge } from '../lib/build-bridge.js'
import { contractHandshake } from 'hanaworlds-contracts'

const config = examples.configNormal
const materialExample = (name = 'material-normal') => examples.materialCases.find(row => row.case === name)!
const materialScope = materialExample().input
function materialValue(name = 'material-normal') {
  const value = structuredClone(materialExample(name).outcome.result!)
  return { ...value, textures: value.textures.map(row => ({ ...row, bytes: Uint8Array.from(row.bytes) })) }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
type Binding = { context: Context; reader: Function; open: boolean }

async function setup(t: any, options: { bridgeFirst?: boolean; holdCanvasReady?: boolean } = {}) {
  const ctx = new Context(), fibers: any[] = [], gates: ReturnType<typeof deferred>[] = []
  t.after(async () => {
    for (const gate of gates) gate.resolve()
    for (const fiber of fibers.reverse()) await fiber.dispose()
  })
  const own = (fiber: any) => { fibers.push(fiber); return fiber }
  await own(ctx.plugin(SessionStore))
  await own(ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }))
  ctx.provide('connection', { requestRejection: () => undefined })
  const ready = deferred(); gates.push(ready)
  if (!options.holdCanvasReady) ready.resolve()
  const canvas = createViewFixture(), workshop = createWorkshopFixture(canvas)
  const bindings: Record<'config' | 'material', Binding[]> = { config: [], material: [] }
  const detached: Record<'config' | 'material', number> = { config: 0, material: 0 }
  const calls: { operation: string; input: unknown; caller: unknown }[] = []
  const state: { config: any; material: any; error?: unknown; pause?: ReturnType<typeof deferred>;
    entered?: ReturnType<typeof deferred> } = { config: structuredClone(config.response), material: materialValue() }
  const attach = (kind: 'config' | 'material', context: Context, reader: Function) => {
    const current = ctx.reflect._getImpl('hanaworldsWorldInspectionContext')
    assert.ok(current, 'Bridge must register its real inspection identity before attaching a source')
    assert.equal(context, current.fiber.ctx, 'use the real provider fiber.ctx, not an inject child/JSON context')
    assert.equal(context.root, ctx.root)
    assert.equal(typeof reader, 'function')
    const binding = { context, reader, open: true }; bindings[kind].push(binding)
    return () => { if (binding.open) { binding.open = false; detached[kind]++ } }
  }
  Object.assign(canvas, {
    ready: ready.promise,
    attachConfigSource(context: Context, reader: Function) {
      assert.equal(serviceIdentity(this), canvas)
      return attach('config', context, reader)
    },
  })
  Object.assign(workshop, {
    attachMaterialSource(context: Context, reader: Function) {
      assert.equal(serviceIdentity(this), workshop)
      return attach('material', context, reader)
    },
  })
  class DocumentSource extends Service {
    constructor(context: Context) { super(context, 'hanaworldsWorldFacts') }
    async read(operation: string, input: unknown) {
      const current = ctx.reflect._getImpl('hanaworldsWorldInspectionContext')
      assert.ok(current, 'no source read after Bridge identity is revoked')
      assert.equal(this.ctx.fiber, current.fiber, 'Adapter is called by the actual Bridge context')
      assert.equal(this.ctx.root, ctx.root)
      calls.push({ operation, input: structuredClone(input), caller: this.ctx.fiber })
      state.entered?.resolve()
      if (state.pause) await state.pause.promise
      if (state.error !== undefined) throw state.error
      return structuredClone(operation === 'ReadWriteProfile' ? state.config : state.material)
    }
    async call(operation: string, request: unknown) {
      assert.equal(arguments.length, 2)
      assert.equal(operation, 'ReadWriteProfile', 'Bridge must not read Canvas Catalogue or wire MaterialSources')
      return this.read(operation, request)
    }
    async readMaterialSources(scope: unknown) {
      assert.equal(arguments.length, 1, 'formal typed source takes only the three-field scope')
      return this.read('readMaterialSources', scope)
    }
    async readCatalogue() { assert.fail('Catalogue source reads belong to Canvas') }
  }
  const sourceFiber = own(ctx.plugin(DocumentSource)); await sourceFiber
  let bridgeFiber: any
  if (options.bridgeFirst) bridgeFiber = own(ctx.plugin(plugin))
  const peerPlugin = { name: 'formal-document-receivers', apply(scope: Context) {
    scope.provide('hanaworldsCanvasV5', canvas)
    scope.provide('hanaworldsWorkshop', workshop)
  } }
  const peersFiber = own(ctx.plugin(peerPlugin)); await peersFiber
  if (!bridgeFiber) bridgeFiber = own(ctx.plugin(plugin))
  await bridgeFiber.await()
  await setImmediate() // drain ordinary Cordis inject jobs once; no retry or polling.
  async function binding(kind: 'config' | 'material') {
    assert.equal(bindings[kind].filter(row => row.open).length, 1,
      `Bridge apply must attach exactly one ${kind} reader through its formal receiver`)
    return bindings[kind].findLast(row => row.open)!
  }
  async function read(kind: 'config' | 'material', signal = new AbortController().signal) {
    const current = await binding(kind)
    return Reflect.apply(current.reader, current.context,
      kind === 'config' ? [structuredClone(config.scope), structuredClone(config.request)] : [structuredClone(materialScope), signal])
  }
  return { ctx, bindings, detached, calls, state, read, binding, ready, bridgeFiber, sourceFiber, peersFiber,
    pause() { const pause = deferred(), entered = deferred(); gates.push(pause, entered); state.pause = pause; state.entered = entered; return { pause, entered } },
    async remount() { bridgeFiber = own(ctx.plugin(plugin)); await bridgeFiber.await(); await setImmediate(); return bridgeFiber },
    async replaceSource() { const next = own(ctx.plugin(DocumentSource)); await next; return next },
    async replacePeers() { const next = own(ctx.plugin(peerPlugin)); await next; await bridgeFiber.await(); await setImmediate(); return next },
  }
}

for (const bridgeFirst of [false, true]) {
  test(`formal handoff: ${bridgeFirst ? 'Bridge-first' : 'peers-first'} attaches both readers with real Bridge context`, async t => {
    const h = await setup(t, { bridgeFirst })
    await h.binding('config'); await h.binding('material')
    assert.deepEqual(h.calls, [], 'attaching must not read source facts, write or start anything')
    assert.deepEqual(await h.read('config'), config.response, 'relay the full original response, not a bare config')
    assert.deepEqual(await h.read('material'), materialValue(), 'relay provider/facts/textures and all original bytes')
    assert.deepEqual(h.calls.map(row => [row.operation, row.input]), [
      ['ReadWriteProfile', config.request], ['readMaterialSources', materialScope],
    ])
  })
}

test('formal handoff: Canvas ready is respected before configuration attachment', async t => {
  const h = await setup(t, { holdCanvasReady: true })
  assert.equal(h.bindings.config.length, 0)
  h.ready.resolve(); await setImmediate()
  await h.binding('config')
})

test('formal handoff: full texture bytes, UNKNOWN/null rows and explicit recovery reach Workshop unchanged', async t => {
  const h = await setup(t)
  for (const name of ['material-normal', 'missing-texture', 'texture-budget', 'decode-failed', 'same-instance-recovery']) {
    h.state.material = materialValue(name)
    const result = await h.read('material')
    assert.deepEqual(result, h.state.material)
    for (const row of result.textures) {
      assert.ok(row.bytes instanceof Uint8Array)
      assert.equal(createHash('sha256').update(row.bytes).digest('hex'), row.bytesDigest)
    }
  }
  assert.equal(h.calls.length, 5, 'each explicit read gets fresh facts; no retry or old success cache')
})

for (const kind of ['config', 'material'] as const) {
  test(`formal handoff: ${kind} preserves original Error/cause/publicError including UNKNOWN, then recovers`, async t => {
    const h = await setup(t)
    const original = Object.assign(new Error('source read outcome unknown', { cause: new Error('original cause') }), {
      publicError: { code: 'ADAPTER_UNAVAILABLE', phase: 'readback', retryability: 'NEVER', mutationState: 'UNKNOWN',
        transactionRef: 'source:uncertain-read', causeCode: 'IO_INTERRUPTED', reason: 'REQUIRED_FACT_UNKNOWN',
        worldRef: kind === 'config' ? config.scope.worldRef : materialScope.worldRef,
        source: { owner: 'world-source', operation: kind === 'config' ? 'ReadWriteProfile' : 'readMaterialSources',
          resource: 'opaque-source-resource', kind: 'IO', nativeCode: 'EIO' } },
    })
    h.state.error = original
    await assert.rejects(h.read(kind), error => { assert.equal(error, original); return true })
    assert.equal(h.calls.length, 1, 'do not retry UNKNOWN or read another source')
    h.state.error = undefined
    assert.deepEqual(await h.read(kind), kind === 'config' ? config.response : materialValue())
    assert.equal(h.calls.length, 2)
  })

  test(`formal handoff: ${kind} reader cannot be borrowed by another root or used after unload`, async t => {
    const h = await setup(t), old = await h.binding(kind)
    const args = kind === 'config' ? [config.scope, config.request] : [materialScope, new AbortController().signal]
    for (const receiver of [new Context(), {}, Object.create(old.context)]) {
      await assert.rejects(Promise.resolve().then(() => Reflect.apply(old.reader, receiver, args)))
    }
    assert.equal(h.calls.length, 0)
    await h.bridgeFiber.dispose()
    assert.equal(old.open, false, 'Bridge cleanup must invoke the documented disposer')
    await assert.rejects(Promise.resolve().then(() => Reflect.apply(old.reader, old.context, args)))
    assert.equal(h.calls.length, 0)
    await h.remount()
    assert.notEqual((await h.binding(kind)).context, old.context)
    assert.deepEqual(await h.read(kind), kind === 'config' ? config.response : materialValue())
  })

  for (const replace of [false, true]) {
    test(`formal handoff: ${kind} rejects a source ${replace ? 'replaced' : 'revoked'} while its read is pending`, async t => {
      const h = await setup(t); await h.binding(kind)
      const gate = h.pause(), work = h.read(kind)
      const settled = work.then(value => ({ value }), error => ({ error }))
      await Promise.race([gate.entered.promise, settled.then(() => assert.fail('read settled before entering the source'))])
      await h.sourceFiber.dispose()
      if (replace) await h.replaceSource()
      gate.pause.resolve()
      assert.ok('error' in await settled, 'never release the old result after source registration loss/replacement')
      assert.equal(h.calls.length, 1)
    })
  }
}

test('formal handoff: original receiver replacement detaches both old readers and reattaches through the current peers', async t => {
  const h = await setup(t), oldConfig = await h.binding('config'), oldMaterial = await h.binding('material')
  await h.peersFiber.dispose()
  assert.equal(oldConfig.open, false)
  assert.equal(oldMaterial.open, false)
  assert.deepEqual(h.calls, [])
  await h.replacePeers()
  assert.notEqual(await h.binding('config'), oldConfig)
  assert.notEqual(await h.binding('material'), oldMaterial)
  assert.deepEqual(await h.read('config'), config.response)
  assert.deepEqual(await h.read('material'), materialValue())
})

test('formal handoff: configuration source business refusal keeps the complete original envelope', async t => {
  const h = await setup(t)
  for (const row of examples.materialCases.filter(row => row.case.startsWith('original-wire-ReadWriteProfile-'))) {
    h.state.config = { ...structuredClone(row.outcome), requestId: config.request.requestId }
    assert.deepEqual(await h.read('config'), h.state.config,
      'Canvas owns interpretation of the original result/error envelope; Bridge must not narrow it')
  }
})

test('formal handoff: existing bridge Catalogue consumer relays Canvas facts under the current invocation', async () => {
  const normal = examples.imageNormal.projection, requests: unknown[] = []
  const context = examples.imageNormal.hostContext.localContext
  const canvas = { contractHandshake, async call() { return null }, async readCatalogue(request: unknown) {
    requests.push(structuredClone(request)); return structuredClone(normal.catalogue)
  } }
  let checks = 0
  const bridge = new DesktopBuildBridge({ trustedInvocation: () => ({ sessionRef: normal.sessionRef,
    localContext: context, async check() { checks++ } }) } as any, {
    canvas: () => canvas, adapter: () => undefined,
    nativeFacts: () => ({ async readCatalogue() { assert.fail('Bridge cannot read Adapter Catalogue under its own role') } }) as any,
  })
  try {
    assert.deepEqual(await bridge.catalogue(context.worldRef), normal.catalogue.facts.catalogue)
    assert.deepEqual(requests, [{ sessionRef: normal.sessionRef, expectedConnection: materialScope }])
    assert.ok(checks >= 2, 'recheck the current session/world invocation before and after Canvas')
  } finally { bridge.close() }
})

test('formal handoff: material cancellation preserves the original reason before and after source await', async t => {
  const h = await setup(t); await h.binding('material')
  const first = new AbortController(), before = new Error('cancel-before-read')
  first.abort(before)
  await assert.rejects(h.read('material', first.signal), error => { assert.equal(error, before); return true })
  assert.equal(h.calls.length, 0)
  const second = new AbortController(), during = new Error('cancel-during-read'), gate = h.pause()
  const work = h.read('material', second.signal)
  const settled = work.then(value => ({ value }), error => ({ error }))
  await Promise.race([gate.entered.promise, settled.then(() => assert.fail('read settled before entering the source'))])
  second.abort(during); gate.pause.resolve()
  const outcome = await settled
  assert.ok('error' in outcome); assert.equal(outcome.error, during)
  assert.equal(h.calls.length, 1)
})
