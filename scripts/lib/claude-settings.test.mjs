import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addBitlingHooks,
  countBitlingHooks,
  HOOK_EVENTS,
  hookCommand,
  removeBitlingHooks,
} from "./claude-settings.mjs";

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
