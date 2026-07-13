# Odin

Mobile-first workout tracker. Vue 3 web code inside a Capacitor native shell,
local-first with on-device SQLite. Ships to Android and iOS.

Full setup and workflow docs live in the project wiki
(First-Time-Setup, Dev-Flow). This file is the quick reference.

## Toolchain

Node 22.13+ required (use the current LTS). Then:

```powershell
npm install         # also wires the pre-commit hook
npm run dev         # Vite dev server on http://localhost:5173
npm run test        # vitest
npm run lint        # eslint + dependency-cruiser boundary rules
npm run typecheck   # vue-tsc
```

## Phone dev loop

The installed dev app is a native shell whose WebView loads the Vite dev
server, so the phone gets the same HMR as the browser. There are two loops;
knowing which one you are in is the whole game.

**Web loop (default, covers .vue / .ts / CSS / asset changes):**

```powershell
npm run dev:phone   # Vite listening on the LAN; save a file, the phone updates
```

No rebuild, no reinstall. If the phone stops updating, the dev server is down
or the network changed.

**Native loop (required after installing/removing/updating a Capacitor plugin,
editing capacitor.config.ts, or touching AndroidManifest / gradle /
Info.plist):** one command per platform:

```powershell
npm run rebuild:phone           # Android from the PC (auto-detects your LAN IP)
npm run rebuild:phone ios       # iOS Simulator, run on the Mac
```

The script re-syncs the native project with the dev server URL baked in, then
builds and installs via `npx cap run` (Android Studio / Xcode required for
that step; pass `--sync-only` to skip it and install yourself). It prints the
URL it baked; override with the `ODIN_DEV_SERVER_URL` env var if the
auto-detected address is wrong.

**Production safety:** the dev URL only exists when `rebuild:phone` sets
`ODIN_DEV_SERVER_URL`. A plain `npx cap sync` (what a release build runs)
produces a config with no `server.url`, and the baked
`capacitor.config.json` files inside `android/` and `ios/` are git-ignored,
so a LAN URL can neither ship nor be committed.
