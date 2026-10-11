/** U3: actual upstream WebServer + Connection authentication on this machine's loopback.
 * Only the credential store and world peers are isolated in-memory component doubles.
 * Never load ~/.dsh, real account credentials, a model or the default 3080 listener.
 */
import { request as httpRequest } from 'node:http'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import * as bridge from 'hanaworlds-desktop-bridge'
import { createViewFixture, fixtureIds } from './view-fixture.ts'
import { createWorkshopFixture } from './workshop-fixture.ts'

test('U3 real upstream authentication admits loopback page leases and rejects foreign origin, host and cookie', async t => {
  const ctx = new Context()
  const fibers: { dispose(): Promise<void> }[] = []
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose() })
  // The upstream creates its own disposable random signing record here. Its values are never printed.
  let record: any
  ctx.provide('credentials', { async modifyRecord(_key: unknown, mutate: (value: unknown) => Promise<unknown>) {
    const next = await mutate(record)
    if (next !== undefined) record = next
    return record
  } } as any)
  fibers.push(await ctx.plugin(SessionStore))
  fibers.push(await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }))
  fibers.push(await ctx.plugin(Connection))
  const canvas = createViewFixture()
  ctx.provide('hanaworldsCanvasV5', canvas)
  ctx.provide('hanaworldsWorkshop', createWorkshopFixture(canvas))
  ctx.sessions.create(SessionId(fixtureIds[0]))
  fibers.push(await ctx.plugin(bridge))
  const connection = ctx.connection
  const unregister = ctx.webServer.register({ kind: 'exact', path: '/', handler(req, res) {
    if (connection.authorizeIndex(req, res)) { res.statusCode = 200; res.end('isolated U3') }
  } })
  t.after(unregister)
  const base = `http://127.0.0.1:${ctx.webServer.port}`
  // Native fetch follows the normal launch-token -> signed-cookie exchange, only for this isolated host.
  const login = await fetch(connection.authenticatedUrl(base + '/'), { redirect: 'manual' })
  assert.equal(login.status, 303)
  assert.equal(login.headers.get('location'), './')
  const cookie = login.headers.get('set-cookie')!.split(';')[0]
  assert.match(login.headers.get('set-cookie')!, /HttpOnly/)
  assert.match(login.headers.get('set-cookie')!, /SameSite=Strict/)
  function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{status: number; data: any}> {
    // Native HTTP retains explicit Host test cases; Node fetch replaces Host with the URL's authority.
    return new Promise((resolve, reject) => {
      const request = httpRequest(base + path, { method: 'POST', headers: {
        origin: base, cookie, 'content-type': 'application/json', ...headers,
      } }, response => {
        const chunks: Buffer[] = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('error', reject)
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          resolve({ status: response.statusCode!, data: raw ? JSON.parse(raw) : null })
        })
      })
      request.on('error', reject)
      request.end(JSON.stringify(body))
    })
  }
  assert.equal((await post('/api-hanaworlds-view/window', {}, { cookie: '' })).status, 401)
  assert.equal((await post('/api-hanaworlds-view/window', {}, { cookie: 'invalid=invalid' })).status, 401)
  assert.equal((await post('/api-hanaworlds-view/window', {}, { origin: 'https://foreign.invalid' })).status, 403)
  assert.equal((await post('/api-hanaworlds-view/window', {}, { host: 'foreign.invalid', origin: 'http://foreign.invalid' })).status, 403)
  assert.equal((await post('/api-hanaworlds-view/window', {}, { host: '127.0.0.1:1', origin: 'http://127.0.0.1:1' })).status, 401)
  const page = await post('/api-hanaworlds-view/window', {})
  assert.equal(page.status, 200)
  const selected = await post('/api-hanaworlds-view/select', { ...page.data, sessionId: fixtureIds[0] })
  assert.equal(selected.status, 200, JSON.stringify(selected.data))
  const binding = { ...page.data, lease: selected.data.lease }
  assert.equal((await post('/api-hanaworlds-view/read', binding)).status, 200)
  await post('/api-hanaworlds-view/close', page.data)
  assert.equal((await post('/api-hanaworlds-view/read', binding)).status, 404)
  console.log(`U3 loopback=127.0.0.1 port=${ctx.webServer.port} root-login=303 authenticated-lease=200 no-cookie=401 bad-cookie=401 foreign-origin=403 foreign-host=403 other-authority=401 closed-page=404; upstream auth real, credentials/world peers isolated`)
})
