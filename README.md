# hanaworlds-desktop-bridge

Server bridge extracted from `hanaworlds-desktop@bd964cdf`. Load the compiled package as a Cordis plugin; its named `apply(ctx)` reuses the host webServer, login boundary and Core Sessions. It does not start Electron or its own DSH application.

```sh
npm ci --ignore-scripts
npm run verify:contracts
npm test
npm run typecheck
```

`npm test` first builds the exported `lib/index.js` entry. Run `npm run build` before installing the plugin in a host. Node >=24.13.1 is required.

The published dependency is pinned to `hanaworlds-contracts#v2.3.0`. The verifier checks the public tag against the lock's commit, the installed SDK version/handshake, and correlated session/v5, canvas/v7 and world-lifecycle/v2 fixture roundtrips. The fixtures under `test/` are explicit component peers adapted from the source workshop/view fixtures. Their model and persistence are simulated; HTTP, Cordis and Core Session are real.

## Composition services

Required: `webServer`, `connection` (the host's `requestRejection` login and Host/Origin boundary), `sessions`, `hanaworldsWorkshop` (session/v5), `hanaworldsCanvasV5` (canvas/v7). These names identify existing service registrations; their historical suffixes do not select wire versions.

Lifecycle consumer: `hanaworldsWorldLifecycle`, implementing the released `WorldLifecyclePort` methods. All lifecycle operations use `world-lifecycle/v2`; `delete` is accessible only through the bridge's name confirmation and Canvas retirement gate. Missing lifecycle methods return `ADAPTER_UNAVAILABLE`. Templates, names, prerequisites and opaque creationFacts come from the source. The create route returns creationFacts unchanged for the skill's input; it interprets no source setting.

Optional consumers: `agents`, `sessionController`, `sessionPersistence` for standard human prompt submission and durable Core inputs; `attachments` for images; `hanaworldsWorldAdapterV6`, `hanaworldsWorldFacts`, `hanaworldsWorldRevisionOracle`, `hanaworldsCompilerConfig`, and the existing Painter/Brush/Canvas/Adapter region services. Missing suppliers produce named gaps. The plugin does not launch a model, choose a model/provider, generate engine configuration or invent material data.

The skill-tools route requires the host's `tools` and `skills` registries. Each GET returns `{tools: ctx.tools.schemas(), skills: await ctx.skills.snapshot()}` from the global registry view, including the skill snapshot's `complete` flag. This read-only display uses provider-owned descriptions and schemas; it does not execute tools, load skill bodies, or call Workshop/region services. Missing registries return `TOOLS_REGISTRY_UNAVAILABLE` or `SKILLS_REGISTRY_UNAVAILABLE`; discovery errors propagate without a substitute catalog. Tool and skill providers own their engine-neutral vocabulary: opaque material references, neutral orientation values, and geometry/partition facts declared by the current world source.

Prepare and Confirm submit only user input to the host's `sessionController.prompt` for the selected Core Session. The host owns that Session's provider, model and reasoning effort; model changes between submissions remain effective. The bridge does not register `hanaworldsModelRoute`, override `agent/request`, or select a fallback when host prompt admission fails. This routing delegation was already present in the desktop-bridge-01 composition; desktop-bridge-02 adds regression coverage for model changes, separate Session selections and host rejection.

Providers: `hanaworldsDesktopBridge` (transport, view bindings, confirmations, image reader and deployment policy), `hanaworldsCatalogue`, `hanaworldsSafetyProfile`, `hanaworldsCapabilities`, `hanaworldsWorldInspectionContext`, `hanaworldsPainterLocalFacts`, `hanaworldsMediaAuthority`. Painter/Brush region ports are provided only when the peer publishes the corresponding methods and handshake. Fiber unload removes services/routes, invalidates active view handles, and restores wrapped peer calls.

In v2.0.0, Canvas owns `hanaworldsCompilerConfig`; this bridge consumes and relays it without shadowing the service. Safety profiles derive from confirmed intents. Avatar facts remain the published `UNAVAILABLE/NO_PUBLIC_SOURCE` record. `hanaworldsWorldInspectionContext.ReadInspectionContext` provides the correlated `world-inspection/v1` operation with current Canvas session/world/object selection and the named `SESSION_NOT_FOUND` / `WORLD_NOT_BOUND` errors. Its internal `read` helper supplies the captured facts used by the existing InspectWorld invocation.

A minimal inspection consumer request (the world/source peer calls this in process):

```ts
await ctx.hanaworldsWorldInspectionContext.ReadInspectionContext({
  contractVersion: 'world-inspection/v1', requestId: 'inspection-example',
  sessionRef: 'selected-core-session', worldRef: 'selected-world',
})
```

The response echoes requestId and has result XOR error. The minimal component counterparty is `createViewFixture()` in `test/view-fixture.ts`; `test/contracts.test.ts` covers the successful selection and both declared errors with the actual provider.

## IPC / preload to HTTP mapping

Every route uses the host's request rejection policy. JSON bodies are bounded to 64 KiB. The plugin mints page-window keys and binds each lease to a live Core Session, the actual Canvas registration, and all LocalWorldContext fields. Clear, close, reselect, context/incarnation changes and supplier replacement invalidate the old lease. A lease from another page key is rejected; unload/restart drops all page state. No native chooser is needed.

| Source host-process message / preload call | Plugin HTTP |
| --- | --- |
| Page Session candidates | GET `/api-hanaworlds-view/candidates` |
| Open page window | POST `/api-hanaworlds-view/window` → page-window key |
| view-select / choose selected Session | POST `/api-hanaworlds-view/select` `{windowKey,sessionId}` → `{lease,sessionId}` |
| view-read / current | POST `/api-hanaworlds-view/read` `{windowKey,lease}` |
| view-clear / clear selection | POST `/api-hanaworlds-view/clear` `{windowKey}` |
| window closed | POST `/api-hanaworlds-view/close` `{windowKey}` |
| workshop-prepare / prepare(text) | POST `/api-hanaworlds-workshop/prepare` `{windowKey,lease,text}` |
| workshop-confirm / confirm() | POST `/api-hanaworlds-workshop/confirm` `{windowKey,lease}` |
| workshop-read / history() | POST `/api-hanaworlds-workshop/read` `{windowKey,lease}` (current Workshop turns only) |
| workshop-invoke / invoke(input) | POST `/api-hanaworlds-workshop/invoke` `{windowKey,lease,input}` |
| deployment facts | POST `/api-hanaworlds-deployment` `{windowKey,lease}` |
| region seam diagnostics | GET `/api-hanaworlds-region` |
| Host tool schemas and skill catalog snapshot | GET `/api-hanaworlds-skill-tools` |

World product routes (all under the same upstream login and Host/Origin fence):

| Method / route | Input / result |
| --- | --- |
| GET `/api-hanaworlds-worlds/describe` | Source templates, prerequisites and supported actions |
| GET `/api-hanaworlds-worlds/list` | Source world inventory |
| POST `/api-hanaworlds-worlds/create` | `{templateId,displayName}` → full created record, opaque creationFacts |
| POST `/api-hanaworlds-worlds/connect` | `{windowKey,sessionId,worldId}` → `{lease,sessionId,worldRef,localContext,noLiveBinding:false}` |
| POST `/api-hanaworlds-worlds/context` | `{windowKey,sessionId}` → worldRef, localContext or null, noLiveBinding |
| POST `/api-hanaworlds-worlds/stop` | `{windowKey,lease}` → source stop result for the captured connection |
| POST `/api-hanaworlds-worlds/describe-delete` | `{worldId}` → source confirmation name and impacts |
| POST `/api-hanaworlds-worlds/delete` | `{worldId,confirmationName}` → source deletion receipt after exact name confirmation and Canvas retirement reservation |
| POST `/api-hanaworlds-worlds/play` | `{worldId}` → source result, only when canPlay is true |

Connect launches via C-world-lifecycle, selects the returned world/connection/incarnation via C-canvas, synchronizes C-session, then publishes the page lease. The caller cannot supply connection or authorization fields. A stopped/disconnected selection stays visible through `context` with `noLiveBinding:true`; it cannot authorize Workshop work. A failed connect publishes no lease. A launch or Canvas selection already completed before a later failure remains a source/Canvas fact; the bridge performs no automatic destructive rollback. The caller can inspect the world inventory and context before an explicit next action.

Deletion reads the current source-owned `describeDelete` and requires an exact `confirmationName` match, including case and whitespace. The bridge derives `worldRef` itself, reads `ListWorldSelections`, and refuses any durable selecting Session, including one whose live connection disappeared: `TRANSACTION_CONFLICT: 世界正被对话 … 选为当前世界；先在那个对话里切到别的世界`. It then calls `ReserveWorldRetirement` with that inventory revision before invoking lifecycle `delete`. Canvas prevents concurrent selections and reservations; a raced selection gets the same conversation guidance without retrying deletion. A successful deletion releases the captured reservation as `RETIRED`; a failed deletion releases it as `ABORTED`. Missing, incompatible, replaced or uncorrelated suppliers cannot authorize deletion. Release failure is exposed as `WORLD_RETIREMENT_RELEASE_FAILED`, preserving a prior deletion error and stating `RETIRED` when deletion was confirmed; it is never reported as a successful product operation. No automatic retry is performed.

The build bridge permits these three retirement operations only inside its internal world-scoped deletion context. Generic `lifecycle.call('delete', …)` and raw retirement calls remain blocked. There are no engine-specific createFlat/luantiContent verbs or hanaworldsLuanti service aliases in this plugin.

`test/u3.test.ts` reads the real installed upstream WebServer/Connection services and exercises this machine's `127.0.0.1` on an OS-assigned port. It exchanges the isolated host's normal launch token for a signed cookie, exercises page lease routes, and rejects missing/bad cookies, foreign Host/Origin and another cookie authority. The credential store and world peers are explicit in-memory doubles. This validates local carrier/authentication; real engine, browser product assembly and owner acceptance are separate gates.

The invoke body contains interaction input, for example:

```json
{"operation":"workshop","input":{"operation":"StartOrResumeSession","payload":{"expectedRevision":null}}}
```

The transport derives protocol version, sessionRef, worldRef and localContext from the selected Core Session and current Canvas facts. It rejects payload authority fields (`sessionRef`, `worldRef`, `localContext`, actor/grant/role fields) before Workshop dispatch. Prepare/confirm go through the existing Core Session Controller and Agent loop. Model output is not a substitute for durable human confirmation or current-view checks.

## Component scope

desktop-bridge-01 delivers the extraction, standalone plugin, these route adapters, published SDK adaptation and tests. It does not implement new unpublished operations. desktop-bridge-04 adds published lifecycle/world-pairing, page-window leases, ReadInspectionContext and U3. desktop-bridge-05 adds name-confirmed deletion and Canvas retirement concurrency; -08 owns full ReadWriteProfile and source-facts assembly, and -09/-11 object history and undo/redo product routes. Existing internal build/inspection/region helpers are preserved; fixture confirmation is not real world mutation or owner acceptance.
