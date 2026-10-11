/** Copied into a fresh production consumer. No SDK or source imports. Peers are protocol-only doubles. */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import * as plugin from 'hanaworlds-desktop-bridge'
import relayFixture from 'hanaworlds-desktop-bridge/fixtures/world-error-relay' with {type:'json'}
const installedRequire = createRequire(import.meta.resolve('hanaworlds-desktop-bridge'))
const {Context} = await import(pathToFileURL(installedRequire.resolve('@deepseek-ai/cordis')))
const {SessionStore,SessionId} = await import(pathToFileURL(installedRequire.resolve('@deepseek-ai/dsh-session')))
const {WebServer} = await import(pathToFileURL(installedRequire.resolve('@deepseek-ai/dsh-host-webserver')))
assert.throws(()=>installedRequire.resolve('hanaworlds-contracts'), {code:'MODULE_NOT_FOUND'})
const equalPublic = (actual,expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify(expected)))
const data = JSON.parse(readFileSync(new URL('./probe-data.json',import.meta.url)))
const base = dirname(fileURLToPath(import.meta.resolve('hanaworlds-desktop-bridge')))
const entries = {}
for (const file of readdirSync(base).filter(p=>p.endsWith('.js'))) entries[file] = await import(pathToFileURL(join(base,file)))
assert.throws(()=>import.meta.resolve('hanaworlds-contracts'), {code:'ERR_MODULE_NOT_FOUND'})
const manifest = JSON.parse(readFileSync(join(base,'../package.json')))
assert.ok(!manifest.dependencies['hanaworlds-contracts'])
assert.ok(relayFixture.relays.length)
const {callLocal, RelayedContractError} = entries['local-protocol.js']
const publicError = {...relayFixture.relays[0].body.contractError,worldRef:'PROBE/world'}
const peer = {contractHandshake:data.handshake,async call(op,req) { return {contractVersion:req.contractVersion,requestId:req.requestId,result:null,error:publicError} }}
await assert.rejects(callLocal(peer,'canvas/v7','ReadWorldSelectionContext',{
  contractVersion:'canvas/v7',requestId:'probe-error',sessionRef:'probe-session',worldRef:'PROBE/world'}),error=>{
  assert.ok(error instanceof RelayedContractError);assert.equal(error.message,publicError.code);equalPublic({...error.publicError},publicError);return true
})
// Foreign provider errors are deliberately plain public envelopes, with no shared private constructor.
await assert.rejects(callLocal({...peer,async call(op,req){return {contractVersion:req.contractVersion,requestId:'foreign',result:null,error:publicError}}},
  'canvas/v7','ReadWorldSelectionContext',{contractVersion:'canvas/v7',requestId:'probe-error',sessionRef:'probe-session',worldRef:'PROBE/world'}))
const {DesktopDeploymentPolicy} = entries['deployment-policy.js']
const facts = {contractHandshake:data.handshake,async call(op,req) {return {contractVersion:req.contractVersion,requestId:req.requestId,
  result:{...data.profile,connection:{...data.profile.connection,worldRef:req.worldRef}},error:null}}}
const policy = new DesktopDeploymentPolicy({facts:()=>facts})
equalPublic(await policy.compiler('PROBE/world'),data.profile.compilationConfig)
equalPublic((await policy.describe('PROBE/world')).writeMethods.value,data.profile.writeMethods)
assert.throws(()=>policy.safety('not-confirmed'))
const {DesktopRegionPorts,regionInvariantRows} = entries['region-ports.js']
const painter = {protocolHandshake:()=>data.protocol,async call(op,r){return r}}
const region = new DesktopRegionPorts({painter:()=>painter,
  brush:()=>({protocolHandshake:()=>data.protocol,compileRegion:r=>r}),
  canvasRegion:()=>({protocolHandshake:data.protocol,async call(){}}),adapterRegion:()=>({protocolHandshake:data.protocol,async call(){}})})
assert.ok(region.status().every(r=>r.compatible));assert.ok(regionInvariantRows().length)
equalPublic(await region.painterPort().call('ValidateRegionProposal',{opaque:true}),{opaque:true})
await assert.rejects(region.painterPort().call('wrong',{}),/UNSUPPORTED_OPERATION/)
const ctx = new Context(), fibers = []
try {
  fibers.push(await ctx.plugin(SessionStore))
  fibers.push(await ctx.plugin(WebServer,{host:'127.0.0.1',port:0}))
  ctx.sessions.create(SessionId(data.sessionRef))
  ctx.provide('connection',{requestRejection:req=>req.headers.origin==='http://probe.local' && req.headers.cookie==='probe=valid' ? undefined : 403})
  ctx.provide('tools',{schemas:()=>[]});ctx.provide('skills',{async snapshot(){return {skills:[],complete:true}}})
  const peerFiber = await ctx.plugin({name:'PROBE/peers',apply(c) {
    const reply = (req,result,error=null) => ({contractVersion:req.contractVersion,requestId:req.requestId,result,error})
    c.provide('hanaworldsCanvasV5',{contractHandshake:data.handshake,async call(op,req){return reply(req,data.selection)}})
    c.provide('hanaworldsWorkshop',{contractHandshake:data.handshake,async call(op,req){return op==='StartOrResumeSession' ? reply(req,data.snapshot) : reply(req,null,{...publicError,worldRef:data.selection.selection.context.activeWorldRef})}});c.provide('hanaworldsWorldFacts',facts)
    c.provide('hanaworldsWorldLifecycle',{async describe(req){return {contractVersion:req.contractVersion,requestId:req.requestId,result:data.lifecycleDescription,error:null}}})
  }})
  peerFiber.entry={options:{name:'PROBE/peers'}};fibers.push(peerFiber)
  const fiber = await ctx.plugin(plugin);fibers.push(fiber)
  // Loader module identity is explicit; this tests real Cordis registrations, not a full official host launch.
  fiber.entry={options:{name:'hanaworlds-desktop-bridge'}}
  const request = async(path,authorized=true) => fetch(`http://127.0.0.1:${ctx.webServer.port}${path}`,{headers:authorized ? {origin:'http://probe.local',cookie:'probe=valid'}:{}})
  const candidates = await request('/api-hanaworlds-view/candidates')
  assert.equal(candidates.status,200);equalPublic((await candidates.json()).candidates,[data.sessionRef])
  assert.equal((await request('/api-hanaworlds-view/candidates',false)).status,403)
  equalPublic(await (await request('/api-hanaworlds-skill-tools')).json(),{tools:[],skills:{skills:[],complete:true}})
  equalPublic(await ctx.hanaworldsDesktopBridge.lifecycle.call('describe'),data.lifecycleDescription)
  const post = async(path,input) => fetch(`http://127.0.0.1:${ctx.webServer.port}${path}`,{method:'POST',headers:{origin:'http://probe.local',cookie:'probe=valid','content-type':'application/json'},body:JSON.stringify(input)})
  const page = await (await post('/api-hanaworlds-view/window',{})).json()
  const selected = await post('/api-hanaworlds-view/select',{...page,sessionId:data.sessionRef})
  assert.equal(selected.status,200)
  const binding = {...page,lease:(await selected.json()).lease}
  const refusal = await post('/api-hanaworlds-workshop/invoke',{...binding,input:{operation:'workshop',input:{operation:'ReadCurrentUndoStatus',payload:{}}}})
  assert.equal(refusal.status,200)
  equalPublic((await refusal.json()).result.error,{...publicError,worldRef:data.selection.selection.context.activeWorldRef})
  const stale = await post('/api-hanaworlds-workshop/invoke',{...binding,lease:'foreign',input:{operation:'workshop',input:{operation:'ReadCurrentUndoStatus',payload:{}}}})
  assert.equal(stale.status,409)
  const missing = await ctx.hanaworldsWorldInspectionContext.ReadInspectionContext({contractVersion:'world-inspection/v1',requestId:'probe-inspection',sessionRef:'missing',worldRef:'PROBE/world'})
  assert.equal(missing.error.code,'SESSION_NOT_FOUND')
  const roles = await ctx.hanaworldsWorldInspectionContext.ReadPluginRoles({contractVersion:'world-inspection/v1',requestId:'probe-roles'})
  assert.equal(roles.error,null);assert.ok(roles.result)
  await assert.rejects(ctx.hanaworldsDesktopBridge.lifecycle.call('delete',{}),/retirement gate required/)
  await fiber.dispose()
  assert.equal(ctx.get('hanaworldsDesktopBridge'),undefined)
  assert.equal((await request('/api-hanaworlds-view/candidates')).status,404)
} finally {for (const fiber of fibers.reverse()) await fiber.dispose()}
console.log(JSON.stringify({production:'PASS',runtimeArtifacts:Object.keys(entries).length,contractRuntime:'ABSENT',carrier:'REAL_CORDIS_CORE_SESSION_HTTP',peers:'PROTOCOL_DOUBLES',owner:'NOT_TESTED'}))
