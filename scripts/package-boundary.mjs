/** Normal pack lifecycle: prepack audits generated files; postpack checks the actual archive and consumer. */
import assert from 'node:assert/strict'
import { audit } from './artifact-audit.mjs'
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, copyFileSync, cpSync, unlinkSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir, homedir } from 'node:os'
import { contractHandshake, contractProtocols, regionCapabilities } from 'hanaworlds-contracts'
const root = fileURLToPath(new URL('../',import.meta.url))
const json = p=>JSON.parse(readFileSync(p,'utf8'))
const manifest = json(join(root,'package.json'))
if (process.argv.includes('--prepack') && process.env.npm_command === 'pack') {
  audit(root, true)
  console.log('prepack artifact boundary PASS')
} else {
  const runRoot = process.env.HANAWORLDS_BOUNDARY_RUN ?? mkdtempSync(join(tmpdir(),'hanaworlds-desktop-bridge-boundary-'))
  mkdirSync(runRoot,{recursive:true})
  const attempt = mkdtempSync(join(runRoot,'pack-'))
  const archiveName = `${manifest.name}-${manifest.version}.tgz`
  const tgz = process.argv.includes('--postpack')
    ? resolve(process.env.npm_config_pack_destination ?? root,archiveName)
    : join(attempt,archiveName)
  const env = {...process.env,npm_config_cache:process.env.npm_config_cache ?? join(homedir(),'.npm')}
  if (!process.argv.includes('--postpack')) {
    // postpack performs the complete check, including negatives; no lifecycle scripts are disabled.
    execFileSync('npm',['pack','--json','--pack-destination',attempt],{cwd:root,env,stdio:['ignore','pipe','inherit']})
    console.log(`package boundary complete: ${tgz}`)
  } else {
    assert.ok(existsSync(tgz),`actual npm archive missing: ${tgz}`)
    execFileSync('tar',['-xzf',tgz,'-C',attempt])
    const unpacked = join(attempt,'package'), result = audit(unpacked)
    const consumer = join(attempt,'production');mkdirSync(consumer)
    // The production graph starts with precisely this tgz and the same declared official dependencies.
    writeFileSync(join(consumer,'package.json'),JSON.stringify({name:'desktop-bridge-production-probe',private:true,type:'module',dependencies:{'hanaworlds-desktop-bridge':`file:${tgz}`}},null,2))
    writeFileSync(join(consumer,'empty.npmrc'),'')
    const cleanEnv = Object.fromEntries(['PATH','HOME','TMPDIR','SystemRoot'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))
    cleanEnv.npm_config_userconfig=join(consumer,'empty.npmrc')
    const pnpm = join(root,'node_modules/pnpm/bin/pnpm.cjs')
    assert.equal(execFileSync(process.execPath,[pnpm,'--version'],{env:cleanEnv,encoding:'utf8'}).trim(),'11.28.5')
    const install = spawnSync(process.execPath,[pnpm,'install','--prod'],{cwd:consumer,env:cleanEnv,encoding:'utf8'})
    writeFileSync(join(attempt,'production-install.log'),install.stdout+install.stderr)
    assert.equal(install.status,0,`pnpm 11.28.5 default-strict production install failed; see ${attempt}/production-install.log\n${install.stdout}${install.stderr}`)
    const replay = spawnSync(process.execPath,[pnpm,'install','--prod','--frozen-lockfile'],{cwd:consumer,env:cleanEnv,encoding:'utf8'})
    writeFileSync(join(attempt,'production-frozen-install.log'),replay.stdout+replay.stderr)
    assert.equal(replay.status,0,'production frozen-lock replay must succeed')
    const lock = readFileSync(join(consumer,'pnpm-lock.yaml'),'utf8')
    assert.ok(!/hanaworlds-contracts|git\+|github.com\/yzsnstotz\/hanaworlds-contracts/.test(lock),'production lock contains contracts/exotic dependency')
    const graph = execFileSync(process.execPath,[pnpm,'list','--prod','--depth','Infinity','--json'],{cwd:consumer,env:cleanEnv,encoding:'utf8'})
    assert.ok(!graph.includes('hanaworlds-contracts'),'production graph contains contracts')
    writeFileSync(join(attempt,'production-graph.json'),graph)
    copyFileSync(join(root,'scripts/production-probe.mjs'),join(consumer,'probe.mjs'))
    const facts = json(join(root,'node_modules/hanaworlds-contracts/fixtures/local/world-source-facts.json'))
    const lifecycle = json(join(root,'node_modules/hanaworlds-contracts/fixtures/local/world-lifecycle.json'))
    const {createViewFixture,fixtureIds} = await import('../test/view-fixture.ts')
    const {createWorkshopFixture} = await import('../test/workshop-fixture.ts')
    const canvas = createViewFixture(), workshop = createWorkshopFixture(canvas), sessionRef = fixtureIds[0]
    const selection = (await canvas.call('ReadWorldSelectionContext',{contractVersion:'canvas/v7',requestId:'probe-data',sessionRef,worldRef:canvas.context(sessionRef).worldRef})).result
    writeFileSync(join(consumer,'probe-data.json'),JSON.stringify({handshake:contractHandshake,sessionRef,selection,snapshot:workshop.snapshot(sessionRef),profile:facts.exchanges.find(e=>e.operation==='ReadWriteProfile').response.result,
      lifecycleDescription:lifecycle.exchanges.find(e=>e.operation==='describe').response.result,
      protocol:{profileVersion:'protocol-handshake/v1',component:'PROBE/peer',protocols:[...contractProtocols].sort((a,b)=>a.protocol < b.protocol ? -1 : a.protocol > b.protocol ? 1 : 0),capabilities:regionCapabilities.map(c=>c.id).sort(),provenance:{packageName:'PROBE/peer',packageVersion:'1.0.0',sourceRevision:null,artifactDigest:null}}}))
    const probe = spawnSync(process.execPath,['probe.mjs'],{cwd:consumer,env:cleanEnv,encoding:'utf8'})
    writeFileSync(join(attempt,'production-probe.log'),probe.stdout+probe.stderr)
    assert.equal(probe.status,0,`production capability probe failed: ${probe.stdout}${probe.stderr}`)
    // Actual malformed packages/loads must fail; these inputs are retained separately from normal installation.
    const negatives=[]
    const mutate = (name,change,pattern)=>{
      const dir=join(attempt,`negative-${name}`);cpSync(unpacked,dir,{recursive:true});change(dir)
      assert.throws(()=>audit(dir),pattern);negatives.push({name,static:'REJECTED'});return dir
    }
    const dependencyNegative = mutate('runtime-dependency',dir=>{const m=json(join(dir,'package.json'));m.dependencies['hanaworlds-contracts']=manifest.devDependencies['hanaworlds-contracts'];writeFileSync(join(dir,'package.json'),JSON.stringify(m))},/production contracts dependency/)
    const injection = join(attempt,'negative-production-dependency');mkdirSync(injection)
    cpSync(dependencyNegative,join(injection,'package'),{recursive:true})
    const negativeTgz=join(injection,'runtime-dependency.tgz')
    execFileSync('tar',['-czf',negativeTgz,'-C',injection,'package'])
    const negativeConsumer=join(injection,'consumer');mkdirSync(negativeConsumer)
    writeFileSync(join(negativeConsumer,'package.json'),JSON.stringify({name:'negative-consumer',private:true,dependencies:{'hanaworlds-desktop-bridge':`file:${negativeTgz}`}}))
    const denied=spawnSync(process.execPath,[pnpm,'install','--prod'],{cwd:negativeConsumer,env:cleanEnv,encoding:'utf8'})
    writeFileSync(join(injection,'install-failure.log'),denied.stdout+denied.stderr)
    assert.notEqual(denied.status,0,'contract runtime dependency must fail default strict installation')
    assert.match(denied.stdout+denied.stderr,/ERR_PNPM_EXOTIC_SUBDEP/,'failure must be the prohibited production Git subdependency')
    negatives.at(-1).install='ERR_PNPM_EXOTIC_SUBDEP'
    for (const [name,code,pattern] of [
      ['bare-value',"import 'hanaworlds-contracts';",/runtime contracts load/],
      ['package-import',"import '#contracts';",/runtime contracts load/],
      ['dynamic-import',"await import('hanaworlds-contracts');",/runtime contracts load/],
      ['opaque-loader',"const name = 'hanaworlds-contracts'; await import(name);",/dynamic runtime loader/],
      ['computed-resolve',"const loader = import.meta['resolve']; export const lazy = () => loader('hanaworlds-contracts');",/runtime loader value/],
      ['require-alias',"const loader = require; export const lazy = () => loader('hanaworlds-contracts');",/runtime loader value/],
      ['builtin-loader-alias',"const loader = process['getBuiltinModule']; export const lazy = () => loader('module');",/runtime loader value/],
      ['fs-alias',"import {readFileSync as read} from 'node:fs'; read('node_modules/hanaworlds-contracts/package.json');",/runtime filesystem/],
      ['require',"require('hanaworlds-contracts');",/runtime contracts load/],
      ['resolve',"import.meta.resolve('hanaworlds-contracts/package.json');",/runtime contracts load/],
      ['dynamic-resource',"import {readFileSync} from 'node:fs'; readFileSync(new URL('../node_modules/hanaworlds-contracts/schema.json',import.meta.url));",/external resource read|runtime URL|runtime filesystem/],
      ['unpacked-local',"import './missing-runtime.js';",/unpacked local dependency/],
    ]) {
      const dir=mutate(name,dir=>writeFileSync(join(dir,'lib/index.js'),code),pattern)
      if (['bare-value','dynamic-import','resolve','unpacked-local'].includes(name)) {
        const load=spawnSync(process.execPath,[join(dir,'lib/index.js')],{cwd:consumer,env:cleanEnv,encoding:'utf8'})
        assert.notEqual(load.status,0,`negative ${name} unexpectedly loaded`)
        writeFileSync(join(dir,'load-failure.log'),load.stdout+load.stderr)
        negatives.at(-1).load='FAILED_AS_REQUIRED'
      }
    }
    const lazyCode = "const resolveDependency = import.meta.resolve; export const lazySDK = () => resolveDependency('hanaworlds-contracts');"
    const lazy=mutate('lazy-loader-alias',dir=>{
      writeFileSync(join(dir,'lib/index.js'),lazyCode)
      // A normal rebuild would generate an authentic new artifact digest: test the loader rule, not stale hashes.
      const p=json(join(dir,'lib/build-provenance.json'))
      p.outputs.find(row=>row.path==='lib/index.js').sha256=createHash('sha256').update(lazyCode).digest('hex')
      writeFileSync(join(dir,'lib/build-provenance.json'),JSON.stringify(p))
    },/runtime loader value/)
    const lazyLoad=spawnSync(process.execPath,['--input-type=module','-e',`const m=await import(${JSON.stringify(join(lazy,'lib/index.js'))}); m.lazySDK()`],{cwd:consumer,env:cleanEnv,encoding:'utf8'})
    assert.notEqual(lazyLoad.status,0);assert.match(lazyLoad.stderr,/ERR_MODULE_NOT_FOUND.*|Cannot find package 'hanaworlds-contracts'/)
    writeFileSync(join(lazy,'load-failure.log'),lazyLoad.stdout+lazyLoad.stderr);negatives.at(-1).load='FAILED_AS_REQUIRED'
    mutate('wrong-source',dir=>{const p=json(join(dir,'lib/build-provenance.json'));p.contracts.sha='0'.repeat(40);writeFileSync(join(dir,'lib/build-provenance.json'),JSON.stringify(p))},/strictly deep-equal/)
    const chunk = /\.\/chunk-[A-Z0-9]+\.js/.exec(readFileSync(join(unpacked,'lib/index.js'),'utf8'))[0]
    const missing=mutate('missing-bundle',dir=>unlinkSync(join(dir,'lib',chunk)),/unpacked local dependency|ENOENT/)
    const missingLoad=spawnSync(process.execPath,[join(missing,'lib/index.js')],{cwd:consumer,env:cleanEnv,encoding:'utf8'})
    assert.notEqual(missingLoad.status,0);assert.ok(missingLoad.stderr.includes(chunk.slice(2)),'missing chunk must be the actual loader failure');writeFileSync(join(missing,'load-failure.log'),missingLoad.stdout+missingLoad.stderr)
    negatives.at(-1).load='FAILED_AS_REQUIRED'
    const proof={tgz,sha256:createHash('sha256').update(readFileSync(tgz)).digest('hex'),pnpm:'11.28.5',policies:'defaults; no overrides/hooks/allowlists/ignored scripts',runtime:result.runtime,negatives}
    writeFileSync(join(attempt,'boundary-proof.json'),JSON.stringify(proof,null,2))
    console.log(`actual tgz + strict pnpm production + ${result.runtime.length} runtime artifacts + ${negatives.length} negatives PASS; evidence ${attempt}`)
  }
}
