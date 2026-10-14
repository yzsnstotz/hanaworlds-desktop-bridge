/** SOURCE/FIXTURE: real Cordis/Loader + bridge package entry, temporary local plugins.
 * This does not prove the assembled App, subscription login, model reply or owner acceptance.
 * Candidate API/fields are defined in this card's contract-add/C-world-inspection.md.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { createViewFixture } from './view-fixture.ts'
import { createWorkshopFixture } from './workshop-fixture.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const scratch = fileURLToPath(new URL('../../tmp/', import.meta.url))
// The card's literal command must exercise freshly built public artifacts, not stale lib files.
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'pipe' })
const bridge = await import('hanaworlds-desktop-bridge')
const wire = 'world-inspection/v1'
// Cordis exposes a TypeScript const enum, erased at runtime (fiber.d.ts).
const FiberState = { PENDING: 0, ACTIVE: 2, FAILED: 3 }
const path = '/api-hanaworlds-plugin-evidence'
const request = requestId => ({ contractVersion: wire, requestId })
const faultCases = [
  { id: 'empty-message', fault: { kind: 'error', name: 'Error', message: '' },
    expected: { name: 'Error', message: '', code: null } },
  { id: 'empty-name-and-code', fault: { kind: 'error', name: '', message: 'exact failure', code: '' },
    expected: { name: '', message: 'exact failure', code: '' } },
  { id: 'non-error-string', fault: { kind: 'value', value: '  拒绝原文\n未改写  ' },
    expected: { name: 'NonError', message: '  拒绝原文\n未改写  ', code: null } },
  { id: 'non-error-object', fault: { kind: 'value', value: { reason: 'protocol rejected', code: '', retry: false } },
    expected: { name: 'NonError', message: '{"reason":"protocol rejected","code":"","retry":false}', code: null } },
]

async function setup(t, { withLoader = true } = {}) {
  await mkdir(scratch, { recursive: true })
  const dir = await mkdtemp(join(scratch, 'plugin-evidence-'))
  const ctx = new Context()
  const hostFibers = []
  t.after(async () => {
    const loader = ctx.get('loader')
    if (loader) {
      for (const entry of [...loader.entries()]) await entry.fiber?.dispose()
    }
    for (const fiber of hostFibers.reverse()) await fiber.dispose()
    assert.ok(dir.startsWith(join(scratch, 'plugin-evidence-')))
    await rm(dir, { recursive: true, force: true })
  })
  hostFibers.push(await ctx.plugin(SessionStore))
  hostFibers.push(await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }))
  ctx.provide('connection', { requestRejection(req) {
    if (req.headers.origin !== 'http://fixture.local') return 403
    if (req.headers.cookie !== 'fixture-login=valid') return 401
  } })
  const canvas = createViewFixture()
  const workshop = createWorkshopFixture(canvas)
  ctx.provide('skills', { async snapshot() { return { complete: true, skills: [] } } })
  let bridgeId
  if (withLoader) {
    hostFibers.push(await ctx.plugin(Loader, { baseUrl: pathToFileURL(dir + '/').href }))
    ctx.loader.builtins['fixture-peers'] = { apply(c) {
      c.provide('hanaworldsCanvasV5', canvas)
      c.provide('hanaworldsWorkshop', workshop)
    } }
    await ctx.loader.create({ id: 'fixture-peers', name: 'cordis:fixture-peers' })
    await ctx.loader.await()
    // Public Loader mounts the package entry. No fiber.entry or Fiber.state is manufactured.
    ctx.loader.builtins.bridge = bridge
    bridgeId = await ctx.loader.create({ id: 'bridge', name: 'cordis:bridge' })
    await ctx.loader.await()
    assert.equal(ctx.loader.resolve(bridgeId).fiber.state, FiberState.ACTIVE)
  } else {
    ctx.provide('hanaworldsCanvasV5', canvas)
    ctx.provide('hanaworldsWorkshop', workshop)
    hostFibers.push(await ctx.plugin(bridge))
  }

  let serial = 0
  async function mount(id, { version = '7.3.1', services = ['evidenceAlpha'], nested = false,
    fail = false, fault = null, inject = [] } = {}) {
    const packageDir = join(dir, `package-${++serial}`)
    await mkdir(packageDir)
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({
      name: `@fixture/package-${serial}`, version, type: 'module', exports: './index.js',
    }))
    const provides = services.map(name => `c.provide(${JSON.stringify(name)}, {value:'current'})`).join(';')
    const failure = fault ?? (fail ? { kind: 'error', name: 'Error',
      message: 'fixture transport handshake rejected', code: 'E_FIXTURE_HANDSHAKE' } : null)
    const throws = failure?.kind === 'error'
      ? `throw Object.assign(new Error(${JSON.stringify(failure.message)}), ${JSON.stringify({
        name: failure.name, ...Object.hasOwn(failure, 'code') ? { code: failure.code } : {},
      })})`
      : null
    // Config validation rejects before composeError wraps the apply callback. This official
    // lifecycle path preserves non-Error values; no private error/state fields are assigned.
    const configValidator = failure?.kind === 'value' ? `export const Config = {
      '~standard': {version:1,vendor:'fixture',validate(){throw ${JSON.stringify(failure.value)}}}
    };` : ''
    await writeFile(join(packageDir, 'index.js'), `
      export const name = 'misleading-display-name';
      export const provide = ['declaredButNotRegistered'];
      export const inject = ${JSON.stringify(inject)};
      ${configValidator}
      export function apply(ctx) {
        ${throws ?? (
          nested ? `ctx.plugin({name:'nested-display',apply(c){${provides}}})` : `const c=ctx;${provides}`)}
      }
    `)
    const moduleName = pathToFileURL(join(packageDir, 'index.js')).href
    await ctx.loader.create({ id, name: moduleName })
    await ctx.loader.await()
    const entry = ctx.loader.resolve(id)
    const fiber = entry.fiber
    let rejection
    if (failure) {
      let rejected = false
      try { await fiber.await() } catch (error) { rejected = true; rejection = error }
      assert.equal(rejected, true, 'the official fiber must reject with the actual thrown value')
      assert.equal(fiber.state, FiberState.FAILED)
    } else {
      await fiber.await()
      assert.equal(fiber.state, FiberState.ACTIVE)
    }
    return { entry, fiber, moduleName, packageDir, packageName: `@fixture/package-${serial}`, version, services, rejection }
  }
  async function direct(raw = request('direct')) {
    const port = ctx.get('hanaworldsWorldInspectionContext')
    assert.equal(typeof port?.ReadPluginEvidence, 'function',
      'bridge public inspection service must expose ReadPluginEvidence')
    return port.ReadPluginEvidence(raw)
  }
  async function read(headers = {}, route = path) {
    const response = await fetch(`http://127.0.0.1:${ctx.webServer.port}${route}`, { headers: {
      origin: 'http://fixture.local', cookie: 'fixture-login=valid', ...headers,
    } })
    const raw = await response.text()
    return { status: response.status, cache: response.headers.get('cache-control'), data: raw ? JSON.parse(raw) : null }
  }
  return { ctx, mount, direct, read, bridgeId }
}

function rows(response, id = 'direct') {
  assert.equal(response.contractVersion, wire)
  assert.equal(response.requestId, id)
  assert.equal(response.error, null)
  assert.ok(Array.isArray(response.result.plugins))
  const refs = response.result.plugins.map(row => row.instanceRef)
  assert.equal(new Set(refs).size, refs.length, 'each actual loaded fiber has a distinct identity')
  return response.result.plugins
}
function rowFor(response, id, requestId = 'direct') {
  const found = rows(response, requestId).filter(row => row.entryId === id)
  assert.equal(found.length, 1, `one current row for ${id}`)
  return found[0]
}
function active(row, mounted) {
  assert.deepEqual(Object.keys(row).sort(),
    ['entryId', 'instanceRef', 'moduleName', 'package', 'state', 'contributions', 'fault', 'metadataError'].sort())
  assert.equal(typeof row.instanceRef, 'string')
  assert.ok(row.instanceRef.length)
  assert.equal(row.moduleName, mounted.moduleName)
  assert.deepEqual(row.package, { name: mounted.packageName, version: mounted.version })
  assert.equal(row.state, 'ACTIVE')
  assert.deepEqual(row.contributions, { services: [...mounted.services].sort() })
  assert.equal(row.fault, null)
  assert.equal(row.metadataError, null)
}

test('fixture baseline uses actual Loader registration, dependency transitions, remount and FAILED cause', async t => {
  const h = await setup(t)
  const gate = await h.ctx.plugin({ name: 'gate-baseline', apply(c) { c.provide('baselineGate', {}) } })
  t.after(() => gate.dispose())
  const mounted = await h.mount('baseline', { services: ['baselinePort'], inject: ['baselineGate'] })
  assert.equal(mounted.fiber.entry, mounted.entry)
  assert.ok(h.ctx.get('baselinePort'))
  const uid = mounted.fiber.uid
  await gate.dispose()
  await mounted.fiber.await()
  assert.equal(mounted.fiber.state, FiberState.PENDING)
  assert.equal(h.ctx.get('baselinePort'), undefined)
  const resumedGate = await h.ctx.plugin({ name: 'gate-baseline-resumed', apply(c) { c.provide('baselineGate', {}) } })
  t.after(() => resumedGate.dispose())
  await mounted.fiber.await()
  assert.equal(mounted.fiber.state, FiberState.ACTIVE)
  assert.equal(mounted.fiber.uid, uid, 'Cordis preserves uid across dependency-driven reactivation')
  await mounted.fiber.dispose()
  await mounted.entry.init()
  await h.ctx.loader.await()
  await mounted.entry.fiber.await()
  assert.notEqual(mounted.entry.fiber, mounted.fiber)
  const broken = await h.mount('baseline-broken', { fail: true })
  await assert.rejects(broken.fiber.await(), error => error.code === 'E_FIXTURE_HANDSHAKE')
  await broken.fiber.dispose()
  const replacement = await h.mount('baseline-broken', { services: ['baselineRecovered'] })
  assert.equal(replacement.fiber.state, FiberState.ACTIVE)
  assert.ok(h.ctx.get('baselineRecovered'))
})

test('public service and guarded HTTP expose current package identity/version and actual contributions', async t => {
  const h = await setup(t)
  const mounted = await h.mount('alpha', { version: '7.3.1-beta.4', services: ['zetaPort', 'alphaPort'], nested: true })
  const direct = await h.direct()
  active(rowFor(direct, 'alpha'), mounted)
  assert.notEqual(rowFor(direct, 'alpha').package.name, 'misleading-display-name')
  const next = await h.direct(request('again'))
  assert.equal(rowFor(next, 'alpha', 'again').instanceRef, rowFor(direct, 'alpha').instanceRef)
  const http = await h.read()
  assert.equal(http.status, 200, JSON.stringify(http.data))
  assert.equal(http.cache, 'no-store')
  assert.equal(http.data.contractVersion, wire)
  assert.ok(http.data.requestId)
  assert.deepEqual(http.data.result, direct.result)
})

test('unloading/removing an entry drops its instance and contributions while another read stays usable', async t => {
  const h = await setup(t)
  await h.mount('alpha')
  const beta = await h.mount('beta', { services: ['evidenceBeta'] })
  const old = rowFor(await h.direct(), 'alpha')
  const fiber = h.ctx.loader.resolve('alpha').fiber
  h.ctx.loader.remove('alpha')
  await fiber.dispose()
  const result = await h.direct()
  assert.ok(!rows(result).some(row => row.entryId === 'alpha' || row.instanceRef === old.instanceRef))
  active(rowFor(result, 'beta'), beta)
})

test('same entry replacement reports the new package/version with a new instance and no old contribution', async t => {
  const h = await setup(t)
  await h.mount('alpha')
  const old = rowFor(await h.direct(), 'alpha')
  await h.ctx.loader.resolve('alpha').fiber.dispose()
  const next = await h.mount('alpha', { version: '8.0.2', services: ['replacementPort'] })
  const row = rowFor(await h.direct(), 'alpha')
  active(row, next)
  assert.notEqual(row.instanceRef, old.instanceRef)
  assert.ok(!row.contributions.services.includes('evidenceAlpha'))
})

test('disabled revokes old evidence; official re-enable of the same module/entry publishes a new instance', async t => {
  const h = await setup(t)
  const mounted = await h.mount('alpha')
  const old = rowFor(await h.direct(), 'alpha')
  await mounted.fiber.dispose()
  assert.equal(mounted.entry.disabled, true)
  const disabled = await h.direct()
  assert.ok(!rows(disabled).some(row => row.entryId === 'alpha' || row.instanceRef === old.instanceRef))
  await mounted.entry.update({ disabled: false })
  await h.ctx.loader.await()
  await mounted.entry.fiber.await()
  assert.equal(mounted.entry.disabled, false)
  assert.notEqual(mounted.entry.fiber, mounted.fiber)
  const row = rowFor(await h.direct(), 'alpha')
  active(row, mounted)
  assert.notEqual(row.instanceRef, old.instanceRef)
})

test('loss of an injected dependency makes the old active instance disappear until actual reactivation', async t => {
  const h = await setup(t)
  const gate = await h.ctx.plugin({ name: 'gate', apply(c) { c.provide('evidenceGate', {}) } })
  t.after(() => gate.dispose())
  const mounted = await h.mount('alpha', { inject: ['evidenceGate'] })
  const before = rowFor(await h.direct(), 'alpha')
  await gate.dispose()
  await mounted.fiber.await()
  assert.equal(mounted.fiber.state, FiberState.PENDING)
  const result = await h.direct()
  assert.ok(!rows(result).some(row => row.entryId === 'alpha' || row.instanceRef === before.instanceRef))
  const resumedGate = await h.ctx.plugin({ name: 'resumed-gate', apply(c) { c.provide('evidenceGate', {}) } })
  t.after(() => resumedGate.dispose())
  await mounted.fiber.await()
  const resumed = rowFor(await h.direct(), 'alpha')
  active(resumed, mounted)
  assert.notEqual(resumed.instanceRef, before.instanceRef, 'a new activation cannot reuse the revoked identity')
})

test('a real FAILED fiber names its concrete cause, isolates healthy rows and normal bridge reads', async t => {
  const h = await setup(t)
  const healthy = await h.mount('alpha')
  const broken = await h.mount('broken', { fail: true })
  const result = await h.direct()
  active(rowFor(result, 'alpha'), healthy)
  const row = rowFor(result, 'broken')
  assert.equal(row.moduleName, broken.moduleName)
  assert.deepEqual(row.package, { name: broken.packageName, version: broken.version })
  assert.equal(row.state, 'FAILED')
  assert.deepEqual(row.contributions, { services: [] })
  assert.deepEqual(row.fault, { name: 'Error', message: 'fixture transport handshake rejected', code: 'E_FIXTURE_HANDSHAKE' })
  assert.equal(row.metadataError, null)
  const http = await h.read()
  assert.equal(http.status, 200)
  assert.deepEqual(http.data.result, result.result)
  const roles = await h.ctx.hanaworldsWorldInspectionContext.ReadPluginRoles(request('roles'))
  assert.equal(roles.error, null, 'existing normal bridge role read still works')
  await broken.fiber.dispose()
  const recovered = await h.mount('broken', { services: ['recoveredPort'] })
  const next = rowFor(await h.direct(), 'broken')
  active(next, recovered)
  assert.notEqual(next.instanceRef, row.instanceRef)
})

for (const scenario of faultCases) {
  test(`D-133 fixture: actual Loader preserves ${scenario.id} rejection and healthy HTTP/recovery`, async t => {
    const h = await setup(t)
    await h.mount('alpha')
    const healthyService = h.ctx.get('evidenceAlpha')
    const broken = await h.mount('broken', { fault: scenario.fault })
    if (scenario.fault.kind === 'error') {
      assert.ok(broken.rejection instanceof Error)
      assert.equal(broken.rejection.name, scenario.expected.name)
      assert.equal(broken.rejection.message, scenario.expected.message)
      assert.equal(typeof broken.rejection.code === 'string' ? broken.rejection.code : null, scenario.expected.code)
    } else {
      assert.deepEqual(broken.rejection, scenario.fault.value)
      assert.equal(broken.rejection instanceof Error, false)
    }
    await assert.rejects(broken.fiber.await(), value => {
      assert.equal(value, broken.rejection, 'official await preserves the actual rejection identity/value')
      return true
    })
    assert.equal(h.ctx.get('evidenceAlpha'), healthyService)
    assert.equal((await h.read({}, '/api-hanaworlds-plugin-roles')).status, 200)
    await broken.fiber.dispose()
    const recovered = await h.mount('broken', { services: ['recoveredPort'] })
    assert.equal(recovered.fiber.state, FiberState.ACTIVE)
    assert.ok(h.ctx.get('recoveredPort'))
    assert.equal((await h.read({}, '/api-hanaworlds-plugin-roles')).status, 200)
  })

  test(`D-133 evidence: ${scenario.id} fault stays exact; healthy rows/HTTP/recovery remain usable`, async t => {
    const h = await setup(t)
    const healthy = await h.mount('alpha')
    const broken = await h.mount('broken', { fault: scenario.fault })
    const result = await h.direct()
    active(rowFor(result, 'alpha'), healthy)
    const row = rowFor(result, 'broken')
    assert.equal(row.state, 'FAILED')
    assert.deepEqual(row.package, { name: broken.packageName, version: broken.version })
    assert.deepEqual(row.contributions, { services: [] })
    assert.deepEqual(row.fault, scenario.expected, 'do not fill empty strings, invent a cause or discard the thrown value')
    assert.equal(row.metadataError, null)
    const http = await h.read()
    assert.equal(http.status, 200)
    assert.deepEqual(http.data.result, result.result)
    const roles = await h.ctx.hanaworldsWorldInspectionContext.ReadPluginRoles(request('roles'))
    assert.equal(roles.error, null)
    await broken.fiber.dispose()
    const recovered = await h.mount('broken', { services: ['recoveredPort'] })
    const next = await h.direct()
    active(rowFor(next, 'alpha'), healthy)
    active(rowFor(next, 'broken'), recovered)
    assert.notEqual(rowFor(next, 'broken').instanceRef, row.instanceRef)
    const recoveredHTTP = await h.read()
    assert.equal(recoveredHTTP.status, 200)
    assert.deepEqual(recoveredHTTP.data.result, next.result)
  })
}

test('missing package version is explicit per-row metadata failure; it never borrows another package version', async t => {
  const h = await setup(t)
  const healthy = await h.mount('alpha')
  const malformed = await h.mount('no-version', { services: ['noVersionPort'] })
  await writeFile(join(malformed.packageDir, 'package.json'), JSON.stringify({ name: malformed.packageName, type: 'module' }))
  const result = await h.direct()
  active(rowFor(result, 'alpha'), healthy)
  const row = rowFor(result, 'no-version')
  assert.equal(row.package, null)
  assert.equal(row.metadataError.code, 'METADATA_UNAVAILABLE')
  assert.ok(row.metadataError.reason.length)
  assert.equal(row.fault, null)
  assert.deepEqual(row.contributions, { services: ['noVersionPort'] })
})

test('returned data cannot mutate subsequent identities, versions or contribution snapshots', async t => {
  const h = await setup(t)
  const mounted = await h.mount('alpha')
  const result = await h.direct()
  const row = rowFor(result, 'alpha')
  const instanceRef = row.instanceRef
  row.package.version = 'forged'
  row.contributions.services.push('forgedPort')
  row.instanceRef = 'forged-instance'
  const next = rowFor(await h.direct(), 'alpha')
  active(next, mounted)
  assert.equal(next.instanceRef, instanceRef)
})

test('bad/extra fields and version mismatch are named admission refusals without changing loaded state', async t => {
  const h = await setup(t)
  await h.mount('alpha')
  const before = (await h.direct()).result
  for (const [raw, code] of [
    [undefined, 'SCHEMA_INVALID'],
    [{ contractVersion: wire, requestId: '' }, 'SCHEMA_INVALID'],
    [{ ...request('unknown'), moduleName: 'user-supplied-path' }, 'UNKNOWN_REQUIRED_FIELD'],
    [{ contractVersion: 'world-inspection/v99', requestId: 'version' }, 'PAYLOAD_VERSION_MISMATCH'],
  ]) {
    // Passing undefined explicitly must not use the helper's default request.
    const port = h.ctx.get('hanaworldsWorldInspectionContext')
    assert.equal(typeof port.ReadPluginEvidence, 'function', 'public evidence operation is missing')
    await assert.rejects(() => port.ReadPluginEvidence(raw), error => {
      assert.equal(error.publicError?.code, code)
      assert.equal(error.publicError?.mutationState, 'NONE')
      assert.equal(error.publicError?.transactionRef, null)
      return true
    })
  }
  assert.deepEqual((await h.direct()).result, before)
})

test('HTTP rejects login/origin before reading and unregisters the evidence route with the bridge', async t => {
  const h = await setup(t)
  await h.mount('alpha')
  assert.equal((await h.read({ cookie: '' })).status, 401)
  assert.equal((await h.read({ origin: 'http://foreign.local' })).status, 403)
  assert.equal((await h.read()).status, 200)
  await h.ctx.loader.resolve(h.bridgeId).fiber.dispose()
  assert.equal((await h.read()).status, 404)
})

test('a captured public method cannot return evidence after its bridge provider is unloaded', async t => {
  const h = await setup(t)
  await h.mount('alpha')
  await h.direct()
  const port = h.ctx.get('hanaworldsWorldInspectionContext')
  await h.ctx.loader.resolve(h.bridgeId).fiber.dispose()
  await assert.rejects(() => port.ReadPluginEvidence(request('captured')), error => {
    assert.equal(error.publicError?.code, 'CAPABILITY_UNAVAILABLE')
    assert.equal(error.publicError?.mutationState, 'NONE')
    return true
  })
})

test('missing Loader is a named read failure, not an empty successful plugin inventory', async t => {
  const h = await setup(t, { withLoader: false })
  const result = await h.direct()
  assert.equal(result.contractVersion, wire)
  assert.equal(result.requestId, 'direct')
  assert.equal(result.result, null)
  assert.equal(result.error.code, 'CAPABILITY_UNAVAILABLE')
  assert.equal(result.error.mutationState, 'NONE')
  assert.ok(result.error.reason.length)
  const http = await h.read()
  assert.equal(http.status, 409)
  assert.equal(http.data.contractError.code, 'CAPABILITY_UNAVAILABLE')
})

test('unload during an awaited real fault observation cannot publish the old instance', { timeout: 10000 }, async t => {
  const h = await setup(t)
  await h.mount('alpha')
  const broken = await h.mount('broken', { fail: true })
  await h.direct() // RED first: missing operation is reported before entering the observation barrier.
  const reached = Promise.withResolvers(), release = Promise.withResolvers()
  const original = broken.fiber.await.bind(broken.fiber)
  // Delay delivery of the actual public lifecycle rejection; neither state nor error is fabricated.
  broken.fiber.await = async () => {
    try { return await original() }
    catch (error) { reached.resolve(); await release.promise; throw error }
  }
  t.after(() => { release.resolve(); broken.fiber.await = original })
  const pending = h.direct(request('during-unload'))
  // Install rejection handling immediately; the operation may use a refusal envelope or reject.
  const outcome = pending.then(value => value, error => ({ error: error.publicError, result: null }))
  await reached.promise
  h.ctx.loader.remove('broken')
  await broken.fiber.dispose()
  release.resolve()
  const result = await outcome
  assert.equal(result.result, null, 'no snapshot containing the old instance may be returned')
  assert.equal(result.error?.code, 'CAPABILITY_UNAVAILABLE')
  assert.equal(result.error?.mutationState, 'NONE')
  assert.ok(rows(await h.direct()).some(row => row.entryId === 'alpha'), 'next normal read still works')
})
