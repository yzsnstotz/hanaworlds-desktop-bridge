# Provenance of moved files

Source: `hanaworlds-desktop` (fork of deepseek-harness, MIT) at `bd964cdf19785b14aa1e2f6d2a2ee350190a038f`, `apps/desktop-host/src/`. History below is `git log --follow --format='%h %ad %s' --date=short bd964cdf -- <file>` (latest 8).

## apps/desktop-host/src/workshop-transport.ts → src/workshop-transport.ts

```
ba0ec49998 2026-10-07 Fix initial Workshop world synchronization and ZIP installation link modes
b07a61cd89 2026-10-07 fix(desktop): publish canonical capabilities and compare live services by registration
2919b53649 2026-10-07 feat(desktop): compose K3 region write path, flat world and product game supply
43ed42b5a6 2026-10-06 feat(desktop): supply production geometry and assemble current public components
c72ff17f39 2026-10-06 Add native HanaWorlds text building tools and skill
66953b6c82 2026-10-06 Connect Desktop Host to current local-world contracts and Undo
3ac5086c4d 2026-10-06 fix(desktop): bind current builds and refresh installed plugin factories
2b0a10d61a 2026-10-05 feat(desktop): persist Session authority and authenticate Workshop transport
(8 commits total)
```

## apps/desktop-host/src/workshop-confirm.ts → src/workshop-confirm.ts

```
f590afaa3b 2026-10-07 fix(desktop): route native Prepare and Confirm through building skill
66953b6c82 2026-10-06 Connect Desktop Host to current local-world contracts and Undo
d1b8d7a705 2026-10-05 feat(hanaworlds): confirm Workshop rounds in trusted Core Session
(3 commits total)
```

## apps/desktop-host/src/build-bridge.ts → src/build-bridge.ts

```
5eb44fbe4b 2026-10-07 fix(desktop): require public G3 write-path capabilities
b07a61cd89 2026-10-07 fix(desktop): publish canonical capabilities and compare live services by registration
2919b53649 2026-10-07 feat(desktop): compose K3 region write path, flat world and product game supply
c010ca5aef 2026-10-07 feat(desktop): validate current-world material sources for image tool
a57723e1c5 2026-10-07 fix(desktop): consume Canvas 0.3.2 and bind object inspection target
43ed42b5a6 2026-10-06 feat(desktop): supply production geometry and assemble current public components
e23c55b5a8 2026-10-06 fix(desktop): consume public Adapter catalogue in current invocation
c72ff17f39 2026-10-06 Add native HanaWorlds text building tools and skill
(10 commits total)
```

## apps/desktop-host/src/region-ports.ts → src/region-ports.ts

```
5eb44fbe4b 2026-10-07 fix(desktop): require public G3 write-path capabilities
2919b53649 2026-10-07 feat(desktop): compose K3 region write path, flat world and product game supply
(2 commits total)
```

## apps/desktop-host/src/view-binding.ts → src/view-binding.ts

```
c62e2a8d45 2026-10-08 fix: retain current world and view after stale read failure
66953b6c82 2026-10-06 Connect Desktop Host to current local-world contracts and Undo
ac884bdbe8 2026-10-05 Bind HanaWorlds Desktop views to trusted Core Sessions
(3 commits total)
```

## apps/desktop-host/src/image-media.ts → src/image-media.ts

```
b07a61cd89 2026-10-07 fix(desktop): publish canonical capabilities and compare live services by registration
c010ca5aef 2026-10-07 feat(desktop): validate current-world material sources for image tool
64bbb9e9d8 2026-10-07 fix(desktop): compare registered attachment service behind Cordis proxies
e9101b77a9 2026-10-07 feat(desktop): bind native conversation images to building skill
(4 commits total)
```

## apps/desktop-host/src/deployment-policy.ts → src/deployment-policy.ts

```
43ed42b5a6 2026-10-06 feat(desktop): supply production geometry and assemble current public components
(1 commits total)
```

## apps/desktop-host/src/local-protocol.ts → src/local-protocol.ts

```
88b0d97cf6 2026-10-08 fix(world): read durable Canvas scope after native binding loss
5eb44fbe4b 2026-10-07 fix(desktop): require public G3 write-path capabilities
2919b53649 2026-10-07 feat(desktop): compose K3 region write path, flat world and product game supply
c72ff17f39 2026-10-06 Add native HanaWorlds text building tools and skill
66953b6c82 2026-10-06 Connect Desktop Host to current local-world contracts and Undo
(5 commits total)
```

## apps/desktop-host/src/inspection-facts.ts → src/inspection-facts.ts

```
a57723e1c5 2026-10-07 fix(desktop): consume Canvas 0.3.2 and bind object inspection target
43ed42b5a6 2026-10-06 feat(desktop): supply production geometry and assemble current public components
c72ff17f39 2026-10-06 Add native HanaWorlds text building tools and skill
(3 commits total)
```

## apps/desktop-host/src/painter-facts.ts → src/painter-facts.ts

```
2919b53649 2026-10-07 feat(desktop): compose K3 region write path, flat world and product game supply
66953b6c82 2026-10-06 Connect Desktop Host to current local-world contracts and Undo
(2 commits total)
```

## apps/desktop-host/src/session-incarnation.ts → src/session-incarnation.ts

```
5d05182c50 2026-10-06 feat(desktop): pair local worlds through current native authority
(1 commits total)
```

## apps/desktop-host/src/index.ts → src/index.ts

```
bd964cdf19 2026-10-08 fix(world): retain stopped control and confirm safe deletion
b7d402824d 2026-10-08 Make existing worlds readable and switchable in the current conversation
c62e2a8d45 2026-10-08 fix: retain current world and view after stale read failure
fd7836b1f4 2026-10-08 feat(desktop): describe HanaWorlds skill tools in Settings
4efd9f545c 2026-10-07 fix(desktop): retain stopped-world control and clean rejected pairing
e5f5549750 2026-10-07 Fix unchanged local tar reinstall and retain world failure stages
0ace297ca6 2026-10-07 feat(desktop): create and view flat worlds in the current conversation
f590afaa3b 2026-10-07 fix(desktop): route native Prepare and Confirm through building skill
(28 commits total)
```

# desktop-bridge-01 plugin adaptation

The initial ecef8ed move is retained. `src/index.ts` extracts the composition from the index.ts history above; `routes.ts` replaces only the current-view/Workshop channels. New lifecycle, world-pairing and inspection contracts are deferred per PM scope. Fixture authorization fields were replaced by released session/v5 and canvas/v7 context facts; fixture persistence/model remain explicit simulations.

## apps/desktop-host/src/skill-submission.ts → src/skill-submission.ts

```
45f255ca1f 2026-10-07 Fix native skill controller registration checks and entry fixture
f590afaa3b 2026-10-07 fix(desktop): route native Prepare and Confirm through building skill
```

## apps/desktop-host/deferred/authorized-039/src/workshop-fixture.ts.deferred → test/workshop-fixture.ts

```
66953b6c82 2026-10-06 Connect Desktop Host to current local-world contracts and Undo
d1b8d7a705 2026-10-05 feat(hanaworlds): confirm Workshop rounds in trusted Core Session
```

## apps/desktop-host/deferred/authorized-039/src/view-fixture.ts.deferred → test/view-fixture.ts

```
66953b6c82 2026-10-06 Connect Desktop Host to current local-world contracts and Undo
d1b8d7a705 2026-10-05 feat(hanaworlds): confirm Workshop rounds in trusted Core Session
ac884bdbe8 2026-10-05 Bind HanaWorlds Desktop views to trusted Core Sessions
```

## apps/desktop/src/ipc.ts → src/routes.ts mapping

```
f590afaa3b 2026-10-07 fix(desktop): route native Prepare and Confirm through building skill
66953b6c82 2026-10-06 Connect Desktop Host to current local-world contracts and Undo
5d05182c50 2026-10-06 feat(desktop): pair local worlds through current native authority
2b0a10d61a 2026-10-05 feat(desktop): persist Session authority and authenticate Workshop transport
6acaf42f51 2026-10-05 Wire migrated Workshop read-only archives through Desktop Host
d1b8d7a705 2026-10-05 feat(hanaworlds): confirm Workshop rounds in trusted Core Session
ac884bdbe8 2026-10-05 Bind HanaWorlds Desktop views to trusted Core Sessions
4932a4da4e 2026-10-05 Import DeepSeek Harness dsh-v0.2.0-rc.2 source snapshot
```

## apps/desktop/src/preload-app.ts → src/routes.ts mapping

```
66953b6c82 2026-10-06 Connect Desktop Host to current local-world contracts and Undo
5d05182c50 2026-10-06 feat(desktop): pair local worlds through current native authority
2b0a10d61a 2026-10-05 feat(desktop): persist Session authority and authenticate Workshop transport
6acaf42f51 2026-10-05 Wire migrated Workshop read-only archives through Desktop Host
d1b8d7a705 2026-10-05 feat(hanaworlds): confirm Workshop rounds in trusted Core Session
ac884bdbe8 2026-10-05 Bind HanaWorlds Desktop views to trusted Core Sessions
3adc72927e 2026-10-05 Keep research profile projection preload-safe
8383812597 2026-10-05 Add isolated HanaWorlds Electron research desktop and Shell management
```

## apps/desktop/src/host-process.ts → src/routes.ts mapping

```
66953b6c82 2026-10-06 Connect Desktop Host to current local-world contracts and Undo
5d05182c50 2026-10-06 feat(desktop): pair local worlds through current native authority
2b0a10d61a 2026-10-05 feat(desktop): persist Session authority and authenticate Workshop transport
6acaf42f51 2026-10-05 Wire migrated Workshop read-only archives through Desktop Host
d1b8d7a705 2026-10-05 feat(hanaworlds): confirm Workshop rounds in trusted Core Session
ac884bdbe8 2026-10-05 Bind HanaWorlds Desktop views to trusted Core Sessions
4932a4da4e 2026-10-05 Import DeepSeek Harness dsh-v0.2.0-rc.2 source snapshot
```


# desktop-bridge-04

The module's b1c0549 baseline already registered neutral World services and contained no hanaworldsLuanti*, createFlat or luantiContent source identifiers. This card preserves those neutral service names and adds a source-owned `hanaworldsWorldLifecycle` consumer, `world-lifecycle/v2` routes and product pairing without reading or importing peer modules. The exact published dependency is `hanaworlds-contracts#v2.3.0` (f89b05f61f5db79c32c6d63b3ea5c3b79c5c53ef).

`world-lifecycle.ts` uses the SDK's released WorldLifecyclePort and strict correlated validation. `world-inspection-context.ts` supplies C-world-inspection while the existing captured InspectWorld helper remains internal. The fixture counterparty for lifecycle is the released `hanaworlds-contracts/fixtures/world-lifecycle` and `createWorldLifecycleMock`; Core Session, Cordis, WebServer and the U3 Connection owner are actual installed upstream dependencies. Test model/persistence/world peers and U3 credential storage are explicit in-memory component doubles. No actual engine launch, world write, browser product acceptance or account credential is claimed.

U3 reads `@deepseek-ai/dsh-client-connection@0.2.0-rc.2`'s requestRejection, Host/Origin fence and normal launch-token/signed-cookie exchange, together with `@deepseek-ai/dsh-host-webserver@0.2.0-rc.2`'s configured listener. Both are MIT dependencies from deepseek-ai/deepseek-harness. It uses OS-assigned loopback ports and releases all plugin fibers/listeners after the test.

# desktop-bridge-05

Baseline: `08df63a` (desktop-bridge-04 merged). This card continues the D-5 dependency usage of DeepSeek Harness and the pinned `hanaworlds-contracts#v2.3.0`; no upstream modifications, module imports, new dependencies or contract changes are introduced. The SDK's `requireWorldRetirable`, `validateRequest` and `validateBoundResponse` compose the released `ListWorldSelections`, `ReserveWorldRetirement`, `ReleaseWorldRetirement` and lifecycle `describeDelete`/`delete` operations.

`world-lifecycle.ts` owns exact-name product confirmation and supplier capture. `build-bridge.ts` adds an internal world-scoped retirement context because its existing call wrapper otherwise rejects non-build Canvas operations. This context preserves the captured reservation owner's release path when the live registration changes. `routes.ts` exposes only worldId + confirmationName after the existing host request fence. `test/view-fixture.ts` extends the explicit Canvas component double with durable selection inventory, revision checks, reservations and retired-world selection refusal. The lifecycle peer remains the published stateless fixture mock; tests delete no actual world data.

Packages used for this card (unchanged dependency versions):

| Name | Version | License | Source | Use |
| --- | --- | --- | --- | --- |
| @deepseek-ai/cordis | 4.0.4 | MIT | https://github.com/deepseek-ai/deepseek-harness | Service composition and captured registration identity |
| @deepseek-ai/dsh-host-webserver | 0.2.0-rc.2 | MIT | https://github.com/deepseek-ai/deepseek-harness | Existing HTTP route carrier |
| @deepseek-ai/dsh-session | 0.2.0-rc.2 | MIT | https://github.com/deepseek-ai/deepseek-harness | Real Core Sessions in component route tests |
| hanaworlds-contracts | 2.3.0 | MIT | https://github.com/yzsnstotz/hanaworlds-contracts/tree/v2.3.0 | Public lifecycle/Canvas request and correlated-response admission, retirement precondition and lifecycle fixture |

Validation is SOURCE/FIXTURE plus local real HTTP/Cordis/Core Session carrier. Real lifecycle deletion, peer assembly, browser UI and owner ACCEPTED are outside this card's component evidence.

# desktop-bridge-07

Baseline: `983feec` (desktop-bridge-05 merged). D-5 remains dependency usage of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): `@deepseek-ai/cordis` 4.0.4 (MIT, plugin/service identity), `@deepseek-ai/dsh-host-webserver` 0.2.0-rc.2 (MIT, existing plugin HTTP routes), `@deepseek-ai/dsh-session` 0.2.0-rc.2 (MIT, real Core user/assistant events), `@deepseek-ai/dsh-api-session-controller` 0.2.0-rc.2 (MIT, existing host prompt admission), and `@deepseek-ai/dsh-session-persistence` 0.2.0-rc.2 (MIT, existing durable read seam). `hanaworlds-contracts` 2.3.0 (MIT, published Git tag v2.3.0 at f89b05f61f5db79c32c6d63b3ea5c3b79c5c53ef) supplies C-session validation and public turn/clarification data. No new dependency, upstream modification, peer import or contract extension is introduced.

`workshop-transport.ts` projects pending clarification data from validated public turn receipts. `workshop-confirm.ts` binds dialogue reads and human confirmation to the displayed public round, captured Workshop registration, Core Session and local-world context. The former private `hanaworldsSkillBusiness.pending` seam is removed. The existing HTTP carrier and host controller/model selection remain in use. `test/workshop-fixture.ts` remains a C-session component double; its confirmed brief is now a released `BriefProjection`. Added tests exercise real Cordis, Core Session and loopback HTTP with explicit model, world and persistence simulations. They do not claim real model inference, engine writes, assembled frontend rendering or owner acceptance.

# desktop-bridge-08

Baseline: `c040612` (desktop-bridge-07 merged). D-5 dependency usage remains unchanged. This card reuses the released `world-facts/v1` ReadWriteProfile envelope, handshake checks, strict correlated response validation and `requireWriteProfileConfig` from `hanaworlds-contracts#v2.3.0`. The world source owns the complete profile. The bridge's compiler service forwards its configuration and deployment HTTP projects all fields from one named read, preserving unknown declarations. No backend-to-route table, engine-specific revision lookup or configuration assembly is introduced.

C-world-inspection remains the neutral `hanaworldsWorldInspectionContext.ReadInspectionContext` provider implemented in desktop-bridge-04, with current Canvas selection, SESSION_NOT_FOUND/WORLD_NOT_BOUND and correlated responses. Its examples and minimal Canvas counterparty remain in README.md and test/view-fixture.ts; verification now includes the actual inspection provider. `test/world-facts-fixture.ts` is an explicit minimal C-world-facts double using published known/undeclared profile examples and both declared operation errors. It is not a real source.

| Name | Version | License | Source | Use |
| --- | --- | --- | --- | --- |
| @deepseek-ai/cordis | 4.0.4 | MIT | https://github.com/deepseek-ai/deepseek-harness | Service registration, identity, teardown |
| @deepseek-ai/dsh-host-webserver | 0.2.0-rc.2 | MIT | https://github.com/deepseek-ai/deepseek-harness | Existing deployment HTTP carrier |
| @deepseek-ai/dsh-session | 0.2.0-rc.2 | MIT | https://github.com/deepseek-ai/deepseek-harness | Existing Core Session and page binding |
| hanaworlds-contracts | 2.3.0 | MIT | https://github.com/yzsnstotz/hanaworlds-contracts/tree/v2.3.0 | C-world-facts and C-world-inspection types, validation, fixture examples |

Evidence is SOURCE/FIXTURE plus real local Cordis/Core Session/HTTP carrier. Assembled world-source availability, real engine facts, browser UI and owner acceptance are not established by these component tests. No dependencies, upstream code, peer module imports or contract changes are added.

# desktop-bridge-09

Baseline: `345bf7d` (desktop-bridge-08 merged). D-5 stays dependency usage of DeepSeek Harness. The existing build bridge, region ports and page bindings are composed through the plugin's authenticated HTTP routes. Canvas owns ListObjects and HistoryQuery; the bridge forwards decoded records into the build response and exposes explicit panel reads. It adds no history storage, engine-specific write routing, peer module imports, dependencies or contract changes.

The Adapter region port previously lacked the in-process write fence. It is now captured and wrapped alongside Canvas region calls: only Canvas's live region stack reaches Adapter region reads/writes for the same Session/world/context. Public protocol capabilities, response binding and supplier identity are checked. Painter/Brush wrappers now reject suppliers replaced during an awaited call. `test/build-fixture.ts` is an explicit minimal component counterparty built from released schema types and region fixtures; it simulates object/history creation and adapter writes with no actual engine or world side effects.

| Name | Version | License | Source | Use |
| --- | --- | --- | --- | --- |
| @deepseek-ai/cordis | 4.0.4 | MIT | https://github.com/deepseek-ai/deepseek-harness | Plugin/service composition, registration identity and teardown |
| @deepseek-ai/dsh-host-webserver | 0.2.0-rc.2 | MIT | https://github.com/deepseek-ai/deepseek-harness | Existing authenticated plugin route carrier |
| @deepseek-ai/dsh-session | 0.2.0-rc.2 | MIT | https://github.com/deepseek-ai/deepseek-harness | Real Core Sessions and existing page leases in component tests |
| hanaworlds-contracts | 2.3.0 | MIT | https://github.com/yzsnstotz/hanaworlds-contracts/tree/v2.3.0 | C-session/C-canvas validation, region protocols/capabilities and fixture data |

Evidence is SOURCE/FIXTURE with real local Cordis/Core Session/HTTP and the existing U3 carrier test. Real engine writes, installed peer assembly, rendered Shell panels and owner ACCEPTED remain untested here.
