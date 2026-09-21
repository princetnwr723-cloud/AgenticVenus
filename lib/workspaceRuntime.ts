// Server-only AgenticVenus persistent coding workspace runtime.
// A user's workspace is a durable Daytona Sandbox. The browser never receives
// the Daytona API key; API routes authenticate the Firebase user and resolve
// the encrypted key server-side.
//
// FIXES
//  - Terminal sessions now start inside the project folder (`workspace/`), so
//    `npm install`, `npm run dev`, `ls` run where the agent's files actually are.
//    Before, they ran in the sandbox home directory and the dev server never
//    found package.json.
//  - File listing skips build output (.next, dist, node_modules…), skips huge
//    files and caps the count — after a build the old listing tried to `cat`
//    thousands of generated files.
//  - Session logs + listening-port detection, so long-running servers
//    (`npm run dev`) can be started without blocking and previewed on localhost.
//  - The sandbox lookup is cached for a few seconds, so polling the file tree
//    doesn't hit Daytona + Firestore three times per refresh.
import { Daytona } from "@daytona/sdk";
import { adminDb } from "@/lib/firebaseAdmin";
import { resolveIntegrationSecret } from "@/lib/secretsResolve";

const COLLECTION = "agentWorkspace";
const DOC_ID = "default";
const PROJECT_DIR = "workspace";
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
  projectDir: string;
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
    await sandbox.process.executeCommand(`mkdir -p ${PROJECT_DIR}`);
  } else if (sandbox.state && sandbox.state !== "started") {
    await sandbox.start(60);
  }

  const state: WorkspaceState = {
    sandboxId: sandbox.id,
    state: sandbox.state,
    workDir: await sandbox.getWorkDir().catch(() => undefined),
    projectDir: PROJECT_DIR,
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

export async function workspaceExec(uid: string, command: string, cwd = PROJECT_DIR, timeout = 120) {
  if (!command.trim()) throw new Error("COMMAND_REQUIRED");
  const { state, sandbox } = await withSandbox(uid);
  const result = await sandbox.process.executeCommand(command, cwd, undefined, Math.min(Math.max(timeout, 1), 300));
  return {
    sandboxId: state.sandboxId,
    command,
    cwd,
    exitCode: result.exitCode,
    output: result.result || result.artifacts?.stdout || "",
  };
}

export async function workspaceSessionExec(uid: string, sessionId: string, command: string, runAsync = false) {
  if (!command.trim()) throw new Error("COMMAND_REQUIRED");
  const { state, sandbox } = await withSandbox(uid);
  try {
    await sandbox.process.getSession(sessionId);
  } catch {
    await sandbox.process.createSession(sessionId);
    // A brand-new shell starts in the sandbox home — move it into the project.
    await sandbox.process.executeSessionCommand(sessionId, { command: `cd ${PROJECT_DIR} 2>/dev/null || (mkdir -p ${PROJECT_DIR} && cd ${PROJECT_DIR})`, runAsync: false });
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

export async function workspaceWriteFile(uid: string, path: string, content: string) {
  const { state, sandbox } = await withSandbox(uid);
  const safePath = path.replace(/^\/+/, "").replace(/\.\.\//g, "");
  const dir = safePath.includes("/") ? safePath.slice(0, safePath.lastIndexOf("/")) : "";
  if (dir) await sandbox.process.executeCommand(`mkdir -p '${dir.replace(/'/g, "'\\''")}'`, PROJECT_DIR);
  await sandbox.fs.uploadFile(Buffer.from(content, "utf8"), `${PROJECT_DIR}/${safePath}`);
  return { sandboxId: state.sandboxId, path: `${PROJECT_DIR}/${safePath}` };
}

export async function workspaceReadFile(uid: string, path: string) {
  const { state, sandbox } = await withSandbox(uid);
  const safePath = path.replace(/^\/+/, "").replace(/\.\.\//g, "");
  const data = await sandbox.fs.downloadFile(`${PROJECT_DIR}/${safePath}`);
  return { sandboxId: state.sandboxId, path: safePath, content: data.toString("utf8") };
}

export async function workspacePreview(uid: string, port: number) {
  const { state, sandbox } = await withSandbox(uid);
  const signed = await sandbox.getSignedPreviewUrl(port, 3600);
  return { sandboxId: state.sandboxId, port, url: signed.url };
}

function findExpression(): string {
  const prune = IGNORED_DIRS.map((d) => `-name '${d}'`).join(" -o ");
  const names = TEXT_GLOBS.map((g) => `-name '${g}'`).join(" -o ");
  return `find ${PROJECT_DIR} \\( -type d \\( ${prune} \\) -prune \\) -o -type f -size -${MAX_FILE_BYTES} \\( ${names} \\) -print`;
}

export async function workspaceListFiles(uid: string, includeContent = false) {
  const { sandbox } = await withSandbox(uid);
  const find = findExpression();

  if (!includeContent) {
    const result = await sandbox.process.executeCommand(`${find} | sort | head -n ${MAX_FILES}`, undefined, undefined, 60);
    const output = result.result || result.artifacts?.stdout || "";
    return { files: output.split(/\r?\n/).filter(Boolean).map((path: string) => ({ path: path.replace(/^workspace\//, "") })) };
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
    if (match) files.push({ path: match[1].replace(/^workspace\//, "").trim(), content: match[2].replace(/\n$/, "") });
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