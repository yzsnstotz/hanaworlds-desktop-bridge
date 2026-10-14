/** Q-243: real build/pack/strict consumer gates plus tampered artifact boundaries.
 * SOURCE/FIXTURE only. No App/real subscription or owner acceptance is implied.
 * The development copy is isolated because the companion test rebuilds the original lib.
 */
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { audit } from '../scripts/artifact-audit.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const scratch = fileURLToPath(new URL('../../tmp/', import.meta.url))
const oldNegatives = ['runtime-dependency', 'bare-value', 'package-import', 'dynamic-import',
  'opaque-loader', 'computed-resolve', 'require-alias', 'builtin-loader-alias', 'fs-alias',
  'require', 'resolve', 'dynamic-resource', 'unpacked-local', 'lazy-loader-alias', 'wrong-source', 'missing-bundle']
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
let work, source, baseline, manifest, readerFile, normalPack
const commands = []
function command(tag, executable, args, cwd = source) {
  const directory = join(work, tag)
  mkdirSync(directory, { recursive: true })
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, TMPDIR: work, npm_config_cache: join(scratch, 'npm-cache'),
      HANAWORLDS_BOUNDARY_RUN: join(directory, 'boundary') } })
  writeFileSync(join(directory, 'command.log'), (result.stdout ?? '') + (result.stderr ?? ''))
  commands.push({ tag, executable, args, status: result.status, signal: result.signal,
    log: join(directory, 'command.log') })
  writeFileSync(join(work, 'commands.json'), JSON.stringify(commands, null, 2) + '\n')
  return result
}
function succeeded(result, tag) {
  assert.equal(result.error, undefined, `${tag}: command could not start`)
  assert.equal(result.status, 0, `${tag} must pass its normal lifecycle; evidence ${join(work, tag, 'command.log')}`)
}

before(() => {
  mkdirSync(scratch, { recursive: true })
  work = mkdtempSync(join(scratch, 'plugin-evidence-artifact-'))
  source = join(work, 'development')
  mkdirSync(source)
  // Copy current working inputs, including changes not committed yet, without copying caches/credentials.
  for (const name of ['src', 'scripts', 'test', 'fixtures', 'types', 'tools', 'package.json',
    'package-lock.json', 'tsconfig.json', 'README.md', 'PROVENANCE.md', 'LICENSE']) {
    if (existsSync(join(root, name))) cpSync(join(root, name), join(source, name), { recursive: true })
  }
  succeeded(command('development-install', 'npm', ['ci', '--ignore-scripts', '--cache', join(scratch, 'npm-cache')]),
    'development-install')
  // This creates genuine compiled outputs for static mutation fixtures, without claiming a normal tgz.
  succeeded(command('compile-fixture', process.execPath, ['scripts/build.mjs']), 'compile-fixture')
  manifest = json(join(source, 'package.json'))
  baseline = join(work, 'compiled-artifact')
  mkdirSync(baseline)
  for (const name of ['lib', 'fixtures', 'package.json', 'README.md', 'PROVENANCE.md', 'LICENSE']) {
    cpSync(join(source, name), join(baseline, name), { recursive: true })
  }
  const files = readdirSync(join(baseline, 'lib')).filter(name => name.endsWith('.js')
    && /from ["']node:fs["']/.test(readFileSync(join(baseline, 'lib', name), 'utf8')))
  assert.equal(files.length, 1, 'locate the actual bundled manifest reader, independent of chunk filename')
  readerFile = join('lib', files[0])
  const probePath = join(work, 'installed-probe-syntax.mjs')
  writeFileSync(probePath, installedProbe())
  succeeded(command('installed-probe-syntax', process.execPath, ['--check', probePath], work),
    'installed-probe-syntax')
  console.log(`Q-257 artifact evidence: ${work}`)
})

// Serialized unchanged into BOTH preparation and strict business modes. The preparation
// mode mounts real Loader modules and exercises these exact binding/state/instance checks.
function verifiedLoadedScope(ctx, cache, definition, states) {
  const entry = [...ctx.loader.entries()].find(entry => entry.id === definition.id)
  if (!entry || entry.disabled || !entry.fiber) return null
  const fiber = entry.fiber, module = cache.loadCache.get(definition.url)?.module
  assert.ok(module); assert.equal(module.url, definition.url)
  const callback = ctx.registry.resolve(ctx.loader.unwrapExports(module.getNamespace()))
  assert.equal(callback, fiber.runtime.callback); assert.equal(fiber.ctx.root, ctx.root)
  assert.equal(fiber.entry, entry)
  assert.ok([states.ACTIVE, states.FAILED].includes(fiber.state))
  return { ...definition, entry, fiber, callback, uid: fiber.uid, state: fiber.state }
}

test('execution-level probe preparation verifies resolved dependencies and real Loader ACTIVE/FAILED/current instances', () => {
  const path = join(source, 'test', 'installed-probe-preparation.mjs')
  writeFileSync(path, installedProbe())
  succeeded(command('probe-preparation', process.execPath, [path, '--preparation-only']), 'probe-preparation')
  const proof = json(join(source, 'probe-preparation-proof.json'))
  assert.equal(proof.mode, 'DEVELOPMENT_PREPARATION_ONLY')
  assert.equal(proof.businessReadPerformed, false)
  assert.deepEqual(proof.states, { active: 2, failed: 3 })
  assert.deepEqual(proof.checks, ['dependencies', 'unloaded-entry-null-no-reads', 'active-scope', 'failed-scope', 'disabled-revoked', 'new-current-instance'])
  assert.ok(Object.values(proof.dependencies).every(path => path.startsWith(source + '/node_modules/')))
  assert.deepEqual(proof.unloadedEntry, { id: 'sample', exists: false, scope: null, reads: [] })
})
test('execution-level preparation exposes the erased-enum binding regression before business pack gates', () => {
  const healthy = command('probe-preparation-control', process.execPath,
    [join(source, 'test', 'installed-probe-preparation.mjs'), '--preparation-only'])
  succeeded(healthy, 'probe-preparation-control')
  const path = join(source, 'test', 'installed-probe-erased-enum.mjs')
  const code = installedProbe()
  assert.ok(code.includes('const FiberState={ACTIVE:2,FAILED:3};'))
  writeFileSync(path, code.replace('const FiberState={ACTIVE:2,FAILED:3};', 'const FiberState=cordis.FiberState;'))
  const rejected = command('probe-preparation-erased-enum', process.execPath, [path, '--preparation-only'])
  assert.equal(rejected.error, undefined)
  assert.equal(rejected.status, 1)
  assert.match(rejected.stderr, /TypeError: Cannot read properties of undefined .*ACTIVE/)
})

test('execution preparation detects the original missing-entry resolve regression without creating sample', () => {
  const control = join(source, 'test', 'missing-entry-control.mjs')
  const code = installedProbe()
  writeFileSync(control, code)
  succeeded(command('missing-entry-control', process.execPath, [control, '--preparation-only']), 'missing-entry-control')
  const lookup = 'const entry = [...ctx.loader.entries()].find(entry => entry.id === definition.id)'
  assert.ok(code.includes(lookup), 'the regression must reach the same shared scope helper')
  const broken = join(source, 'test', 'missing-entry-resolve-regression.mjs')
  writeFileSync(broken, code.replace(lookup, 'const entry = ctx.loader.resolve(definition.id)'))
  const rejected = command('missing-entry-resolve-regression', process.execPath, [broken, '--preparation-only'])
  assert.equal(rejected.error, undefined)
  assert.equal(rejected.status, 1)
  assert.match(rejected.stderr, /Error: cannot resolve entry sample/)
})

// This same observer is serialized into the strict installed probe below. Every invocation
// is recorded before native I/O; observation never substitutes a value or swallows an exception.
function createReadObserver(nativeRead, classify) {
  const reads = []
  return { reads, read: function(path, ...args) {
    const attempt = { authorized: false, outcome: 'ATTEMPTED' }
    reads.push(attempt)
    try { Object.assign(attempt, classify(path)) }
    catch { attempt.observationError = 'UNCLASSIFIABLE_PATH' }
    try {
      const result = Reflect.apply(nativeRead, this, [path, ...args])
      attempt.outcome = 'SUCCESS'
      Object.defineProperty(attempt, 'originalResult', { value: result })
      return result
    } catch (error) {
      attempt.outcome = 'FAILED'
      Object.defineProperty(attempt, 'originalError', { value: error })
      attempt.failure = { name: error.name, message: error.message, code: error.code ?? null }
      throw error
    }
  } }
}
function assertOwnedReads(reads) {
  assert.equal(reads.filter(row => !row.authorized || row.outcome === 'ATTEMPTED').length, 0,
    'all read attempts, including failed native I/O, must belong to the current verified instance: '
      + JSON.stringify(reads))
}

test('read observer preserves the real successful return and records owned attempts', () => {
  const path = join(work, 'observer-own-package.json')
  writeFileSync(path, '{"name":"observer-own"}')
  const observer = createReadObserver(readFileSync, path => ({ path: resolve(path), authorized: true }))
  const value = observer.read(path)
  assert.ok(Buffer.isBuffer(value))
  assert.equal(value, observer.reads[0].originalResult, 'return the identical native Buffer')
  assert.equal(observer.reads[0].outcome, 'SUCCESS')
  assertOwnedReads(observer.reads)
})
test('read observer detects forbidden real ENOENT attempts even when the caller swallows the native error', () => {
  const allowed = join(work, 'observer-own-package.json')
  // Each missing path is real filesystem I/O, not an injected exception or a mocked metadata reader.
  const forbidden = ['host/package.json', 'other-plugin/package.json',
    'node_modules/hanaworlds-contracts/schema.json', 'arbitrary.txt']
  const observer = createReadObserver(readFileSync, path => ({ path: resolve(path),
    authorized: resolve(path) === allowed }))
  for (const relative of forbidden) {
    const path = join(work, 'observer-forbidden', relative)
    let caught
    try { observer.read(path, 'utf8') } catch (error) { caught = error }
    const attempt = observer.reads.at(-1)
    assert.ok(caught)
    assert.equal(caught, attempt.originalError, 'rethrow the identical native exception')
    assert.equal(caught.code, 'ENOENT')
    assert.deepEqual(attempt.failure, { name: caught.name, message: caught.message, code: caught.code })
    assert.equal(attempt.path, path)
    assert.equal(attempt.outcome, 'FAILED')
    assert.equal(attempt.authorized, false)
  }
  assert.equal(observer.reads.length, forbidden.length, 'no failed attempt disappears')
  assert.throws(() => assertOwnedReads(observer.reads), /all read attempts/)
})

test('read observer also detects a forbidden real permission failure without changing the exception', () => {
  const path = join(work, 'observer-permission-denied.json')
  writeFileSync(path, '{}')
  chmodSync(path, 0)
  const observer = createReadObserver(readFileSync, path => ({ path: resolve(path), authorized: false }))
  try {
    let caught
    try { observer.read(path, 'utf8') } catch (error) { caught = error }
    assert.ok(caught, 'the actual native read must fail on the unreadable fixture')
    const attempt = observer.reads[0]
    assert.equal(caught, attempt.originalError)
    assert.equal(caught.code, 'EACCES')
    assert.equal(attempt.failure.code, caught.code)
    assert.equal(attempt.outcome, 'FAILED')
    assert.equal(observer.reads.length, 1)
    assert.throws(() => assertOwnedReads(observer.reads), /all read attempts/)
  } finally { chmodSync(path, 0o600) }
})

test('the normal compiled artifact permits only the validated loaded-instance manifest reader', () => {
  assert.doesNotThrow(() => audit(baseline), 'Q-243 requires the guarded manifest capability to pass the original audit')
})
test('normal npm run build preserves prepack/postpack and default strict production gates', () => {
  succeeded(command('normal-build', 'npm', ['run', 'build']), 'normal-build')
})
test('normal explicit prepack still exercises the complete archive gate', () => {
  succeeded(command('normal-prepack', 'npm', ['run', 'prepack']), 'normal-prepack')
})
test('normal npm pack produces the real archive without skipping lifecycle scripts', () => {
  const destination = join(work, 'normal-pack', 'archive')
  mkdirSync(destination, { recursive: true })
  normalPack = command('normal-pack', 'npm', ['pack', '--json', '--pack-destination', destination])
  succeeded(normalPack, 'normal-pack')
  assert.ok(existsSync(join(destination, `${manifest.name}-${manifest.version}.tgz`)))
})

function normalProof() {
  assert.ok(normalPack, 'normal pack must actually have been run')
  succeeded(normalPack, 'normal-pack')
  const boundary = join(work, 'normal-pack', 'boundary')
  const proofs = readdirSync(boundary).map(name => join(boundary, name, 'boundary-proof.json')).filter(existsSync)
  assert.equal(proofs.length, 1, 'one successful current normal-pack receipt')
  return { proof: json(proofs[0]), attempt: dirname(proofs[0]) }
}
test('normal strict installed consumer retains every original tampered-package negative gate', () => {
  const { proof, attempt } = normalProof()
  assert.equal(proof.pnpm, '11.28.5')
  assert.equal(proof.policies, 'defaults; no overrides/hooks/allowlists/ignored scripts')
  assert.deepEqual(proof.negatives.filter(row => oldNegatives.includes(row.name)).map(row => row.name).sort(),
    [...oldNegatives].sort(), 'all original negatives remain; additive negative coverage is allowed')
  assert.ok(proof.negatives.every(row => row.static === 'REJECTED'))
  assert.equal(proof.negatives.find(row => row.name === 'runtime-dependency').install, 'ERR_PNPM_EXOTIC_SUBDEP')
  const graph = readFileSync(join(attempt, 'production-graph.json'), 'utf8')
  assert.ok(!graph.includes('hanaworlds-contracts'))
  assert.match(readFileSync(join(attempt, 'production-probe.log'), 'utf8'), /"production":"PASS"/)
  assert.ok(existsSync(join(attempt, 'production-frozen-install.log')))
})

function changed(code, pattern, replacement) {
  assert.match(code, pattern, 'mutation must actually reach the current compiled code')
  return code.replace(pattern, replacement)
}
const mutations = [
  ['non-manifest-file', code => changed(code, /(["'])package\.json\1/, '"schema.json"')],
  ['arbitrary-path-in-approved-reader', code => code + '\nexport const arbitraryRead = path => readFileSync(path, "utf8");\n'],
  ['fs-alias-in-approved-reader', code => code + '\nconst aliasRead = readFileSync; export const aliasLeak = path => aliasRead(path);\n'],
  ['sdk-resource-in-approved-reader', code => code + '\nexport const sdkLeak = () => readFileSync("node_modules/hanaworlds-contracts/schema.json", "utf8");\n'],
  ['foreign-package-version', code => code + '\nexport const borrowVersion = () => readFileSync("node_modules/other-plugin/package.json", "utf8");\n'],
  ['host-package-version', code => code + '\nexport const borrowHost = path => readFileSync(path + "/package.json", "utf8");\n'],
  ['dynamic-loader', code => code + '\nexport const evaluateForMetadata = requested => import(requested);\n'],
  ['loader-service-reimport', code => code + '\nexport const reimportForMetadata = ctx => ctx.loader.import("other-plugin");\n'],
  ['removed-callback-check', code => changed(code,
    /if\s*\(!callback\s*\|\|\s*callback\s*!==\s*row\.fiber\.runtime\?\.callback\)/, 'if (false)')],
  ['removed-disabled-check', code => changed(code, /entry\.disabled\s*\|\|/, '')],
]
for (const [name, mutate] of mutations) {
  test(`actual tampered tgz rejects ${name}; digest refresh cannot authorize a filesystem capability`, () => {
    const directory = join(work, `negative-${name}`), packed = join(directory, 'package')
    mkdirSync(directory)
    cpSync(baseline, packed, { recursive: true })
    const path = join(packed, readerFile), code = mutate(readFileSync(path, 'utf8'))
    writeFileSync(path, code)
    // Recompute the archive output hash so the desired refusal is the boundary, not a stale digest.
    const provenancePath = join(packed, 'lib/build-provenance.json'), provenance = json(provenancePath)
    const output = provenance.outputs.find(row => row.path === readerFile.replaceAll('\\', '/'))
    assert.ok(output)
    output.sha256 = hash(code)
    writeFileSync(provenancePath, JSON.stringify(provenance, null, 2) + '\n')
    const archive = join(directory, 'tampered.tgz'), extracted = join(directory, 'extracted')
    execFileSync('tar', ['-czf', archive, '-C', directory, 'package'])
    mkdirSync(extracted)
    execFileSync('tar', ['-xzf', archive, '-C', extracted])
    // A rejected normal reader cannot prove that an added unguarded reader is isolated.
    assert.doesNotThrow(() => audit(baseline), 'normal manifest capability must work before negative specificity is meaningful')
    assert.throws(() => audit(join(extracted, 'package')),
      /runtime filesystem|external resource read|runtime URL|runtime loader|manifest|metadata|callback|instance/)
  })
}

test('the real strictly installed public entry reads only owned manifests and diagnoses missing/bad/unassociated metadata', () => {
  const { attempt } = normalProof()
  const consumer = join(attempt, 'production')
  writeFileSync(join(consumer, 'plugin-evidence-probe.mjs'), installedProbe())
  const result = command('installed-evidence', process.execPath, ['plugin-evidence-probe.mjs'], consumer)
  succeeded(result, 'installed-evidence')
  const proof = json(join(consumer, 'plugin-evidence-proof.json'))
  assert.equal(proof.publicEntry, 'STRICT_INSTALLED_PACKAGE')
  assert.equal(proof.callbackVerified, true)
  assert.equal(proof.healthyVersion, '7.4.2-beta.8')
  assert.equal(proof.unauthorizedReads, 0)
  assertOwnedReads(proof.reads)
  assert.ok(proof.reads.every(row => row.path.endsWith('/package.json') && row.ownerEntryId
    && row.callbackVerified && row.rootVerified && Number.isInteger(row.fiberUid)
    && typeof row.instanceRef === 'string' && row.instanceRef.length > 0))
  assert.ok(proof.reads.some(row => row.phase === 'missing-own-manifest-no-host-fallback'
    && row.ownerEntryId === 'sample' && row.outcome === 'FAILED' && row.failure.code === 'ENOENT'))
  assert.deepEqual(proof.cases, ['builtin-unassociated', 'normal', 'unknown-request-path',
    'malformed-manifest', 'missing-version', 'missing-own-manifest-no-host-fallback', 'restored'])
  assert.deepEqual(proof.httpCases, ['builtin-unassociated', 'normal', 'malformed-manifest',
    'missing-version', 'missing-own-manifest-no-host-fallback', 'restored'])
})

// Runs from the actual production consumer after normal pack/postpack's strict install.
// Only package exports and its resolved official dependencies are used; no source SDK or test helper imports.
function installedProbe() { return String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const bridgeURL=import.meta.resolve('hanaworlds-desktop-bridge');
const require=createRequire(bridgeURL);
const preparation=process.argv[2]==='--preparation-only';
assert.ok(process.argv.length===2 || (process.argv.length===3 && preparation));
if(!preparation)assert.throws(()=>require.resolve('hanaworlds-contracts'),{code:'MODULE_NOT_FOUND'});
const cordis=await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')));
const {Context}=cordis;
// Fixed Cordis 4.0.4 src/fiber.ts:147-154 const enum, erased at runtime. Same values as the original 22 tests.
const FiberState={ACTIVE:2,FAILED:3};
const {Loader}=await import(pathToFileURL(require.resolve('@deepseek-ai/cordis-plugin-loader')));
const {SessionStore}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')));
const {WebServer}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-host-webserver')));
${createReadObserver.toString()}
${assertOwnedReads.toString()}
${verifiedLoadedScope.toString()}
if(preparation){
  const dependencies=Object.fromEntries(['@deepseek-ai/cordis','@deepseek-ai/cordis-plugin-loader',
    '@deepseek-ai/dsh-session','@deepseek-ai/dsh-host-webserver'].map(name=>[name,require.resolve(name)]));
  for(const binding of [Context,Loader,SessionStore,WebServer])assert.equal(typeof binding,'function');
  const checks=['dependencies'], ctx=new Context(), fibers=[];
  let unloadedEntry;
  const base=fs.mkdtempSync(join(process.cwd(),'probe-preparation-fixtures-'));
  fs.writeFileSync(join(base,'package.json'),JSON.stringify({type:'module'}));
  fs.writeFileSync(join(base,'active.js'),'export function apply(c){c.provide("preparationEvidence",{})}');
  fs.writeFileSync(join(base,'failed.js'),'export function apply(){throw new Error("PREPARATION_FAILED_FIXTURE")}');
  const active={id:'active',url:pathToFileURL(join(base,'active.js')).href,path:join(base,'package.json')};
  const failed={id:'failed',url:pathToFileURL(join(base,'failed.js')).href,path:join(base,'package.json')};
  try{
    fibers.push(await ctx.plugin(Loader,{baseUrl:pathToFileURL(base+'/').href}));
    const cache=ctx.loader.internal;assert.ok(cache);
    const missing={...active,id:'sample'};
    assert.equal([...ctx.loader.entries()].some(entry=>entry.id==='sample'),false);
    // Prove the real API throws, then exercise the shared enumerable lookup. No sample
    // entry is created; neither the helper nor its observer swallows the Loader exception.
    assert.throws(()=>ctx.loader.resolve('sample'),/cannot resolve entry sample/);
    const nativeRead=fs.readFileSync;
    const observer=createReadObserver(nativeRead,path=>({path:String(path),authorized:false}));
    fs.readFileSync=observer.read;syncBuiltinESMExports();
    try{
      const scope=verifiedLoadedScope(ctx,cache,missing,FiberState);
      assert.equal(scope,null);assert.equal(observer.reads.length,0);
      unloadedEntry={id:'sample',exists:false,scope,reads:observer.reads};
      checks.push('unloaded-entry-null-no-reads');
    }finally{fs.readFileSync=nativeRead;syncBuiltinESMExports();}
    await ctx.loader.create({id:active.id,name:active.url});await ctx.loader.await();
    await ctx.loader.resolve('active').fiber.await();
    const scope=verifiedLoadedScope(ctx,cache,active,FiberState);
    assert.equal(scope.state,FiberState.ACTIVE);checks.push('active-scope');
    await ctx.loader.create({id:failed.id,name:failed.url});await ctx.loader.await();
    await assert.rejects(()=>ctx.loader.resolve('failed').fiber.await(),/PREPARATION_FAILED_FIXTURE/);
    const failedScope=verifiedLoadedScope(ctx,cache,failed,FiberState);
    assert.equal(failedScope.state,FiberState.FAILED);checks.push('failed-scope');
    await scope.entry.update({disabled:true});
    assert.equal(verifiedLoadedScope(ctx,cache,active,FiberState),null);checks.push('disabled-revoked');
    await scope.entry.update({disabled:false});await ctx.loader.await();await scope.entry.fiber.await();
    const current=verifiedLoadedScope(ctx,cache,active,FiberState);
    assert.notEqual(current.fiber,scope.fiber);assert.notEqual(current.uid,scope.uid);
    assert.equal(current.state,FiberState.ACTIVE);checks.push('new-current-instance');
    fs.writeFileSync('probe-preparation-proof.json',JSON.stringify({mode:'DEVELOPMENT_PREPARATION_ONLY',
      businessReadPerformed:false,dependencies,unloadedEntry,states:{active:scope.state,failed:failedScope.state},checks},null,2));
  }finally{
    const loader=ctx.get('loader');if(loader)for(const entry of [...loader.entries()])await entry.fiber?.dispose();
    for(const fiber of fibers.reverse())await fiber.dispose();
    fs.rmSync(base,{recursive:true,force:true});
  }
}else{
const ctx=new Context(), fibers=[], reads=[], cases=[], httpCases=[];
const protocolData=JSON.parse(fs.readFileSync('probe-data.json','utf8'));
let peerCalls=0;
const fixtureRoot=join(process.cwd(),'evidence-fixtures'), own=join(fixtureRoot,'plugin');
fs.mkdirSync(own,{recursive:true});
const manifestPath=join(own,'package.json');
const original=JSON.stringify({name:'@fixture/installed-evidence',version:'7.4.2-beta.8',type:'module'});
fs.writeFileSync(manifestPath,original);
fs.writeFileSync(join(fixtureRoot,'package.json'),JSON.stringify({name:'host-version-must-not-be-borrowed',version:'99.0.0',type:'module'}));
fs.writeFileSync(join(own,'index.js'),'export const name="misleading-name"; export function apply(c){c.provide("artifactEvidence",{})}');
const nativeRead=fs.readFileSync;
try {
fibers.push(await ctx.plugin(SessionStore));
fibers.push(await ctx.plugin(WebServer,{host:'127.0.0.1',port:0}));
ctx.provide('connection',{requestRejection(req){if(req.headers.origin!=='http://fixture.local')return 403;if(req.headers.cookie!=='fixture=valid')return 401;}});
fibers.push(await ctx.plugin(Loader,{baseUrl:pathToFileURL(fixtureRoot+'/').href}));
ctx.loader.builtins.peers={apply(c){
const peer={source:'FIXTURE',contractHandshake:protocolData.handshake,async call(){peerCalls++;throw new Error('UNEXPECTED_WORLD_OR_SESSION_CALL');}};
c.provide('hanaworldsCanvasV5',peer);c.provide('hanaworldsWorkshop',peer);
}};
await ctx.loader.create({id:'peers',name:'cordis:peers'});
await ctx.loader.create({id:'bridge',name:bridgeURL});
await ctx.loader.await();
for(const entry of ctx.loader.entries())await entry.fiber?.await();
const installed=fileURLToPath(bridgeURL), cache=ctx.loader.internal;
assert.ok(cache);
const moduleURL=pathToFileURL(join(own,'index.js')).href;
// These roots are independently known from the fixture and the installed archive, never
// derived from a bridge response or from a basename allowlist. Namespace/instance matching
// is repeated before every actual read, including an ENOENT attempt.
const definitions=[{id:'bridge',url:bridgeURL,path:resolve(dirname(installed),'../package.json')},
  {id:'sample',url:moduleURL,path:resolve(manifestPath)}];
const scopeFor=definition=>verifiedLoadedScope(ctx,cache,definition,FiberState);
const port=ctx.get('hanaworldsWorldInspectionContext');
const row=(result,id='sample')=>{
  assert.equal(result.error,null);
  const current=result.result.plugins.find(row=>row.entryId===id);assert.ok(current);return current;
};
let healthyBridge;
async function observed(phase,call){
  const scopes=definitions.map(scopeFor).filter(Boolean);
  const observer=createReadObserver(nativeRead,path=>{
    const absolute=typeof path==='string'?resolve(path):path instanceof URL?resolve(fileURLToPath(path)):
      Buffer.isBuffer(path)?resolve(path.toString()):null;
    const owner=scopes.find(scope=>scope.path===absolute);
    const current=owner && ctx.loader.resolve(owner.id);
    const currentModule=owner && cache.loadCache.get(owner.url)?.module;
    const callbackVerified=!!owner && currentModule?.url===owner.url
      && ctx.registry.resolve(ctx.loader.unwrapExports(currentModule.getNamespace()))===owner.callback;
    const rootVerified=!!owner && owner.fiber.ctx.root===ctx.root;
    const authorized=!!owner && current===owner.entry && !current.disabled
      && current.fiber===owner.fiber && owner.fiber.entry===current && owner.uid!==null && owner.fiber.uid===owner.uid && owner.fiber.state===owner.state
      && callbackVerified && rootVerified;
    return {path:absolute,phase,authorized,ownerEntryId:owner?.id??null,
      fiberUid:owner?.uid??null,callbackVerified,rootVerified};
  });
  fs.readFileSync=observer.read;syncBuiltinESMExports();
  try {
    const result=await call();
    for(const read of observer.reads)read.instanceRef=result.result?.plugins
      .find(row=>row.entryId===read.ownerEntryId)?.instanceRef??null;
    return result;
  }
  finally {
    fs.readFileSync=nativeRead;syncBuiltinESMExports();reads.push(...observer.reads);
    fs.writeFileSync('plugin-evidence-read-attempts.json',JSON.stringify(reads,null,2));
    assertOwnedReads(observer.reads);
  }
}
async function check(phase){
  const direct=await observed(phase,()=>port.ReadPluginEvidence({contractVersion:'world-inspection/v1',requestId:'installed'}));
  const bridge=row(direct,'bridge');assert.ok(bridge.package);assert.equal(bridge.metadataError,null);
  if(healthyBridge)assert.deepEqual(bridge.package,healthyBridge.package);else healthyBridge=bridge;
  const response=await observed(phase+'-http',async()=>{
    const response=await fetch('http://127.0.0.1:'+ctx.webServer.port+'/api-hanaworlds-plugin-evidence',
      {headers:{origin:'http://fixture.local',cookie:'fixture=valid'}});
    assert.equal(response.status,200);return response.json();
  });
  assert.deepEqual(row(response,'bridge').package,healthyBridge.package);
  assert.deepEqual(response.result.plugins,direct.result.plugins);httpCases.push(phase);
  return direct;
}
// Isolate the unassociated builtin before the sample is loaded: only the verified bridge
// manifest is authorized, so even a swallowed failed sample/host/SDK/arbitrary read is rejected.
const unassociated=await check('builtin-unassociated'), builtin=row(unassociated,'peers');
assert.equal(builtin.package,null);assert.equal(builtin.metadataError.code,'METADATA_UNAVAILABLE');
assert.deepEqual(unassociated.result.plugins.map(row=>row.entryId).sort(),['bridge','peers']);
cases.push('builtin-unassociated');
await ctx.loader.create({id:'sample',name:moduleURL});await ctx.loader.await();
await ctx.loader.resolve('sample').fiber.await();
const healthy=row(await check('normal'));
assert.deepEqual(healthy.package,{name:'@fixture/installed-evidence',version:'7.4.2-beta.8'});
assert.deepEqual(healthy.contributions,{services:['artifactEvidence']});cases.push('normal');
const count=reads.length;
await assert.rejects(()=>observed('unknown-request-path',()=>port.ReadPluginEvidence({
  contractVersion:'world-inspection/v1',requestId:'bad',path:'/arbitrary/path'})),
  error=>error.publicError?.code==='UNKNOWN_REQUIRED_FIELD');
assert.equal(reads.length,count);cases.push('unknown-request-path');
fs.writeFileSync(manifestPath,'{broken');
let current=row(await check('malformed-manifest'));
assert.equal(current.package,null);assert.equal(current.metadataError.code,'METADATA_UNAVAILABLE');cases.push('malformed-manifest');
fs.writeFileSync(manifestPath,JSON.stringify({name:'@fixture/installed-evidence',type:'module'}));
current=row(await check('missing-version'));
assert.equal(current.package,null);assert.equal(current.metadataError.code,'METADATA_UNAVAILABLE');cases.push('missing-version');
fs.unlinkSync(manifestPath);
current=row(await check('missing-own-manifest-no-host-fallback'));
assert.equal(current.package,null);assert.equal(current.metadataError.code,'METADATA_UNAVAILABLE');
assert.ok(reads.some(read=>read.phase==='missing-own-manifest-no-host-fallback' && read.ownerEntryId==='sample'
  && read.outcome==='FAILED' && read.failure.code==='ENOENT'),'the missing own manifest attempt is visible');
cases.push('missing-own-manifest-no-host-fallback');
fs.writeFileSync(manifestPath,original);
current=row(await check('restored'));assert.deepEqual(current.package,healthy.package);
assert.equal(current.instanceRef,healthy.instanceRef);cases.push('restored');
const callbackVerified=reads.length>0 && reads.every(read=>read.callbackVerified);
const unauthorizedReads=reads.filter(read=>!read.authorized).length;
assertOwnedReads(reads);assert.equal(unauthorizedReads,0);
assert.equal(peerCalls,0,'plugin evidence must not call peer world/session operations');
fs.writeFileSync('plugin-evidence-proof.json',JSON.stringify({publicEntry:'STRICT_INSTALLED_PACKAGE',callbackVerified,healthyVersion:healthy.package.version,unauthorizedReads,reads,cases,httpCases},null,2));
}finally{
fs.readFileSync=nativeRead;syncBuiltinESMExports();
const loader=ctx.get('loader');if(loader)for(const entry of [...loader.entries()])await entry.fiber?.dispose();
for(const fiber of fibers.reverse())await fiber.dispose();
}
}
`; }
