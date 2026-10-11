import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contractProtocols, regionCapabilities, contractHandshake, validateBoundResponse, validateType } from 'hanaworlds-contracts'
import { DesktopDeploymentPolicy } from '../lib/deployment-policy.js'
import { DesktopRegionPorts } from '../lib/region-ports.js'
import { DesktopImageMedia, serviceIdentity } from '../lib/image-media.js'
import { Context, Service } from '@deepseek-ai/cordis'
import { DesktopBuildBridge } from '../lib/build-bridge.js'
import { DesktopInspectionFacts } from '../lib/inspection-facts.js'
import { createWriteProfileFixture } from './world-facts-fixture.ts'
import regionFixture from 'hanaworlds-contracts/fixtures/region' with { type: 'json' }

test('deployment relays a complete world-source write profile, including opaque backend and declared avatar', async () => {
  const source = createWriteProfileFixture()
  const backend = { profileId: 'OPAQUE/custom-source', revision: 'custom-revision' }
  source.profile = validateType('WriteProfile', { ...source.profile,
    writeBackend: { ...source.profile.writeBackend, writeBackend: backend },
    compilationConfig: { ...source.profile.compilationConfig, writeBackend: backend },
    writeMethods: ['REGION'],
    avatarEnvelope: { availability: 'KNOWN', basis: 'WORLD_SOURCE_DECLARATION', size: { width: 2, height: 3, depth: 4 } },
  })
  const policy = new DesktopDeploymentPolicy({ facts: () => source })
  const description = await policy.describe('fixture-world')
  assert.deepEqual(description.writeProfile.value, source.profile)
  assert.deepEqual(description.compilerConfig.value, source.profile.compilationConfig)
  assert.deepEqual(description.writeMethods.value, source.profile.writeMethods)
  assert.deepEqual(description.fixed[0].value, source.profile.avatarEnvelope)
  assert.equal(source.requests.length, 1, 'one source snapshot for the whole description')
  assert.deepEqual(await policy.compiler('fixture-world'), source.profile.compilationConfig)
  assert.equal((source.requests[0] as any).worldRef, 'fixture-world')
  assert.throws(() => policy.safety('fixture-world'))
})

test('deployment preserves undeclared facts without substituting a config, method or body envelope', async () => {
  const source = createWriteProfileFixture(true), policy = new DesktopDeploymentPolicy({ facts: () => source })
  const description = await policy.describe('fixture-world')
  assert.deepEqual(description.writeProfile.value, source.profile)
  assert.equal(description.compilerConfig.value, null)
  assert.equal(description.compilerConfig.error, null)
  assert.deepEqual(description.writeMethods.value, [])
  assert.deepEqual(description.fixed[0].value, source.profile.avatarEnvelope)
  await assert.rejects(policy.compiler('fixture-world'), /CAPABILITY_UNAVAILABLE/)
})

test('deployment reports missing sources, missing named reads and declared errors without inventing facts', async () => {
  await assert.rejects(new DesktopDeploymentPolicy({ facts: () => undefined }).writeProfile('fixture-world'), /ADAPTER_UNAVAILABLE/)
  await assert.rejects(new DesktopDeploymentPolicy({ facts: () => ({}) }).writeProfile('fixture-world'), /CAPABILITY_UNAVAILABLE/)
  const source = createWriteProfileFixture(), policy = new DesktopDeploymentPolicy({ facts: () => source })
  for (const code of ['ADAPTER_UNAVAILABLE', 'CAPABILITY_UNAVAILABLE'] as const) {
    source.error = code
    await assert.rejects(policy.writeProfile('fixture-world'), new RegExp(code))
    const description = await policy.describe('fixture-world')
    assert.equal(description.writeProfile.value, null)
    assert.equal(description.fixed[0].value, null)
  }
  const calls = source.requests.length
  const unbound = await policy.describe(null)
  assert.match(unbound.writeProfile.error!, /WORLD_NOT_BOUND/)
  assert.equal(source.requests.length, calls)
})

test('deployment rejects incompatible, uncorrelated and foreign-world source responses', async () => {
  const source = createWriteProfileFixture()
  const policy = (port: any) => new DesktopDeploymentPolicy({ facts: () => port })
  await assert.rejects(policy({ ...source, contractHandshake: { ...source.contractHandshake, wireVersions: [] } }).writeProfile('fixture-world'))
  for (const change of [(r: any) => ({ ...r, requestId: 'foreign-request' }),
    (r: any) => ({ ...r, result: { ...r.result, connection: { ...r.result.connection, worldRef: 'foreign-world' } } })]) {
    await assert.rejects(policy({ ...source, async call(op: string, raw: unknown) { return change(await source.call(op, raw)) } }).writeProfile('fixture-world'))
  }
})

test('deployment refuses a world source replaced during the read', async () => {
  const source = createWriteProfileFixture()
  let live = source
  const policy = new DesktopDeploymentPolicy({ facts: () => live })
  const call = source.call.bind(source)
  source.call = async (op, raw) => { const response = await call(op, raw); live = createWriteProfileFixture(); return response }
  await assert.rejects(policy.writeProfile('fixture-world'), /ADAPTER_UNAVAILABLE/)
})

test('region ports admit published wire capabilities, constrain operations, and reject replaced providers', async () => {
  const handshake = { profileVersion: 'protocol-handshake/v1', component: 'FIXTURE/region',
    protocols: [...contractProtocols].sort((a, b) => a.protocol < b.protocol ? -1 : a.protocol > b.protocol ? 1 : 0),
    capabilities: regionCapabilities.map(c => c.id).sort(),
    provenance: { packageName: 'FIXTURE/region', packageVersion: '1.0.0', sourceRevision: null, artifactDigest: null } }
  const requests: unknown[] = []
  let painter = { protocolHandshake: () => handshake, async call(operation: string, request: unknown) { requests.push(request); return { operation } } }
  const brush = { protocolHandshake: () => handshake, compileRegion(request: unknown) { requests.push(request); return request } }
  const ports = new DesktopRegionPorts({ painter: () => painter, brush: () => brush,
    canvasRegion: () => ({ protocolHandshake: handshake, async call() {} }),
    adapterRegion: () => ({ protocolHandshake: handshake, async call() {} }) })
  assert.ok(ports.status().every(row => row.compatible))
  const port = ports.painterPort()!
  assert.deepEqual(await port.call('ValidateRegionProposal', { test: true }), { operation: 'ValidateRegionProposal' })
  await assert.rejects(port.call('OTHER_OPERATION', {}), /UNSUPPORTED_OPERATION/)
  painter = { ...painter }
  await assert.rejects(port.call('ValidateRegionProposal', {}), /REGION_PEER_REPLACED/)
  assert.equal(requests.length, 1)
})

test('image reader refuses bytes whose attachment is absent from the current Core conversation', async () => {
  let storageReads = 0
  const images = new DesktopImageMedia({ attachments: () => ({ async readImage() { storageReads++; return {} } } as any),
    async readEvents() { return [] } })
  await assert.rejects(images.read({ seq: 1 } as any, 'foreign-attachment', async () => {}), /ATTACHMENT_NOT_IN_SESSION/)
  assert.equal(storageReads, 0)
})

test('build bridge restores the exact raw call on actual Cordis Service registrations', async () => {
  class Canvas extends Service {
    constructor(ctx: Context) { super(ctx, 'fixtureCanvas') }
    async call() { return null }
  }
  const ctx = new Context(), fiber = await ctx.plugin(Canvas)
  try {
    const raw = serviceIdentity(ctx.get('fixtureCanvas')) as Canvas
    const original = raw.call
    for (const seam of ['canvas', 'adapter', 'region']) {
      const bridge = new DesktopBuildBridge({} as any, {
        canvas: () => seam === 'canvas' ? ctx.get('fixtureCanvas') : undefined,
        adapter: () => seam === 'adapter' ? ctx.get('fixtureCanvas') : undefined,
        canvasRegion: () => seam === 'region' ? ctx.get('fixtureCanvas') : undefined,
        nativeFacts: () => undefined,
      })
      assert.notEqual(raw.call, original, seam)
      bridge.close()
      assert.equal(raw.call, original, seam)
    }
  } finally { await fiber.dispose() }
})

test('region write authorization ends when the individual Canvas call returns', async () => {
  const request = regionFixture.commitRequest
  let release!: () => void, late!: Promise<unknown>, writes = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  const adapter = { protocolHandshake: regionFixture.peerHandshake, async call() { writes++; return regionFixture.writeResponse } }
  const canvas = { protocolHandshake: { ...regionFixture.peerHandshake,
    protocols: [...contractProtocols].sort((a, b) => a.protocol < b.protocol ? -1 : a.protocol > b.protocol ? 1 : 0),
    capabilities: regionCapabilities.map(c => c.id).sort() }, async call() {
    late = gate.then(() => adapter.call('WriteRegion', regionFixture.writeRequest))
    return regionFixture.commitResponse
  } }
  const bridge = new DesktopBuildBridge({ trustedInvocation: () => ({ sessionRef: request.sessionRef,
    localContext: request.localContext, async check() {} }) } as any,
    { canvas: () => ({ contractHandshake, async call() { return null } }), adapter: () => undefined,
      nativeFacts: () => undefined, canvasRegion: () => canvas, adapterRegion: () => adapter })
  try {
    await bridge.run(async () => {
      await canvas.call('ApplyRegionCommit', request)
      release()
      await assert.rejects(late, /LOCAL_DISPATCH_REQUIRED/)
      assert.equal(writes, 0)
      return null
    })
  } finally { bridge.close() }
})

test('Canvas region descendants cannot retain the ordinary Adapter mutation scope', async () => {
  const request = regionFixture.commitRequest
  let release!: () => void, late!: Promise<unknown>, writes = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  const adapter = { contractHandshake, async call(_op: string, input: any) {
    writes++
    return { contractVersion: 'world-adapter/v8', requestId: input.requestId, result: null, guardRefusal: null,
      error: { code: 'CAPABILITY_UNAVAILABLE', phase: 'validate', retryability: 'AFTER_NEW_FACTS', mutationState: 'NONE',
        transactionRef: null, causeCode: null, reason: 'REQUIRED_FACT_UNKNOWN' } }
  } }
  const localCanvas = { contractHandshake, async call() { return null } }
  const canvas = { protocolHandshake: { ...regionFixture.peerHandshake,
    protocols: [...contractProtocols].sort((a, b) => a.protocol < b.protocol ? -1 : a.protocol > b.protocol ? 1 : 0),
    capabilities: regionCapabilities.map(c => c.id).sort() }, async call() {
    late = gate.then(() => adapter.call('RestoreTransaction', { contractVersion: 'world-adapter/v8',
      requestId: 'late-restore', sessionRef: request.sessionRef, worldRef: request.worldRef,
      originTransactionId: request.transactionId, operationDigest: 'a'.repeat(64), beforeImageDigest: 'b'.repeat(64),
      restoreAttemptIdentity: 'late-attempt', guarantee: 'RECOVERABLE_VERIFIED', localContext: request.localContext }))
    return regionFixture.commitResponse
  } }
  const adapterRegion = { protocolHandshake: regionFixture.peerHandshake, async call() {} }
  const guarded = new DesktopBuildBridge({ trustedInvocation: () => ({ sessionRef: request.sessionRef,
    localContext: request.localContext, async check() {} }) } as any,
    { canvas: () => localCanvas, adapter: () => adapter, nativeFacts: () => undefined,
      canvasRegion: () => canvas, adapterRegion: () => adapterRegion })
  try {
    await guarded.run(async () => {
      await canvas.call('ApplyRegionCommit', request)
      release()
      await assert.rejects(late, /LOCAL_DISPATCH_REQUIRED/)
      assert.equal(writes, 0)
      return null
    })
  } finally { guarded.close() }
})

test('inspection recognizes unchanged Canvas and revision-oracle registrations through Cordis proxies', async () => {
  const local = { connectionRef: 'fixture-connection', connectionIncarnationRef: 'fixture-incarnation',
    worldRef: 'fixture-world', selectionRevision: 'selection-1' }
  const request = { contractVersion: 'world-adapter/v8', requestId: 'inspect-1', sessionRef: 'fixture-session',
    worldRef: 'fixture-world', expectedWorldRevision: 'world-rev-1', sampledBounds: { min: [0, 0, 0], max: [0, 0, 0] }, localContext: local }
  class Canvas extends Service {
    contractHandshake = contractHandshake
    constructor(ctx: Context) { super(ctx, 'fixtureCanvas') }
    async call(operation: string, input: any) {
      const result = operation === 'ReadWorldSelectionContext' ? {
        sessionRef: input.sessionRef, worldRef: local.worldRef, inventory: { capabilityRevision: 'inventory-1', connections: [] },
        selection: { status: 'BOUND', connectionRef: local.connectionRef, context: {
          currentSession: input.sessionRef, activeWorldRef: local.worldRef, orderedSelectedObjectRefs: ['fixture-object'],
          sessionRevision: 'session-1', selectionRevision: local.selectionRevision, localContext: local,
        } },
      } : { worldRef: local.worldRef, registryRevision: 'registry-1', objects: [{ worldRef: local.worldRef,
        objectRef: 'fixture-object', objectRevision: 'object-1', displayName: null, nameRevision: null, creationSequence: 0, status: 'READY' }] }
      return validateBoundResponse('canvas/v7', operation as never, input, {
        contractVersion: 'canvas/v7', requestId: input.requestId, result, error: null,
      })
    }
  }
  class Oracle extends Service {
    constructor(ctx: Context) { super(ctx, 'fixtureOracle') }
    async read() { return 'world-rev-1' }
  }
  const ctx = new Context(), canvasFiber = await ctx.plugin(Canvas), oracleFiber = await ctx.plugin(Oracle)
  try {
    const transport = { trustedInvocation: () => ({ invocationRef: 'inspect-invocation', sessionRef: 'fixture-session',
      localContext: local, async check() {} }) }
    const facts = new DesktopInspectionFacts(transport as any, { canvas: () => ctx.get('fixtureCanvas'), revision: () => ctx.get('fixtureOracle') })
    const result = await facts.run(request, () => facts.read(request))
    assert.deepEqual(result, { current: true, worldRef: local.worldRef, worldRevision: 'world-rev-1',
      objectRef: 'fixture-object', objectRevision: 'object-1' })
    await assert.rejects(Promise.resolve().then(() => facts.read(request)), /INSPECTION_FACTS_UNAVAILABLE/)
  } finally { await oracleFiber.dispose(); await canvasFiber.dispose() }
})

test('lifecycle delete is unavailable before the bridge retirement gate and missing sources never invent defaults', async () => {
  const { DesktopWorldLifecycle } = await import('../lib/world-lifecycle.js')
  let calls = 0
  const port = new DesktopWorldLifecycle(() => ({ async delete() { calls++; return {} } } as any))
  await assert.rejects(port.call('delete' as never, { worldId: 'world', confirmationName: 'World' }), /TRANSACTION_CONFLICT/)
  assert.equal(calls, 0)
  await assert.rejects(new DesktopWorldLifecycle(() => undefined).call('describe'), /ADAPTER_UNAVAILABLE/)
})
