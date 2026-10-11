import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateRequest, validateBoundResponse, checkContractHandshake } from 'hanaworlds-contracts'
import { createViewFixture, fixtureIds } from './view-fixture.ts'
import { createWorkshopFixture } from './workshop-fixture.ts'
import { DesktopSessionWorlds } from '../lib/session-worlds.js'
import { callLocal } from '../lib/local-protocol.js'
const core = Object.fromEntries(fixtureIds.map(id => [id, {}]))

test('published C-session and C-canvas stubs reject authority fields and uncorrelated packets', async () => {
  const canvas = createViewFixture(), workshop = createWorkshopFixture(canvas)
  const request = { contractVersion: 'session/v5', requestId: 'contract-roundtrip', sessionRef: fixtureIds[0], expectedRevision: null }
  const response = await workshop.call('StartOrResumeSession', request)
  validateBoundResponse('session/v5', 'StartOrResumeSession', request, response)
  assert.throws(() => validateRequest('session/v5', 'StartOrResumeSession', { ...request, actorRef: 'FORGED' }))
  assert.throws(() => validateBoundResponse('session/v5', 'StartOrResumeSession', request, { ...response, requestId: 'another-request' }))
  checkContractHandshake(workshop.contractHandshake, { wires: ['session/v5'], factProfiles: [] })
  const selection = await callLocal(canvas, 'canvas/v7', 'ReadWorldSelectionContext', {
    contractVersion: 'canvas/v7', requestId: 'canvas-read', sessionRef: fixtureIds[0], worldRef: 'FIXTURE/world/1',
  })
  assert.equal(selection.selection.status, 'BOUND')
})

test('session discovery admits the published Workshop handshake before calling the peer', async () => {
  const canvas = createViewFixture(), workshop = createWorkshopFixture(canvas)
  const incompatible = { ...workshop, contractHandshake: { ...workshop.contractHandshake, contracts: 'hanaworlds-contracts@1.0.0' } }
  const worlds = new DesktopSessionWorlds({ session: id => core[id], canvas: () => canvas, workshop: () => incompatible })
  await assert.rejects(worlds.discover(fixtureIds[0]), /UNSUPPORTED_VERSION/)
  assert.equal(workshop.requests.length, 0)
})

test('session discovery and reads keep Canvas as the current-context authority', async () => {
  const canvas = createViewFixture(), workshop = createWorkshopFixture(canvas)
  const worlds = new DesktopSessionWorlds({ session: id => core[id], canvas: () => canvas, workshop: () => workshop })
  assert.equal(await worlds.localContext(fixtureIds[0]), null)
  assert.equal(await worlds.discover(fixtureIds[0]), 'FIXTURE/world/1')
  assert.deepEqual(await worlds.localContext(fixtureIds[0]), canvas.context(fixtureIds[0]))
  canvas.act(fixtureIds[0], 'disconnect')
  assert.equal(await worlds.localContext(fixtureIds[0]), null)
  worlds.forget(fixtureIds[0])
  assert.equal(await worlds.localContext(fixtureIds[0]), null)
})

test('session discovery rejects Core identity replacement while the Workshop read is in flight', async () => {
  const canvas = createViewFixture(), workshop = createWorkshopFixture(canvas)
  let live: object = {}
  const peer = { ...workshop, async call(operation: string, request: unknown) {
    const result = await workshop.call(operation, request)
    live = {}
    return result
  } }
  const worlds = new DesktopSessionWorlds({ session: () => live, canvas: () => canvas, workshop: () => peer })
  await assert.rejects(worlds.discover(fixtureIds[0]), /SESSION_NOT_FOUND/)
  assert.equal(await worlds.localContext(fixtureIds[0]), null)
})

test('C-world-inspection provider returns correlated current selection and named errors', async () => {
  const { DesktopWorldInspectionContext } = await import('../lib/world-inspection-context.js')
  const canvas = createViewFixture(), workshop = createWorkshopFixture(canvas)
  const worlds = new DesktopSessionWorlds({ session: id => core[id], canvas: () => canvas, workshop: () => workshop })
  const provider = new DesktopWorldInspectionContext({ session: id => core[id], canvas: () => canvas })
  const request = { contractVersion: 'world-inspection/v1', requestId: 'inspection-context-1', sessionRef: fixtureIds[0], worldRef: 'FIXTURE/world/1' }
  const result = validateBoundResponse('world-inspection/v1', 'ReadInspectionContext', request, await provider.ReadInspectionContext(request))
  assert.equal(result.error, null)
  assert.deepEqual(result.result!.localContext, canvas.context(fixtureIds[0]))
  assert.deepEqual(result.result!.orderedSelectedObjectRefs, [])
  canvas.act(fixtureIds[0], 'disconnect')
  assert.equal((await provider.ReadInspectionContext(request)).error!.code, 'WORLD_NOT_BOUND')
  assert.equal((await provider.ReadInspectionContext({ ...request, sessionRef: 'absent' })).error!.code, 'SESSION_NOT_FOUND')
  await assert.rejects(provider.ReadInspectionContext({ ...request, actorRef: 'forged' }))
})
