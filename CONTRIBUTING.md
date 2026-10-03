# Contributing to Bitling

Thanks for helping Bitling grow! The best first PRs are new skins, moods, evolutions and agent
adapters. You don't need Rust for any of them.

## Setup

```bash
npm install
npm run dev     # the pet in your browser, hot reload: http://localhost:1420/?demo
npm run app     # the real desktop app (needs Rust + Tauri system deps)
npm test        # JS + Rust tests
```

Browser preview parameters: `?state=waiting`, `?skin=gameboy`, `?level=12`, `?say=Hello`, `?hud`,
`?demo`. Keys `1`–`6` switch states, `S` cycles skins, `L` throws a level-up party.

## Add a skin

Skins only recolor the existing pixel art. Add an entry to `SKINS` in
[`src/skins.ts`](src/skins.ts) (body, shade, highlight and antenna tip per state; see the
character legend at the top of [`src/sprites.ts`](src/sprites.ts)) and the same id + name to
`SKINS` in [`src-tauri/src/menu.rs`](src-tauri/src/menu.rs) so it shows up in the menu.

Preview it: `npm run sprites -- --preview --skin <id>` writes `docs/preview-light.png` and
`docs/preview-dark.png` (Node 22.18+). Please check both: the pet must read well on light and
dark wallpapers.

## Add a mood or an evolution

Frames are ASCII art in [`src/sprites.ts`](src/sprites.ts): one character per pixel on a 10x9
grid. The outline is added automatically, so don't draw it. Each animation has 2–4 frames and a
list of steps with timings. Evolutions are small grids in `ACCESSORIES`, unlocked by level.

## Add an agent adapter

Anything that can run a command or send an HTTP request can drive Bitling:

```bash
curl -X POST http://127.0.0.1:47800/event -H "Content-Type: application/json" \
  -d '{"state": "done", "source": "my-agent", "message": "Finished!", "session": "abc", "project": "my-app"}'
```

To ship an adapter with Bitling:

1. Teach [`hooks/bitling-hook.mjs`](hooks/bitling-hook.mjs) the agent's payload (event name,
   message, session id) if it calls hooks with JSON.
2. Add pure add/remove functions for its config file to
   [`scripts/lib/agents.mjs`](scripts/lib/agents.mjs), with tests in `agents.test.mjs`. Never
   overwrite something the user configured themselves, and keep removal exact.
3. Register it in `AGENTS` in [`scripts/install-hooks.mjs`](scripts/install-hooks.mjs).
4. Add a row to the agent table in the README.

Hook rules: return fast, always exit 0, print nothing on stdout unless the agent requires it, and
give up quickly when Bitling isn't running.

## Pull requests

- Small, focused commits with a message that says why.
- `npm test` and `npm run build` must pass; CI also runs `cargo fmt --check` and clippy.
- For visual changes, attach a screenshot or GIF (the `?demo` page is easy to record).
