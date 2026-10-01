# Bitling: development notes

Working notes for whoever continues (human or agent). The README is the user-facing doc;
this file records *why* things are the way they are and what to do next.

## Status after session 1 (2026-10-01)

MVP is done and verified on Linux:

- Tauri 2 app: transparent, frameless, always-on-top, hidden from taskbar/Dock, placed in the
  bottom-right corner of the primary screen, draggable, right-click menu.
- Pet with 4 animated states (idle, done, waiting, error), 2-4 frames each, plus hover HUD
  (level + XP bar).
- Local HTTP endpoint `127.0.0.1:47800` (`/event`, `/state`, `/health`).
- Claude Code hook script + installer (backup, confirmation, uninstall, dry run).
- Demo mode: `npm run demo` (over HTTP), right-click menu "Demo mode", keys 1-4/D,
  `?demo` in the browser, `BITLING_DEMO=1`.
- XP/levels persisted in `~/.bitling/state.json`.

### What was actually verified

- `npm test`: 6 JS tests (settings merge) + 13 Rust tests (protocol, XP, routing).
- `npm run build` (tsc + vite) and `npx tauri build --no-bundle` (release binary ~3.7 MB).
- Dev and release binaries run under Xvfb: HTTP events switch states, HUD appears after `done`,
  window lands in the corner. (Xvfb has no compositor, so the background is black there; that is
  expected.)
- **Real Claude Code 2.1.287 end-to-end** (`claude -p` with `--settings` produced by the
  installer): `UserPromptSubmit` and `PostToolUse` → working, `PostToolUseFailure` → error,
  `Stop` → done (+10 XP).
- Installer: fresh install, reinstall (no duplicates), uninstall restores the original file,
  backups never overwrite each other, invalid JSON is refused, no TTY without `--yes` is refused.

### Not verified yet

- macOS and Windows (transparency, `macOSPrivateApi`, drag, hooks under PowerShell).
- A real desktop with a compositor (transparency, drag on Wayland).
- The `Notification` / `permission_prompt` hook from a live interactive session (`-p` mode
  never asks for permission). The payload field is documented both as `notification_type` and
  `type`; both are handled.

## Architecture

```
hooks/bitling-hook.mjs        hook script (copied to ~/.bitling/ by the installer)
scripts/install-hooks.mjs     CLI: add/remove hooks in Claude Code settings
scripts/lib/claude-settings   pure merge logic + node:test tests
scripts/demo.mjs              drives a running app over HTTP
scripts/render-sprites.mjs    PNG/GIF/icon export from the sprite data
src/sprites.ts                ASCII pixel art, palettes, frame timings (pure data)
src/scene.ts                  frame → 16x18 color grid: outline, shadow, HUD (pure, DOM-free)
src/animation.ts              steps through frames in real time
src/renderer.ts               paints a scene on the canvas (DPR-aware)
src/bridge.ts                 all Tauri calls; no-ops in a plain browser
src/main.ts                   wiring: input, demo mode, agent events
src-tauri/src/main.rs         window setup, commands, shared state
src-tauri/src/server.rs       tiny_http endpoint + routing (unit tested)
src-tauri/src/protocol.rs     JSON event parsing, raw Claude Code payload mapping
src-tauri/src/progress.rs     XP curve, state.json persistence
```

Data flow: agent hook → `POST /event` → Rust (`AppSink::on_event`: update state, XP, save) →
Tauri event `bitling:event` → `main.ts` → `AnimationPlayer` → `composeScene` → canvas.

## Decisions

1. **Tauri 2 + Vite + plain TypeScript.** Small binary, native transparency, no frontend
   framework. Vite is a dev tool only; the shipped JS is ~35 KB (mostly `@tauri-apps/api`).
2. **Sprites are ASCII grids in code** (`src/sprites.ts`), one char per pixel, per-state
   palettes. Easy to review and to contribute new art in a PR. The outline is computed
   (`scene.ts`: any transparent pixel 4-adjacent to art), so the art stays simple and readable on
   light and dark wallpapers.
3. **Scene size 16x18 big pixels × 8 = 128x144 window.** The 10x9 sprite sits at (3, 6);
   the space around it is for effects (sparkles, "!", sweat drop), the ground shadow, and the HUD
   row at the bottom. Changing it means updating `SCENE_W/H` and `tauri.conf.json`.
4. **Scene composition is pure and DOM-free**, shared by the app and the Node export script.
   Node imports the `.ts` files directly (type stripping), hence `allowImportingTsExtensions`
   + `erasableSyntaxOnly` in tsconfig (no enums, no parameter properties), and Node 22.18+ for
   `npm run sprites`.
5. **No 60 fps loop.** `main.ts` sleeps with `setTimeout` until the next frame change; identical
   frames are not repainted.
6. **Protocol is agent-agnostic**: states `idle | working | done | waiting | error`. `working`
   means "agent busy again" and currently renders as idle. Which agent event maps to which state is
   decided by the *installer* (the state is the hook script's argument), so it is visible and
   editable in the user's settings.json. The Rust side additionally maps raw Claude Code payloads
   for `"type": "http"` hooks; that table (`protocol.rs::from_claude_hook`) must be kept in sync
   with `HOOK_EVENTS` in `scripts/lib/claude-settings.mjs`.
7. **Hook script in Node, not shell.** Claude Code runs hooks in bash *or* PowerShell (Windows
   without Git Bash); a Node script works in both, and the installer already needs Node. The
   command is `node "<path>" <state>` with forward slashes and double quotes so it survives bash,
   PowerShell and cmd. The script is copied to `~/.bitling/` so the repo can be moved.
8. **Script first, HTTP hooks as an alternative.** The brief asked for a hook script; it also
   works with Claude Code versions that predate `type: "http"` hooks. The endpoint accepts raw
   hook payloads anyway, which is the path to a Node-free install for binary users (see next
   steps).
9. **Hook timing:** frequent hooks (`UserPromptSubmit`, `PostToolUse`, `PostToolUseFailure`,
   `Notification`) are `async: true`. `Stop` and `StopFailure` run inline with `timeout: 5`,
   because the real test showed `claude -p` exits right after `Stop` and kills async hooks.
   The script always exits 0, never writes stdout (Claude Code parses it; exit code 2 on `Stop`
   would even block), and has a hard 2 s cap.
10. **`PostToolUse` → working** is what clears "waiting" after the user approves a tool: there
    is no "permission resolved" event. Cost: one short Node process per tool call (async).
11. **Reactions stay on screen ≥ 2 s** (`MIN_REACTION_MS` in `main.ts`): a `working` event only
    calms the pet once the current state was visible for 2 s, so quick failure → retry does not
    flicker.
12. **Security:** bind to 127.0.0.1 only; `POST /event` requires `Content-Type:
    application/json`, which browsers can't send cross-origin without a CORS preflight (never
    answered), so websites can't drive the pet. No auth token (local, cosmetic impact only).
    Body capped at 1 MiB, messages trimmed to 200 chars.
13. **XP:** 10 per `done`; total XP for level L is `25·L·(L−1)` (each level needs 50 more than
    the previous). Events with `source: "demo"` don't count. Stats count done/waiting/error.
14. **Data lives in `~/.bitling/`** (`state.json`, `bitling-hook.mjs`), not the OS app-data
    dir: one discoverable folder next to `~/.claude`. `BITLING_HOME` overrides it (tests too).
    Writes are atomic (tmp + rename); a corrupt file is moved to `state.json.corrupt`.
15. **Window placement:** starts hidden, positioned from `inner_size()` (on Linux `outer_size()`
    is 0x0 until mapped), then shown. Quit lives in the right-click menu because there is no
    frame, taskbar entry or Dock icon (`ActivationPolicy::Accessory` on macOS).
16. **Click vs drag:** a press becomes `startDragging()` after 3 px of movement; a plain click
    calms the pet to idle ("seen it").
17. Bundle identifier `io.github.blazkojj.bitling` (must not end in `.app` for macOS).

## Known issues / edge cases

- Several Claude Code sessions share one pet: the last event wins.
- Async hooks could in theory arrive out of order (a late `PostToolUse` after `Stop` would calm
  the pet 2 s after "done"). Unlikely, since the final reply is generated after the last tool.
  Fix if needed: sequence numbers or timestamps from the hook script.
- A second instance can't bind the port; it runs without the endpoint and says so in the
  right-click menu. No single-instance guard yet.
- Window position is not remembered between runs.
- `npm run sprites` needs Node 22.18+ while everything else needs 20.19+.
- No CI yet.

## Next steps (suggested order)

1. **Record the real demo GIF** (`docs/demo.gif`, pet next to a Claude Code session) and
   replace the placeholder in the README. `npm run demo -- --loop` helps.
2. **CI + releases:** GitHub Actions running `npm run build` and `npm test` on Linux/macOS/
   Windows; a release workflow with `tauri-apps/tauri-action` producing `.dmg`, `.msi`/`.exe`,
   `.AppImage`/`.deb`. Prebuilt binaries are the biggest win for "easy install".
3. **Install hooks from the app** (Rust port of the installer, native confirm dialog, backup),
   writing `type: "http"` hooks so binary users need no Node.js.
4. **Test on macOS and Windows**; fix transparency/drag/hook quirks.
5. Single-instance guard (`tauri-plugin-single-instance`), remember window position, tray icon,
   launch at login.
6. A real **working** animation (typing / thinking) instead of reusing idle.
7. **Speech bubble** with `message` (e.g. "Bash needs permission"); the data already flows to the
   frontend (`PetEvent.message`).
8. **Multi-session awareness** via `session_id`: e.g. stay "waiting" while any session waits.
9. Adapters for other agents (Codex CLI, Gemini CLI, Cursor, Aider); the HTTP API is ready.
10. Level-up celebration, evolutions/skins, optional sounds.

## Handy commands

```bash
npm install
npm run dev                 # frontend in the browser: http://localhost:1420/?demo | ?state=error | ?hud
npm run app                 # desktop app (Vite + tauri dev)
npm run demo                # story through all states (app must run)
npm run hooks:install -- --dry-run
npm test                    # JS + Rust tests
npm run sprites -- --preview --gif   # docs/preview-*.png (ignored) + docs/states.gif
node scripts/render-sprites.mjs --icon && npx tauri icon src-tauri/app-icon.png
npx tauri build --no-bundle # release binary in src-tauri/target/release/
```

Linux build deps (Ubuntu 24.04): `libwebkit2gtk-4.1-dev build-essential libssl-dev
libayatana-appindicator3-dev librsvg2-dev libxdo-dev`.
