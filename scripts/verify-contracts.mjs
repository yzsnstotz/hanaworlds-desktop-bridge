/** Verify the public tag, lock, installed package, and the actual schemas used by this card. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { contractHandshake, version, checkContractHandshake, validateRequest, validateBoundResponse, createWorldLifecycleMock, createWorldErrorMock, createPluginRolesMock, protocolRequirement, contractProtocols } from 'hanaworlds-contracts'

const root = new URL('../', import.meta.url)
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'))
const manifest = json('package.json'), lock = json('package-lock.json')
const pin = 'git+https://github.com/yzsnstotz/hanaworlds-contracts.git#v2.9.0'
assert.equal(manifest.dependencies['hanaworlds-contracts'], pin)
assert.equal(lock.packages[''].dependencies['hanaworlds-contracts'], pin)
const remote = execFileSync('git', ['ls-remote', 'https://github.com/yzsnstotz/hanaworlds-contracts.git',
  'refs/tags/v2.9.0', 'refs/tags/v2.9.0^{}'], { cwd: fileURLToPath(root), encoding: 'utf8' }).trim().split('\n')
const rows = remote.map(row => row.split(/\s+/)), tag = rows.find(row => row[1] === 'refs/tags/v2.9.0^{}')
  ?? rows.find(row => row[1] === 'refs/tags/v2.9.0')
assert.ok(tag, 'published v2.9.0 tag must exist')
const locked = lock.packages['node_modules/hanaworlds-contracts']
assert.equal(locked.resolved.split('#').at(-1), tag[0])
assert.equal(locked.version, '2.9.0')
assert.equal(json('node_modules/hanaworlds-contracts/package.json').version, '2.9.0')
assert.equal(version, '2.9.0')
checkContractHandshake(contractHandshake, { wires: ['session/v5', 'canvas/v7', 'world-facts/v1', 'world-inspection/v1'], factProfiles: [] })
const { fixtureCapabilities, createWorkshopFixture } = await import('../test/workshop-fixture.ts')
const { createViewFixture } = await import('../test/view-fixture.ts')
const canvas = createViewFixture(), workshop = createWorkshopFixture(canvas)
for (const [port, wire, operation, input] of [
  [workshop, 'session/v5', 'StartOrResumeSession', { contractVersion: 'session/v5', requestId: 'verify-session', sessionRef: 'hanaworlds-view-alpha', expectedRevision: null }],
  [canvas, 'canvas/v7', 'ReadWorldSelectionContext', { contractVersion: 'canvas/v7', requestId: 'verify-canvas', sessionRef: 'hanaworlds-view-alpha', worldRef: 'FIXTURE/world/1' }],
]) {
  const request = validateRequest(wire, operation, input)
  const response = validateBoundResponse(wire, operation, request, await port.call(operation, request))
  assert.equal(response.error, null)
  assert.ok(response.result)
}
assert.equal(fixtureCapabilities.providerRef, 'FIXTURE/workshop')
const { createWriteProfileFixture } = await import('../test/world-facts-fixture.ts')
const { DesktopWorldInspectionContext } = await import('../lib/world-inspection-context.js')
const inspectionSession = {}
const inspection = new DesktopWorldInspectionContext({ session: () => inspectionSession, canvas: () => canvas })
for (const unavailable of [false, true]) {
  const facts = createWriteProfileFixture(unavailable)
  const request = validateRequest('world-facts/v1', 'ReadWriteProfile', {
    contractVersion: 'world-facts/v1', requestId: `verify-profile-${unavailable}`, worldRef: 'FIXTURE/world/1',
  })
  const response = validateBoundResponse('world-facts/v1', 'ReadWriteProfile', request, await facts.call('ReadWriteProfile', request))
  assert.equal(response.error, null)
  assert.equal(response.result.avatarEnvelope.availability, unavailable ? 'UNAVAILABLE' : 'KNOWN')
}
const inspectionRequest = validateRequest('world-inspection/v1', 'ReadInspectionContext', {
  contractVersion: 'world-inspection/v1', requestId: 'verify-inspection', sessionRef: 'hanaworlds-view-alpha', worldRef: 'FIXTURE/world/1',
})
assert.equal(validateBoundResponse('world-inspection/v1', 'ReadInspectionContext', inspectionRequest,
  await inspection.ReadInspectionContext(inspectionRequest)).error, null)
const lifecycleFixture = (await import('hanaworlds-contracts/fixtures/world-lifecycle', { with: { type: 'json' } })).default
const lifecycle = createWorldLifecycleMock(lifecycleFixture)
for (const operation of ['describe', 'list']) {
  const request = validateRequest('world-lifecycle/v2', operation, { contractVersion: 'world-lifecycle/v2', requestId: `verify-${operation}` })
  const response = validateBoundResponse('world-lifecycle/v2', operation, request, lifecycle('world-lifecycle/v2', operation, request))
  assert.equal(response.error, null)
}
// 2.7.0 optional Error.worldRef: the published provider mock's refusals decode with their target world,
// a pre-2.7 seven-field error still decodes, and a wrong world is refused by the installed SDK.
const worldErrorFixture = (await import('hanaworlds-contracts/fixtures/world-error', { with: { type: 'json' } })).default
const worldError = createWorldErrorMock(worldErrorFixture)
for (const example of worldErrorFixture.exchanges.filter(x => x.response.error !== null)) {
  const response = validateBoundResponse(example.wire, example.operation, example.request,
    worldError(example.wire, example.operation, example.request))
  assert.deepEqual({ ...response.error }, example.response.error)
}
for (const example of worldErrorFixture.legacy) validateBoundResponse(example.wire, example.operation, example.request, example.response)
for (const example of worldErrorFixture.reject) {
  assert.throws(() => validateBoundResponse(example.wire, example.operation, example.request, example.response),
    error => error.code === example.code, example.title)
}
const { RelayedContractError } = await import('../lib/local-protocol.js')
const relayed = new RelayedContractError(worldErrorFixture.legacy[1].response.error)
assert.deepEqual({ ...relayed.publicError }, worldErrorFixture.legacy[1].response.error)
// 2.9.0 ReadPluginRoles (this module provides it): world-inspection minor 1 is installed and every
// published fixture host answers through the SDK mock exactly as published, failures included.
assert.equal(contractProtocols.find(p => p.protocol === 'world-inspection').minor, 1)
protocolRequirement('world-inspection/v1', [], 1)
const pluginRolesFixture = (await import('hanaworlds-contracts/fixtures/plugin-roles', { with: { type: 'json' } })).default
for (const example of pluginRolesFixture.exchanges) {
  const response = validateBoundResponse(example.wire, example.operation, example.request,
    createPluginRolesMock(example.host)(example.wire, example.operation, example.request))
  assert.equal(JSON.stringify(response), JSON.stringify(example.response), example.title)
}
for (const example of pluginRolesFixture.reject) {
  assert.throws(() => validateBoundResponse(example.wire, example.operation, example.request, example.response),
    error => error.code === example.code, example.title)
}
console.log(`contracts v2.9.0: published tag ${tag[0]}, lock, installed SDK, session/v5 canvas/v7 world-facts/v1 world-inspection/v1 world-lifecycle/v2 and world-error (Error.worldRef) and plugin-roles (ReadPluginRoles) fixture roundtrips verified`)
