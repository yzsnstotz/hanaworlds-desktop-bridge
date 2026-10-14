/** Audit the actual npm archive, not the source tree. */
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { builtinModules } from 'node:module'
import ts from 'typescript'
import { proveManifestCapability } from './plugin-evidence-capability.mjs'
const json = p => JSON.parse(readFileSync(p, 'utf8'))
const walk = p => readdirSync(p, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(p, e.name)) : [join(p, e.name)])
const builtins = new Set(builtinModules.flatMap(n => [n, `node:${n}`]))
export function audit(pkg, beforePack = false) {
  pkg = resolve(pkg)
  const manifest = json(join(pkg, 'package.json'))
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    assert.ok(!Object.keys(manifest[section] ?? {}).some(n => n === 'hanaworlds-contracts'), `production contracts dependency: ${section}`)
  }
  assert.equal(manifest.devDependencies['hanaworlds-contracts'], 'git+https://github.com/yzsnstotz/hanaworlds-contracts.git#v2.9.0')
  const files = beforePack ? [...walk(join(pkg, 'lib')), ...walk(join(pkg, 'fixtures'))] : walk(pkg)
  if (!beforePack) for (const p of files) assert.ok(!/(?:^|\/)(?:src|node_modules|test|schemas)(?:\/|$)/.test(relative(pkg,p)), `development repository content shipped: ${p}`)
  const runtime = files.filter(p => /\.(?:js|mjs|cjs)$/.test(p))
  let proof
  let units = new Map()
  function target(s, from, declaration) {
    assert.ok(!s.startsWith('hanaworlds-contracts') && !s.startsWith('#contracts'), `runtime contracts load: ${s}`)
    assert.ok(!['node:fs','fs','node:fs/promises','fs/promises','node:module','module'].includes(s)
      || (declaration && ts.isImportDeclaration(declaration) && declaration.importClause?.namedBindings
        && ts.isNamedImports(declaration.importClause.namedBindings) && declaration.importClause.namedBindings.elements.length === 1
        && proof?.dependencyImports.has(declaration.importClause.namedBindings.elements[0])), `runtime filesystem or module-loader dependency: ${s}`)
    if (builtins.has(s)) return
    if (s.startsWith('.')) {
      const p = resolve(dirname(from), s)
      assert.ok(p.startsWith(pkg + '/') && existsSync(p), `unpacked local dependency: ${s} in ${from}`)
    } else if (s.startsWith('#')) {
      assert.ok(typeof manifest.imports?.[s] === 'string', `unresolved package import: ${s}`)
      target(manifest.imports[s], join(pkg, 'package.json'))
    } else {
      const name = s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]
      assert.ok(Object.hasOwn(manifest.dependencies ?? {}, name) || Object.hasOwn(manifest.peerDependencies ?? {}, name), `undeclared runtime dependency: ${s}`)
    }
  }
  // Resolve the ordinary archive dependency graph first. Capability proof must not
  // hide the original missing-bundle/contracts/opaque-loader admission failures.
  for (const p of runtime) {
    const sf = ts.createSourceFile(p, readFileSync(p, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    function dependencies(n) {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) {
        const s = n.moduleSpecifier.text
        if (!['node:fs', 'node:module'].includes(s)) target(s, p)
      }
      if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
        ['require','require.resolve','import.meta.resolve','__require','process.getBuiltinModule'].includes(n.expression.getText(sf)))) {
        assert.ok(n.arguments.length && ts.isStringLiteralLike(n.arguments[0]), `dynamic runtime loader in ${p}`)
        target(n.arguments[0].text,p)
      }
      ts.forEachChild(n, dependencies)
    }
    dependencies(sf)
  }
  proof = proveManifestCapability(runtime)
  units = new Map([...proof.dependencyImports].map(n => [n.getSourceFile().fileName, n.getSourceFile()]))
  for (const p of runtime) {
    const sf = units.get(p) ?? ts.createSourceFile(p, readFileSync(p, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    function visit(n) {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) target(n.moduleSpecifier.text, p, n)
      if (ts.isCallExpression(n)) {
        const fn = n.expression.getText(sf)
        if (n.expression.kind === ts.SyntaxKind.ImportKeyword || ['require', 'require.resolve', 'import.meta.resolve'].includes(fn) || fn === '__require' || fn === 'process.getBuiltinModule') {
          assert.ok(n.arguments.length && ts.isStringLiteralLike(n.arguments[0]), `dynamic runtime loader: ${fn} in ${p}`)
          target(n.arguments[0].text, p)
        }
        assert.ok(!/(?:^|\.)(?:readFile(?:Sync)?|createReadStream|createRequire)$/.test(fn) || proof.approved.has(n.expression), `external resource read: ${fn} in ${p}`)
      }
      if (ts.isNewExpression(n) && n.expression.getText(sf) === 'URL') {
        assert.ok(n.arguments?.length === 2 && ts.isStringLiteralLike(n.arguments[1]) && /^https?:/.test(n.arguments[1].text), `runtime URL resource lookup in ${p}`)
      }
      if (ts.isCallExpression(n) && (ts.isPropertyAccessExpression(n.expression) || ts.isElementAccessExpression(n.expression))) {
        const key = ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text
          : ts.isStringLiteralLike(n.expression.argumentExpression) ? n.expression.argumentExpression.text : undefined
        assert.ok(key !== 'import', `runtime loader reimport in ${p}`)
      }
      // Taking a loader as a value defeats call-site matching and may stay dormant during import probes.
      // This plugin embeds its resources and has no runtime import.meta or loader-factory use.
      assert.ok(!ts.isMetaProperty(n), `runtime loader value: import.meta in ${p}`)
      if (ts.isIdentifier(n) && ['require','__require','eval','Function','createRequire'].includes(n.text)) {
        const direct = ts.isCallExpression(n.parent) && n.parent.expression === n && ['require','__require'].includes(n.text)
        assert.ok(direct, `runtime loader value: ${n.text} in ${p}`)
      }
      if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
        const key = ts.isPropertyAccessExpression(n) ? n.name.text : ts.isStringLiteralLike(n.argumentExpression) ? n.argumentExpression.text : undefined
        assert.ok(!['require','createRequire','getBuiltinModule','eval','Function'].includes(key), `runtime loader value: ${key} in ${p}`)
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  function exports(value, key = '') {
    if (typeof value === 'string') {
      if (key === 'types') { assert.ok(existsSync(join(pkg, value))); return }
      if (value.includes('*')) {
        const [prefix, suffix] = value.split('*')
        assert.ok(files.some(p => `./${relative(pkg,p)}`.startsWith(prefix) && p.endsWith(suffix)), `empty export: ${value}`)
      } else assert.ok(existsSync(join(pkg, value)), `missing export: ${value}`)
    } else for (const [k,v] of Object.entries(value ?? {})) exports(v,k)
  }
  exports(manifest.exports)
  for (const [name,v] of Object.entries(manifest.imports ?? {})) {
    assert.ok(!name.startsWith('#contracts'), `runtime contracts package import: ${name}`)
    const visitTarget = value => { if (typeof value === 'string') target(value, join(pkg,'package.json')); else for (const child of Object.values(value ?? {})) visitTarget(child) }
    visitTarget(v)
  }
  for (const key of ['main', 'module', 'types']) if (manifest[key]) exports(manifest[key], key)
  const provenance = json(join(pkg, 'lib/build-provenance.json'))
  const sourceLock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)))
  assert.deepEqual(provenance.contracts, {pin: manifest.devDependencies['hanaworlds-contracts'], version: '2.9.0',
    resolved: sourceLock.packages['node_modules/hanaworlds-contracts'].resolved,
    sha: sourceLock.packages['node_modules/hanaworlds-contracts'].resolved.split('#').at(-1)})
  for (const row of provenance.outputs) {
    assert.equal(createHash('sha256').update(readFileSync(join(pkg,row.path))).digest('hex'), row.sha256, `artifact digest mismatch: ${row.path}`)
  }
  assert.equal(runtime.length, provenance.outputs.length, 'every shipped JS artifact must be accounted for')
  for (const file of ['contracts-MIT.txt','contracts-NOTICE.txt','canonicalize-Apache-2.0.txt']) assert.ok(existsSync(join(pkg,'lib/licenses',file)))
  return { manifest, runtime: runtime.map(p => relative(pkg,p)) }
}
