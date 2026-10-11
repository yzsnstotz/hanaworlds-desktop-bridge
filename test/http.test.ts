import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { validateType } from 'hanaworlds-contracts'
import * as plugin from 'hanaworlds-desktop-bridge'
import { createViewFixture, fixtureIds } from './view-fixture.ts'
import { createWorkshopFixture, fixtureControls } from './workshop-fixture.ts'

/** Real Cordis + Core Session + HTTP carrier; model, Canvas and persistence are explicit test peers. */
async function setup(t: any, registries = true) {
  const ctx = new Context()
  const sessionsFiber = await ctx.plugin(SessionStore)
  const serverFiber = await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const canvas = createViewFixture(), workshop = createWorkshopFixture(canvas)
  const originalCanvasCall = canvas.call
  ctx.provide('connection', { requestRejection(req: any) {
    if (req.headers.origin !== 'http://fixture.local') return 403
    if (req.headers.cookie !== 'fixture-login=valid') return 401
  } })
  ctx.provide('hanaworldsCanvasV5', canvas)
  ctx.provide('hanaworldsWorkshop', workshop)
  const registryReads: string[] = []
  const registryState = { tools: [] as unknown[], skills: { skills: [] as unknown[], complete: true } }
  if (registries) {
    ctx.provide('tools', { schemas(...args: unknown[]) {
      assert.deepEqual(args, []); registryReads.push('tools.schemas'); return registryState.tools
    } } as any)
    ctx.provide('skills', { async snapshot(...args: unknown[]) {
      assert.deepEqual(args, []); registryReads.push('skills.snapshot'); return registryState.skills
    } } as any)
  }
  const sessions = ctx.sessions
  for (const id of fixtureIds) sessions.create(SessionId(id))
  // The original fixture's durable Core seam, modeled in memory for component tests.
  const saved = new Map<string, readonly any[]>()
  const flushDisposer = ctx.on('session/flush', session => { saved.set(session.id, session.snapshotEvents()) })
  ctx.provide('sessionPersistence', { async open(id: string) { return {
    async read(from = 0, count?: number) { return { events: (saved.get(id) ?? []).slice(Number(from), count === undefined ? undefined : Number(from) + count) } },
    async close() {},
  } } })
  const agents = new Map(fixtureIds.map(id => [id, { session: sessions.get(SessionId(id))!, status: 'idle',
    inbox: { nextTurn: [], nextStep: [] }, async whenIdle() {} }]))
  // Host-owned selections and a controller boundary spy; no live model requests.
  const modelSelections = new Map(fixtureIds.map(id => [id, { provider: 'fixture-provider', model: `fixture-model-${id}` }]))
  const prompts: { request: any; selection: unknown }[] = []
  let promptError: Error | undefined
  ctx.provide('agents', { get: (id: string) => agents.get(id), currentInitiator: () => undefined })
  ctx.provide('hanaworldsSkillBusiness', { pending: (session: any) => workshop.pending(session.id) })
  ctx.provide('sessionController', { async prompt(request: any) {
    prompts.push({ request, selection: modelSelections.get(request.sessionId) })
    if (promptError) throw promptError
    const session = sessions.get(request.sessionId)!
    const text = request.content[0].text
    session.append('user/message', { id: request.requestId, role: 'user', source: { kind: 'user', rpcId: request.requestId },
      content: [{ type: 'text', text }] }, { surfaceOp: 'append' })
    const context = canvas.context(session.id)!, snapshot = workshop.snapshot(session.id), pending = workshop.pending(session.id)
    const operation = pending ? 'AnswerClarification' : 'AppendMultimodalTurn'
    const input = pending ? { turnRef: snapshot.turns.at(-1)!.turnRef, clarificationId: pending.clarificationId, answer: text }
      : { turnRef: `FIXTURE/turn/${request.requestId}`, text, media: [], controls: fixtureControls }
    await ctx.hanaworldsDesktopBridge.transport.dispatch(operation, {
      contractVersion: 'session/v5', requestId: request.requestId, sessionRef: session.id,
      expectedRevision: snapshot.context.sessionRevision, localContext: context, ...input,
    })
  } })
  const bridgeFiber = await ctx.plugin(plugin)
  const base = `http://127.0.0.1:${ctx.webServer.port}`
  t.after(async () => { await bridgeFiber.dispose(); flushDisposer(); await serverFiber.dispose(); await sessionsFiber.dispose() })
  async function request(path: string, data?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', headers: {
      origin: 'http://fixture.local', cookie: 'fixture-login=valid', 'content-type': 'application/json', ...headers,
    }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
    const raw = await response.text()
    return { status: response.status, data: raw ? JSON.parse(raw) : null }
  }
  async function bind(id = fixtureIds[0]) {
    const page = await request('/api-hanaworlds-view/window', {})
    assert.equal(page.status, 200)
    const selected = await request('/api-hanaworlds-view/select', { ...page.data, sessionId: id })
    assert.equal(selected.status, 200, JSON.stringify(selected.data))
    return { ...page.data, lease: selected.data.lease }
  }
  return { ctx, request, bind, canvas, workshop, bridgeFiber, originalCanvasCall, base, agents, saved,
    registryReads, registryState, modelSelections, prompts, rejectPrompt(error: Error) { promptError = error } }
}

test('Cordis entry registers authenticated HTTP routes and releases services and peer wrappers', async t => {
  const h = await setup(t)
  assert.deepEqual((await h.request('/api-hanaworlds-view/candidates')).data.candidates, fixtureIds)
  assert.equal((await h.request('/api-hanaworlds-view/window', {}, { cookie: '' })).status, 401)
  assert.equal((await h.request('/api-hanaworlds-view/window', {}, { origin: 'http://foreign.local' })).status, 403)
  assert.notEqual(h.canvas.call, h.originalCanvasCall)
  validateType('PublicCapabilities', h.ctx.hanaworldsCapabilities)
  assert.ok(h.ctx.hanaworldsPainterLocalFacts)
  assert.ok(h.ctx.hanaworldsWorldInspectionContext)
  assert.deepEqual((await h.request('/api-hanaworlds-skill-tools')).data, { tools: [], skills: { skills: [], complete: true } })
  await h.bridgeFiber.dispose()
  assert.equal(h.ctx.get('hanaworldsDesktopBridge'), undefined)
  assert.equal(h.ctx.get('hanaworldsCatalogue'), undefined)
  assert.equal(h.canvas.call, h.originalCanvasCall)
  assert.equal((await h.request('/api-hanaworlds-view/candidates')).status, 404)
})

test('skill-tools reads only live host schemas and skill snapshots with neutral descriptions', async t => {
  const h = await setup(t)
  const before = { sessions: h.ctx.sessions.list().map(s => s.id), requests: h.workshop.requests.length,
    prompts: h.prompts.length, saved: [...h.saved] }
  h.workshop.describeWriteTools = async () => { throw new Error('WORKSHOP_MUST_NOT_BE_READ') }
  h.registryState.tools = [{ name: 'hanaworlds_proposal', description: '提交逐格建筑提议：使用当前世界的不透明材质引用与中立朝向。',
    parameters: { type: 'object', properties: { materialRef: { type: 'string' }, orientation: { type: 'integer' } },
      required: ['materialRef'], additionalProperties: false } }]
  h.registryState.skills = { skills: [{ name: 'hanaworlds-building', description: '从当前世界的事实读取几何、分块与材质词表。',
    source: 'runtime', provider: 'FIXTURE/skills', invocation: { modelInvocable: true, userInvocable: true } }], complete: true }
  const response = await h.request('/api-hanaworlds-skill-tools')
  assert.equal(response.status, 200)
  assert.deepEqual(response.data, h.registryState)
  assert.doesNotMatch(JSON.stringify(response.data), /nodeName|param2|mapblock|flat\s+mapgen|["']?unit["']?\s*:\s*["']node["']/i)
  assert.deepEqual(h.registryReads, ['tools.schemas', 'skills.snapshot'])
  h.registryState.tools = []
  h.registryState.skills = { skills: [], complete: false }
  assert.deepEqual((await h.request('/api-hanaworlds-skill-tools')).data, h.registryState)
  assert.deepEqual({ sessions: h.ctx.sessions.list().map(s => s.id), requests: h.workshop.requests.length,
    prompts: h.prompts.length, saved: [...h.saved] }, before)
})

test('skill-tools enforces login, origin and GET before reading registries, and unloads', async t => {
  const h = await setup(t)
  assert.equal((await h.request('/api-hanaworlds-skill-tools', undefined, { cookie: '' })).status, 401)
  assert.equal((await h.request('/api-hanaworlds-skill-tools', undefined, { origin: 'http://foreign.local' })).status, 403)
  assert.equal((await h.request('/api-hanaworlds-skill-tools', {})).status, 404)
  assert.equal((await h.request('/api-hanaworlds-skill-tools/unknown')).status, 404)
  assert.deepEqual(h.registryReads, [])
  await h.bridgeFiber.dispose()
  assert.equal((await h.request('/api-hanaworlds-skill-tools')).status, 404)
  assert.deepEqual(h.registryReads, [])
})

test('skill-tools reports missing host registries without falling back to Workshop', async t => {
  const h = await setup(t, false)
  const response = await h.request('/api-hanaworlds-skill-tools')
  assert.equal(response.status, 409)
  assert.equal(response.data.error, 'TOOLS_REGISTRY_UNAVAILABLE')
  h.ctx.provide('tools', { schemas: () => [] } as any)
  const missingSkills = await h.request('/api-hanaworlds-skill-tools')
  assert.equal(missingSkills.status, 409)
  assert.equal(missingSkills.data.error, 'SKILLS_REGISTRY_UNAVAILABLE')
})

test('skill-tools relays real DSH registries without executing tools or loading skill bodies', async t => {
  const h = await setup(t, false)
  h.ctx.provide('systemPrompt', { tools() {} } as any)
  const toolsFiber = await h.ctx.plugin(ToolRuntime), skillsFiber = await h.ctx.plugin(SkillRegistry)
  t.after(async () => { await skillsFiber.dispose(); await toolsFiber.dispose() })
  const disposeTool = h.ctx.tools.register({ name: 'hanaworlds_context', description: '读取当前世界、选中对象与放置区域事实。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'null' }, render: () => [] },
    async execute() { throw new Error('TOOL_MUST_NOT_EXECUTE') } })
  h.ctx.skills.registerProvider(() => ({ name: 'FIXTURE/skills', async list() { return [{
    name: 'hanaworlds-building', description: '依照世界源声明的几何与材质词表构建。', source: 'runtime',
    provider: 'FIXTURE/skills', invocation: { modelInvocable: true, userInvocable: true }, rank: 600, locator: 'opaque',
  }] }, async get() { throw new Error('SKILL_BODY_MUST_NOT_LOAD') } }))
  const response = await h.request('/api-hanaworlds-skill-tools')
  assert.equal(response.status, 200)
  assert.deepEqual(response.data, { tools: h.ctx.tools.schemas(), skills: await h.ctx.skills.snapshot() })
  assert.deepEqual(Object.keys(response.data.tools[0]).sort(), ['description', 'name', 'parameters'])
  assert.doesNotMatch(JSON.stringify(response.data), /nodeName|param2|mapblock|flat\s+mapgen|["']?unit["']?\s*:\s*["']node["']/i)
  disposeTool()
  assert.deepEqual((await h.request('/api-hanaworlds-skill-tools')).data.tools, [])
})

test('skill-tools preserves host discovery errors without cached or Workshop fallback', async t => {
  const h = await setup(t, false)
  h.ctx.provide('tools', { schemas: () => [] } as any)
  h.ctx.provide('skills', { async snapshot() { throw new Error('FIXTURE_DISCOVERY_FAILED') } } as any)
  const response = await h.request('/api-hanaworlds-skill-tools')
  assert.equal(response.status, 409)
  assert.equal(response.data.error, 'FIXTURE_DISCOVERY_FAILED')
})

test('HTTP invoke enriches interaction input from the selected Core session and Canvas context', async t => {
  const h = await setup(t), binding = await h.bind()
  const result = await h.request('/api-hanaworlds-workshop/invoke', { ...binding,
    input: { operation: 'workshop', input: { operation: 'StartOrResumeSession', payload: { expectedRevision: null } } },
  })
  assert.equal(result.status, 200, JSON.stringify(result.data))
  assert.equal(result.data.result.result.context.currentSession, fixtureIds[0])
  const context = await h.request('/api-hanaworlds-workshop/invoke', { ...binding,
    input: { operation: 'context', input: { sessionRef: fixtureIds[0] } },
  })
  assert.deepEqual(context.data.result.localContext, { ...h.canvas.context(fixtureIds[0]) })
})

test('HTTP refuses forged authority in interaction payload without dispatching to Workshop', async t => {
  const h = await setup(t), binding = await h.bind()
  for (const key of ['sessionRef', 'worldRef', 'localContext', 'actorRef', 'authorizationRef', 'callerRole', 'bindingRef', 'grantEpoch', 'allowedActions']) {
    const count = h.workshop.requests.length
    const result = await h.request('/api-hanaworlds-workshop/invoke', { ...binding, input: {
      operation: 'workshop', input: { operation: 'StartOrResumeSession', payload: { expectedRevision: null, [key]: 'FORGED' } },
    } })
    assert.equal(result.status, 409, key)
    assert.match(result.data.error, /LOCAL_CONTEXT_REQUIRED/)
    assert.equal(h.workshop.requests.length, count)
  }
  assert.equal((await h.request('/api-hanaworlds-workshop/invoke', { ...binding,
    input: { operation: 'context', input: { sessionRef: fixtureIds[1] } } })).status, 409)
})

test('HTTP session selection refuses an absent Core identity before calling Workshop', async t => {
  const h = await setup(t), window = (await h.request('/api-hanaworlds-view/window', {})).data
  const count = h.workshop.requests.length
  const result = await h.request('/api-hanaworlds-view/select', { ...window, sessionId: 'FORGED/non-core-session' })
  assert.equal(result.status, 409)
  assert.equal(h.workshop.requests.length, count)
})

test('HTTP prepare and confirm pass real Core user input through the transport into published session/v5', async t => {
  const h = await setup(t), binding = await h.bind()
  assert.match((await h.request('/api-hanaworlds-workshop/confirm', binding)).data.error, /NO_CURRENT_ROUND/)
  const prepared = await h.request('/api-hanaworlds-workshop/prepare', { ...binding, text: '一个小石屋' })
  assert.equal(prepared.status, 200, JSON.stringify(prepared.data))
  assert.equal(prepared.data.view.source, 'FIXTURE')
  assert.equal(prepared.data.view.turns[0].userText, '一个小石屋')
  assert.ok(prepared.data.view.pending)
  const confirmed = await h.request('/api-hanaworlds-workshop/confirm', binding)
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data))
  assert.equal(confirmed.data.view.pending, null)
  assert.match(confirmed.data.view.turns[0].resultText, /已确认/)
  const mutations = h.workshop.requests.filter(r => ['AppendMultimodalTurn', 'AnswerClarification'].includes(r.operation))
  assert.deepEqual(mutations.map(r => r.operation), ['AppendMultimodalTurn', 'AnswerClarification'])
  for (const { request } of mutations) {
    assert.equal(request.sessionRef, fixtureIds[0]); assert.deepEqual(request.localContext, h.canvas.context(fixtureIds[0]))
  }
  const inputs = h.saved.get(fixtureIds[0])!.filter(e => e.type === 'user/message')
  assert.deepEqual(inputs.map(e => e.data.content[0].text), ['一个小石屋', '确认'])
  assert.equal((await h.request('/api-hanaworlds-workshop/read', binding)).data.view.turns.length, 1)
})

test('HTTP prepare and confirm delegate routing to the host after its model selection changes', async t => {
  const h = await setup(t), binding = await h.bind()
  assert.equal(h.ctx.get('hanaworldsModelRoute' as never), undefined)
  const before = { provider: 'fixture-provider-a', model: 'fixture-model-a', reasoningEffort: 'high' }
  h.modelSelections.set(fixtureIds[0], before)
  assert.equal((await h.request('/api-hanaworlds-workshop/prepare', { ...binding, text: '一个小石屋' })).status, 200)
  const after = { provider: 'fixture-provider-b', model: 'fixture-model-b' }
  h.modelSelections.set(fixtureIds[0], after)
  assert.equal((await h.request('/api-hanaworlds-workshop/confirm', binding)).status, 200)
  assert.deepEqual(h.prompts.map(p => p.selection), [before, after])
  for (const { request } of h.prompts) {
    // The bridge submits user input only; the host retains provider/model/effort ownership.
    assert.deepEqual(request, { requestId: request.requestId, sessionId: fixtureIds[0], mode: 'queue', content: request.content })
    assert.equal(typeof request.requestId, 'string')
  }
  assert.deepEqual(h.prompts.map(p => p.request.content), [
    [{ type: 'text', text: '一个小石屋' }], [{ type: 'text', text: '确认' }],
  ])
  assert.equal(h.modelSelections.get(fixtureIds[0]), after)
})

test('HTTP prompts use the selected session without replacing another host model selection', async t => {
  const h = await setup(t)
  const selections = new Map(h.modelSelections)
  for (const id of fixtureIds) {
    const binding = await h.bind(id)
    assert.equal((await h.request('/api-hanaworlds-workshop/prepare', { ...binding, text: '一个小石屋' })).status, 200)
  }
  assert.deepEqual(h.prompts.map(p => p.request.sessionId), fixtureIds)
  assert.deepEqual(h.prompts.map(p => p.selection), fixtureIds.map(id => selections.get(id)))
  assert.deepEqual(h.modelSelections, selections)
})

test('HTTP surfaces host prompt rejection without a fallback model or Workshop mutation', async t => {
  const h = await setup(t), binding = await h.bind()
  const selection = h.modelSelections.get(fixtureIds[0])
  const count = h.workshop.requests.length
  h.rejectPrompt(new Error('FIXTURE_HOST_MODEL_UNAVAILABLE'))
  const result = await h.request('/api-hanaworlds-workshop/prepare', { ...binding, text: '一个小石屋' })
  assert.equal(result.status, 409)
  assert.match(result.data.error, /FIXTURE_HOST_MODEL_UNAVAILABLE/)
  assert.equal(h.prompts.length, 1)
  assert.equal(h.workshop.requests.length, count)
  assert.equal(h.modelSelections.get(fixtureIds[0]), selection)
})

test('view clear, close, revoked selection and stale lease reject subsequent work', async t => {
  const h = await setup(t)
  let binding = await h.bind()
  assert.equal((await h.request('/api-hanaworlds-view/read', { ...binding, lease: 'FORGED' })).status, 409)
  assert.equal((await h.request('/api-hanaworlds-view/read', binding)).status, 200)
  await h.request('/api-hanaworlds-view/clear', binding)
  assert.equal((await h.request('/api-hanaworlds-view/read', binding)).status, 409)
  binding = await h.bind()
  h.canvas.act(fixtureIds[0], 'revoke')
  assert.match((await h.request('/api-hanaworlds-view/read', binding)).data.error, /CONTEXT_CHANGED/)
  h.canvas.act(fixtureIds[0], 'regrant')
  binding = await h.bind()
  assert.equal((await h.request('/api-hanaworlds-view/close', binding)).status, 200)
  assert.equal((await h.request('/api-hanaworlds-view/read', binding)).status, 404)
})

test('direct HTTP append persists Core input and returns released stale-revision errors', async t => {
  const h = await setup(t), binding = await h.bind()
  const snapshot = h.workshop.snapshot(fixtureIds[0])
  const input = { operation: 'workshop', input: { operation: 'AppendMultimodalTurn', payload: {
    turnRef: 'FIXTURE/http-turn', expectedRevision: snapshot.context.sessionRevision,
    text: '测试直接传输', media: [], controls: fixtureControls,
  } } }
  const result = await h.request('/api-hanaworlds-workshop/invoke', { ...binding, input })
  assert.equal(result.status, 200, JSON.stringify(result.data))
  assert.equal(result.data.result.error, null)
  const appended = h.workshop.requests.find(r => r.operation === 'AppendMultimodalTurn')!
  assert.equal(appended.request.contractVersion, 'session/v5')
  assert.equal(appended.request.sessionRef, fixtureIds[0])
  assert.deepEqual(appended.request.localContext, h.canvas.context(fixtureIds[0]))
  assert.equal(h.saved.get(fixtureIds[0])!.filter(e => e.type === 'user/message').length, 1)
  const stale = await h.request('/api-hanaworlds-workshop/invoke', { ...binding, input: {
    operation: 'workshop', input: { operation: 'StartOrResumeSession', payload: { expectedRevision: 'STALE' } },
  } })
  assert.equal(stale.data.result.result, null)
  assert.equal(stale.data.result.error.code, 'STALE_REVISION')
})

test('confirm refuses busy Agents and rejects a changed view while a human prompt is running', async t => {
  const h = await setup(t), binding = await h.bind()
  h.agents.get(fixtureIds[0])!.status = 'busy'
  assert.match((await h.request('/api-hanaworlds-workshop/prepare', { ...binding, text: 'busy' })).data.error, /AGENT_BUSY/)
  h.agents.get(fixtureIds[0])!.status = 'idle'
  const agent = h.agents.get(fixtureIds[0])!
  agent.whenIdle = async () => { h.canvas.act(fixtureIds[0], 'regrant') }
  const prepared = await h.request('/api-hanaworlds-workshop/prepare', { ...binding, text: 'changing selection' })
  assert.equal(prepared.status, 409)
  assert.match(prepared.data.error, /CONTEXT_CHANGED/)
  assert.equal((await h.request('/api-hanaworlds-workshop/confirm', binding)).status, 409)
})

test('deployment keeps UNAVAILABLE source facts and missing region peers visible', async t => {
  const h = await setup(t), binding = await h.bind()
  const description = (await h.request('/api-hanaworlds-deployment', binding)).data
  assert.equal(description.compilerConfig.value, null)
  assert.match(description.compilerConfig.error, /COMPILER_CONFIG_UNAVAILABLE/)
  assert.deepEqual(description.fixed[0].value, { availability: 'UNAVAILABLE', reason: 'NO_PUBLIC_SOURCE' })
  const seams = (await h.request('/api-hanaworlds-region')).data
  assert.equal(seams.length, 4)
  assert.ok(seams.every((s: any) => !s.compatible && s.unmet.code === 'PEER_UNAVAILABLE'))
})

test('HTTP rejects invalid JSON, oversized bodies, unsupported routes and unknown page handles', async t => {
  const h = await setup(t)
  assert.equal((await h.request('/api-hanaworlds-view/read', { windowKey: 'unknown', lease: 'unknown' })).status, 404)
  assert.equal((await h.request('/api-hanaworlds-view/no-such-action')).status, 404)
  assert.equal((await h.request('/api-hanaworlds-workshop/prepare', [], { 'content-type': 'text/plain' })).status, 415)
  assert.equal((await h.request('/api-hanaworlds-workshop/prepare', [])).status, 400)
  assert.equal((await h.request('/api-hanaworlds-workshop/prepare', { text: 'x'.repeat(65537) })).status, 413)
  const raw = await fetch(h.base + '/api-hanaworlds-view/read', { method: 'POST',
    headers: { origin: 'http://fixture.local', cookie: 'fixture-login=valid', 'content-type': 'application/json' }, body: '{' })
  assert.equal(raw.status, 400)
})
