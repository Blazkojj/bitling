#!/usr/bin/env node
// Connects Bitling to Claude Code by adding hooks to its settings.json.
//
//   npm run hooks:install                 add / update the hooks
//   npm run hooks:uninstall               remove them again
//   ... -- --yes                          don't ask for confirmation
//   ... -- --dry-run                      only print the resulting settings
//   ... -- --settings <file>              use another settings file, e.g.
//                                         .claude/settings.local.json for one project
//
// Before writing, it shows exactly what will change, asks for confirmation and
// saves a timestamped backup of the settings file next to it.

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  addBitlingHooks,
  countBitlingHooks,
  HOOK_EVENTS,
  removeBitlingHooks,
} from "./lib/claude-settings.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (flag("--help") || flag("-h")) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 13).join("\n"));
  process.exit(0);
}

const uninstall = flag("--uninstall");
const dryRun = flag("--dry-run");
const assumeYes = flag("--yes") || flag("-y");

// Claude Code keeps user settings in ~/.claude unless CLAUDE_CONFIG_DIR says otherwise.
const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const settingsPath = path.resolve(option("--settings") ?? path.join(claudeDir, "settings.json"));
// The hook script is copied out of the repo so the clone can be moved or deleted.
const bitlingDir = process.env.BITLING_HOME || path.join(os.homedir(), ".bitling");
const hookSource = path.join(repoRoot, "hooks", "bitling-hook.mjs");
const hookTarget = path.join(bitlingDir, "bitling-hook.mjs");

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { bold: paint(1), dim: paint(2), green: paint(32), yellow: paint(33), red: paint(31) };

main().catch((err) => {
  console.error(c.red(`✖ ${err.message}`));
  process.exit(1);
});

async function main() {
  const current = readSettings(settingsPath);
  const existing = countBitlingHooks(current);
  const next = uninstall ? removeBitlingHooks(current).settings : addBitlingHooks(current, hookTarget);

  console.log(c.bold(uninstall ? "\nRemove Bitling from Claude Code\n" : "\nConnect Bitling to Claude Code\n"));
  console.log(`  Settings file  ${settingsPath}${fs.existsSync(settingsPath) ? "" : c.dim(" (will be created)")}`);
  if (!uninstall) console.log(`  Hook script    ${hookTarget}`);
  console.log();

  if (uninstall) {
    if (existing === 0) {
      console.log("  No Bitling hooks found, nothing to do.\n");
      return;
    }
    console.log(`  ${existing} Bitling hook(s) will be removed. Your other settings stay as they are.`);
  } else {
    console.log("  These hooks will be added (each one takes ~0.1 s and never blocks Claude):\n");
    const names = HOOK_EVENTS.map(({ event, matcher }) => (matcher ? `${event} (${matcher})` : event));
    const width = Math.max(...names.map((n) => n.length));
    HOOK_EVENTS.forEach(({ state, why }, i) => {
      console.log(`    ${names[i].padEnd(width)}  → ${state.padEnd(8)} ${c.dim(why)}`);
    });
    if (existing > 0) console.log(c.yellow(`\n  ${existing} existing Bitling hook(s) will be replaced.`));
  }

  if (dryRun) {
    console.log(c.bold("\n  --dry-run: resulting settings.json\n"));
    console.log(JSON.stringify(next, null, 2));
    return;
  }

  const backup = fs.existsSync(settingsPath) ? backupPath(settingsPath) : null;
  if (backup) console.log(`\n  A backup will be saved to ${backup}`);

  if (!(await confirm("\n  Continue? [y/N] "))) {
    console.log("  Cancelled, nothing was changed.\n");
    return;
  }

  if (backup) fs.copyFileSync(settingsPath, backup);
  if (!uninstall) {
    fs.mkdirSync(bitlingDir, { recursive: true });
    fs.copyFileSync(hookSource, hookTarget);
  }
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`);

  console.log(c.green(`\n  ✔ ${uninstall ? "Bitling hooks removed." : "Bitling hooks installed."}`));
  if (uninstall) {
    console.log(c.dim(`    Your XP is kept in ${bitlingDir}.\n`));
    return;
  }
  console.log("    Restart Claude Code (or open /hooks) so it picks up the new hooks.");
  console.log(
    (await bitlingIsRunning())
      ? c.green("    Bitling is running and listening. Go give Claude a task!\n")
      : c.yellow("    Bitling is not running yet: start it with `npm run app`.\n"),
  );
}

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8");
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch (err) {
    // Never overwrite a file we don't understand.
    throw new Error(`${file} is not valid JSON (${err.message}). Fix it first; nothing was changed.`);
  }
}

async function confirm(question) {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) {
    console.log(c.yellow("\n  No terminal to ask for confirmation; re-run with --yes to apply."));
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

/** settings.json.bitling-backup-2026-10-01_12-00-00, never reusing an existing name. */
function backupPath(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  let candidate = `${file}.bitling-backup-${stamp}`;
  for (let n = 2; fs.existsSync(candidate); n++) candidate = `${file}.bitling-backup-${stamp}-${n}`;
  return candidate;
}

function bitlingIsRunning() {
  const port = Number(process.env.BITLING_PORT) || 47800;
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 800 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}
