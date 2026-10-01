// Pure helpers that add/remove Bitling's hooks in a Claude Code settings object.
// No file system access here, so they are easy to test (claude-settings.test.mjs).

/** Every hook command Bitling installs contains this, which is how we find ours again. */
export const HOOK_MARKER = "bitling-hook.mjs";

/**
 * Claude Code hook events Bitling listens to and the pet state each one sets.
 * Keep in sync with `from_claude_hook()` in src-tauri/src/protocol.rs.
 * See https://code.claude.com/docs/en/hooks
 */
export const HOOK_EVENTS = [
  { event: "Stop", state: "done", why: "Claude finished its task" },
  {
    event: "Notification",
    matcher: "permission_prompt|elicitation_dialog",
    state: "waiting",
    why: "Claude needs your approval or input",
  },
  { event: "StopFailure", state: "error", why: "the turn died on an API error" },
  { event: "PostToolUseFailure", state: "error", why: "a tool call failed" },
  { event: "UserPromptSubmit", state: "working", why: "you sent a prompt (calms the pet)" },
  { event: "PostToolUse", state: "working", why: "a tool finished (clears 'waiting')" },
];

/**
 * The shell command for one hook. Forward slashes work for Node on Windows
 * too and avoid backslash-escaping surprises in Git Bash / PowerShell.
 */
export function hookCommand(scriptPath, state) {
  return `node "${scriptPath.replaceAll("\\", "/")}" ${state}`;
}

const isOurs = (hook) => typeof hook?.command === "string" && hook.command.includes(HOOK_MARKER);

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

/** Returns a copy of `settings` with Bitling's hooks (re)installed. */
export function addBitlingHooks(settings, scriptPath) {
  const { settings: result } = removeBitlingHooks(settings);
  result.hooks ??= {};
  for (const { event, matcher, state } of HOOK_EVENTS) {
    const group = {
      ...(matcher ? { matcher } : {}),
      // async: Claude Code doesn't wait for the pet, ever.
      hooks: [{ type: "command", command: hookCommand(scriptPath, state), async: true }],
    };
    result.hooks[event] = [...(result.hooks[event] ?? []), group];
  }
  return result;
}

/** Counts Bitling hook commands currently present in `settings`. */
export function countBitlingHooks(settings) {
  return removeBitlingHooks(settings).removed;
}
