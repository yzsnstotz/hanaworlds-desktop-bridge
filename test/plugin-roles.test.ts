import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { pluginRoles, validateBoundResponse } from 'hanaworlds-contracts'
import * as plugin from 'hanaworlds-desktop-bridge'
import { createViewFixture } from './view-fixture.ts'
import { createWorkshopFixture } from './workshop-fixture.ts'

const ROLES = pluginRoles.roles
type Skills = { skills: { name: string; provider: string }[]; complete: boolean } | Error
/** Real Cordis services and HTTP carrier. Plugins mount as fibers carrying the loader's `fiber.entry`
 * ({options: {name}}), exactly the field cordis-plugin-loader sets; no plugin is identified by its exports. */
async function setup(t: any, mounts: { module: string; services: string[]; nested?: boolean }[], skills: Skills) {
  const ctx = new Context()
  const sessionsFiber = await ctx.plugin(SessionStore)
  const serverFiber = await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  ctx.provide('connection', { requestRejection(req: any) {
    if (req.headers.origin !== 'http://fixture.local') return 403
    if (req.headers.cookie !== 'fixture-login=valid') return 401
  } })
  const state = { skills, reads: 0 }
  ctx.provide('skills', { async snapshot() {
    state.reads++
    if (state.skills instanceof Error) throw state.skills
    return { ...state.skills, skills: state.skills.skills.map(s => ({ ...s, description: 'fixture', source: 'runtime',
      invocation: { modelInvocable: true, userInvocable: true } })) }
  } } as any)
  const logs: string[] = []
  ctx.logger.exporter({ export: message => { if (message.name === 'hanaworlds-plugin-roles') logs.push(String(message.args[0])) } })
  const canvas = createViewFixture(), workshop = createWorkshopFixture(canvas)
  const values: Record<string, unknown> = { hanaworldsCanvasV5: canvas, hanaworldsWorkshop: workshop }
  const fibers = new Map<string, any>()
  for (const mount of mounts) {
    const provide = (c: Context) => { for (const name of mount.services) c.provide(name, values[name] ?? { fixture: name }) }
    const fiber: any = await ctx.plugin({ name: `fixture:${mount.module}`,
      apply: (c: Context) => { if (mount.nested) c.plugin({ name: 'fixture:nested', apply: provide }); else provide(c) } })
    fiber.entry = { options: { name: mount.module } }
    fibers.set(mount.module, fiber)
  }
  const bridgeFiber: any = await ctx.plugin(plugin)
  bridgeFiber.entry = { options: { name: 'hanaworlds-desktop-bridge' } }
  const base = `http://127.0.0.1:${ctx.webServer.port}`
  t.after(async () => { await bridgeFiber.dispose(); for (const f of fibers.values()) await f.dispose(); await serverFiber.dispose(); await sessionsFiber.dispose() })
  async function read(headers: Record<string, string> = {}) {
    const response = await fetch(base + '/api-hanaworlds-plugin-roles', { headers: {
      origin: 'http://fixture.local', cookie: 'fixture-login=valid', ...headers } })
    const raw = await response.text()
    return { status: response.status, data: raw ? JSON.parse(raw) : null }
  }
  return { ctx, read, state, logs, fibers, bridgeFiber }
}

/** The current HanaWorlds assembly's real service names (shell-ui's host half named by the contract). */
const assembly = [
  { module: 'hanaworlds-shell-ui', services: ['hanaworldsShellUi'] },
  { module: 'hanaworlds-adapter-luanti', services: ['hanaworldsWorldAdapterV6', 'hanaworldsWorldAdapterRegionV1', 'hanaworldsLuantiNativeFacts'] },
  { module: 'hanaworlds-canvas', services: ['hanaworldsCanvasV5', 'hanaworldsCanvasRegionV1'] },
  { module: 'hanaworlds-brush', services: ['hanaworldsBrushV3'] },
  { module: 'hanaworlds-building-exterior-painter', services: ['hanaworldsPainterV2PictureBlocks'] },
  { module: 'hanaworlds-workshop', services: ['hanaworldsWorkshop', 'hanaworldsWorkshopV3'] },
  { module: 'hanaworlds-local-runtime', services: ['hanaworldsWorldLifecycle', 'hanaworldsEngineRuntime'] },
]
const skills = (...providers: string[]) => ({ complete: true,
  skills: [...providers.map(provider => ({ name: 'hanaworlds-building', provider })), { name: 'pdf', provider: 'filesystem' }] })
const providersOf = (response: any) => response.data.result.providers

test('the running host fills every role from its registered services and skills; HTTP and service agree', async t => {
  const h = await setup(t, assembly, skills('hanaworlds-skills'))
  const response = await h.read()
  assert.equal(response.status, 200, JSON.stringify(response.data))
  validateBoundResponse('world-inspection/v1', 'ReadPluginRoles', { contractVersion: 'world-inspection/v1', requestId: response.data.requestId }, response.data)
  assert.deepEqual([response.data.result.status, response.data.result.missingRoles, response.data.error], ['COMPLETE', [], null])
  assert.deepEqual(providersOf(response), {
    'shell-ui': ['hanaworlds-shell-ui'], 'world-source': ['hanaworlds-adapter-luanti'], canvas: ['hanaworlds-canvas'],
    brush: ['hanaworlds-brush'], painter: ['hanaworlds-building-exterior-painter'], workshop: ['hanaworlds-workshop'],
    skills: ['hanaworlds-skills'], 'desktop-bridge': ['hanaworlds-desktop-bridge'], 'local-runtime': ['hanaworlds-local-runtime'] })
  assert.ok(!JSON.stringify(response.data).includes('version'), 'no versions')
  const direct = await h.ctx.hanaworldsWorldInspectionContext.ReadPluginRoles({ contractVersion: 'world-inspection/v1', requestId: 'in-process' })
  assert.deepEqual(JSON.parse(JSON.stringify(direct.result)), response.data.result)
})

test('a renamed world source is found by the service it registers, not by its package name', async t => {
  const renamed = assembly.map(m => m.module === 'hanaworlds-adapter-luanti' ? { ...m, module: 'acme-voxel-world-source' } : m)
  const h = await setup(t, [...renamed, { module: 'hanaworlds-world-source-lookalike', services: ['hanaworldsLuantiLocalWorlds'] }], skills('hanaworlds-skills'))
  const response = await h.read()
  assert.deepEqual(providersOf(response)['world-source'], ['acme-voxel-world-source'])
  assert.equal(response.data.result.status, 'COMPLETE')
})

test('several skill providers of the contracted skill all fill skills', async t => {
  const h = await setup(t, assembly, skills('studio-skills', 'hanaworlds-skills'))
  assert.deepEqual(providersOf(await h.read()).skills, ['hanaworlds-skills', 'studio-skills'])
})

test('missing roles are named and the answer is PARTIAL; a stopped plugin stops filling its role', async t => {
  const h = await setup(t, assembly.filter(m => !['hanaworlds-brush', 'hanaworlds-shell-ui'].includes(m.module)), skills())
  const response = await h.read()
  assert.equal(response.status, 200)
  assert.deepEqual([response.data.result.status, response.data.result.missingRoles], ['PARTIAL', ['shell-ui', 'brush', 'skills']])
  for (const role of ['shell-ui', 'brush', 'skills']) assert.deepEqual(providersOf(response)[role], [])
  await h.fibers.get('hanaworlds-building-exterior-painter').dispose()
  assert.deepEqual((await h.read()).data.result.missingRoles, ['shell-ui', 'brush', 'painter', 'skills'])
})

test('one plugin fills several roles; a service from a nested fiber belongs to its loader entry', async t => {
  const mounts = assembly.filter(m => m.module !== 'hanaworlds-brush')
    .map(m => m.module === 'hanaworlds-canvas' ? { ...m, services: [...m.services, 'hanaworldsBrushV3'] } : m)
    .map(m => m.module === 'hanaworlds-local-runtime' ? { ...m, nested: true } : m)
  const h = await setup(t, mounts, skills('hanaworlds-skills'))
  const providers = providersOf(await h.read())
  assert.deepEqual([providers.canvas, providers.brush], [['hanaworlds-canvas'], ['hanaworlds-canvas']])
  assert.deepEqual(providers['local-runtime'], ['hanaworlds-local-runtime'])
})

test('a failed read is an explicit, logged CAPABILITY_UNAVAILABLE, never an empty role map', async t => {
  const h = await setup(t, assembly, { skills: [], complete: false })
  const expectFailure = async (reason: RegExp) => {
    const response = await h.read()
    assert.equal(response.status, 409, JSON.stringify(response.data))
    assert.equal(response.data.error, 'CAPABILITY_UNAVAILABLE')
    assert.deepEqual([response.data.contractError.code, response.data.contractError.reason], ['CAPABILITY_UNAVAILABLE', 'REQUIRED_FACT_UNKNOWN'])
    assert.equal(response.data.result, undefined)
    assert.match(h.logs.at(-1)!, reason)
  }
  await expectFailure(/skills catalog incomplete/)
  h.state.skills = new Error('provider discovery failed')
  await expectFailure(/provider discovery failed/)
  h.state.skills = skills('hanaworlds-skills')
  assert.equal((await h.read()).status, 200)
  // A contracted service whose provider has no loader entry cannot be attributed: refuse rather than guess.
  h.ctx.provide('hanaworldsWorldFacts', {})
  await expectFailure(/hanaworldsWorldFacts has no loader entry/)
  const direct = await h.ctx.hanaworldsWorldInspectionContext.ReadPluginRoles({ contractVersion: 'world-inspection/v1', requestId: 'r' })
  assert.deepEqual([direct.result, direct.error?.code], [null, 'CAPABILITY_UNAVAILABLE'])
})

test('the route checks login and origin before reading, and unloads with the plugin', async t => {
  const h = await setup(t, assembly, skills('hanaworlds-skills'))
  assert.equal((await h.read({ cookie: '' })).status, 401)
  assert.equal((await h.read({ origin: 'http://foreign.local' })).status, 403)
  assert.equal(h.state.reads, 0)
  assert.equal(ROLES.length, 9)
  await h.bridgeFiber.dispose()
  assert.equal((await h.read()).status, 404)
})
