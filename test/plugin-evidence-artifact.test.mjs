/** Q-243: real build/pack/strict consumer gates plus tampered artifact boundaries.
 * SOURCE/FIXTURE only. No App/real subscription or owner acceptance is implied.
 * The development copy is isolated because the companion test rebuilds the original lib.
 */
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
  console.log(`Q-243 artifact evidence: ${work}`)
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
  writeFileSync(join(consumer, 'plugin-evidence-probe.mjs'), installedProbe)
  const result = command('installed-evidence', process.execPath, ['plugin-evidence-probe.mjs'], consumer)
  succeeded(result, 'installed-evidence')
  const proof = json(join(consumer, 'plugin-evidence-proof.json'))
  assert.equal(proof.publicEntry, 'STRICT_INSTALLED_PACKAGE')
  assert.equal(proof.callbackVerified, true)
  assert.equal(proof.healthyVersion, '7.4.2-beta.8')
  assert.equal(proof.unauthorizedReads, 0)
  assert.ok(proof.reads.every(path => path.endsWith('/package.json')))
  assert.deepEqual(proof.cases, ['normal', 'unknown-request-path', 'builtin-unassociated',
    'malformed-manifest', 'missing-version', 'missing-own-manifest-no-host-fallback', 'restored'])
})

// Runs from the actual production consumer after normal pack/postpack's strict install.
// Only package exports and its resolved official dependencies are used; no source SDK or test helper imports.
const installedProbe = String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const bridgeURL=import.meta.resolve('hanaworlds-desktop-bridge');
const require=createRequire(bridgeURL);
assert.throws(()=>require.resolve('hanaworlds-contracts'),{code:'MODULE_NOT_FOUND'});
const {Context}=await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')));
const {Loader}=await import(pathToFileURL(require.resolve('@deepseek-ai/cordis-plugin-loader')));
const {SessionStore}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')));
const {WebServer}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-host-webserver')));
const ctx=new Context(), fibers=[], reads=[], cases=[];
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
await ctx.loader.create({id:'sample',name:pathToFileURL(join(own,'index.js')).href});
await ctx.loader.await();
for(const entry of ctx.loader.entries())await entry.fiber?.await();
const installed=fileURLToPath(bridgeURL);
const allowed=new Set([resolve(manifestPath),resolve(dirname(installed),'../package.json')]);
fs.readFileSync=function(path,...args){const result=nativeRead.call(this,path,...args);const absolute=resolve(path instanceof URL?path.pathname:String(path));reads.push(absolute);return result;};
syncBuiltinESMExports();
const actualEntry=ctx.loader.resolve('sample'), cache=ctx.loader.internal;
assert.ok(cache);
const moduleURL=pathToFileURL(join(own,'index.js')).href;
const loadedNamespace=cache.loadCache.get(moduleURL)?.module?.getNamespace();
assert.ok(loadedNamespace);
const callbackVerified=ctx.registry.resolve(ctx.loader.unwrapExports(loadedNamespace))===actualEntry.fiber.runtime.callback;
assert.equal(callbackVerified,true);
assert.equal(actualEntry.fiber.ctx.root,ctx.root);
const port=ctx.get('hanaworldsWorldInspectionContext');
const read=()=>port.ReadPluginEvidence({contractVersion:'world-inspection/v1',requestId:'installed'});
const row=result=>{assert.equal(result.error,null);const current=result.result.plugins.find(row=>row.entryId==='sample');assert.ok(current);return current;};
const healthy=row(await read());
assert.deepEqual(healthy.package,{name:'@fixture/installed-evidence',version:'7.4.2-beta.8'});
assert.deepEqual(healthy.contributions,{services:['artifactEvidence']});cases.push('normal');
let count=reads.length;
await assert.rejects(()=>port.ReadPluginEvidence({contractVersion:'world-inspection/v1',requestId:'bad',path:'/arbitrary/path'}),error=>error.publicError?.code==='UNKNOWN_REQUIRED_FIELD');
assert.equal(reads.length,count);cases.push('unknown-request-path');
const result=await read(), builtin=result.result.plugins.find(row=>row.entryId==='peers');
assert.equal(builtin.package,null);assert.equal(builtin.metadataError.code,'METADATA_UNAVAILABLE');cases.push('builtin-unassociated');
fs.writeFileSync(manifestPath,'{broken');
let current=row(await read());assert.equal(current.package,null);assert.equal(current.metadataError.code,'METADATA_UNAVAILABLE');cases.push('malformed-manifest');
fs.writeFileSync(manifestPath,JSON.stringify({name:'@fixture/installed-evidence',type:'module'}));
current=row(await read());assert.equal(current.package,null);assert.equal(current.metadataError.code,'METADATA_UNAVAILABLE');cases.push('missing-version');
fs.unlinkSync(manifestPath);
current=row(await read());assert.equal(current.package,null);assert.equal(current.metadataError.code,'METADATA_UNAVAILABLE');cases.push('missing-own-manifest-no-host-fallback');
fs.writeFileSync(manifestPath,original);
current=row(await read());assert.deepEqual(current.package,healthy.package);assert.equal(current.instanceRef,healthy.instanceRef);cases.push('restored');
const response=await fetch('http://127.0.0.1:'+ctx.webServer.port+'/api-hanaworlds-plugin-evidence',{headers:{origin:'http://fixture.local',cookie:'fixture=valid'}});
assert.equal(response.status,200);assert.deepEqual(row(await response.json()).package,healthy.package);
fs.readFileSync=nativeRead;syncBuiltinESMExports();
const unauthorizedReads=reads.filter(path=>!allowed.has(path)).length;
assert.equal(unauthorizedReads,0,'successful file reads must belong to the actual matched loaded modules');
assert.equal(peerCalls,0,'plugin evidence must not call peer world/session operations');
fs.writeFileSync('plugin-evidence-proof.json',JSON.stringify({publicEntry:'STRICT_INSTALLED_PACKAGE',callbackVerified,healthyVersion:healthy.package.version,unauthorizedReads,reads,cases},null,2));
}finally{
fs.readFileSync=nativeRead;syncBuiltinESMExports();
const loader=ctx.get('loader');if(loader)for(const entry of [...loader.entries()])await entry.fiber?.dispose();
for(const fiber of fibers.reverse())await fiber.dispose();
}
`;
