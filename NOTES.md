# Bitling: development notes

Working notes for contributors. The README is the user-facing doc; this file records *why*
things are the way they are, what has been verified, and what to do next.

## Status (v0.2.0, 2026-10-01)

The whole original roadmap is implemented:

- 5 animated states (idle, working, waiting, done, error), speech bubbles, optional sounds.
- XP and levels, evolutions (sprout at 5, crown at 10), confetti on level-up, 4 skins.
- Claude Code: one-click "Connect" from the app (HTTP hooks, no Node) or `npm run hooks:install`.
- Gemini CLI and Codex CLI adapters (`--agent gemini|codex`).
- Multiple agent sessions, tray icon, native menu, remembered position, launch at login,
  single instance, click-through outside the pet.
- CI and a tag-triggered release workflow producing installers for all three platforms.
- `docs/demo.gif` is a real recording (Claude Code `-p` run, see "Recording the demo").

### Verified (Linux, Xvfb)

- `npm test`: 10 JS tests + 21 Rust tests; `cargo clippy -D warnings`, `cargo fmt --check`.
- Real Claude Code 2.1.287 end-to-end, both with the Node script hooks and with the app's HTTP
  hooks: UserPromptSubmit/PostToolUse → working, PostToolUseFailure → error with the traceback in
  the bubble, Stop → done with the first line of Claude's answer, +10 XP, level-up.
- Native menu, "Connect Claude Code" dialog (backup written, hooks added), single-instance
  fallback, position saved and restored, multi-session priority (waiting wins).
- Simulated Codex `notify` and Gemini `AfterTool`/`AfterAgent` payloads through the hook script.

### Not verified yet

- macOS and Windows builds (the release workflow has never run: push a `v0.2.0` tag).
- Tray icon display (the container has no D-Bus / tray host), autostart, the D-Bus based
  single-instance plugin, click-through with a real window manager / Wayland.
- Real Gemini CLI and Codex CLI sessions (only their documented payloads were tested).
- Sounds (no audio device in the container).
- The `Notification`/`permission_prompt` hook from a live interactive session.

## Architecture

```
hooks/bitling-hook.mjs        hook script for Claude/Gemini/Codex (copied to ~/.bitling/)
scripts/install-hooks.mjs     CLI installer (--agent claude|gemini|codex)
scripts/lib/claude-settings   pure merge logic for all agents + node:test tests
scripts/demo.mjs              drives a running app over HTTP
scripts/render-sprites.mjs    PNG/GIF/icon export from the sprite data
src/sprites.ts                ASCII pixel art, palettes, frames, accessories (pure data)
src/skins.ts                  palette overrides per skin
src/scene.ts                  frame → 16x18 color grid: outline, shadow, HUD, confetti (pure)
src/animation.ts              steps through frames in real time
src/renderer.ts               paints a scene on the canvas (DPR-aware)
src/sound.ts                  WebAudio jingles
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

## Known issues / edge cases

- macOS builds are not signed/notarized (Gatekeeper warning). Needs an Apple developer account.
- Codex's `notify` only fires on finished turns: no waiting/error for Codex.
- Gemini hooks were written against the documented format only.
- If the user already has a Codex `notify`, the installer refuses instead of chaining.
- Async hook events could in theory arrive out of order (only with the Node script).

## Next steps

1. Push a `v0.2.0` tag, check the release workflow on all platforms, publish the draft release.
2. Test on macOS and Windows (transparency, click-through, tray, autostart, PowerShell hooks).
3. Signing/notarization and the Tauri updater.
4. More agents: Cursor hooks, Aider, OpenCode; a VS Code extension that posts to the API.
5. More moods: sleepy at night, bored after long idle, happy streaks.
6. Per-project pets (one Bitling per repository / session).

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
