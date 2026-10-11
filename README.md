# hanaworlds-desktop-bridge

Server bridge extracted from `hanaworlds-desktop@bd964cdf`. Load the compiled package as a Cordis plugin; its named `apply(ctx)` reuses the host webServer, login boundary and Core Sessions. It does not start Electron or its own DSH application.

```sh
npm ci --ignore-scripts
npm run verify:contracts
npm test
npm run typecheck
```

`npm test` first builds the exported `lib/index.js` entry. Run `npm run build` before installing the plugin in a host. Node >=24.13.1 is required.

The published dependency is pinned to `hanaworlds-contracts#v2.0.0`. The verifier checks the public tag against the lock's commit, the installed SDK version/handshake, and correlated session/v5 and canvas/v7 fixture roundtrips. The fixtures under `test/` are explicit component peers adapted from the source workshop/view fixtures. Their model and persistence are simulated; HTTP, Cordis and Core Session are real.

## Composition services

Required: `webServer`, `connection` (the host's `requestRejection` login and Host/Origin boundary), `sessions`, `hanaworldsWorkshop` (session/v5), `hanaworldsCanvasV5` (canvas/v7). These names identify existing service registrations; their historical suffixes do not select wire versions.

Optional consumers: `agents`, `sessionController`, `sessionPersistence` for standard human prompt submission and durable Core inputs; `attachments` for images; `hanaworldsWorldAdapterV6`, `hanaworldsWorldFacts`, `hanaworldsWorldRevisionOracle`, `hanaworldsCompilerConfig`, and the existing Painter/Brush/Canvas/Adapter region services. Missing suppliers produce named gaps. The plugin does not launch a model, choose a model/provider, generate engine configuration or invent material data.

The skill-tools route requires the host's `tools` and `skills` registries. Each GET returns `{tools: ctx.tools.schemas(), skills: await ctx.skills.snapshot()}` from the global registry view, including the skill snapshot's `complete` flag. This read-only display uses provider-owned descriptions and schemas; it does not execute tools, load skill bodies, or call Workshop/region services. Missing registries return `TOOLS_REGISTRY_UNAVAILABLE` or `SKILLS_REGISTRY_UNAVAILABLE`; discovery errors propagate without a substitute catalog. Tool and skill providers own their engine-neutral vocabulary: opaque material references, neutral orientation values, and geometry/partition facts declared by the current world source.

Prepare and Confirm submit only user input to the host's `sessionController.prompt` for the selected Core Session. The host owns that Session's provider, model and reasoning effort; model changes between submissions remain effective. The bridge does not register `hanaworldsModelRoute`, override `agent/request`, or select a fallback when host prompt admission fails. This routing delegation was already present in the desktop-bridge-01 composition; desktop-bridge-02 adds regression coverage for model changes, separate Session selections and host rejection.

Providers: `hanaworldsDesktopBridge` (transport, view bindings, confirmations, image reader and deployment policy), `hanaworldsCatalogue`, `hanaworldsSafetyProfile`, `hanaworldsCapabilities`, `hanaworldsWorldInspectionContext`, `hanaworldsPainterLocalFacts`, `hanaworldsMediaAuthority`. Painter/Brush region ports are provided only when the peer publishes the corresponding methods and handshake. Fiber unload removes services/routes, invalidates active view handles, and restores wrapped peer calls.

In v2.0.0, Canvas owns `hanaworldsCompilerConfig`; this bridge consumes and relays it without shadowing the service. Safety profiles derive from confirmed intents. Avatar facts remain the published `UNAVAILABLE/NO_PUBLIC_SOURCE` record. `hanaworldsWorldInspectionContext.read` exposes only captured facts for the existing InspectWorld invocation; it does not implement the future ReadInspectionContext operation.

## IPC / preload to HTTP mapping

Every route uses the host's request rejection policy. JSON bodies are bounded to 64 KiB. Returned page keys and view handles are component-local state; page-window product leases and U3 validation belong to desktop-bridge-04.

| Source host-process message / preload call | Plugin HTTP |
| --- | --- |
| view-candidates / native chooser candidates | GET `/api-hanaworlds-view/candidates` |
| native BrowserWindow identifier | POST `/api-hanaworlds-view/window` → component page handle |
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

The invoke body contains interaction input, for example:

```json
{"operation":"workshop","input":{"operation":"StartOrResumeSession","payload":{"expectedRevision":null}}}
```

The transport derives protocol version, sessionRef, worldRef and localContext from the selected Core Session and current Canvas facts. It rejects payload authority fields (`sessionRef`, `worldRef`, `localContext`, actor/grant/role fields) before Workshop dispatch. Prepare/confirm go through the existing Core Session Controller and Agent loop. Model output is not a substitute for durable human confirmation or current-view checks.

## Component scope

desktop-bridge-01 delivers the extraction, standalone plugin, these route adapters, published SDK adaptation and tests. It does not implement new unpublished operations. contracts-03/04 publish those; desktop-bridge-04 supplies lifecycle/world-pairing and page-window leases, -05 deletion concurrency, -08 full ReadWriteProfile/ReadInspectionContext, and -09/-11 object history and undo/redo product routes. Existing internal build/inspection/region helpers are preserved; fixture confirmation is not real world mutation or owner acceptance.
