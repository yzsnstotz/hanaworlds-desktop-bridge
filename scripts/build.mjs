/** Reproducible runtime bundling from the exact released development supply. Host packages stay external. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, mkdirSync, copyFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
process.chdir(root)
const json = p => JSON.parse(readFileSync(p,'utf8'))
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex')
const manifest = json('package.json'), lock = json('package-lock.json')
const pin = 'git+https://github.com/yzsnstotz/hanaworlds-contracts.git#v2.9.0'
assert.equal(manifest.devDependencies['hanaworlds-contracts'], pin)
assert.equal(lock.packages[''].devDependencies['hanaworlds-contracts'], pin)
for (const section of ['dependencies','peerDependencies','optionalDependencies']) assert.ok(!manifest[section]?.['hanaworlds-contracts'])
const rows = execFileSync('git',['ls-remote','https://github.com/yzsnstotz/hanaworlds-contracts.git','refs/tags/v2.9.0','refs/tags/v2.9.0^{}'],{encoding:'utf8'}).trim().split('\n').map(r=>r.split(/\s+/))
const sha = (rows.find(r=>r[1].endsWith('^{}')) ?? rows.find(r=>r[1]==='refs/tags/v2.9.0'))?.[0]
assert.ok(sha)
const sdk = lock.packages['node_modules/hanaworlds-contracts']
assert.ok(['git+https://github.com/yzsnstotz/hanaworlds-contracts.git#', 'git+ssh://git@github.com/yzsnstotz/hanaworlds-contracts.git#'].some(prefix => sdk.resolved === prefix + sha), 'lock must resolve the exact official repository and published SHA')
assert.equal(sdk.version, '2.9.0')
assert.equal(sdk.dev, true)
assert.equal(json('node_modules/hanaworlds-contracts/package.json').version,'2.9.0')
// Delete only superseded generated files, never source or other worktrees.
mkdirSync('lib', {recursive:true})
for (const e of readdirSync('lib',{withFileTypes:true})) if (e.isFile()) unlinkSync(`lib/${e.name}`)
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.json'],{stdio:'inherit'})
const result = await build({entryPoints:readdirSync('lib').filter(p=>p.endsWith('.js')).map(p=>`lib/${p}`),
  bundle:true, splitting:true, format:'esm', platform:'node', target:'node24', outdir:'lib',
  external:Object.keys(manifest.dependencies), metafile:true, write:false, allowOverwrite:true, legalComments:'eof', keepNames:true})
for (const [p, detail] of Object.entries(result.metafile.inputs)) {
  assert.ok(p.startsWith('lib/') || p.startsWith('node_modules/hanaworlds-contracts/dist/') || p.startsWith('node_modules/canonicalize/'), `unexpected bundled implementation ${p}`)
}
mkdirSync('lib/licenses',{recursive:true})
for (const [source,target] of [
  ['node_modules/hanaworlds-contracts/LICENSE','contracts-MIT.txt'],
  ['node_modules/hanaworlds-contracts/NOTICE','contracts-NOTICE.txt'],
  ['node_modules/canonicalize/LICENSE','canonicalize-Apache-2.0.txt'],
]) copyFileSync(source, `lib/licenses/${target}`)
const inputs = Object.keys(result.metafile.inputs).sort().map(path=>({path, kind:path.startsWith('lib/') ? 'tsc-intermediate' : 'released-supply', sha256:hash(path)}))
const sources = readdirSync('src').filter(p=>p.endsWith('.ts')).sort().map(p=>({path:`src/${p}`,sha256:hash(`src/${p}`)}))
for (const file of result.outputFiles) writeFileSync(file.path,file.contents)
const outputs = Object.keys(result.metafile.outputs).sort().map(path=>({path,sha256:hash(path),
  imports:result.metafile.outputs[path].imports, inputs:result.metafile.outputs[path].inputs}))
writeFileSync('lib/build-provenance.json',JSON.stringify({format:1, contracts:{pin,version:sdk.version,resolved:sdk.resolved,sha},
  tools:{esbuild:json('node_modules/esbuild/package.json').version,typescript:json('node_modules/typescript/package.json').version},
  lockSha256:hash('package-lock.json'),sources,inputs,outputs},null,2)+'\n')
console.log(`bundled contracts v2.9.0 ${sha}; ${outputs.length} artifacts; official Host dependencies external`)
