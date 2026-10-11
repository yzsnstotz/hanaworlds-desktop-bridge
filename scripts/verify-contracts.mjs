/** Verify the public tag, lock, installed package, and the actual schemas used by this card. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { contractHandshake, version, checkContractHandshake, validateRequest, validateBoundResponse } from 'hanaworlds-contracts'

const root = new URL('../', import.meta.url)
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'))
const manifest = json('package.json'), lock = json('package-lock.json')
const pin = 'git+https://github.com/yzsnstotz/hanaworlds-contracts.git#v2.0.0'
assert.equal(manifest.dependencies['hanaworlds-contracts'], pin)
assert.equal(lock.packages[''].dependencies['hanaworlds-contracts'], pin)
const remote = execFileSync('git', ['ls-remote', 'https://github.com/yzsnstotz/hanaworlds-contracts.git',
  'refs/tags/v2.0.0', 'refs/tags/v2.0.0^{}'], { cwd: fileURLToPath(root), encoding: 'utf8' }).trim().split('\n')
const rows = remote.map(row => row.split(/\s+/)), tag = rows.find(row => row[1] === 'refs/tags/v2.0.0^{}')
  ?? rows.find(row => row[1] === 'refs/tags/v2.0.0')
assert.ok(tag, 'published v2.0.0 tag must exist')
const locked = lock.packages['node_modules/hanaworlds-contracts']
assert.equal(locked.resolved.split('#').at(-1), tag[0])
assert.equal(locked.version, '2.0.0')
assert.equal(json('node_modules/hanaworlds-contracts/package.json').version, '2.0.0')
assert.equal(version, '2.0.0')
checkContractHandshake(contractHandshake, { wires: ['session/v5', 'canvas/v7'], factProfiles: [] })
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
console.log(`contracts v2.0.0: published tag ${tag[0]}, lock, installed SDK, session/v5 and canvas/v7 fixture roundtrips verified`)
