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
