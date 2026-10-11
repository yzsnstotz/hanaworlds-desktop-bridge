import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contractProtocols, regionCapabilities, contractHandshake, validateBoundResponse } from 'hanaworlds-contracts'
import { DesktopDeploymentPolicy } from '../lib/deployment-policy.js'
import { DesktopRegionPorts } from '../lib/region-ports.js'
import { DesktopImageMedia, serviceIdentity } from '../lib/image-media.js'
import { Context, Service } from '@deepseek-ai/cordis'
import { DesktopBuildBridge } from '../lib/build-bridge.js'
import { DesktopInspectionFacts } from '../lib/inspection-facts.js'

test('deployment relays its compiler supplier unchanged without an engine default or backend table', async () => {
  const declared = { writeBackend: { profileId: 'OPAQUE/backend', revision: 'opaque-revision' } }
  let observed: string | undefined
  const policy = new DesktopDeploymentPolicy({ compiler: () => ({ async read(worldRef) { observed = worldRef; return declared } }) })
  assert.equal(await policy.compiler('fixture-world'), declared)
  assert.equal(observed, 'fixture-world')
  assert.equal((await policy.describe('fixture-world')).compilerConfig.value, declared)
  assert.throws(() => policy.safety('fixture-world'))
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
