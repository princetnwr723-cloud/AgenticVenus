// Server-only AgenticVenus persistent coding workspace runtime.
// A user's workspace is a durable Daytona Sandbox. The browser never receives
// the Daytona API key; API routes authenticate the Firebase user and resolve
// the encrypted key server-side.
import { Daytona } from "@daytona/sdk";
import { adminDb } from "@/lib/firebaseAdmin";
import { resolveIntegrationSecret } from "@/lib/secretsResolve";

const COLLECTION = "agentWorkspace";
const DOC_ID = "default";
const PROJECT_DIR = "workspace";

export type WorkspaceState = {
  sandboxId: string;
  state?: string;
  workDir?: string;
  projectDir: string;
  updatedAt: number;
};

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
  await adminDb().collection("users").doc(uid).collection(COLLECTION).doc(DOC_ID).set(state, { merge: true });
  return state;
}

export async function workspaceExec(uid: string, command: string, cwd = PROJECT_DIR, timeout = 120) {
  if (!command.trim()) throw new Error("COMMAND_REQUIRED");
  const state = await ensureWorkspace(uid);
  const daytona = await getDaytona(uid);
  const sandbox = await daytona.get(state.sandboxId);
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
  const state = await ensureWorkspace(uid);
  const daytona = await getDaytona(uid);
  const sandbox = await daytona.get(state.sandboxId);
  try {
    await sandbox.process.getSession(sessionId);
  } catch {
    await sandbox.process.createSession(sessionId);
  }
  const result = await sandbox.process.executeSessionCommand(sessionId, { command, runAsync });
  return { sandboxId: state.sandboxId, sessionId, ...result };
}

export async function workspaceWriteFile(uid: string, path: string, content: string) {
  const state = await ensureWorkspace(uid);
  const daytona = await getDaytona(uid);
  const sandbox = await daytona.get(state.sandboxId);
  const safePath = path.replace(/^\/+/, "");
  await sandbox.fs.uploadFile(Buffer.from(content, "utf8"), `${PROJECT_DIR}/${safePath}`);
  return { sandboxId: state.sandboxId, path: `${PROJECT_DIR}/${safePath}` };
}

export async function workspaceReadFile(uid: string, path: string) {
  const state = await ensureWorkspace(uid);
  const daytona = await getDaytona(uid);
  const sandbox = await daytona.get(state.sandboxId);
  const safePath = path.replace(/^\/+/, "");
  const data = await sandbox.fs.downloadFile(`${PROJECT_DIR}/${safePath}`);
  return { sandboxId: state.sandboxId, path: safePath, content: data.toString("utf8") };
}

export async function workspacePreview(uid: string, port: number) {
  const state = await ensureWorkspace(uid);
  const daytona = await getDaytona(uid);
  const sandbox = await daytona.get(state.sandboxId);
  const signed = await sandbox.getSignedPreviewUrl(port, 3600);
  return { sandboxId: state.sandboxId, port, url: signed.url };
}

export async function workspaceListFiles(uid: string, includeContent = false) {
  const state = await ensureWorkspace(uid);
  const daytona = await getDaytona(uid);
  const sandbox = await daytona.get(state.sandboxId);
  const findExpr = "find workspace -type f -not -path '*/node_modules/*' -not -path '*/.git/*' \\\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.json' -o -name '*.css' -o -name '*.html' -o -name '*.md' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.py' -o -name '*.sql' \\\)";
  if (!includeContent) {
    const result = await sandbox.process.executeCommand(`${findExpr} -print | sort`, undefined, undefined, 60);
    const output = result.result || result.artifacts?.stdout || "";
    return { files: output.split(/\r?\n/).filter(Boolean).map((path) => ({ path: path.replace(/^workspace\//, "") })) };
  }
  const result = await sandbox.process.executeCommand(`${findExpr} -print0 | xargs -0 -r -n1 sh -c 'printf "FILE:%s\\n" "$0"; cat "$0"; printf "\\n---AV_FILE_END---\\n"'`, undefined, undefined, 60);
  const output = result.result || result.artifacts?.stdout || "";
  const files: { path: string; content: string }[] = [];
  for (const chunk of output.split(/---AV_FILE_END---/)) {
    const match = chunk.match(/^FILE:(.+?)\n([\s\S]*)$/);
    if (match) files.push({ path: match[1].replace(/^workspace\//, "").trim(), content: match[2].replace(/\n$/, "") });
  }
  return { files };
}

export async function workspaceDelete(uid: string) {
  const stored = await getStored(uid);
  if (!stored?.sandboxId) return;
  const daytona = await getDaytona(uid);
  const sandbox = await daytona.get(stored.sandboxId).catch(() => null);
  if (sandbox) await sandbox.delete(60, true);
  await adminDb().collection("users").doc(uid).collection(COLLECTION).doc(DOC_ID).delete();
}
