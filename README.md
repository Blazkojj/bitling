<div align="center">

# Bitling

**A tiny pixel pet that lives in the corner of your screen and reacts to your AI coding agent.**

It cheers when Claude Code finishes a task, jumps up with a big **!** when it needs your approval,
and breaks into a sweat when something fails. Stop babysitting the terminal.

<img src="docs/states.gif" alt="Bitling's four moods: idle, waiting for you, done, error" width="444">

`idle` · `waiting for you` · `done` · `error`

</div>

## Demo

> 🎬 **Demo GIF coming soon:** Bitling sitting next to a real Claude Code session.

<!--
  Record it with `npm run app` + `npm run demo -- --loop` (or a real Claude Code task),
  save it as docs/demo.gif and replace the quote above with:
  <p align="center"><img src="docs/demo.gif" alt="Bitling reacting to Claude Code" width="720"></p>
-->

## Why

Coding agents work for minutes at a time, and then quietly wait for you. Bitling turns that
into something you notice from the corner of your eye:

| Bitling is... | because Claude Code... |
| --- | --- |
| 🟦 **calm**, blinking and swaying | is working, or nothing is going on |
| 🟨 **alarmed**, wide eyes and a bouncing **!** | needs your permission or an answer |
| 🟩 **happy**, jumping between sparkles | finished the task |
| ⬜ **pale**, X-eyed and sweating | hit an error (failed tool call, API error) |

Every finished task earns XP, and your Bitling levels up over time.

## Features

- 🪟 Tiny transparent window, always on top, no frame, drag it anywhere
- 🎨 Hand-made 10×9 pixel art drawn in code: sprites are ASCII art you can edit in a PR
- 🔌 Hooks into Claude Code in one command, with a backup of your settings
- 🌐 Simple local HTTP API (`127.0.0.1:47800`), so any tool or agent can drive it
- ⭐ XP and levels, saved in a plain JSON file
- 🪶 Light: Tauri 2 + plain TypeScript and Canvas, no frontend framework, no 60 fps loop
- 🖥️ Windows, macOS and Linux via Tauri (so far tested on Linux; macOS/Windows reports welcome!)

## Quick start

Prebuilt downloads are on the [roadmap](#roadmap). For now, run it from source:

**Prerequisites:** [Node.js](https://nodejs.org) 20.19+, [Rust](https://rustup.rs), and the
[Tauri system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
git clone https://github.com/Blazkojj/bitling.git
cd bitling
npm install
npm run app            # Bitling appears in the bottom-right corner
```

Then, in another terminal, connect it to Claude Code:

```bash
npm run hooks:install  # shows the changes, asks first, backs up your settings
```

Restart Claude Code (or open `/hooks`) and give Claude a task. That's it.

> **No agent at hand?** `npm run demo` plays through every state, see [Try it without an agent](#try-it-without-an-agent).

## Using Bitling

| Action | What it does |
| --- | --- |
| **Drag** | Move the pet anywhere |
| **Click** | "Seen it": calm the pet back to idle |
| **Hover** | Show level and XP bar |
| **Right-click** | Menu: level, demo mode, pick a state, quit |
| **1 2 3 4** / **D** | Idle / done / waiting / error / toggle demo mode (when the pet has focus) |

## How it works

```
Claude Code ──hook──▶ node ~/.bitling/bitling-hook.mjs done ──HTTP POST──▶ Bitling (127.0.0.1:47800)
```

`npm run hooks:install` copies a small, dependency-free hook script to `~/.bitling/` and registers
it in `~/.claude/settings.json` for these [Claude Code hook events](https://code.claude.com/docs/en/hooks):

| Hook event | Pet state |
| --- | --- |
| `Stop` | done |
| `Notification` (`permission_prompt`, `elicitation_dialog`) | waiting |
| `StopFailure`, `PostToolUseFailure` | error |
| `UserPromptSubmit`, `PostToolUse` | working (calm again) |

Frequent hooks run in the background (`async: true`), so Claude Code never waits for the pet. The
end-of-turn ones (`Stop`, `StopFailure`) run inline, because Claude Code may exit right after them
(e.g. `claude -p`) and would kill a background hook; they take about 0.1 s. The script never prints
to stdout, always exits with code 0 and gives up after 1.5 s, so a closed Bitling can't break your
agent.

Useful flags: `npm run hooks:install -- --dry-run` (just print the result),
`-- --settings .claude/settings.local.json` (one project only), `-- --yes` (no prompt).
Remove everything with `npm run hooks:uninstall`.

## Try it without an agent

With the app running:

```bash
npm run demo              # a short story through every state
npm run demo -- --loop    # keep looping, e.g. while recording a GIF
npm run demo -- waiting   # set one state
```

Or talk to the HTTP API directly:

```bash
curl -X POST http://127.0.0.1:47800/event \
  -H "Content-Type: application/json" \
  -d '{"state": "done", "source": "my-script", "message": "Build finished"}'
```

You can also tweak the art without the desktop app: `npm run dev` and open
`http://localhost:1420/?demo` (or `?state=waiting`, `?hud`) in your browser.

## HTTP API

Bitling listens on `127.0.0.1` only.

| Route | Description |
| --- | --- |
| `POST /event` | `{"state": "idle" \| "working" \| "done" \| "waiting" \| "error", "source"?: string, "message"?: string}` |
| `GET /state` | Current state and XP |
| `GET /health` | `{"ok": true, "app": "bitling", "version": "..."}` |

`POST /event` requires `Content-Type: application/json`. It also accepts raw Claude Code hook
payloads, so instead of the script you can point an
[HTTP hook](https://code.claude.com/docs/en/hooks) straight at Bitling (no Node.js needed):

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "http", "url": "http://127.0.0.1:47800/event" }] }]
  }
}
```

Want Bitling to react to another agent or tool (Codex, Gemini CLI, Aider, your CI...)? Anything
that can send that one request works. Adapters are very welcome!

## XP and levels

Each finished task (`done`) is worth 10 XP, and each level needs 50 XP more than the previous one
(level 2 at 50 XP, level 3 at 150, level 4 at 300...). Progress lives in `~/.bitling/state.json`.
Demo events don't count.

## Configuration

| Environment variable | Default | |
| --- | --- | --- |
| `BITLING_PORT` | `47800` | Port of the local API (set it for the app *and* the hooks) |
| `BITLING_HOME` | `~/.bitling` | Where the hook script and `state.json` live |
| `BITLING_DEMO` | unset | `1` starts the app in demo mode |

## Make it yours

The sprites are plain text in [`src/sprites.ts`](src/sprites.ts): one character per pixel, a
palette per state, and a list of frames with timings. Edit, save, and `npm run dev` reloads.
`npm run sprites` re-exports the preview images (`-- --gif` for the animated one; needs Node 22.18+).

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

## Roadmap

- [x] Transparent always-on-top pet with 4 animated states
- [x] Claude Code hooks + one-command installer
- [x] Local HTTP API, demo mode
- [x] XP and levels
- [ ] Prebuilt binaries for Windows, macOS and Linux (GitHub Releases)
- [ ] Install hooks from the app itself (no Node.js needed)
- [ ] "Working" animation while the agent is busy
- [ ] Speech bubble with the last message ("Bash needs permission")
- [ ] Remember window position, tray icon, launch at login
- [ ] Multiple sessions / agents at once
- [ ] Adapters for other agents (Codex CLI, Gemini CLI, Cursor, Aider...)
- [ ] Sound effects (opt-in), more skins, level-up evolutions

## Troubleshooting

- **The pet has a black box around it (Linux).** Transparent windows need a compositing window
  manager (GNOME, KDE and most modern desktops have one).
- **"Port 47800 unavailable" in the right-click menu.** Another Bitling (or another app) is using
  the port. Close it, or set `BITLING_PORT` for both the app and Claude Code.
- **Nothing happens when Claude works.** Restart Claude Code after installing the hooks, check
  them with `/hooks`, and make sure `node` is on your `PATH`. Test the pipe with `npm run demo`.

## Contributing

Issues and PRs are welcome, especially new sprites, agent adapters and platform fixes.

```bash
npm run dev      # frontend only, in the browser
npm run app      # full desktop app
npm test         # JS + Rust tests
```

## License

[MIT](LICENSE)
