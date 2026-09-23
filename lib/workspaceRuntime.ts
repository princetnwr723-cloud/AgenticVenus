// Server-only AgenticVenus persistent coding workspace runtime.
// A user's workspace is a durable Daytona Sandbox (ONE per user — spinning a
// brand-new VM per chat would be slow and expensive to boot). Per-chat
// isolation instead comes from a scoped project path: every chat's files
// live under workspace/<scope>/ (see lib/workspaceScope.ts), with its own
// terminal session names and its own stable dev-server port, so two chats
// never see or collide with each other's files, terminal, or preview.
import { Daytona } from "@daytona/sdk";
import { adminDb } from "@/lib/firebaseAdmin";
import { resolveIntegrationSecret } from "@/lib/secretsResolve";
import { signPreviewToken } from "@/lib/previewToken";
import { projectPathForScope, sanitizeScope } from "@/lib/workspaceScope";

const COLLECTION = "agentWorkspace";
const DOC_ID = "default";
const STATE_CACHE_MS = 20_000;

const IGNORED_DIRS = ["node_modules", ".git", ".next", "dist", "build", "out", ".vercel", ".turbo", ".cache", "coverage", ".venv", "__pycache__", ".parcel-cache", ".svelte-kit"];
const TEXT_GLOBS = [
  "*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs", "*.json", "*.css", "*.scss", "*.html", "*.md", "*.mdx",
  "*.py", "*.sql", "*.svg", "*.txt", "*.yml", "*.yaml", "*.toml", "*.sh", "*.vue", "*.svelte", "*.glsl", "*.vert", "*.frag",
  ".gitignore", ".prettierrc", ".prettierignore", ".eslintrc*", ".env.example",
];
const MAX_FILES = 300;
const MAX_FILE_BYTES = "300k";
const RESERVED_PORTS = new Set([22, 2280, 5900, 6080, 22220, 22222, 33333]);

export type WorkspaceState = {
  sandboxId: string;
  state?: string;
  workDir?: string;
  updatedAt: number;
};

const stateCache = new Map<string, { state: WorkspaceState; at: number }>();

async function getDaytona(uid: string) {
  const apiKey = await resolveIntegrationSecret(uid, "daytonaApiKey");
  if (!apiKey) throw new Error("NO_DAYTONA: Add your Daytona API key in Settings → Integrations.");
  return new Daytona({ apiKey });
}

async function getStored(uid: string) {
  const snap = await adminDb().collection("users").doc(uid).collection(COLLECTION).doc(DOC_ID).get();
  return snap.exists ? (snap.data() as Partial<WorkspaceState>) : null;
}

export async function ensureWorkspace(uid: string): Promise<WorkspaceState> {
  const cached = stateCache.get(uid);
  if (cached && Date.now() - cached.at < STATE_CACHE_MS) return cached.state;

  const daytona = await getDaytona(uid);
  const stored = await getStored(uid);

  let sandbox = stored?.sandboxId ? await daytona.get(stored.sandboxId).catch(() => null) : null;
  if (!sandbox) {
    sandbox = await daytona.create({ language: "typescript", autoDeleteInterval: -1 });
    await sandbox.process.executeCommand("mkdir -p workspace");
  } else if (sandbox.state && sandbox.state !== "started") {
    await sandbox.start(60);
  }

  const state: WorkspaceState = {
    sandboxId: sandbox.id,
    state: sandbox.state,
    workDir: await sandbox.getWorkDir().catch(() => undefined),
    updatedAt: Date.now(),
  };
  if (stored?.sandboxId !== state.sandboxId || stored?.state !== state.state) {
    await adminDb().collection("users").doc(uid).collection(COLLECTION).doc(DOC_ID).set(state, { merge: true });
  }
  stateCache.set(uid, { state, at: Date.now() });
  return state;
}

async function withSandbox(uid: string) {
  const state = await ensureWorkspace(uid);
  const daytona = await getDaytona(uid);
  try {
    const sandbox = await daytona.get(state.sandboxId);
    return { state, sandbox };
  } catch (err) {
    stateCache.delete(uid); // sandbox vanished — next call re-creates it
    throw err;
  }
}

export async function workspaceExec(uid: string, command: string, scope?: string, timeout = 120) {
  if (!command.trim()) throw new Error("COMMAND_REQUIRED");
  const { state, sandbox } = await withSandbox(uid);
  const cwd = projectPathForScope(scope);
  await sandbox.process.executeCommand(`mkdir -p '${cwd}'`, undefined, undefined, 15).catch(() => undefined);
  const result = await sandbox.process.executeCommand(command, cwd, undefined, Math.min(Math.max(timeout, 1), 300));
  return {
    sandboxId: state.sandboxId,
    command,
    cwd,
    exitCode: result.exitCode,
    output: result.result || result.artifacts?.stdout || "",
  };
}

export async function workspaceSessionExec(uid: string, sessionId: string, command: string, scope?: string, runAsync = false) {
  if (!command.trim()) throw new Error("COMMAND_REQUIRED");
  const { state, sandbox } = await withSandbox(uid);
  const cwd = projectPathForScope(scope);
  try {
    await sandbox.process.getSession(sessionId);
  } catch {
    await sandbox.process.createSession(sessionId);
    // A brand-new shell starts in the sandbox home — move it into this chat's project.
    await sandbox.process.executeSessionCommand(sessionId, { command: `mkdir -p '${cwd}' && cd '${cwd}'`, runAsync: false });
  }
  const result = await sandbox.process.executeSessionCommand(sessionId, { command, runAsync });
  return { sandboxId: state.sandboxId, sessionId, ...result };
}

/** Output produced so far by a (possibly still running) session command. */
export async function workspaceSessionLogs(uid: string, sessionId: string, cmdId: string) {
  const { sandbox } = await withSandbox(uid);
  const logs: any = await (sandbox.process as any).getSessionCommandLogs(sessionId, cmdId);
  const output = typeof logs === "string" ? logs : logs?.output ?? logs?.stdout ?? "";
  return { output: String(output || "") };
}

/** TCP ports something is listening on inside the sandbox (dev servers, etc). */
export async function workspaceListeningPorts(uid: string) {
  const { sandbox } = await withSandbox(uid);
  const result = await sandbox.process.executeCommand(
    "(ss -ltnH 2>/dev/null || netstat -ltn 2>/dev/null) | grep -oE ':[0-9]+[[:space:]]' | tr -d ': ' | sort -un",
    undefined,
    undefined,
    15
  );
  const output = result.result || result.artifacts?.stdout || "";
  const ports = output
    .split(/\s+/)
    .map((p: string) => parseInt(p, 10))
    .filter((p: number) => Number.isFinite(p) && p >= 1024 && !RESERVED_PORTS.has(p));
  return { ports };
}

/** Force-frees a port before (re)starting a dev server on it — kills only
 * whatever is bound to THAT port, never a broad "pkill next|vite", so other
 * chats' dev servers running in the same sandbox are never touched. */
export async function workspaceFreePort(uid: string, port: number) {
  const { sandbox } = await withSandbox(uid);
  await sandbox.process
    .executeCommand(`(lsof -ti tcp:${port} 2>/dev/null | xargs -r kill -9) || (fuser -k ${port}/tcp 2>/dev/null) || true`, undefined, undefined, 15)
    .catch(() => undefined);
}

export async function workspaceWriteFile(uid: string, path: string, content: string, scope?: string) {
  const { state, sandbox } = await withSandbox(uid);
  const root = projectPathForScope(scope);
  const safePath = path.replace(/^\/+/, "").replace(/\.\.\//g, "");
  const dir = safePath.includes("/") ? safePath.slice(0, safePath.lastIndexOf("/")) : "";
  await sandbox.process.executeCommand(`mkdir -p '${(dir ? `${root}/${dir}` : root).replace(/'/g, "'\\''")}'`, undefined, undefined, 15);
  await sandbox.fs.uploadFile(Buffer.from(content, "utf8"), `${root}/${safePath}`);
  return { sandboxId: state.sandboxId, path: `${root}/${safePath}` };
}

export async function workspaceReadFile(uid: string, path: string, scope?: string) {
  const { state, sandbox } = await withSandbox(uid);
  const root = projectPathForScope(scope);
  const safePath = path.replace(/^\/+/, "").replace(/\.\.\//g, "");
  const data = await sandbox.fs.downloadFile(`${root}/${safePath}`);
  return { sandboxId: state.sandboxId, path: safePath, content: data.toString("utf8") };
}

/** Returns a same-origin, warning-free preview URL for a port inside this
 * sandbox — see app/api/preview/[token]/... — instead of Daytona's raw
 * signed URL, which showed a click-through interstitial inside the iframe. */
export async function workspacePreview(uid: string, port: number) {
  const state = await ensureWorkspace(uid);
  const token = signPreviewToken({ uid, sandboxId: state.sandboxId, port });
  return { sandboxId: state.sandboxId, port, url: `/api/preview/${token}/` };
}

function findExpression(root: string): string {
  const prune = IGNORED_DIRS.map((d) => `-name '${d}'`).join(" -o ");
  const names = TEXT_GLOBS.map((g) => `-name '${g}'`).join(" -o ");
  return `find '${root}' \\( -type d \\( ${prune} \\) -prune \\) -o -type f -size -${MAX_FILE_BYTES} \\( ${names} \\) -print`;
}

export async function workspaceListFiles(uid: string, includeContent = false, scope?: string) {
  const { sandbox } = await withSandbox(uid);
  const root = projectPathForScope(scope);
  await sandbox.process.executeCommand(`mkdir -p '${root}'`, undefined, undefined, 15).catch(() => undefined);
  const find = findExpression(root);
  const stripRe = new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`);

  if (!includeContent) {
    const result = await sandbox.process.executeCommand(`${find} | sort | head -n ${MAX_FILES}`, undefined, undefined, 60);
    const output = result.result || result.artifacts?.stdout || "";
    return { files: output.split(/\r?\n/).filter(Boolean).map((path: string) => ({ path: path.replace(stripRe, "") })) };
  }

  const result = await sandbox.process.executeCommand(
    `${find} | sort | head -n ${MAX_FILES} | tr '\\n' '\\0' | xargs -0 -r -n1 sh -c 'printf "FILE:%s\\n" "$0"; cat "$0"; printf "\\n---AV_FILE_END---\\n"'`,
    undefined,
    undefined,
    60
  );
  const output = result.result || result.artifacts?.stdout || "";
  const files: { path: string; content: string }[] = [];
  for (const chunk of output.split(/---AV_FILE_END---/)) {
    const match = chunk.match(/^\s*FILE:(.+?)\n([\s\S]*)$/);
    if (match) files.push({ path: match[1].replace(stripRe, "").trim(), content: match[2].replace(/\n$/, "") });
  }
  return { files };
}

export async function workspaceDelete(uid: string) {
  const stored = await getStored(uid);
  stateCache.delete(uid);
  if (!stored?.sandboxId) return;
  const daytona = await getDaytona(uid);
  const sandbox = await daytona.get(stored.sandboxId).catch(() => null);
  if (sandbox) await sandbox.delete(60, true);
  await adminDb().collection("users").doc(uid).collection(COLLECTION).doc(DOC_ID).delete();
}

export { sanitizeScope };