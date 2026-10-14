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

Workshop dialogue reads use the released C-session `StartOrResumeSession` and `ReadSessionTurnDetails` operations. `view.turns` contains the public user/result text and confirmed-brief status; `view.modelReply` is the actual durable Core assistant text from the submitted prompt interval. A pending confirmation comes only from the validated `TurnReceipt.clarification` returned by `AppendMultimodalTurn` or `AnswerClarification` through this transport. `view.pending` contains `question`, `userText`, `clarificationId` and `turnRevision`. There is no `hanaworldsSkillBusiness` dependency or inference of pending intent from model prose.

Call Prepare or Read to display the pending round before calling Confirm with the same `{windowKey,lease}`. Confirm checks that the displayed clarification still matches the current public turn and sends the exact human input `确认` through the host controller. A different page must read the round before confirming it. A successor round requires a new read (`HANAWORLDS_CONFIRM_ROUND_CHANGED`); a page with no displayed round gets `HANAWORLDS_CONFIRM_NO_CURRENT_ROUND`. Human submissions are serialized per Core Session across page windows. Current-world/context changes, Workshop registration replacement and page clear/close cannot authorize an old confirmation. The pending projection is scoped to this plugin instance and its observed public receipts; restart drops it together with page leases. The bridge does not recover unobserved pending state from private Workshop or skill storage.

Providers: `hanaworldsDesktopBridge` (transport, view bindings, confirmations, image reader and deployment policy), `hanaworldsCatalogue`, `hanaworldsSafetyProfile`, `hanaworldsCapabilities`, `hanaworldsWorldInspectionContext`, `hanaworldsPainterLocalFacts`, `hanaworldsMediaAuthority`. Canvas alone registers `hanaworldsCompilerConfig` and `hanaworldsCanvasConfigSupply`; the bridge does not provide or remove either service. Painter/Brush region ports are provided only when the peer publishes the corresponding methods and handshake. Fiber unload removes bridge services/routes, invalidates active view handles, and restores wrapped peer calls.

The world source's `hanaworldsWorldFacts` advertises `world-facts/v1` and implements `call('ReadWriteProfile', request)` using the published request/response envelope. Deployment reads that complete profile once and forwards its opaque backend, compilationConfig, writeMethods and avatarEnvelope without assembling configuration or filling unknown facts. `/api-hanaworlds-deployment` includes the full `writeProfile` plus projections from that same snapshot; missing sources or failed reads have null values and named errors. A successful undeclared profile keeps null configuration, empty methods and its source-owned UNAVAILABLE envelope. This management projection does not register a compiler fallback. Safety profiles derive from confirmed intents.

### Original Host configuration and picture-material handoffs (D-182)

The bridge's current `hanaworldsWorldInspectionContext` owner fiber supplies its actual `fiber.ctx` to the two original receivers. A dependent Cordis fiber waits for that registration to become ACTIVE, then attaches to the current Canvas/Workshop. It waits for `Canvas.ready` before configuration attachment. Either load order works through the normal dependency lifecycle. No source read occurs at attachment. Missing receiver methods remain visible as `sourceSupply.config/material` with `state:UNAVAILABLE` and a named reason in the existing deployment response; `ATTACHED` describes reader registration, not world readiness. Provider replacement/unload calls the corresponding disposer and revokes captured readers. A new activation attaches new readers without touching Canvas's two configuration registrations.

| Original receiver | Exact runtime reader | Source call and full result |
| --- | --- | --- |
| `canvas.attachConfigSource(bridgeContext, reader)` → synchronous disposer | `(this: actual Bridge Context, scope, request)` | `this.get('hanaworldsWorldFacts').call('ReadWriteProfile', request)` → original `{contractVersion,requestId,result,error}`; no result-only projection |
| `workshop.attachMaterialSource(bridgeContext, reader)` → synchronous disposer | `(this: actual Bridge Context, scope, signal)` | `this.get('hanaworldsWorldFacts').readMaterialSources(scope)` → original `{provider,facts,textures}` with real `Uint8Array` |

`scope` is exactly `{worldRef,connectionRef,connectionIncarnationRef}`; each is a nonempty opaque reference. The configuration request is exactly `{contractVersion:'world-facts/v1',requestId,worldRef}`, with scope/request/returned connection correlation. The complete `WriteProfile` retains backend, configuration, methods, avatar and optional `transportPolicy`. Canvas keeps its original compiler result `{compilationConfig,compilerRevision}` and full ConfigSupply observations/history; it performs its own Catalogue/provider/current-domain and repeat-read checks. The bridge does not read either configuration port to produce its input.

Material forwarding preserves complete provider identity, snapshot, presentation, texture rows, UNKNOWN/null values, sourceRevision and every original texture byte. Embedded schemas check closed shapes, source scope, snapshot digest, presentation coverage, ordered material rows, unique texture coverage, byte lengths and SHA256. Typed texture bytes are never converted into JSON arrays in the runtime handoff. JSON byte lists in `test/host-source-examples.json` are document fixture encodings only. No texture path is accepted or interpreted by the bridge.

Original source exceptions remain the same thrown object, including cause/publicError/source/UNKNOWN. Configuration business refusals remain the entire original envelope. Cancellation throws the original AbortSignal reason before or after the read. Successful results are released only while the captured Bridge, peer and facts registrations/value/fiber remain current and ACTIVE; a forged/borrowed receiver, source loss or replacement refuses. There is no retry, TTL, old-result cache or new write/launch authorization. These checks observe current facts under the ordinary desktop model; they do not promise synchronous safety across an idle gap.

`hanaworldsCatalogue.read(worldRef)` remains the existing bridge projection for a trusted invocation. It now asks current Canvas `readCatalogue({sessionRef,expectedConnection})` and returns its admitted complete `facts.catalogue`. Bridge does not call Adapter Catalogue. Workshop's original `readMaterialSourcesProjection({attachmentRef}, exec)` and `readImageMaterialInput({attachmentRef}, exec)` own actual Agent/Core/turn/current human attachment/Canvas binding checks and typed four-field mapping; bridge does not construct an exec or grant a model source-reading role. Image selection performs no compiler or world write.

Formal authority: C-world-facts v2/D-176; C-canvas v6/D-178 (Q-288 handoff); C-session v2 §13/D-181. Exact input document hashes and compiled transitive definitions are recorded in `src/host-source-schema.ts`. No sibling implementation or additional contract package supplies these new interfaces. Locked source tests cover the registration/lifecycle and full values with document peers; normal pack also runs `host-source-installed-test.mjs` in the actual default-strict production consumer, without an SDK runtime. Its complete exchanges and byte lists are retained in `host-source-proof.json`. These are installed component/fixture receipts. Actual official Loader/world/Agent image authorization, model/UI and owner acceptance require their own real assembled supply and are not established by this probe.

`hanaworldsWorldInspectionContext.ReadInspectionContext` provides the correlated `world-inspection/v1` operation with current Canvas session/world/object selection and the named `SESSION_NOT_FOUND` / `WORLD_NOT_BOUND` errors. Its internal `read` helper supplies the captured facts used by the existing InspectWorld invocation.

A minimal inspection consumer request (the world/source peer calls this in process):

```ts
await ctx.hanaworldsWorldInspectionContext.ReadInspectionContext({
  contractVersion: 'world-inspection/v1', requestId: 'inspection-example',
  sessionRef: 'selected-core-session', worldRef: 'selected-world',
})
```

The response echoes requestId and has result XOR error. The minimal component counterparty is `createViewFixture()` in `test/view-fixture.ts`; `test/contracts.test.ts` covers the successful selection and both declared errors with the actual provider.

`hanaworldsWorldInspectionContext.ReadPluginRoles` (hanaworlds-contracts 2.9.0, consumer shell-ui) answers every HanaWorlds role → the `moduleName[]` of the plugins providing it in the running host, with `status` COMPLETE/PARTIAL/UNAVAILABLE and named `missingRoles`. It reads only what the host registered: each active Cordis service named by the published `pluginRoles.evidence` table is attributed to the loader module (`fiber.entry.options.name`) of its providing fiber or nearest ancestor; the skills role comes from the live `ctx.skills` catalog entries of the contracted skill (`SkillSummary.provider`, because the DSH skill registry does not expose the registering plugin). Package names, configuration and seeds are never read; versions stay with `remote.pluginManager.listBundles`. A failed read (no loader entry for a contracted service, missing or incomplete skill catalog) is logged under `hanaworlds-plugin-roles` and answered as `CAPABILITY_UNAVAILABLE`, never as an empty map. HTTP: GET `/api-hanaworlds-plugin-roles` (same login/origin fence) returns the whole `ReadPluginRolesResponse`, or 409 `{error, contractError}` on failure.

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
| Advance current cell build | POST `/api-hanaworlds-build/advance` `{windowKey,lease,payload:{expectedTurnRevision,requestId?}}` |
| Region proposal context | POST `/api-hanaworlds-region/context` `{windowKey,lease,payload:{expectedTurnRevision,requestId?}}` |
| Submit region proposal | POST `/api-hanaworlds-region/proposal` `{windowKey,lease,payload}` (released region proposal business fields) |
| Advance current region build | POST `/api-hanaworlds-region/advance` `{windowKey,lease,payload:{expectedTurnRevision,requestId?}}` |
| Object inventory | POST `/api-hanaworlds-objects/list` `{windowKey,lease}` |
| One current-world object's history | POST `/api-hanaworlds-objects/history` `{windowKey,lease,objectRef}` |
| Refresh both object and history panels | POST `/api-hanaworlds-objects/panels` `{windowKey,lease}` |
| Host tool schemas and skill catalog snapshot | GET `/api-hanaworlds-skill-tools` |
| Role → providing plugins (C-world-inspection ReadPluginRoles) | GET `/api-hanaworlds-plugin-roles` |

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

Build routes return `{result,panels,panelError}`. `result` is the original Workshop result; `panels` is `{objects: ObjectInventory, histories: HistoryView[]}` read from C-canvas after dispatch. The existing Workshop invoke route returns this same shape for `AdvanceCurrentBuild`. Pending or refused builds retain their original outcome and expose the unchanged Canvas records. The object list preserves Canvas order; histories correspond to each listed object. Single-object history first checks membership in that world's current inventory. Every read validates the peer handshake, correlated response, world/object identity and the captured page lease before and after dispatch.

If a panel read fails while the lease stays valid, the route preserves the build result with `panels:null` and the named `panelError`. Refresh through `/api-hanaworlds-objects/panels`; do not repeat a mutation to refresh a panel. Closing, reselecting, disconnecting or replacing the selected Canvas invalidates the old response. Panel reads are successive supplier observations, not a new atomic snapshot contract. The Shell consumes these records for rendering; this module contains no frontend panel implementation.

### Canvas/Session refusals (hanaworlds-contracts 2.7.0 `Error.worldRef`)

A C-canvas or C-session refusal keeps its whole public Error: `code`, `phase`, `retryability`, `mutationState`, `transactionRef`, `causeCode`, `reason` and the optional target `worldRef`. Routes that fail on such a refusal answer 409 with the existing `error` text plus `contractError` (the peer's Error, unchanged). `/api-hanaworlds-workshop/invoke` already returns the Workshop envelope, so its Error stays at `result.error`. A build whose follow-up panel read was refused keeps `panelError` and adds `panelContractError`. The bridge only checks the named world against the admitted request's selector (SDK) and its own current Session→world binding; a different world is refused as `CURRENT_WORLD_MISMATCH`, malformed errors are refused by the SDK, and the bridge never adds or guesses a world. Errors without `worldRef` relay as before. No failure path writes, undoes, redoes or retries. Published consumer fixture: `hanaworlds-desktop-bridge/fixtures/world-error-relay` (SOURCE/FIXTURE only).

Region proposal payloads contain `turnRevision`, `intent`, `intentDigest`, `referenceBrief`, `referenceBriefDigest`, `catalogue`, `catalogueDigest`, `proposal` and optional `requestId`. The plugin injects the protocol, invocation identifier and current session/world/context. Workshop calls the plugin's Painter/Brush region ports; only a live Canvas region invocation can call Adapter region reads/writes. Canvas authority ends when that individual call returns, so detached descendants cannot retain region or ordinary Adapter mutation access. The region bridge checks declared protocol majors/capabilities, supplier identity and current context, and validates public commit responses. It forwards source-owned geometry, partition, material and write data without an engine mapping table. Missing Workshop region methods remain `WORKSHOP_REGION_UNAVAILABLE`.

## Component scope

desktop-bridge-01 delivers the extraction, standalone plugin, these route adapters, published SDK adaptation and tests. It does not implement new unpublished operations. desktop-bridge-04 adds published lifecycle/world-pairing, page-window leases, ReadInspectionContext and U3. desktop-bridge-05 adds name-confirmed deletion and Canvas retirement concurrency. desktop-bridge-07 supplies current-process HTTP dialogue confirmation solely from public C-session receipts, with displayed-round and supplier identity checks; its model/persistence/world peers remain explicit component fixtures. desktop-bridge-08 supplies full ReadWriteProfile forwarding and source-owned compiler/write-method/avatar projections. desktop-bridge-09 adds page-bound cell/region build routes and Canvas object/history panel refresh. -11 owns undo/redo product routes. `test/build-fixture.ts` supplies minimal published-protocol counterparties; its records and world writes are simulations. Real engine mutation, assembled Shell rendering and owner acceptance remain separate evidence gates.

## Independent production package

`hanaworlds-contracts` is an exact **development** supply at Git tag `v2.9.0`.
`npm ci` and the normal build compile with TypeScript first (including upstream
const enums), then esbuild bundles only this module and its needed released
contract runtime/schema/canonicalization code. Official Cordis/DSH and zod
packages remain external. There is no compiler implementation or sibling plugin
in the bundle. `lib/build-provenance.json` records the original resolved Git
identity, tag SHA, source/input/output SHA-256 values and tool versions; required
licenses and upstream NOTICE are in `lib/licenses/`.

Declarations preserve the public SDK types and existing calls. TypeScript
consumers install the same tagged SDK as a **devDependency** when compiling;
these erased type references do not require a production SDK install. Public
`fixtures/world-error-relay` remains available; SDK test fixtures are not shipped.

`npm run test:package-boundary` creates a real archive with normal `npm pack`
lifecycle scripts. Prepack rebuilds and audits the files being archived; postpack
audits the actual tgz, installs it into a fresh isolated consumer with pinned
pnpm 11.28.5 defaults, replays its frozen production lock, loads all shipped JS
entries, exercises real Cordis/Core Session/HTTP carrier behavior against public
protocol doubles, and runs failing boundary injections. Build and npm test both
run this gate. Direct `npm run prepack` also performs the complete archive gate.
The gate's npm pack uses the standard global user cache (`~/.npm`) explicitly,
including under npm run, which injects npm's configured cache into child processes.
It does not change user npm configuration or require an external build volume.
No dependency policy, lifecycle scripts, hooks, aliases or allowlists are relaxed.
Production lock, resolution graph, tgz digest and probe/negative evidence are
retained in the printed evidence directory. Set `HANAWORLDS_BOUNDARY_RUN` to a
new directory outside any development checkout to choose its location; otherwise
it uses a fresh OS temporary directory. The gate refuses inherited SDK resolution.
These component checks do not establish a full official host, client/UI or owner
acceptance, real engine writes, reliable guard, complete subscriptions or ten-plugin
seed completion.
