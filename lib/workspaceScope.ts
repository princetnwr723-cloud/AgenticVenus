// lib/workspaceScope.ts
// Pure helpers shared by the client and the server so a chat's Codespace
// (files, terminal session, dev-server port) always resolves to the same
// place. This is what makes "har chat ka apna Codespace" (per-chat
// isolation) work: every chat's files live under workspace/<scope>/ inside
// the ONE shared cloud sandbox — not a brand-new VM per chat (that would be
// slow and expensive to boot for every conversation) — with its own,
// stable, collision-free dev-server port.

const DEFAULT_SCOPE = "global";
const PORT_BASE = 3001;
const PORT_RANGE = 900; // 3001..3900

export function sanitizeScope(scope?: string | null): string {
  const clean = (scope || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  return clean || DEFAULT_SCOPE;
}

export function projectPathForScope(scope?: string | null): string {
  return `workspace/${sanitizeScope(scope)}`;
}

export function sessionIdForScope(scope: string | null | undefined, base: string): string {
  const s = sanitizeScope(scope);
  return s === DEFAULT_SCOPE ? base : `${base}-${s}`;
}

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** The dev-server port a chat's Codespace should use. The default/global
 * scope keeps the familiar 3000 (or 5173 for Vite); every other chat gets a
 * stable, distinct port so two chats' dev servers never collide inside the
 * same shared cloud sandbox. */
export function portForScope(scope: string | null | undefined, isVite: boolean): number {
  const s = sanitizeScope(scope);
  if (s === DEFAULT_SCOPE) return isVite ? 5173 : 3000;
  return PORT_BASE + (hash(s) % PORT_RANGE);
}

export { DEFAULT_SCOPE };