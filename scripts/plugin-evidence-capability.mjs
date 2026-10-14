/** Closed AST proof of the manifest capability, independent of archive filenames/digests.
 * The reviewed policy is data, never executed. Every transitive artifact declaration and
 * builtin binding used by the issuer/reader must match it; extra capability references,
 * aliases, shadowed globals and mutation of the proved declarations are refused.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const printer = ts.createPrinter({ removeComments: true })
export const syntax = node => printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile())
function declaration(node) {
  for (let current = node; current && !ts.isSourceFile(current); current = current.parent) {
    if (ts.isImportSpecifier(current)) return current
    if ((ts.isVariableDeclaration(current) && ts.isVariableStatement(current.parent?.parent)
      && ts.isSourceFile(current.parent.parent.parent))
      || (ts.isFunctionDeclaration(current) && ts.isSourceFile(current.parent))) return current
  }
}
function descriptor(node) {
  if (ts.isImportSpecifier(node)) return { name: node.name.text, binding: node.propertyName?.text ?? node.name.text,
    module: node.parent.parent.parent.moduleSpecifier.text }
  return { name: node.name.text, tree: syntax(node) }
}
export function capabilityGraph(files) {
  const program = ts.createProgram(files, { allowJs: true, noEmit: true, noLib: true, types: [],
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext })
  const checker = program.getTypeChecker(), units = files.map(path => program.getSourceFile(path))
  const roots = units.flatMap(sf => sf.statements.flatMap(statement => ts.isVariableStatement(statement)
    ? [...statement.declarationList.declarations].filter(d => d.name.getText(sf) === 'DesktopPluginEvidence') : []))
  assert.equal(roots.length, 1, 'manifest capability requires one complete loaded-instance issuer')
  const nodes = new Set(), queue = [...roots], imports = new Set()
  while (queue.length) {
    const node = queue.pop()
    if (nodes.has(node)) continue
    nodes.add(node)
    if (ts.isImportSpecifier(node)) { imports.add(node); continue }
    function visit(child) {
      if (ts.isIdentifier(child)) {
        let symbol = checker.getSymbolAtLocation(child)
        for (const item of symbol?.declarations ?? []) {
          let target = declaration(item)
          if (target && ts.isImportSpecifier(target) && target.parent.parent.parent.moduleSpecifier.text.startsWith('.')) {
            symbol = checker.getAliasedSymbol(checker.getSymbolAtLocation(target.name))
            target = declaration(symbol?.declarations?.[0])
            assert.ok(target, 'manifest metadata dependency must have an actual packed declaration')
          }
          if (target && files.includes(target.getSourceFile().fileName) && target !== node) queue.push(target)
        }
      }
      ts.forEachChild(child, visit)
    }
    visit(node)
  }
  return { units, checker, nodes, imports, descriptors: [...nodes].map(descriptor).sort((a,b) => a.name.localeCompare(b.name)) }
}
export function proveManifestCapability(files) {
  const graph = capabilityGraph(files)
  const policyPath = new URL('./plugin-evidence-policy.txt', import.meta.url)
  const policySource = ts.createSourceFile('policy.js', readFileSync(policyPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const policy = policySource.statements.flatMap(n => ts.isVariableStatement(n) ? [...n.declarationList.declarations]
    : ts.isFunctionDeclaration(n) ? [n] : ts.isImportDeclaration(n) ? [...n.importClause.namedBindings.elements] : [])
    .map(descriptor).sort((a,b) => a.name.localeCompare(b.name))
  assert.deepEqual(graph.descriptors, policy, 'manifest metadata/callback/instance capability closure differs from the reviewed AST proof')
  const approved = new Set(), resourceNames = new Set(['readFileSync', 'findPackageJSON', 'manifestScopes', 'packageIdentity'])
  for (const sf of graph.units) {
    function visit(node) {
      if (ts.isIdentifier(node)) {
        const symbol = graph.checker.getSymbolAtLocation(node)
        const definition = declaration(symbol?.declarations?.[0])
        if (definition && symbol.declarations[0] === definition && graph.nodes.has(definition)) {
          const owner = declaration(node)
          const isImport = owner && ts.isImportSpecifier(owner)
          const isExport = ts.isExportSpecifier(node.parent) && !resourceNames.has(definition.name.text)
          const isName = ts.isFunctionDeclaration(definition) && ts.isCallExpression(node.parent)
            && node.parent.expression.getText(sf) === '__name' && ts.isExpressionStatement(node.parent.parent)
            && node.parent.arguments[0] === node && ts.isStringLiteralLike(node.parent.arguments[1])
            && node.parent.arguments[1].text === definition.name.text
          const isCall = ts.isCallExpression(node.parent) && node.parent.expression === node
          const isConstruct = ts.isNewExpression(node.parent) && node.parent.expression === node
          assert.ok(graph.nodes.has(owner) || isImport || isExport || isName ||
            (!resourceNames.has(definition.name.text) && (isCall || isConstruct)),
          `manifest capability alias or mutation: ${node.getText(sf)}`)
          if (resourceNames.has(definition.name.text) && (graph.nodes.has(owner) || isImport)) approved.add(node)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  const dependencyImports = new Set([...graph.imports].filter(n => ['node:fs', 'node:module'].includes(n.parent.parent.parent.moduleSpecifier.text)))
  assert.deepEqual([...dependencyImports].map(descriptor).sort((a,b)=>a.name.localeCompare(b.name)), [
    {name:'findPackageJSON',binding:'findPackageJSON',module:'node:module'},
    {name:'readFileSync',binding:'readFileSync',module:'node:fs'},
  ], 'manifest capability builtin bindings must be exact')
  // The certificate permits only the closed reader/issuer slice, not an entire module.
  return { approved, dependencyImports }
}
