# Bitling: development notes

Working notes for contributors. The README is the user-facing doc; this file records *why*
things are the way they are, what has been verified, and what to do next.

## Status (v0.2.0, 2026-10-03)

- 5 agent states (idle, working, waiting, done, error) plus the pet's own moods (asleep, petted,
  looking around, yawning), speech bubbles, optional sounds, 3 sizes, 4 skins.
- XP and levels, evolutions (sprout at 5, crown at 10), confetti on level-up, 16 achievements,
  daily streaks, stats, a random name per pet.
- Claude Code: one-click "Connect" from the app (HTTP hooks, no Node) or `npm run hooks:install`.
- Adapters for Gemini CLI, Codex CLI, Cursor, Aider, OpenCode (`--agent ...`).
- Multiple agent sessions with project names, tray icon, native menu, remembered position,
  launch at login, single instance, click-through outside the pet, daily update check.
- CI on every push; a release workflow (tag or manual run with a tag → draft release, manual run
  without a tag → artifacts only);
  a Pages workflow for the browser playground (`playground.html`).
- `docs/demo.gif` is a real recording (Claude Code `-p` run, see "Recording the demo").

### Verified

- GitHub Actions: CI green; the release workflow built installers on macOS (Apple Silicon and
  Intel), Windows and Linux (manual run, artifacts only). The Pages build step works; deploying
  needs Pages enabled (Settings → Pages → Source: GitHub Actions).

On Linux under Xvfb:

- `npm test`: 13 JS tests + 26 Rust tests; `cargo clippy -D warnings`, `cargo fmt --check`.
- Petting, achievement bubbles (queued after other bubbles), the stats menu, sizes, the greeting
  with the pet's name; the playground page in headless Chromium (desktop and phone width).
- Simulated Cursor, Aider and OpenCode events through the hook script / plugin.
- Real Claude Code 2.1.287 end-to-end, both with the Node script hooks and with the app's HTTP
  hooks: UserPromptSubmit/PostToolUse → working, PostToolUseFailure → error with the traceback in
  the bubble, Stop → done with the first line of Claude's answer, +10 XP, level-up.
- Native menu, "Connect Claude Code" dialog (backup written, hooks added), single-instance
  fallback, position saved and restored, multi-session priority (waiting wins).
- Simulated Codex `notify` and Gemini `AfterTool`/`AfterAgent` payloads through the hook script.

### Not verified yet

- Running the macOS and Windows builds (they compile and bundle in CI; nobody has launched them).
- Tray icon display (the container has no D-Bus / tray host), autostart, the D-Bus based
  single-instance plugin, click-through with a real window manager / Wayland.
- Real Gemini CLI, Codex CLI, Cursor, Aider and OpenCode sessions (documented payloads only).
- Sounds (no audio device in the container).
- The `Notification`/`permission_prompt` hook from a live interactive session.

## Architecture

```
hooks/bitling-hook.mjs        hook script for Claude/Gemini/Codex/Cursor/Aider (copied to ~/.bitling/)
hooks/opencode-bitling.js     OpenCode plugin (copied to ~/.config/opencode/plugins/)
scripts/install-hooks.mjs     CLI installer (--agent claude|gemini|codex|cursor|aider|opencode)
scripts/lib/agents.mjs        pure config merge logic for all agents + node:test tests
scripts/demo.mjs              drives a running app over HTTP
scripts/render-sprites.mjs    PNG/GIF/icon export from the sprite data
src/sprites.ts                ASCII pixel art, palettes, frames, accessories (pure data)
src/skins.ts                  palette overrides per skin
src/scene.ts                  frame → 16x18 color grid: outline, shadow, HUD, confetti (pure)
src/animation.ts              steps through frames in real time
src/renderer.ts               paints a scene on the canvas (DPR-aware)
src/sound.ts                  WebAudio jingles
src/updates.ts                daily GitHub "latest release" check
src/playground.ts             browser playground (playground.html) driving the pet via window.bitling
src/pet.css / window.css      pet + bubble styles / the transparent app window
src-tauri/src/achievements.rs achievement rules (pure, tested)
src/bridge.ts                 all Tauri calls; no-ops in a plain browser
src/main.ts                   wiring: input, bubbles, demo, agent events, hit regions
src-tauri/src/main.rs         setup, plugins, commands, shared state
src-tauri/src/server.rs       tiny_http endpoint + routing, single-instance fallback
src-tauri/src/protocol.rs     JSON event parsing, raw Claude Code payload mapping
src-tauri/src/sessions.rs     multi-session aggregation
src-tauri/src/progress.rs     XP curve, state.json
src-tauri/src/config.rs       config.json (skin, sound, bubbles, position)
src-tauri/src/claude_hooks.rs "Connect Claude Code" (HTTP hooks, backup)
src-tauri/src/menu.rs         one native menu for tray + right-click
src-tauri/src/window.rs       placement, position memory, click-through polling
```

Data flow: hook → `POST /event` → `AppSink::on_event` (sessions, XP, save) → Tauri event
`bitling:event` (aggregated `state` + this event's `eventState` + message) → `main.ts`.

## Decisions

1. **Tauri 2 + Vite + plain TypeScript.** Small binary, native transparency, no framework.
2. **Sprites are ASCII grids**; the outline is computed in `scene.ts`, so art stays editable.
   Skins only override palette characters; accessories are stamped on the head row detected per
   frame, so they follow jumps and squashes.
3. **Scene composition is pure and DOM-free**, shared with the Node export script (type
   stripping: `.ts` imports, `erasableSyntaxOnly`, Node 22.18+ for `npm run sprites`).
4. **Window 240x224** with the 128x144 canvas bottom-right and the bubble above it. Everything but
   the canvas and the bubble is click-through: the frontend reports hit rectangles
   (`set_hit_regions`), a Rust thread polls the cursor every 50 ms and toggles
   `set_ignore_cursor_events`. Without a global cursor position (some Wayland setups) the window
   simply stays clickable.
5. **One native menu in Rust** (`menu.rs`) for the tray and the right-click popup
   (`popup_menu_at`, the plain `popup_menu` showed a 1x1 menu on Linux). Menu actions that touch
   the animation are sent to the frontend as `bitling:command`.
6. **Connect from the app writes `type: "http"` hooks** (`?via=bitling` marks them). No Node
   needed, nothing to spawn per tool call. The Node installer stays for Gemini/Codex and for
   people who prefer command hooks; both installers recognise and remove each other's hooks.
   `serde_json` uses `preserve_order` so the user's settings keep their key order.
7. **Hook timing (Node script):** frequent hooks are `async`; `Stop`/`StopFailure` run inline with
   a 5 s timeout because `claude -p` kills background hooks at exit (found in a real run). HTTP
   hooks are always inline but take ~1 ms locally.
8. **Real payload quirks:** `PostToolUseFailure` sends `error` (docs say `tool_error`);
   Notification's type field is documented both as `notification_type` and `type`. All handled.
9. **Sessions:** a waiting session always wins, otherwise the newest event; sessions expire after
   2 h; clicking the pet clears them (`acknowledge`). The bubble describes the event itself, not
   the aggregate.
10. **Reactions stay ≥ 2 s** before a `working` event calms the pet (no flicker on fail → retry).
11. **Single instance:** `tauri-plugin-single-instance` (needs D-Bus on Linux) plus a fallback: if
    the port is taken by a Bitling (`/health`), the new process calls `/show` and exits.
12. **Position memory by polling** `outer_position()` every 1.5 s; "moved" events fire hundreds
    of times per drag and not at all on some Linux setups.
13. **Security:** 127.0.0.1 only; `POST` requires `application/json` (no CORS preflight is ever
    answered, so web pages can't drive the pet); bodies ≤ 1 MiB; messages trimmed to 200 chars.
14. **XP:** 10 per done, level L needs `25·L·(L−1)` total XP; `source: "demo"` earns nothing.
15. **Data in `~/.bitling/`** (state, config, hook script); `BITLING_HOME` overrides.
16. **Sounds are synthesized** (WebAudio square/triangle waves), off by default.
17. **Adapters:** Cursor's `beforeSubmitPrompt` gets `{"continue":true}` on stdout and its `stop`
    status maps to done/error/idle; Aider's `notifications_command` (run with `shell=True`) is the
    only signal Aider gives; OpenCode runs on Bun, so its adapter is a plugin calling `fetch`
    directly. Installers refuse to replace a user's own Codex `notify` / Aider command.
18. **Sleep** is the pet's own mood (not in the protocol: `AgentState = Exclude<PetState,
    "sleep">`): 10 quiet minutes, 3 at night (22:00–06:00), only from idle/done and never during
    demo or while a bubble is up. Thin Z glyphs are "floating stamps" drawn after the outline.
19. **Project names:** hooks send the folder name (`cwd`, Cursor `workspace_roots[0]`, OpenCode
    `directory`); bubbles show `[project]` only when 2+ sessions are active, to avoid clutter.
20. **Updates are notify-only:** the frontend fetches `releases/latest` once a day (CSP allows
    `https://api.github.com` only), the backend accepts the URL only if it starts with this
    repository's releases page, and the menu opens it in the browser. Real auto-update would need
    the Tauri updater plus a signing key stored as a GitHub secret.
21. **Achievements** are pure rules over counters (`achievements.rs`); time-based ones use the
    local hour/weekday of the event (chrono). Streaks count local calendar days with a done event.
    Unlocks are announced through a bubble queue so they don't overwrite each other.
22. **Sizes** scale the canvas (6/8/11 px per big pixel); the Rust side resizes the window keeping
    the bottom-right corner fixed and computes window sizes instead of reading them back.
23. **Playground** reuses `main.ts` as-is in the browser; `window.bitling` only exists outside
    Tauri. The page is built separately (`vite.site.config.ts`, relative base) so the app bundle
    stays unchanged.

## Known issues / edge cases

- macOS builds are not signed/notarized (Gatekeeper warning). Needs an Apple developer account.
- Codex's `notify` only fires on finished turns: no waiting/error for Codex.
- Gemini hooks were written against the documented format only.
- If the user already has a Codex `notify`, the installer refuses instead of chaining.
- Async hook events could in theory arrive out of order (only with the Node script).

## Next steps

1. Publish the draft release "Bitling v0.2.0" (Releases page; check the installers first).
   It was created by a manual run of the release workflow with `tag: v0.2.0`; the git tag
   appears when the release is published. Next releases: bump the version in package.json,
   Cargo.toml and tauri.conf.json, then push a `vX.Y.Z` tag or run the workflow with that tag.
2. Enable GitHub Pages (Settings → Pages → Source: GitHub Actions) and run the "Playground"
   workflow, so the README's "Try it in your browser" link works.
3. Launch the macOS and Windows builds by hand: transparency, click-through, tray, autostart,
   hooks under PowerShell.
4. Signing/notarization and the Tauri updater (needs certificates and a signing key secret).
5. Editor extensions (VS Code, JetBrains) posting to the HTTP API.
6. Localized bubbles and menu, more moods/evolutions, a community skins gallery.
7. Per-project pets (one Bitling per repository / session), side by side.

## Recording the demo

`docs/demo.gif` was recorded under Xvfb: Bitling + an xterm running `claude -p ... --output-format
stream-json --verbose` piped through a tiny formatter, captured with
`ffmpeg -f x11grab -draw_mouse 0` and converted with a 96-color palette. Without a compositor the
window background is black, so a dark terminal theme makes it look seamless. A recording on a
real desktop (transparent window over a wallpaper) would look even better.

## Handy commands

```bash
npm run dev                 # browser: http://localhost:1420/?demo | ?state=error&skin=gameboy&level=12
npm run app                 # desktop app
npm run demo                # story through all states over HTTP (app must run)
npm run hooks:install -- --dry-run [--agent gemini|codex]
npm test                    # JS + Rust tests
npm run sprites -- --preview --gif [--skin midnight --level 12]
npx tauri build --no-bundle # release binary in src-tauri/target/release/
git tag v0.2.0 && git push origin v0.2.0   # build installers on GitHub
```

Linux build deps (Ubuntu 24.04): `libwebkit2gtk-4.1-dev build-essential libssl-dev
libayatana-appindicator3-dev librsvg2-dev libxdo-dev`.
