// Bitling plugin for OpenCode (https://opencode.ai).
//
// `npm run hooks:install -- --agent opencode` copies this file to
// ~/.config/opencode/plugins/bitling.js, where OpenCode loads it at startup.
// It forwards session events to the Bitling app on 127.0.0.1:47800
// (BITLING_PORT to override). No dependencies; failures are ignored so the
// pet can never get in OpenCode's way.

const PORT = Number(process.env.BITLING_PORT) || 47800;

/** OpenCode event → [pet state, message]. */
function toPet(event) {
  const p = event.properties ?? {};
  switch (event.type) {
    case "session.status":
      return p.status?.type === "busy" ? ["working", null] : null;
    case "session.idle":
      return ["done", null];
    case "session.error": {
      // Pressing Esc aborts the turn: that is not a failure.
      if (p.error?.name === "MessageAbortedError") return ["idle", null];
      return ["error", p.error?.data?.message ?? p.error?.name ?? null];
    }
    case "permission.asked":
    case "permission.updated":
      return ["waiting", p.title ?? p.permission ?? "OpenCode needs your approval"];
    case "permission.replied":
      return ["working", null];
    default:
      return null;
  }
}

export const BitlingPlugin = async ({ directory } = {}) => ({
  event: async ({ event }) => {
    const pet = toPet(event);
    if (!pet) return;
    const [state, message] = pet;
    try {
      await fetch(`http://127.0.0.1:${PORT}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state,
          message,
          source: "opencode",
          session: event.properties?.sessionID ?? null,
          project: directory ? directory.split(/[\\/]/).filter(Boolean).pop() : null,
        }),
        signal: AbortSignal.timeout(1500),
      });
    } catch {
      // Bitling is not running: that's fine.
    }
  },
});
