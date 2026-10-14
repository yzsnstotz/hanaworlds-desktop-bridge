/** C-canvas v2 sections 4/6: official Cordis registration with DOCUMENT_FIXTURE peers.
 * These tests prove bridge composition, not real Canvas/world/Workshop authorization.
 * Material-source forwarding is deliberately not invented: see the run's contract request.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import * as bridge from 'hanaworlds-desktop-bridge'
import { createViewFixture } from './view-fixture.ts'
import { createWorkshopFixture } from './workshop-fixture.ts'
import { createWriteProfileFixture } from './world-facts-fixture.ts'
import { serviceIdentity } from '../lib/image-media.js'

// Full published C-canvas compilerConfig example, not a default for production.
const documentResult = {
  compilationConfig: {
    profileVersion: 'compilation-config/v3',
    writeBackend: { profileId: 'fixture-world-source-cell-write/v1', revision: 'fixture-world-source-rev-7' },
    overlapRule: 'last-writer-wins', effectOrder: 'numeric-x-y-z', compressionRule: 'exact-final-effects-only',
  },
  compilerRevision: 'compiler-config-aa5598d9a7aa4b8f4eaf9c43a8a3c722',
}

async function host(t: any) {
  const ctx = new Context(), fibers: any[] = []
  // Dispose dependents first, including fibers whose apply failed.
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose() })
  const sessions = ctx.plugin(SessionStore); fibers.push(sessions); await sessions
  const server = ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }); fibers.push(server); await server
  const canvas = createViewFixture(), workshop = createWorkshopFixture(canvas)
  const peers = ctx.plugin({ name: 'document-fixture-peers', apply(scope: Context) {
    scope.provide('connection', { requestRejection: () => undefined })
    scope.provide('hanaworldsCanvasV5', canvas)
    scope.provide('hanaworldsWorkshop', workshop)
    scope.provide('hanaworldsWorldFacts', createWriteProfileFixture() as any)
  } }); fibers.push(peers); await peers
  async function mountBridge() {
    const fiber = ctx.plugin(bridge); fibers.push(fiber)
    await assert.doesNotReject(fiber.await(),
      'bridge must stay ACTIVE alongside the sole C-canvas compiler provider')
    assert.ok(ctx.get('hanaworldsDesktopBridge'))
    return fiber
  }
  async function compiler(result = documentResult) {
    const calls: string[] = [], state: { error: unknown } = { error: undefined }
    const port = { async read(worldRef: string) {
      assert.equal(serviceIdentity(this), port, 'keep the actual provider receiver')
      calls.push(worldRef)
      if (state.error !== undefined) throw state.error
      return structuredClone(result)
    } }
    const fiber = ctx.plugin({ name: 'renamed-canvas-document-provider', apply(scope: Context) {
      scope.provide('hanaworldsCompilerConfig', port as any)
    } }); fibers.push(fiber)
    await assert.doesNotReject(fiber.await(), 'Canvas must be able to register its sole compiler service')
    return { fiber, port, calls, state }
  }
  return { ctx, mountBridge, compiler }
}

test('compiler owner: missing Canvas supply remains absent even with a complete world-source profile', async t => {
  const h = await host(t)
  await h.mountBridge()
  assert.equal(h.ctx.get('hanaworldsCompilerConfig'), undefined,
    'bridge must not manufacture a fallback compiler provider from ReadWriteProfile')
})

for (const order of ['canvas-first', 'bridge-first'] as const) {
  test(`compiler owner: ${order} preserves the single provider and complete response`, async t => {
    const h = await host(t)
    if (order === 'bridge-first') await h.mountBridge()
    const supplied = await h.compiler()
    if (order === 'canvas-first') await h.mountBridge()
    const live = h.ctx.get('hanaworldsCompilerConfig')!
    assert.equal(serviceIdentity(live), supplied.port, 'consumer resolves the Canvas registration')
    assert.deepEqual(await live.read('fixture-world'), documentResult,
      'all configuration fields AND compilerRevision reach the consumer')
    assert.deepEqual(supplied.calls, ['fixture-world'])
  })
}

test('compiler owner: unloading the bridge leaves Canvas registration and full configuration intact', async t => {
  const h = await host(t), supplied = await h.compiler(), bridgeFiber = await h.mountBridge()
  await bridgeFiber.dispose()
  assert.equal(h.ctx.get('hanaworldsDesktopBridge'), undefined)
  assert.equal(serviceIdentity(h.ctx.get('hanaworldsCompilerConfig')), supplied.port)
  assert.deepEqual(await h.ctx.get('hanaworldsCompilerConfig')!.read('fixture-world'), documentResult)
})

test('compiler owner: supplier loss is visible and recovery resolves the new provider without bridge fallback', async t => {
  const h = await host(t), first = await h.compiler()
  await h.mountBridge()
  await first.fiber.dispose()
  assert.equal(h.ctx.get('hanaworldsCompilerConfig'), undefined, 'no stale or bridge-owned success after supplier loss')
  const nextValue = { ...documentResult, compilerRevision: 'opaque-new-observation' }
  const second = await h.compiler(nextValue)
  assert.notEqual(second.port, first.port)
  assert.equal(serviceIdentity(h.ctx.get('hanaworldsCompilerConfig')), second.port)
  assert.deepEqual(await h.ctx.get('hanaworldsCompilerConfig')!.read('fixture-world'), nextValue)
  assert.deepEqual(first.calls, [], 'the missing/replaced provider is never read as a fallback')
})

test('compiler owner: original public refusals and ordinary Error identity remain observable', async t => {
  const h = await host(t), supplied = await h.compiler()
  await h.mountBridge()
  const plain = new Error('original provider read failed', { cause: new Error('original IO cause') })
  const unbound = { publicError: { code: 'WORLD_NOT_BOUND', phase: 'validate', retryability: 'AFTER_NEW_FACTS',
    mutationState: 'NONE', transactionRef: null, causeCode: null, reason: 'SCOPE_DENIED' } }
  const source = { publicError: { code: 'TARGET_FACTS_INCOMPLETE', phase: 'validate', retryability: 'AFTER_NEW_FACTS',
    mutationState: 'NONE', transactionRef: null, causeCode: null, reason: 'REQUIRED_FACT_UNKNOWN', worldRef: 'fixture-world',
    source: { owner: 'world-source', operation: 'ReadWriteProfile', resource: 'fixture-world', kind: 'IO', nativeCode: 'EIO' } } }
  for (const original of [plain, unbound, source]) {
    supplied.state.error = original
    await assert.rejects(h.ctx.get('hanaworldsCompilerConfig')!.read('fixture-world'), error => {
      assert.equal(error, original, 'the bridge must not wrap, narrow or replace the original failure')
      return true
    })
  }
  supplied.state.error = undefined
  assert.deepEqual(await h.ctx.get('hanaworldsCompilerConfig')!.read('fixture-world'), documentResult)
  assert.equal(supplied.calls.length, 4, 'one call per attempt, no retries')
})
