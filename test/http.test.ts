import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import lifecycleFixture from 'hanaworlds-contracts/fixtures/world-lifecycle' with { type: 'json' }
import worldErrorFixture from 'hanaworlds-contracts/fixtures/world-error' with { type: 'json' }
import { createWorldLifecycleMock, validateType, digestValue, worldUnavailableError } from 'hanaworlds-contracts'
import relayFixture from 'hanaworlds-desktop-bridge/fixtures/world-error-relay' with { type: 'json' }
import * as plugin from 'hanaworlds-desktop-bridge'
import { createViewFixture, fixtureIds } from './view-fixture.ts'
import { createWorkshopFixture, fixtureControls } from './workshop-fixture.ts'
import { createWriteProfileFixture } from './world-facts-fixture.ts'
import { installBuildFixture } from './build-fixture.ts'

/** Real Cordis + Core Session + HTTP carrier; model, Canvas and persistence are explicit test peers. */
async function setup(t: any, registries = true, builds = false) {
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
  const lifecycleRequests: { operation: string; request: any }[] = []
  const lifecycleMock = createWorldLifecycleMock(lifecycleFixture)
  const lifecycle: any = Object.fromEntries(['describe', 'list', 'create', 'describeDelete', 'delete', 'launch', 'stop', 'play']
    .map(operation => [operation, async (request: any) => {
      lifecycleRequests.push({ operation, request })
      return lifecycleMock('world-lifecycle/v2', operation as never, request)
    }]))
  ctx.provide('hanaworldsWorldLifecycle', lifecycle)
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
  const modelReplies = new Map<string, string>()
  let promptError: Error | undefined
  ctx.provide('agents', { get: (id: string) => agents.get(id), currentInitiator: () => undefined })
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
    const modelReply = modelReplies.get(session.id)
    if (modelReply) session.append('assistant/message', { turn: 1, step: 1, stream: [], message: {
      id: `FIXTURE/reply/${request.requestId}`, role: 'assistant', source: { kind: 'model', provider: 'fixture-provider', model: 'fixture-model' },
      content: [{ type: 'text', text: modelReply }],
    } }, { surfaceOp: 'append' })
  } })
  const buildFixture = builds ? installBuildFixture(ctx, canvas, workshop) : undefined
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
  return { ctx, request, bind, canvas, workshop, bridgeFiber, originalCanvasCall, base, agents, saved, buildFixture,
    registryReads, registryState, modelSelections, modelReplies, prompts, lifecycle, lifecycleRequests, rejectPrompt(error: Error) { promptError = error } }
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
  assert.ok(h.ctx.hanaworldsCompilerConfig)
  assert.deepEqual((await h.request('/api-hanaworlds-skill-tools')).data, { tools: [], skills: { skills: [], complete: true } })
  await h.bridgeFiber.dispose()
  assert.equal(h.ctx.get('hanaworldsDesktopBridge'), undefined)
  assert.equal(h.ctx.get('hanaworldsCatalogue'), undefined)
  assert.equal(h.ctx.get('hanaworldsCompilerConfig'), undefined)
  assert.equal(h.ctx.get('hanaworldsWorldInspectionContext'), undefined)
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
  assert.equal(confirmed.data.view.turns[0].confirmedBrief, true)
  const mutations = h.workshop.requests.filter(r => ['AppendMultimodalTurn', 'AnswerClarification'].includes(r.operation))
  assert.deepEqual(mutations.map(r => r.operation), ['AppendMultimodalTurn', 'AnswerClarification'])
  for (const { request } of mutations) {
    assert.equal(request.sessionRef, fixtureIds[0]); assert.deepEqual(request.localContext, h.canvas.context(fixtureIds[0]))
  }
  const inputs = h.saved.get(fixtureIds[0])!.filter(e => e.type === 'user/message')
  assert.deepEqual(inputs.map(e => e.data.content[0].text), ['一个小石屋', '确认'])
  assert.equal((await h.request('/api-hanaworlds-workshop/read', binding)).data.view.turns.length, 1)
})

test('C-session-only peer exposes the current proposal and admits HTTP confirmation', async t => {
  const h = await setup(t), binding = await h.bind()
  const prepared = await h.request('/api-hanaworlds-workshop/prepare', { ...binding, text: '一个小石屋' })
  const read = await h.request('/api-hanaworlds-workshop/read', binding)
  const confirmed = await h.request('/api-hanaworlds-workshop/confirm', binding)
  assert.equal(prepared.status, 200)
  assert.ok(read.data.view.pending, 'A published C-session peer must make its pending proposal visible without a private service')
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data))
  assert.equal(read.data.view.pending.clarificationId, h.workshop.requests.find(r => r.operation === 'AnswerClarification')!.request.clarificationId)
  assert.equal(confirmed.data.view.pending, null)
  assert.match(confirmed.data.view.turns[0].resultText, /已确认/)
  assert.equal((await h.request('/api-hanaworlds-workshop/confirm', binding)).status, 409)
  assert.equal(h.prompts.length, 2)
})

test('HTTP confirmation requires a displayed round and refuses a successor round from another page', async t => {
  const h = await setup(t), a = await h.bind(), b = await h.bind()
  const first = await h.request('/api-hanaworlds-workshop/prepare', { ...a, text: '第一个提案' })
  assert.ok(first.data.view.pending)
  assert.equal((await h.request('/api-hanaworlds-workshop/confirm', b)).status, 409)
  await h.request('/api-hanaworlds-workshop/read', b)
  assert.equal((await h.request('/api-hanaworlds-workshop/confirm', b)).status, 200)
  assert.equal((await h.request('/api-hanaworlds-workshop/prepare', { ...b, text: '后续提案' })).status, 200)
  const prompts = h.prompts.length
  const stale = await h.request('/api-hanaworlds-workshop/confirm', a)
  assert.equal(stale.status, 409)
  assert.match(stale.data.error, /ROUND_CHANGED/)
  assert.equal(h.prompts.length, prompts)
  const latest = await h.request('/api-hanaworlds-workshop/read', a)
  assert.notEqual(latest.data.view.pending.clarificationId, first.data.view.pending.clarificationId)
  assert.equal((await h.request('/api-hanaworlds-workshop/confirm', a)).status, 200)
})

test('HTTP submission locks the selected Core session across page windows', async t => {
  const h = await setup(t), a = await h.bind(), b = await h.bind()
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const ready = new Promise<void>(resolve => { started = resolve })
  h.agents.get(fixtureIds[0])!.whenIdle = async () => { started(); await gate }
  const preparing = h.request('/api-hanaworlds-workshop/prepare', { ...a, text: '当前提案' })
  t.after(() => release())
  await ready
  try {
    const duplicate = await h.request('/api-hanaworlds-workshop/prepare', { ...b, text: '同时提交' })
    assert.equal(duplicate.status, 409)
    assert.match(duplicate.data.error, /HANAWORLDS_CONFIRM_BUSY/)
    assert.equal(h.prompts.length, 1)
  } finally { release() }
  assert.equal((await preparing).status, 200)
})

test('HTTP refuses Workshop replacement while the host prompt is running', async t => {
  const h = await setup(t), binding = await h.bind()
  h.agents.get(fixtureIds[0])!.whenIdle = async () => { h.ctx.set('hanaworldsWorkshop', { ...h.workshop }) }
  const prepared = await h.request('/api-hanaworlds-workshop/prepare', { ...binding, text: '提案' })
  assert.equal(prepared.status, 409)
  assert.match(prepared.data.error, /SESSION_OR_CONTEXT_CHANGED/)
})

test('HTTP dialogue reads the actual durable model proposal and confirmed brief', async t => {
  const h = await setup(t), binding = await h.bind()
  h.modelReplies.set(fixtureIds[0], '拟建一个小石屋，请确认。')
  const prepared = await h.request('/api-hanaworlds-workshop/prepare', { ...binding, text: '一个小石屋' })
  assert.equal(prepared.status, 200)
  assert.equal(prepared.data.view.modelReply, '拟建一个小石屋，请确认。')
  assert.equal(prepared.data.view.turns[0].confirmedBrief, false)
  assert.equal((await h.request('/api-hanaworlds-workshop/read', binding)).data.view.modelReply, prepared.data.view.modelReply)
  h.modelReplies.set(fixtureIds[0], '已收到你的确认。')
  const confirmed = await h.request('/api-hanaworlds-workshop/confirm', binding)
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.data.view.modelReply, '已收到你的确认。')
  assert.equal(confirmed.data.view.turns[0].confirmedBrief, true)
  assert.equal(confirmed.data.view.pending, null)
  const events = h.saved.get(fixtureIds[0])!
  assert.deepEqual(events.filter(e => e.type === 'user/message').map(e => e.data.content[0].text), ['一个小石屋', '确认'])
  assert.deepEqual(events.filter(e => e.type === 'assistant/message').map(e => e.data.message.content[0].text),
    ['拟建一个小石屋，请确认。', '已收到你的确认。'])
})

test('HTTP refuses a pending clarification that names a different turn revision', async t => {
  const h = await setup(t), binding = await h.bind()
  const call = h.workshop.call
  h.workshop.call = async (operation, request) => {
    const packet: any = await call(operation, request)
    if (operation === 'AppendMultimodalTurn') return { ...packet,
      result: { ...packet.result, clarification: { ...packet.result.clarification, turnRevision: 'FORGED/revision' } } }
    return packet
  }
  assert.equal((await h.request('/api-hanaworlds-workshop/prepare', { ...binding, text: '提案' })).status, 409)
  assert.equal((await h.request('/api-hanaworlds-workshop/read', binding)).data.view.pending, null)
  assert.equal((await h.request('/api-hanaworlds-workshop/confirm', binding)).status, 409)
  assert.equal(h.prompts.length, 1)
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

test('deployment reports the missing world source without manufacturing avatar facts', async t => {
  const h = await setup(t), binding = await h.bind()
  const description = (await h.request('/api-hanaworlds-deployment', binding)).data
  assert.equal(description.compilerConfig.value, null)
  assert.match(description.compilerConfig.error, /ADAPTER_UNAVAILABLE/)
  assert.equal(description.writeProfile.value, null)
  assert.equal(description.fixed[0].value, null)
  const seams = (await h.request('/api-hanaworlds-region')).data
  assert.equal(seams.length, 4)
  assert.ok(seams.every((s: any) => !s.compatible && s.unmet.code === 'PEER_UNAVAILABLE'))
})

test('Cordis deployment HTTP and compiler service relay full source snapshots and undeclared facts', async t => {
  const h = await setup(t), binding = await h.bind()
  for (const unavailable of [false, true]) {
    const source = createWriteProfileFixture(unavailable)
    const dispose = h.ctx.provide('hanaworldsWorldFacts', source as any)
    const response = await h.request('/api-hanaworlds-deployment', binding)
    assert.equal(response.status, 200)
    assert.deepEqual(response.data.writeProfile.value, JSON.parse(JSON.stringify({ ...source.profile,
      connection: { ...source.profile.connection, worldRef: 'FIXTURE/world/1' } })))
    assert.deepEqual(response.data.compilerConfig.value, JSON.parse(JSON.stringify(source.profile.compilationConfig)))
    assert.deepEqual(response.data.writeMethods.value, source.profile.writeMethods)
    assert.deepEqual(response.data.fixed[0].value, JSON.parse(JSON.stringify(source.profile.avatarEnvelope)))
    assert.equal(source.requests.length, 1)
    if (unavailable) await assert.rejects(h.ctx.hanaworldsCompilerConfig.read('FIXTURE/world/1'), /CAPABILITY_UNAVAILABLE/)
    else assert.deepEqual(await h.ctx.hanaworldsCompilerConfig.read('FIXTURE/world/1'), source.profile.compilationConfig)
    dispose()
  }
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


test('neutral lifecycle routes preserve source-owned templates and opaque creation facts', async t => {
  const h = await setup(t)
  const described = await h.request('/api-hanaworlds-worlds/describe')
  assert.equal(described.status, 200)
  assert.equal(described.data.templates[0].templateId, 'fixture-template')
  assert.equal((await h.request('/api-hanaworlds-worlds/list')).data.worlds[0].worldId, 'fixture-world-id')
  const created = await h.request('/api-hanaworlds-worlds/create', { templateId: 'fixture-template', displayName: 'Fixture World' })
  assert.equal(created.status, 200)
  const fixture = lifecycleFixture.exchanges.find(e => e.operation === 'create' && e.response.result)!
  assert.deepEqual(created.data.creationFacts, (fixture.response.result as any).creationFacts)
  assert.deepEqual(h.lifecycleRequests.map(r => r.operation), ['describe', 'list', 'create'])
  assert.equal((await h.request('/api-hanaworlds-worlds/create', { templateId: 'fixture-template', displayName: 'Fixture World', luantiContent: {} })).status, 400)
  assert.equal((await h.request('/api-hanaworlds-worlds/list', undefined, { cookie: '' })).status, 401)
})

const deletion = { worldId: 'fixture-world-id', confirmationName: 'Fixture World' }

test('delete requires the exact source name and rejects forged retirement authority before any mutation', async t => {
  const h = await setup(t)
  for (const input of [{ ...deletion, confirmationName: 'fixture world' }, { ...deletion, confirmationName: 'Fixture World ' }]) {
    const response = await h.request('/api-hanaworlds-worlds/delete', input)
    assert.equal(response.status, 409)
    assert.match(response.data.error, /TRANSACTION_CONFLICT.*名字/)
  }
  for (const input of [{ worldId: deletion.worldId }, { ...deletion, worldRef: 'forged' }, { ...deletion, reservationRef: 'forged' }]) {
    assert.equal((await h.request('/api-hanaworlds-worlds/delete', input)).status, 400)
  }
  assert.ok(h.lifecycleRequests.every(r => r.operation === 'describeDelete'))
  assert.equal(h.canvas.requests.length, 0)
})

test('delete refuses a world selected by another conversation even after disconnection', async t => {
  const h = await setup(t)
  const page = (await h.request('/api-hanaworlds-view/window', {})).data
  assert.equal((await h.request('/api-hanaworlds-worlds/connect', { ...page, sessionId: fixtureIds[1], worldId: deletion.worldId })).status, 200)
  h.canvas.act(fixtureIds[1], 'disconnect')
  const response = await h.request('/api-hanaworlds-worlds/delete', deletion)
  assert.equal(response.status, 409)
  assert.match(response.data.error, /先在那个对话里切到别的世界/)
  assert.ok(response.data.error.includes(fixtureIds[1]))
  assert.ok(!h.lifecycleRequests.some(r => r.operation === 'delete'))
})

test('delete reserves through Canvas before lifecycle deletion and retires the reservation', async t => {
  const h = await setup(t), order: string[] = []
  const canvasCall = h.canvas.call, remove = h.lifecycle.delete
  h.canvas.call = async function (op: string, req: unknown) { order.push(op); return canvasCall.call(this, op, req) }
  h.lifecycle.delete = async (req: unknown) => { order.push('delete'); return remove(req) }
  const response = await h.request('/api-hanaworlds-worlds/delete', deletion)
  assert.equal(response.status, 200, JSON.stringify(response.data))
  assert.equal(response.data.deleted, true)
  assert.deepEqual(order, ['ListWorldSelections', 'ReserveWorldRetirement', 'delete', 'ReleaseWorldRetirement'])
  assert.equal(h.canvas.requests.at(-1)!.request.outcome, 'RETIRED')
  assert.deepEqual(h.lifecycleRequests.map(r => r.operation), ['describeDelete', 'delete'])
  await assert.rejects(h.ctx.hanaworldsDesktopBridge.lifecycle.call('delete' as never, deletion), /retirement gate/)
})

test('delete aborts its reservation on lifecycle failure and permits a later explicit attempt', async t => {
  const h = await setup(t), remove = h.lifecycle.delete
  h.lifecycle.delete = async () => { throw new Error('TRANSACTION_CONFLICT') }
  assert.equal((await h.request('/api-hanaworlds-worlds/delete', deletion)).status, 409)
  assert.equal(h.canvas.requests.at(-1)!.request.outcome, 'ABORTED')
  h.lifecycle.delete = remove
  assert.equal((await h.request('/api-hanaworlds-worlds/delete', deletion)).status, 200)
})

test('retirement blocks new selections and a second deletion while lifecycle delete is pending', async t => {
  const h = await setup(t), remove = h.lifecycle.delete
  let proceed!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { proceed = resolve }), ready = new Promise<void>(resolve => { started = resolve })
  h.lifecycle.delete = async (req: unknown) => { started(); await gate; return remove(req) }
  const deleting = h.request('/api-hanaworlds-worlds/delete', deletion)
  try {
    assert.equal(await Promise.race([ready.then(() => true), deleting.then(() => false)]), true)
    assert.equal((await h.request('/api-hanaworlds-worlds/delete', deletion)).status, 409)
    const page = (await h.request('/api-hanaworlds-view/window', {})).data
    assert.equal((await h.request('/api-hanaworlds-worlds/connect', { ...page, sessionId: fixtureIds[0], worldId: deletion.worldId })).status, 409)
  } finally { proceed() }
  assert.equal((await deleting).status, 200)
  assert.equal(h.lifecycleRequests.filter(r => r.operation === 'delete').length, 1)
})

test('delete keeps the route login and Origin boundary ahead of any peer call', async t => {
  const h = await setup(t)
  assert.equal((await h.request('/api-hanaworlds-worlds/delete', deletion, { cookie: '' })).status, 401)
  assert.equal((await h.request('/api-hanaworlds-worlds/delete', deletion, { origin: 'http://foreign.local' })).status, 403)
  assert.equal(h.lifecycleRequests.length, 0)
  assert.equal(h.canvas.requests.length, 0)
})

test('selection racing the retirement reservation refuses deletion with conversation guidance', async t => {
  const h = await setup(t), call = h.canvas.call
  h.canvas.call = async function (op: string, req: any) {
    if (op === 'ReserveWorldRetirement') await h.originalCanvasCall.call(this, 'SelectWorldConnection', {
      contractVersion: 'canvas/v7', requestId: 'race-selection', sessionRef: fixtureIds[1], worldRef: 'fixture-world',
      connectionRef: 'race-connection', connectionIncarnationRef: 'race-incarnation', expectedRevision: 'race-revision', expectedContext: null,
    })
    return call.call(this, op, req)
  }
  const response = await h.request('/api-hanaworlds-worlds/delete', deletion)
  assert.equal(response.status, 409)
  assert.match(response.data.error, /先在那个对话里切到别的世界/)
  assert.ok(!h.lifecycleRequests.some(r => r.operation === 'delete'))
  assert.equal(h.canvas.requests.filter(r => r.operation === 'ReserveWorldRetirement').length, 1)
})

test('delete rejects uncorrelated descriptions, inventories and retirement receipts before lifecycle mutation', async t => {
  for (const corruption of ['description', 'inventory', 'reservation-id', 'reservation-revision']) await t.test(corruption, async t => {
    const h = await setup(t), call = h.canvas.call, describe = h.lifecycle.describeDelete
    if (corruption === 'description') h.lifecycle.describeDelete = async (req: any) => ({ ...await describe(req), requestId: 'wrong-id' })
    else h.canvas.call = async function (op: string, req: any) {
      const response: any = await call.call(this, op, req)
      if (corruption === 'inventory' && op === 'ListWorldSelections') return { ...response, result: { ...response.result, worldRef: 'wrong-world' } }
      if (op === 'ReserveWorldRetirement' && corruption === 'reservation-id') return { ...response, requestId: 'wrong-id' }
      if (op === 'ReserveWorldRetirement' && corruption === 'reservation-revision') return { ...response, result: { ...response.result, inventoryRevision: 'wrong-revision' } }
      return response
    }
    assert.equal((await h.request('/api-hanaworlds-worlds/delete', deletion)).status, 409)
    assert.ok(!h.lifecycleRequests.some(r => r.operation === 'delete'))
  })
})

test('replacing either supplier after reservation aborts through the captured Canvas without deleting', async t => {
  for (const supplier of ['canvas', 'lifecycle']) await t.test(supplier, async t => {
    const h = await setup(t), call = h.canvas.call
    h.canvas.call = async function (op: string, req: any) {
      const response = await call.call(this, op, req)
      if (op === 'ReserveWorldRetirement') {
        if (supplier === 'canvas') h.ctx.set('hanaworldsCanvasV5', createViewFixture())
        else h.ctx.set('hanaworldsWorldLifecycle', { ...h.lifecycle })
      }
      return response
    }
    const response = await h.request('/api-hanaworlds-worlds/delete', deletion)
    assert.equal(response.status, 409)
    assert.match(response.data.error, /REPLACED/)
    assert.doesNotMatch(response.data.error, /WORLD_RETIREMENT_RELEASE_FAILED/)
    assert.equal(h.canvas.requests.at(-1)!.request.outcome, 'ABORTED')
    assert.ok(!h.lifecycleRequests.some(r => r.operation === 'delete'))
  })
})

test('release failures expose the confirmed retirement outcome and preserve original deletion errors', async t => {
  for (const deleted of [true, false]) await t.test(String(deleted), async t => {
    const h = await setup(t), call = h.canvas.call
    let outcome: string | undefined
    h.canvas.call = async function (op: string, req: any) {
      if (op === 'ReleaseWorldRetirement') { outcome = req.outcome; throw new Error('RELEASE_FAILED') }
      return call.call(this, op, req)
    }
    if (!deleted) h.lifecycle.delete = async () => { throw new Error('WORLD_NOT_FOUND') }
    const response = await h.request('/api-hanaworlds-worlds/delete', deletion)
    assert.equal(response.status, 409)
    assert.equal(outcome, deleted ? 'RETIRED' : 'ABORTED')
    assert.match(response.data.error, /WORLD_RETIREMENT_RELEASE_FAILED.*RELEASE_FAILED/)
    if (!deleted) assert.match(response.data.error, /WORLD_NOT_FOUND/)
    assert.equal((await h.request('/api-hanaworlds-worlds/delete', deletion)).status, 409)
  })
})

test('a deletion receipt for a different world aborts retirement without permanently retiring the target', async t => {
  const h = await setup(t), remove = h.lifecycle.delete
  h.lifecycle.delete = async (req: unknown) => {
    const response = await remove(req)
    return { ...response, result: { ...response.result, worldRef: 'different-world' } }
  }
  const response = await h.request('/api-hanaworlds-worlds/delete', deletion)
  assert.equal(response.status, 409)
  assert.equal(response.data.error, 'CURRENT_WORLD_MISMATCH')
  assert.equal(h.canvas.requests.at(-1)!.request.outcome, 'ABORTED')
  const page = (await h.request('/api-hanaworlds-view/window', {})).data
  assert.equal((await h.request('/api-hanaworlds-worlds/connect', { ...page, sessionId: fixtureIds[0], worldId: deletion.worldId })).status, 200)
})

test('delete names missing suppliers and raw retirement operations remain gated', async t => {
  const h = await setup(t)
  await assert.rejects(h.canvas.call('ReserveWorldRetirement', { contractVersion: 'canvas/v7', requestId: 'raw-retirement',
    worldRef: 'fixture-world', expectedInventoryRevision: 'FIXTURE/inventory/1' }), /LOCAL_DISPATCH_REQUIRED/)
  h.ctx.set('hanaworldsWorldLifecycle', undefined as any)
  assert.match((await h.request('/api-hanaworlds-worlds/delete', deletion)).data.error, /ADAPTER_UNAVAILABLE/)
  h.ctx.set('hanaworldsWorldLifecycle', h.lifecycle)
  h.ctx.set('hanaworldsCanvasV5', undefined as any)
  assert.match((await h.request('/api-hanaworlds-worlds/delete', deletion)).data.error, /CANVAS_UNAVAILABLE/)
  assert.equal(h.lifecycleRequests.length, 0)
})

test('connect launches by lifecycle, selects Canvas and issues a distinct lease for each page window', async t => {
  const h = await setup(t)
  h.canvas.act(fixtureIds[0], 'disconnect')
  const a = (await h.request('/api-hanaworlds-view/window', {})).data
  const b = (await h.request('/api-hanaworlds-view/window', {})).data
  const connected = await h.request('/api-hanaworlds-worlds/connect', { ...a, sessionId: fixtureIds[0], worldId: 'fixture-world-id' })
  assert.equal(connected.status, 200, JSON.stringify(connected.data))
  assert.equal(connected.data.sessionId, fixtureIds[0])
  assert.equal(connected.data.localContext.worldRef, 'fixture-world')
  assert.equal(connected.data.noLiveBinding, false)
  assert.equal(h.lifecycleRequests.at(-1)!.operation, 'launch')
  assert.ok(h.canvas.requests.some(r => r.operation === 'SelectWorldConnection'))
  assert.equal((await h.request('/api-hanaworlds-view/read', { ...b, lease: connected.data.lease })).status, 409)
  const selected = await h.request('/api-hanaworlds-view/select', { ...b, sessionId: fixtureIds[0] })
  assert.equal(selected.status, 200)
  assert.notEqual(selected.data.lease, connected.data.lease)
  assert.equal((await h.request('/api-hanaworlds-view/read', { ...a, lease: connected.data.lease })).status, 200)
  h.canvas.act(fixtureIds[0], 'disconnect')
  const state = await h.request('/api-hanaworlds-worlds/context', { ...a, sessionId: fixtureIds[0] })
  assert.equal(state.status, 200)
  assert.equal(state.data.noLiveBinding, true)
  assert.equal(state.data.localContext, null)
  assert.equal(state.data.worldRef, 'fixture-world')
  assert.equal((await h.request('/api-hanaworlds-view/read', { ...a, lease: connected.data.lease })).status, 409)
})

test('connect rejects missing Core sessions and unknown window keys before launch', async t => {
  const h = await setup(t)
  const page = (await h.request('/api-hanaworlds-view/window', {})).data
  assert.equal((await h.request('/api-hanaworlds-worlds/connect', { ...page, sessionId: 'absent', worldId: 'fixture-world-id' })).status, 409)
  assert.equal((await h.request('/api-hanaworlds-worlds/connect', { windowKey: 'unknown', sessionId: fixtureIds[0], worldId: 'fixture-world-id' })).status, 404)
  assert.equal(h.lifecycleRequests.length, 0)
})

test('closing a page while launch is in flight prevents publication and Canvas selection', async t => {
  const h = await setup(t)
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const ready = new Promise<void>(resolve => { started = resolve })
  const launch = h.lifecycle.launch
  h.lifecycle.launch = async (request: unknown) => { started(); await gate; return launch(request) }
  const page = (await h.request('/api-hanaworlds-view/window', {})).data
  const connecting = h.request('/api-hanaworlds-worlds/connect', { ...page, sessionId: fixtureIds[0], worldId: 'fixture-world-id' })
  // A missing route fails immediately on the red run; do not await a launch that cannot happen.
  const available = await Promise.race([ready.then(() => true), connecting.then(() => false)])
  assert.equal(available, true)
  await h.request('/api-hanaworlds-view/close', page)
  release()
  assert.equal((await connecting).status, 409)
  assert.equal(h.canvas.requests.filter(r => r.operation === 'SelectWorldConnection').length, 0)
})

test('lifecycle refusals, changed suppliers and forged launch correlation publish no selection', async t => {
  const h = await setup(t)
  const page = (await h.request('/api-hanaworlds-view/window', {})).data
  const input = { ...page, sessionId: fixtureIds[0], worldId: 'fixture-world-id' }
  assert.equal((await h.request('/api-hanaworlds-worlds/connect', { ...input, connectionRef: 'forged' })).status, 400)
  const launch = h.lifecycle.launch
  h.lifecycle.launch = async (request: any) => ({ ...await launch(request), requestId: 'another-request' })
  assert.equal((await h.request('/api-hanaworlds-worlds/connect', input)).status, 409)
  assert.equal(h.canvas.requests.filter(r => r.operation === 'SelectWorldConnection').length, 0)
  h.lifecycle.launch = async () => { throw new Error('ADAPTER_UNAVAILABLE') }
  assert.match((await h.request('/api-hanaworlds-worlds/connect', input)).data.error, /ADAPTER_UNAVAILABLE/)
})

test('stop revokes the page lease and uses only the captured lifecycle connection', async t => {
  const h = await setup(t), window = (await h.request('/api-hanaworlds-view/window', {})).data
  const connected = await h.request('/api-hanaworlds-worlds/connect', { ...window, sessionId: fixtureIds[0], worldId: 'fixture-world-id' })
  const page = { ...window, lease: connected.data.lease }
  const result = await h.request('/api-hanaworlds-worlds/stop', page)
  assert.equal(result.status, 200)
  assert.equal(result.data.state, 'STOPPED')
  assert.equal(h.lifecycleRequests.at(-1)!.request.connectionRef, h.canvas.context(fixtureIds[0])!.connectionRef)
  assert.equal((await h.request('/api-hanaworlds-view/read', page)).status, 409)
})

test('a completed stop cannot clear a successor session selected in the same page', async t => {
  const h = await setup(t), window = (await h.request('/api-hanaworlds-view/window', {})).data
  const connected = await h.request('/api-hanaworlds-worlds/connect', { ...window, sessionId: fixtureIds[0], worldId: 'fixture-world-id' })
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const ready = new Promise<void>(resolve => { started = resolve })
  const stop = h.lifecycle.stop
  h.lifecycle.stop = async (request: unknown) => { started(); await gate; return stop(request) }
  const stopping = h.request('/api-hanaworlds-worlds/stop', { ...window, lease: connected.data.lease })
  await ready
  const successor = await h.request('/api-hanaworlds-view/select', { ...window, sessionId: fixtureIds[1] })
  assert.equal(successor.status, 200)
  release()
  assert.equal((await stopping).status, 200)
  assert.equal((await h.request('/api-hanaworlds-view/read', { ...window, lease: successor.data.lease })).status, 200)
})

test('replacing Canvas with identical context invalidates the old supplier lease', async t => {
  const h = await setup(t), binding = await h.bind()
  h.ctx.set('hanaworldsCanvasV5', { ...h.canvas, call: h.originalCanvasCall })
  assert.equal((await h.request('/api-hanaworlds-view/read', binding)).status, 409)
})

async function confirmedBuild(t: any) {
  const h = await setup(t, true, true)
  const page = (await h.request('/api-hanaworlds-view/window', {})).data
  const selected = await h.request('/api-hanaworlds-worlds/connect', { ...page, sessionId: fixtureIds[0], worldId: 'fixture-world-id' })
  assert.equal(selected.status, 200)
  const binding = { ...page, lease: selected.data.lease }
  assert.equal((await h.request('/api-hanaworlds-workshop/prepare', { ...binding, text: '造一间小屋' })).status, 200)
  assert.equal((await h.request('/api-hanaworlds-workshop/confirm', binding)).status, 200)
  const turn = h.workshop.snapshot(fixtureIds[0]).turns.at(-1)!
  return { ...h, binding, payload: { expectedTurnRevision: turn.turnRevision } }
}

test('build route publishes Canvas object and history panels only after the confirmed cell build', async t => {
  const h = await confirmedBuild(t)
  const before = await h.request('/api-hanaworlds-objects/list', h.binding)
  assert.equal(before.status, 200)
  assert.deepEqual(before.data.objects, [])
  const built = await h.request('/api-hanaworlds-build/advance', { ...h.binding, payload: h.payload })
  assert.equal(built.status, 200, JSON.stringify(built.data))
  assert.equal(built.data.result.result.outcome, 'VERIFIED')
  assert.equal(built.data.panels.objects.objects.length, 1)
  assert.equal(built.data.panels.histories[0].entries[0].transactionId, built.data.result.result.receipt.transactionId)
  assert.equal(built.data.panelError, null)
  const objectRef = built.data.panels.objects.objects[0].objectRef
  const history = await h.request('/api-hanaworlds-objects/history', { ...h.binding, objectRef })
  assert.equal(history.status, 200)
  assert.deepEqual(history.data, built.data.panels.histories[0])
  assert.deepEqual(h.buildFixture!.calls, ['ListObjects', 'AdvanceCurrentBuild', 'CreateObject', 'ListObjects', 'HistoryQuery', 'ListObjects', 'HistoryQuery'])
})

test('existing Workshop invoke build returns the same panel refresh without a second build', async t => {
  const h = await confirmedBuild(t)
  const built = await h.request('/api-hanaworlds-workshop/invoke', { ...h.binding,
    input: { operation: 'workshop', input: { operation: 'AdvanceCurrentBuild', payload: h.payload } } })
  assert.equal(built.status, 200, JSON.stringify(built.data))
  assert.equal(built.data.panels.objects.objects.length, 1)
  assert.equal(h.buildFixture!.calls.filter(op => op === 'AdvanceCurrentBuild').length, 1)
})

test('region advance uses the plugin Brush and Canvas region ports and returns both panels', async t => {
  const h = await confirmedBuild(t)
  const context = await h.request('/api-hanaworlds-region/context', { ...h.binding, payload: h.payload })
  assert.equal(context.status, 200, JSON.stringify(context.data))
  assert.deepEqual(context.data.result.localContext, { ...h.canvas.context(fixtureIds[0]) })
  const built = await h.request('/api-hanaworlds-region/advance', { ...h.binding, payload: h.payload })
  assert.equal(built.status, 200, JSON.stringify(built.data))
  assert.equal(built.data.result.receipt.status, 'VERIFIED')
  assert.equal(built.data.panels.objects.objects.length, 1)
  assert.equal(built.data.panels.histories[0].headTransactionId, built.data.result.receipt.transactionId)
  assert.ok(h.buildFixture!.calls.includes('CompileRegionBuild'))
  assert.ok(h.buildFixture!.calls.includes('ApplyRegionCommit'))
  await assert.rejects(h.buildFixture!.canvasRegion.call('ApplyRegionCommit', h.buildFixture!.region.commitRequest), /LOCAL_DISPATCH_REQUIRED/)
})

test('new routes reject caller association fields and foreign page leases before dispatch', async t => {
  const h = await confirmedBuild(t), fixture = h.buildFixture!
  for (const route of ['/api-hanaworlds-build/advance', '/api-hanaworlds-region/context', '/api-hanaworlds-region/advance']) {
    const start = fixture.calls.length
    assert.equal((await h.request(route, { ...h.binding, payload: { ...h.payload, worldRef: 'forged' } })).status, 400)
    assert.equal((await h.request(route, { ...h.binding, payload: h.payload, sessionRef: fixtureIds[1] })).status, 400)
    assert.equal((await h.request(route, { ...h.binding, payload: h.payload }, { cookie: '' })).status, 401)
    assert.equal((await h.request(route, { ...h.binding, payload: h.payload }, { origin: 'http://foreign.local' })).status, 403)
    const page = (await h.request('/api-hanaworlds-view/window', {})).data
    assert.equal((await h.request(route, { ...page, lease: h.binding.lease, payload: h.payload })).status, 409)
    assert.equal(fixture.calls.length, start)
  }
  assert.equal((await h.request('/api-hanaworlds-objects/list', { ...h.binding, worldRef: 'forged' })).status, 400)
  assert.equal((await h.request('/api-hanaworlds-objects/history', { ...h.binding, objectRef: 'foreign-object' })).status, 409)
  assert.ok(!fixture.calls.includes('HistoryQuery'))
})

test('panel failures preserve a verified mutation receipt and never repeat the build', async t => {
  const h = await confirmedBuild(t)
  h.buildFixture!.state.panelError = true
  const built = await h.request('/api-hanaworlds-build/advance', { ...h.binding, payload: h.payload })
  assert.equal(built.status, 200, JSON.stringify(built.data))
  assert.equal(built.data.result.result.receipt.status, 'VERIFIED')
  assert.equal(built.data.panels, null)
  assert.match(built.data.panelError, /FIXTURE_PANEL_UNAVAILABLE/)
  assert.equal(h.buildFixture!.calls.filter(op => op === 'AdvanceCurrentBuild').length, 1)
})

test('a Canvas panel refusal after a verified build keeps its whole error and never repeats or undoes the build', async t => {
  const h = await confirmedBuild(t)
  h.buildFixture!.state.panelRefusal = request => ({ contractVersion: 'canvas/v7', requestId: request.requestId, result: null,
    error: worldUnavailableError(request, canvasUnavailable, {}) })
  const built = await h.request('/api-hanaworlds-build/advance', { ...h.binding, payload: h.payload })
  assert.equal(built.status, 200, JSON.stringify(built.data))
  assert.equal(built.data.result.result.receipt.status, 'VERIFIED')
  assert.equal(built.data.panels, null)
  assert.equal(built.data.panelError, 'CAPABILITY_UNAVAILABLE')
  assert.deepEqual(built.data.panelContractError, { ...canvasUnavailable, worldRef: 'fixture-world' })
  const calls = h.buildFixture!.calls
  assert.equal(calls.filter(op => op === 'AdvanceCurrentBuild').length, 1)
  assert.ok(!calls.some(op => /Undo|Redo/.test(op)))
})

test('panels reject uncorrelated Canvas records and stale page leases', async t => {
  const h = await confirmedBuild(t)
  await h.request('/api-hanaworlds-build/advance', { ...h.binding, payload: h.payload })
  h.buildFixture!.state.corrupt = 'ListObjects'
  assert.equal((await h.request('/api-hanaworlds-objects/list', h.binding)).status, 409)
  h.buildFixture!.state.corrupt = 'HistoryQuery'
  assert.equal((await h.request('/api-hanaworlds-objects/history', { ...h.binding, objectRef: h.buildFixture!.objects[0].objectRef })).status, 409)
  h.buildFixture!.state.corrupt = ''
  const call = h.canvas.call
  h.canvas.call = async function(op: string, raw: any) {
    const result = await call.call(this, op, raw)
    if (op === 'ListObjects') h.ctx.hanaworldsDesktopBridge.views.clear(h.binding.windowKey)
    return result
  }
  assert.equal((await h.request('/api-hanaworlds-objects/list', h.binding)).status, 409)
})

test('region Adapter writes require a live Canvas region call and its exact session/world', async t => {
  const h = await confirmedBuild(t), fixture = h.buildFixture!
  await assert.rejects(fixture.adapterRegion.call('WriteRegion', fixture.region.writeRequest), /LOCAL_DISPATCH_REQUIRED/)
  h.workshop.advanceRegionBuild = async (request: any) => {
    await fixture.adapterRegion.call('WriteRegion', { ...fixture.region.writeRequest,
      sessionRef: request.sessionRef, localContext: request.localContext })
    return { sessionRef: request.sessionRef, worldRef: request.worldRef, error: null }
  }
  const built = await h.request('/api-hanaworlds-region/advance', { ...h.binding, payload: h.payload })
  assert.equal(built.status, 409)
  assert.match(built.data.error, /LOCAL_DISPATCH_REQUIRED/)
  assert.ok(!fixture.calls.includes('WriteRegion'))
})

test('replaced region suppliers and Painter/Brush ports cannot publish stale results', async t => {
  const h = await confirmedBuild(t), fixture = h.buildFixture!
  for (const [key, service, operation, payload] of [
    ['hanaworldsBrushV3', fixture.brush, 'CompileRegionBuild', fixture.region.compileRequest],
    ['hanaworldsPainterV2PictureBlocks', fixture.painter, 'ValidateRegionProposal', fixture.region.proposalRequest],
  ] as const) {
    const method = operation === 'CompileRegionBuild' ? 'compileRegion' : 'call'
    const original = (service as any)[method]
    ;(service as any)[method] = function(...args: any[]) {
      const result = original.apply(this, args)
      h.ctx.set(key as any, { ...service } as any)
      return result
    }
    const port = h.ctx.get(operation === 'CompileRegionBuild' ? 'hanaworldsBrushRegionV1' : 'hanaworldsPainterRegionV1')!
    await assert.rejects(port.call(operation, payload), /REGION_PEER_REPLACED/)
  }
})

test('region proposal routes current-view association through Workshop and the plugin Painter port', async t => {
  const h = await confirmedBuild(t), fixture = h.buildFixture!
  const request = structuredClone(fixture.region.proposalRequest)
  request.referenceBrief.sessionRef = fixtureIds[0]
  request.referenceBriefDigest = digestValue('reference-brief', request.referenceBrief).sha256
  request.intent.referenceBriefDigest = request.referenceBriefDigest
  request.intentDigest = digestValue('intent', request.intent).sha256
  fixture.painter.call = async (_op: string, input?: any) => ({ ...fixture.region.proposalResponse,
    requestId: input.requestId, result: { ...fixture.region.proposalResponse.result, invocationId: input.invocationId } })
  const { contractVersion, sessionRef, worldRef, localContext, invocationId, ...payload } = request
  const response = await h.request('/api-hanaworlds-region/proposal', { ...h.binding, payload })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  assert.equal(response.data.result.error, null)
  assert.equal((await h.request('/api-hanaworlds-region/proposal', { ...h.binding, payload: { ...payload, sessionRef } })).status, 400)
})

test('object panels refuse foreign nested worlds and a history for a different object', async t => {
  const h = await confirmedBuild(t)
  await h.request('/api-hanaworlds-build/advance', { ...h.binding, payload: h.payload })
  const call = h.canvas.call
  let foreign = 'world'
  h.canvas.call = async function(op: string, raw: any) {
    const response: any = await call.call(this, op, raw)
    if (op === 'ListObjects' && foreign === 'world') return { ...response,
      result: { ...response.result, objects: response.result.objects.map((o: any) => ({ ...o, worldRef: 'foreign-world' })) } }
    if (op === 'HistoryQuery' && foreign === 'object') return { ...response, result: { ...response.result, objectRef: 'foreign-object' } }
    return response
  }
  assert.equal((await h.request('/api-hanaworlds-objects/list', h.binding)).status, 409)
  foreign = 'object'
  assert.equal((await h.request('/api-hanaworlds-objects/history', { ...h.binding, objectRef: h.buildFixture!.objects[0].objectRef })).status, 409)
})

test('incompatible region capabilities are refused before reaching a world write', async t => {
  const h = await confirmedBuild(t), fixture = h.buildFixture!
  fixture.adapterRegion.protocolHandshake = { ...fixture.region.peerHandshake, capabilities: [] }
  const response = await h.request('/api-hanaworlds-region/advance', { ...h.binding, payload: h.payload })
  assert.equal(response.status, 409)
  assert.ok(!fixture.calls.includes('WriteRegion'))
  assert.equal(fixture.objects.length, 0)
})

test('unconfirmed or pending cell builds leave the Canvas panels unchanged', async t => {
  const h = await setup(t, true, true), binding = await h.bind()
  const payload = { expectedTurnRevision: 'unconfirmed-turn' }
  const refused = await h.request('/api-hanaworlds-build/advance', { ...binding, payload })
  assert.equal(refused.status, 200)
  assert.equal(refused.data.result.error.code, 'INTENT_UNCONFIRMED')
  assert.deepEqual(refused.data.panels.objects.objects, [])
  const confirmed = await confirmedBuild(t)
  confirmed.buildFixture!.state.mode = 'PENDING'
  const pending = await confirmed.request('/api-hanaworlds-build/advance', { ...confirmed.binding, payload: confirmed.payload })
  assert.equal(pending.status, 200)
  assert.equal(pending.data.result.result.outcome, 'PENDING')
  assert.deepEqual(pending.data.panels.objects.objects, [])
  assert.ok(!confirmed.buildFixture!.calls.includes('CreateObject'))
  assert.deepEqual((await confirmed.request('/api-hanaworlds-objects/panels', confirmed.binding)).data, pending.data.panels)
})

/** Published failure templates (hanaworlds-contracts fixtures/world-error) without their fixture world. */
const template = (title: string) => {
  const { worldRef: _world, ...error } = worldErrorFixture.exchanges.find(x => x.title === title)!.response.error!
  return error
}
const sessionUnavailable = template('no selector: provider resolves the trusted Session binding')
const canvasUnavailable = template('request worldRef names the target world')
/** A peer answering with a published failure whose target world it determines itself (request selector or its own binding). */
const refuse = (wire: string, error: object, trusted: () => Record<string, string>) => (request: any) =>
  ({ contractVersion: wire, requestId: request.requestId, result: null, error: worldUnavailableError(request, error, trusted()) })
/** A peer answering with exactly this raw error. */
const answer = (wire: string, error: unknown) => (request: any) => ({ contractVersion: wire, requestId: request.requestId, result: null, error })
const relay = (title: string) => relayFixture.relays.find(x => x.title === title)!
const rejected = (title: string) => relayFixture.rejected.find(x => x.title === title)!
const mutations = ['ApplyRecoverableCommit', 'ApplyRegionCommit', 'Undo', 'Redo', 'UndoRegionCommit', 'CreateObject',
  'AdvanceCurrentBuild', 'UndoCurrentBuild', 'AppendMultimodalTurn', 'AnswerClarification']
/** The whole failure path ran each refused operation exactly `times` and nothing that writes, undoes or redoes. */
function noWrites(h: { canvas: { requests: { operation: string }[] }; workshop: { requests: { operation: string }[] } }) {
  for (const { operation } of [...h.canvas.requests, ...h.workshop.requests]) assert.ok(!mutations.includes(operation), operation)
}
const count = (requests: { operation: string }[], operation: string) => requests.filter(r => r.operation === operation).length

test('Session refusal while selecting keeps each conversation\'s target world and mutationState through the real route', async t => {
  const h = await setup(t)
  h.workshop.failures.set('StartOrResumeSession', refuse('session/v5', sessionUnavailable, () => h.canvas.trusted()))
  const expected = relay('Session refusal while publishing a conversation names that conversation\'s world')
  for (const [index, id] of fixtureIds.entries()) {
    const page = (await h.request('/api-hanaworlds-view/window', {})).data
    const response = await h.request('/api-hanaworlds-view/select', { ...page, sessionId: id })
    assert.equal(response.status, expected.status)
    assert.deepEqual(response.data, { ...expected.body, contractError: { ...expected.body.contractError, worldRef: `FIXTURE/world/${index + 1}` } })
    assert.equal(response.data.contractError.mutationState, 'NONE')
    assert.equal(count(h.workshop.requests, 'StartOrResumeSession'), index + 1)
  }
  assert.deepEqual(h.workshop.requests.map(r => r.operation), ['StartOrResumeSession', 'StartOrResumeSession'])
  assert.equal(h.canvas.requests.length, 0)
})

test('Canvas refusal of panel reads keeps each conversation\'s and the switched current world through the real route', async t => {
  const h = await setup(t)
  const alpha = await h.bind(fixtureIds[0]), beta = await h.bind(fixtureIds[1])
  h.canvas.failures.set('ListObjects', refuse('canvas/v7', canvasUnavailable, () => h.canvas.trusted()))
  const expected = relay('Canvas refusal of a panel read names the bound world')
  const first = await h.request('/api-hanaworlds-objects/list', { windowKey: alpha.windowKey, lease: alpha.lease })
  assert.equal(first.status, expected.status)
  assert.deepEqual(first.data, expected.body)
  const second = await h.request('/api-hanaworlds-objects/list', { windowKey: beta.windowKey, lease: beta.lease })
  assert.deepEqual(second.data.contractError, { ...expected.body.contractError, worldRef: 'FIXTURE/world/2' })
  // Switch the first conversation; the refusal now names its new current world, never the previous one.
  const switched = await h.request('/api-hanaworlds-worlds/connect', { windowKey: alpha.windowKey, sessionId: fixtureIds[0], worldId: deletion.worldId })
  assert.equal(switched.status, 200, JSON.stringify(switched.data))
  const third = await h.request('/api-hanaworlds-objects/list', { windowKey: alpha.windowKey, lease: switched.data.lease })
  assert.equal(third.status, 409)
  assert.deepEqual(third.data.contractError, { ...expected.body.contractError, worldRef: switched.data.worldRef })
  assert.notEqual(switched.data.worldRef, 'FIXTURE/world/1')
  const history = await h.request('/api-hanaworlds-objects/history', { windowKey: beta.windowKey, lease: beta.lease, objectRef: 'FIXTURE/object/1' })
  assert.deepEqual(history.data.contractError, { ...expected.body.contractError, worldRef: 'FIXTURE/world/2' })
  assert.equal(count(h.canvas.requests, 'ListObjects'), 4)
  assert.equal(count(h.canvas.requests, 'HistoryQuery'), 0)
  noWrites(h)
})

test('Session refusal relayed by workshop invoke stays whole in its envelope', async t => {
  const h = await setup(t)
  const page = await h.bind(fixtureIds[0])
  h.workshop.failures.set('ReadCurrentUndoStatus', refuse('session/v5', sessionUnavailable, () => h.canvas.trusted()))
  const expected = relay('Session refusal returned whole through workshop invoke')
  const response = await h.request('/api-hanaworlds-workshop/invoke', { ...page,
    input: { operation: 'workshop', input: { operation: 'ReadCurrentUndoStatus', payload: {} } } })
  assert.equal(response.status, expected.status)
  assert.equal(response.data.result.result, null)
  assert.deepEqual(response.data.result.error, expected.error)
  assert.equal(count(h.workshop.requests, 'ReadCurrentUndoStatus'), 1)
  noWrites(h)
})

test('mismatched or malformed world errors are refused and pre-2.7 errors still relay', async t => {
  const h = await setup(t)
  const page = await h.bind(fixtureIds[0])
  // Selector-less Session read: the bridge's own binding for this conversation is FIXTURE/world/1.
  h.workshop.failures.set('StartOrResumeSession', answer('session/v5', { ...sessionUnavailable, worldRef: 'FIXTURE/world/2' }))
  const otherSession = rejected('Session error naming another world than the conversation\'s bound world')
  const reselect = await h.request('/api-hanaworlds-view/select', { windowKey: page.windowKey, sessionId: fixtureIds[0] })
  assert.equal(reselect.status, otherSession.status)
  assert.deepEqual(reselect.data, otherSession.body)
  h.workshop.failures.delete('StartOrResumeSession')
  const bound = await h.bind(fixtureIds[0])
  const list = (lease = bound) => h.request('/api-hanaworlds-objects/list', { windowKey: lease.windowKey, lease: lease.lease })
  h.canvas.failures.set('ListObjects', answer('canvas/v7', { ...canvasUnavailable, worldRef: 'FIXTURE/world/2' }))
  const otherCanvas = rejected('Canvas error naming another world than the request selected')
  const foreign = await list()
  assert.equal(foreign.status, otherCanvas.status)
  assert.deepEqual(foreign.data, otherCanvas.body)
  // Published malformed errors: empty/null/non-string world, world in reason, free message, path, stack, credential.
  const malformed = worldErrorFixture.reject.filter(x => !x.title.startsWith('another world'))
  assert.equal(malformed.length, 8)
  for (const example of malformed) {
    h.canvas.failures.set('ListObjects', answer('canvas/v7', example.response.error))
    const response = await list()
    assert.equal(response.status, 409, example.title)
    assert.equal(response.data.contractError, undefined, example.title)
    assert.equal(response.data.error.split('/')[0], example.code, example.title)
  }
  const legacy = relay('pre-2.7 Canvas error without a world still relays')
  h.canvas.failures.set('ListObjects', answer('canvas/v7', worldErrorFixture.legacy[0].response.error))
  const old = await list()
  assert.equal(old.status, legacy.status)
  assert.deepEqual(old.data, legacy.body)
  assert.ok(!('worldRef' in old.data.contractError))
  assert.equal(count(h.canvas.requests, 'ListObjects'), 2 + malformed.length)
  noWrites(h)
})
