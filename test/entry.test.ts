import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

test('package exports a Cordis apply entry and contract verification script', async () => {
  assert.ok(existsSync(new URL('../src/index.ts', import.meta.url)), 'Cordis apply entry must exist')
  const plugin = await import('hanaworlds-desktop-bridge')
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(existsSync(new URL('../scripts/verify-contracts.mjs', import.meta.url)))
})
