<div align="center">

# Bitling

[![CI](https://github.com/Blazkojj/bitling/actions/workflows/ci.yml/badge.svg)](https://github.com/Blazkojj/bitling/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Blazkojj/bitling?include_prereleases&label=download)](https://github.com/Blazkojj/bitling/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A tiny pixel pet that lives in the corner of your screen and reacts to your AI coding agent.**

It thinks while Claude works, waves a big **!** when it needs your approval, sweats when something
breaks, throws confetti when the job is done, and naps when you're away. Stop babysitting the
terminal.

<img src="docs/states.gif" alt="Bitling's moods: idle, working, waiting for you, done, error, asleep" width="660">

`idle` · `working` · `waiting for you` · `done` · `error` · `asleep`

Works with **Claude Code**, **Gemini CLI**, **Codex CLI**, **Cursor**, **Aider** and **OpenCode**.

**[▶ Try it in your browser](https://blazkojj.github.io/bitling/)** · [Download](https://github.com/Blazkojj/bitling/releases) · [Quick start](#quick-start) · [How it works](#how-it-works) · [Make it yours](#make-it-yours)

</div>

## Demo

A real Claude Code run: the test fails (Bitling sweats), Claude fixes the bug, the tests pass, and
Bitling levels up and grows a sprout.

<p align="center"><img src="docs/demo.gif" alt="Bitling reacting to a real Claude Code session" width="840"></p>

## Why

Coding agents work for minutes at a time, and then quietly wait for you. Bitling turns that into
something you notice from the corner of your eye, without notifications nagging you:

| Bitling... | because your agent... |
| --- | --- |
| 🟦 blinks and sways | is idle |
| 🟦 thinks "..." | is working |
| 🟨 jumps with a bouncing **!** | needs your permission or an answer |
| 🟩 cheers between sparkles | finished the task |
| ⬜ goes pale, X-eyed and sweating | hit an error |
| 💤 falls asleep | nothing happened for 10 minutes (3 at night) |

A speech bubble tells you *what* happened ("Bash wants to run `npm test`", "Fixed the login bug").
Every finished task earns XP; your Bitling levels up, grows a sprout at level 5 and a crown at
level 10, and collects achievements (night owl, 7-day streak, polyglot...). It has a name, it
loves being petted (double-click it), and when nothing happens it looks around, yawns, and
eventually naps.

## Features

- 🪟 Tiny transparent window, always on top, drag it anywhere, clicks pass through around it
- 💬 Speech bubbles with the agent's message, 🎵 optional chiptune sounds
- 🎨 Hand-made 10×9 pixel art drawn in code, 4 skins (Classic, Pastel, Midnight, Game Boy)
- ⭐ XP, levels, evolutions, a confetti party on level-up, 16 achievements and daily streaks
- 🥰 A name of its own, petting (double-click), idle tricks, naps; small / normal / large size
- 🔌 Works with **Claude Code** (one click, no Node.js needed), **Gemini CLI**, **Codex CLI**,
  **Cursor**, **Aider** and **OpenCode**
- 👥 Several agents at once: one waiting for you always wins, bubbles say which project it is
- 🔔 Tells you when a new version is out (once a day, can be turned off)
- 🧭 Tray icon, remembers its position, launch at login
- 🌐 Simple local HTTP API, so any tool, script or CI job can drive it
- 🪶 Tauri 2 + plain TypeScript, no frontend framework, a few MB, no 60 fps loop

## Quick start

### Download

Grab the installer for Windows, macOS or Linux from
[Releases](https://github.com/Blazkojj/bitling/releases), start Bitling, then **right-click the
pet → Connect Claude Code…** It shows what it will change, backs up your settings and adds the
hooks. Restart Claude Code and give it a task.

### From source

Needs [Node.js](https://nodejs.org) 20.19+, [Rust](https://rustup.rs) and the
[Tauri system dependencies](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/Blazkojj/bitling.git
cd bitling
npm install
npm run app            # Bitling appears in the bottom-right corner
```

Then connect your agent, either from the pet's right-click menu (Claude Code) or from a terminal:

```bash
npm run hooks:install                    # Claude Code
npm run hooks:install -- --agent gemini  # Gemini CLI
npm run hooks:install -- --agent codex   # Codex CLI
npm run hooks:install -- --agent cursor  # Cursor
npm run hooks:install -- --agent aider   # Aider
npm run hooks:install -- --agent opencode  # OpenCode
```

> **No agent at hand?** Right-click → **Play demo**, or `npm run demo`.

## Using Bitling

| Action | What it does |
| --- | --- |
| **Drag** | Move the pet (it remembers where) |
| **Click** | "Seen it": calm the pet down, dismiss the bubble |
| **Double-click** | Pet it ♥ |
| **Hover** | Show level and XP bar |
| **Right-click** / tray icon | Stats and achievements, demo, states, skins, size, sounds, bubbles, launch at login, updates, connect/disconnect Claude Code, quit |
| Keys **1–7**, **D**, **S**, **L** | Idle / done / waiting / error / working / asleep / petted, demo, next skin, level-up party (when focused) |

## How it works

```
Claude Code ─────── HTTP hook ─────────────────────────────┐
Gemini · Codex · Cursor · Aider ─▶ ~/.bitling/bitling-hook.mjs ─┼─▶ Bitling (127.0.0.1:47800)
OpenCode ─────── plugin ───────────────────────────────────┘
```

**Claude Code.** "Connect Claude Code…" in the app adds `type: "http"` hooks to
`~/.claude/settings.json` that post straight to Bitling. `npm run hooks:install` does the same
with a small, dependency-free Node script instead. Either way, a timestamped backup is saved and
the other one's hooks are cleaned up.

| Claude Code event | Bitling |
| --- | --- |
| `UserPromptSubmit`, `PostToolUse` | working |
| `Notification` (`permission_prompt`, `elicitation_dialog`) | waiting |
| `PostToolUseFailure`, `StopFailure` | error |
| `Stop` | done (+10 XP, bubble with the first line of Claude's answer) |

| Agent | Where | What Bitling sees |
| --- | --- | --- |
| Gemini CLI | `~/.gemini/settings.json` | `BeforeAgent`, `AfterTool` (error if the tool failed), `Notification` (`ToolPermission`), `AfterAgent` |
| Codex CLI | `notify` in `~/.codex/config.toml` | finished turns only |
| Cursor | `~/.cursor/hooks.json` | `beforeSubmitPrompt`, `afterFileEdit`, `afterShellExecution`, `stop` (completed / error / aborted) |
| Aider | `notifications_command` in `~/.aider.conf.yml` | finished, waiting for you |
| OpenCode | plugin in `~/.config/opencode/plugins/` | busy, `permission.asked`, `session.error`, `session.idle` |

Hooks never get in the agent's way: they return in ~0.1 s, print nothing the agent doesn't expect,
always exit 0 and give up after 1.5 s when Bitling isn't running. The installers never overwrite
an existing `notify` / `notifications_command`, and always back up the file they change.

Remove everything with right-click → **Disconnect Claude Code**, or
`npm run hooks:uninstall [-- --agent gemini|codex|cursor|aider|opencode]`.

## HTTP API

Bitling listens on `127.0.0.1` only, so anything can make it react: a long build, a deploy, your
test watcher.

```bash
curl -X POST http://127.0.0.1:47800/event \
  -H "Content-Type: application/json" \
  -d '{"state": "done", "source": "ci", "message": "Deploy finished 🚀"}'
```

| Route | Description |
| --- | --- |
| `POST /event` | `{"state": "idle" \| "working" \| "done" \| "waiting" \| "error", "source"?, "message"?, "session"?, "project"?}`, or a raw Claude Code hook payload |
| `GET /state` | Current state, XP and active sessions |
| `GET /health` | `{"ok": true, "app": "bitling", "version": "..."}` |
| `POST /show` | Bring the window back |

`POST` requires `Content-Type: application/json`, which websites can't send cross-origin, so no web
page can poke your pet. Events with `"source": "demo"` don't earn XP.

## Make it yours

The sprites are plain text in [`src/sprites.ts`](src/sprites.ts): one character per pixel, a
palette per state, and a list of frames with timings. Skins live in [`src/skins.ts`](src/skins.ts),
evolutions in `ACCESSORIES`. Edit, save, and `npm run dev` reloads in the browser
(`http://localhost:1420/?demo`, or `?state=waiting&skin=gameboy&level=12&say=Hi`).

```
......A...
.....E....
..HHBBBB..
.BHEBBEBB.
.BBEBBEBD.
.BBBBBBBD.
.BBBEEBBD.
..DDDDDD..
..L....L..
```

`npm run sprites -- --gif` re-exports the preview (Node 22.18+). New skins, moods and evolutions
are the best kind of PR.

## Settings and files

Everything lives in `~/.bitling/`: `state.json` (name, XP, stats, streaks, achievements),
`config.json` (skin, size, sound, bubbles, updates, position) and the hook script. Rename your pet
by editing `name` in `state.json`.

| Environment variable | Default | |
| --- | --- | --- |
| `BITLING_PORT` | `47800` | Port of the local API (set it for the app *and* the hooks) |
| `BITLING_HOME` | `~/.bitling` | Data directory |
| `BITLING_DEMO` | unset | `1` starts in demo mode |

## Roadmap

- [x] Transparent always-on-top pet with animated states, speech bubbles, sounds
- [x] Claude Code: one-click connect from the app, Node installer as an alternative
- [x] Gemini CLI, Codex CLI, Cursor, Aider and OpenCode adapters
- [x] XP, levels, evolutions, level-up party, skins, a sleepy mood
- [x] Multiple sessions with project names, tray, remembered position, launch at login, single instance
- [x] Prebuilt installers via GitHub Actions, update notifications
- [x] Achievements, streaks, petting, idle tricks, sizes, a browser playground
- [ ] Signed and notarized builds with one-click auto-update (needs signing certificates)
- [ ] Editor extensions (VS Code, JetBrains) that talk to the HTTP API
- [ ] More moods and evolutions, community skins gallery, localized bubbles
- [ ] Bitling friends: one pet per project, side by side

## Troubleshooting

- **Black box around the pet (Linux).** Transparent windows need a compositing window manager
  (GNOME, KDE and most modern desktops have one).
- **Nothing happens when Claude works.** Restart Claude Code after connecting, check `/hooks`, and
  test the pipe with `npm run demo` or the curl above.
- **"Port 47800 unavailable".** Another app uses the port: set `BITLING_PORT` for both the app and
  the hooks.
- **macOS says the app is from an unidentified developer.** Builds aren't notarized yet:
  right-click the app → Open.

## Contributing

Issues and PRs are welcome, especially sprites, skins, agent adapters and platform fixes. See
[CONTRIBUTING.md](CONTRIBUTING.md) for how to add a skin, a mood or a new agent.

```bash
npm run dev      # frontend only, in the browser
npm run app      # full desktop app
npm test         # JS + Rust tests
```

## License

[MIT](LICENSE)
