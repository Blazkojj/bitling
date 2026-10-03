import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addAiderNotify,
  addBitlingHooks,
  addCursorHooks,
  CURSOR_HOOK_EVENTS,
  removeAiderNotify,
  removeCursorHooks,
  addCodexNotify,
  GEMINI_HOOK_EVENTS,
  removeCodexNotify,
  countBitlingHooks,
  HOOK_EVENTS,
  hookCommand,
  removeBitlingHooks,
} from "./agents.mjs";

const SCRIPT = "/home/me/.bitling/bitling-hook.mjs";

test("adds one hook per event to empty settings", () => {
  const result = addBitlingHooks({}, SCRIPT);
  assert.equal(countBitlingHooks(result), HOOK_EVENTS.length);
  // End of turn: inline with a timeout, so it finishes before Claude Code exits.
  assert.deepEqual(result.hooks.Stop, [
    { hooks: [{ type: "command", command: `node "${SCRIPT}" done`, timeout: 5 }] },
  ]);
  // Everything else runs in the background.
  assert.deepEqual(result.hooks.PostToolUse, [
    { hooks: [{ type: "command", command: `node "${SCRIPT}" working`, async: true }] },
  ]);
  assert.equal(result.hooks.Notification[0].matcher, "permission_prompt|elicitation_dialog");
});

test("keeps the user's own settings and hooks untouched", () => {
  const userHook = { matcher: "Bash", hooks: [{ type: "command", command: "./lint.sh" }] };
  const before = { model: "opus", permissions: { allow: ["Bash(npm test)"] }, hooks: { PostToolUse: [userHook] } };
  const result = addBitlingHooks(before, SCRIPT);

  assert.equal(result.model, "opus");
  assert.deepEqual(result.permissions, before.permissions);
  assert.deepEqual(result.hooks.PostToolUse[0], userHook);
  assert.equal(result.hooks.PostToolUse.length, 2);
  // The input object is not mutated.
  assert.equal(before.hooks.PostToolUse.length, 1);
});

test("installing twice does not duplicate hooks", () => {
  const once = addBitlingHooks({}, SCRIPT);
  const twice = addBitlingHooks(once, "/elsewhere/bitling-hook.mjs");
  assert.equal(countBitlingHooks(twice), HOOK_EVENTS.length);
  assert.match(twice.hooks.Stop[0].hooks[0].command, /elsewhere/);
});

test("uninstall restores the original settings", () => {
  const original = {
    theme: "dark",
    hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] },
  };
  const { settings, removed } = removeBitlingHooks(addBitlingHooks(original, SCRIPT));
  assert.equal(removed, HOOK_EVENTS.length);
  assert.deepEqual(settings, original);
});

test("uninstall drops the hooks key when only Bitling used it", () => {
  const { settings } = removeBitlingHooks(addBitlingHooks({ theme: "dark" }, SCRIPT));
  assert.deepEqual(settings, { theme: "dark" });
});

test("Windows paths use forward slashes", () => {
  assert.equal(
    hookCommand("C:\\Users\\me\\.bitling\\bitling-hook.mjs", "waiting"),
    'node "C:/Users/me/.bitling/bitling-hook.mjs" waiting',
  );
});

test("also removes the HTTP hooks added by the app", () => {
  const settings = {
    hooks: { Stop: [{ hooks: [{ type: "http", url: "http://127.0.0.1:47800/event?via=bitling" }] }] },
  };
  assert.deepEqual(removeBitlingHooks(settings), { settings: {}, removed: 1 });
});

test("Gemini CLI hooks use names, ms timeouts and --source gemini", () => {
  const result = addBitlingHooks({}, SCRIPT, "gemini");
  assert.equal(countBitlingHooks(result), GEMINI_HOOK_EVENTS.length);
  assert.deepEqual(result.hooks.AfterAgent[0].hooks[0], {
    name: "bitling-done",
    type: "command",
    command: `node "${SCRIPT}" done --source gemini`,
    timeout: 5000,
  });
  assert.equal(result.hooks.Notification[0].matcher, "ToolPermission");
});

test("Codex notify line goes before tables and comes off cleanly", () => {
  const toml = 'model = "o4"\n\n[mcp_servers.x]\ncommand = "y"\n';
  const added = addCodexNotify(toml, SCRIPT);
  assert.ok(added.startsWith(`notify = ["node", "${SCRIPT}", "done", "--source", "codex"]`));
  assert.ok(added.indexOf("notify") < added.indexOf("[mcp_servers.x]"));
  // Re-adding replaces instead of duplicating.
  assert.equal(addCodexNotify(added, SCRIPT).match(/notify/g).length, 1);
  assert.equal(removeCodexNotify(added).toml.trim(), toml.trim());
});

test("Codex: an existing user notify is never overwritten", () => {
  assert.throws(() => addCodexNotify('notify = ["say", "hi"]\n', SCRIPT), /already has a `notify`/);
});

test("Cursor hooks.json gets flat command entries and keeps the user's", () => {
  const before = { version: 1, hooks: { stop: [{ command: "./notify.sh" }] } };
  const added = addCursorHooks(before, SCRIPT);
  assert.equal(added.hooks.stop.length, 2);
  assert.equal(added.hooks.beforeSubmitPrompt[0].command, `node "${SCRIPT}" working --source cursor`);
  assert.equal(countCursor(addCursorHooks(added, SCRIPT)), CURSOR_HOOK_EVENTS.length);
  assert.deepEqual(removeCursorHooks(added).config, before);
});

const countCursor = (config) => removeCursorHooks(config).removed;

test("Aider: adds notifications + command, removes only its own lines", () => {
  const yaml = "model: sonnet\nauto-commits: false\n";
  const added = addAiderNotify(yaml, SCRIPT);
  assert.match(added, /^notifications: true # bitling$/m);
  assert.match(added, new RegExp(`^notifications_command: 'node "${SCRIPT}" done --source aider' # bitling$`, "m"));
  assert.equal(addAiderNotify(added, SCRIPT), added, "re-installing changes nothing");
  assert.equal(removeAiderNotify(added).yaml, yaml);
  // Keeps an existing `notifications: true`, refuses a foreign command or notifications off.
  assert.doesNotMatch(addAiderNotify("notifications: true\n", SCRIPT), /notifications: true # bitling/);
  assert.throws(() => addAiderNotify("notifications_command: say hi\n", SCRIPT), /already has/);
  assert.throws(() => addAiderNotify("notifications: false\n", SCRIPT), /turns notifications off/);
});
