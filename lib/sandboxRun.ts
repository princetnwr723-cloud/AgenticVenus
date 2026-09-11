// lib/sandboxRun.ts
// Real cloud sandbox execution (via E2B) — this is what makes ANY
// language previewable, not just static HTML/CSS/JS. Split into
// start (fast — creates the sandbox and kicks off the install/run
// command in the background) and checkStatus (polls whether the server
// has actually started listening yet). Split this way because npm
// install for a real project (Next.js + Three.js + Framer Motion etc.)
// can easily take 30-90+ seconds — far longer than Vercel's serverless
// function time limit allows for a single blocking request, so the
// client polls checkStatus every few seconds instead of one long wait.

import { Sandbox } from "e2b";
import type { CodeFile } from "@/lib/codeExtract";

const SANDBOX_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes — keeps cost bounded
const PORT = 3000;

function fallbackRunCommand(files: CodeFile[]): string {
  const names = files.map((f) => f.filename.toLowerCase());
  if (names.some((n) => n.endsWith("package.json"))) {
    return `npm install && (npm run dev -- --port ${PORT} --host 0.0.0.0 || npm start)`;
  }
  if (names.some((n) => n.endsWith("requirements.txt"))) {
    return `pip install -r requirements.txt && (python3 -m flask run --host 0.0.0.0 --port ${PORT} || python3 app.py)`;
  }
  if (names.some((n) => n === "go.mod")) {
    return `go run .`;
  }
  return `python3 -m http.server ${PORT}`;
}

/** Creates the sandbox, writes files, and starts the install/run command
 * in the background. Returns immediately — doesn't wait for the server
 * to actually be ready (see checkStatus for that). */
export async function startCloudSandbox(files: CodeFile[]): Promise<{ sandboxId: string }> {
  if (!process.env.E2B_API_KEY) {
    throw new Error("E2B_API_KEY isn't set — cloud preview needs an E2B account and API key.");
  }

  const sandbox = await Sandbox.create({ timeoutMs: SANDBOX_TIMEOUT_MS });
  await sandbox.files.write(files.map((f) => ({ path: f.filename, data: f.code })));

  const runScript = files.find((f) => /(^|\/)run\.sh$/i.test(f.filename));
  const runCommand = runScript ? `bash "${runScript.filename}"` : fallbackRunCommand(files);

  // Log output to a file inside the sandbox so checkStatus can surface
  // useful errors (e.g. "npm: command not found", a crashed server) if
  // the port never comes up, instead of a bare timeout.
  await sandbox.commands.run(`(${runCommand}) > /tmp/agenticvenus.log 2>&1`, { background: true });

  return { sandboxId: sandbox.sandboxId };
}

/** Called repeatedly by the client while waiting for the server to come
 * up. Checks whether something is actually listening on the target port
 * yet, and if not, returns the tail of the log so the user (and agent)
 * can see what's actually happening instead of a bare "not ready". */
export async function checkSandboxStatus(
  sandboxId: string
): Promise<{ ready: boolean; previewUrl?: string; log?: string }> {
  const sandbox = await Sandbox.connect(sandboxId);

  const check = await sandbox.commands.run(
    `curl -s -o /dev/null -w "%{http_code}" http://localhost:${PORT} || echo "000"`
  );
  const statusCode = (check.stdout || "").trim();
  const ready = /^\d{3}$/.test(statusCode) && statusCode !== "000";

  if (ready) {
    const host = sandbox.getHost(PORT);
    return { ready: true, previewUrl: `https://${host}` };
  }

  let log = "";
  try {
    const tail = await sandbox.commands.run("tail -n 40 /tmp/agenticvenus.log 2>/dev/null || true");
    log = tail.stdout || "";
  } catch {
    // Log isn't critical — ignore if it can't be read.
  }
  return { ready: false, log };
}

export async function stopCloudSandbox(sandboxId: string): Promise<void> {
  if (!process.env.E2B_API_KEY) return;
  const sandbox = await Sandbox.connect(sandboxId);
  await sandbox.kill();
}