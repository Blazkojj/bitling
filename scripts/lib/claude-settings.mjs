// Pure helpers that add/remove Bitling's hooks in an agent's settings: Claude
// Code and Gemini CLI share the same JSON hooks layout; Codex uses one TOML
// `notify` line. No file system access here, so they are easy to test
// (claude-settings.test.mjs).

/** Every hook command Bitling installs contains this, which is how we find ours again. */
export const HOOK_MARKER = "bitling-hook.mjs";

/**
 * Claude Code hook events Bitling listens to and the pet state each one sets.
 * Keep in sync with `from_claude_hook()` in src-tauri/src/protocol.rs.
 * See https://code.claude.com/docs/en/hooks
 *
 * Hooks run in the background (`async`) so Claude never waits for the pet,
 * except the end-of-turn ones: Claude Code may exit right after them (e.g.
 * `claude -p`), which kills background hooks before they report. The script
 * takes ~0.1 s and is capped at 2 s, so running those inline is cheap.
 */
export const HOOK_EVENTS = [
  { event: "Stop", state: "done", inline: true, why: "Claude finished its task" },
  {
    event: "Notification",
    matcher: "permission_prompt|elicitation_dialog",
    state: "waiting",
    why: "Claude needs your approval or input",
  },
  { event: "StopFailure", state: "error", inline: true, why: "the turn died on an API error" },
  { event: "PostToolUseFailure", state: "error", why: "a tool call failed" },
  { event: "UserPromptSubmit", state: "working", why: "you sent a prompt (calms the pet)" },
  { event: "PostToolUse", state: "working", why: "a tool finished (clears 'waiting')" },
];

/**
 * Gemini CLI hook events (https://geminicli.com/docs/hooks/reference).
 * AfterTool covers failures too: the hook script switches to "error" when the
 * tool response carries an error. Gemini timeouts are in milliseconds.
 */
export const GEMINI_HOOK_EVENTS = [
  { event: "AfterAgent", state: "done", why: "Gemini finished its turn" },
  { event: "Notification", matcher: "ToolPermission", state: "waiting", why: "Gemini needs your approval" },
  { event: "BeforeAgent", state: "working", why: "you sent a prompt" },
  { event: "AfterTool", state: "working", why: "a tool finished (or failed: error)" },
];

/**
 * The shell command for one hook. Forward slashes work for Node on Windows
 * too and avoid backslash-escaping surprises in Git Bash / PowerShell.
 */
export function hookCommand(scriptPath, state, source) {
  const base = `node "${scriptPath.replaceAll("\\", "/")}" ${state}`;
  return source ? `${base} --source ${source}` : base;
}

/** Query string the app's own "Connect Claude Code" puts on its HTTP hook URLs. */
export const URL_MARKER = "via=bitling";

const isOurs = (hook) =>
  (typeof hook?.command === "string" && hook.command.includes(HOOK_MARKER)) ||
  (typeof hook?.url === "string" && hook.url.includes(URL_MARKER));

/** Returns a copy of `settings` without Bitling's hooks, and how many were removed. */
export function removeBitlingHooks(settings) {
  const result = structuredClone(settings ?? {});
  let removed = 0;
  if (!result.hooks || typeof result.hooks !== "object") return { settings: result, removed };

  for (const [event, groups] of Object.entries(result.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) {
        kept.push(group);
        continue;
      }
      const hooks = group.hooks.filter((hook) => !isOurs(hook));
      removed += group.hooks.length - hooks.length;
      // Drop groups we emptied, keep everything else exactly as it was.
      if (hooks.length > 0 || group.hooks.length === 0) kept.push({ ...group, hooks });
    }
    if (kept.length > 0) result.hooks[event] = kept;
    else delete result.hooks[event];
  }
  if (Object.keys(result.hooks).length === 0) delete result.hooks;
  return { settings: result, removed };
}

/**
 * Returns a copy of `settings` with Bitling's hooks (re)installed.
 * `agent` is "claude" (default) or "gemini".
 */
export function addBitlingHooks(settings, scriptPath, agent = "claude") {
  const { settings: result } = removeBitlingHooks(settings);
  result.hooks ??= {};
  const gemini = agent === "gemini";
  for (const { event, matcher, state, inline } of gemini ? GEMINI_HOOK_EVENTS : HOOK_EVENTS) {
    const command = hookCommand(scriptPath, state, gemini ? "gemini" : undefined);
    const hook = gemini
      ? { name: `bitling-${state}`, type: "command", command, timeout: 5000 }
      : inline
        ? { type: "command", command, timeout: 5 }
        : { type: "command", command, async: true };
    const group = { ...(matcher ? { matcher } : {}), hooks: [hook] };
    result.hooks[event] = [...(result.hooks[event] ?? []), group];
  }
  return result;
}

/** Counts Bitling hook commands currently present in `settings`. */
export function countBitlingHooks(settings) {
  return removeBitlingHooks(settings).removed;
}

// ---------------------------------------------------------------------------
// Codex CLI: a single root-level `notify = [...]` line in ~/.codex/config.toml.
// Codex runs it after every turn and appends a JSON payload as the last argument.

/** The `notify` line Bitling adds to config.toml. */
export function codexNotifyLine(scriptPath) {
  const path = scriptPath.replaceAll("\\", "/");
  return `notify = ["node", "${path}", "done", "--source", "codex"] # bitling`;
}

const NOTIFY_RE = /^\s*notify\s*=/;

/**
 * Adds the notify line. Root keys must come before any [table], so it goes at
 * the top. Throws if the user already has their own `notify` (Codex allows one).
 */
export function addCodexNotify(toml, scriptPath) {
  const lines = removeCodexNotify(toml).toml.split("\n");
  if (lines.some((line) => NOTIFY_RE.test(line))) {
    throw new Error("config.toml already has a `notify` command; Codex supports only one. Remove it or chain it first.");
  }
  const rest = lines.join("\n").replace(/^\n+/, "");
  return `${codexNotifyLine(scriptPath)}\n${rest ? `\n${rest}` : ""}`;
}

/** Removes Bitling's notify line (and only that one). */
export function removeCodexNotify(toml) {
  const lines = (toml ?? "").split("\n");
  const kept = lines.filter((line) => !(NOTIFY_RE.test(line) && line.includes(HOOK_MARKER)));
  const removed = lines.length - kept.length;
  const text = kept.join("\n");
  return { toml: removed ? text.replace(/^\n+/, "") : text, removed };
}
