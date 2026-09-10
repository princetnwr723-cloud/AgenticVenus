// lib/sandboxRun.ts
// This is what makes ANY language previewable, not just static
// HTML/CSS/JS — instead of rendering in a browser iframe, it spins up a
// real Linux sandbox in the cloud (via E2B), writes the project's files
// into it, runs whatever start command the project needs (npm run dev,
// python app.py, go run ., anything), and exposes the real running
// server as a live URL. Server-side only — needs E2B_API_KEY.

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

export async function startCloudSandbox(files: CodeFile[]): Promise<{ sandboxId: string; previewUrl: string }> {
  if (!process.env.E2B_API_KEY) {
    throw new Error("E2B_API_KEY isn't set — cloud preview needs an E2B account and API key.");
  }

  const sandbox = await Sandbox.create({ timeoutMs: SANDBOX_TIMEOUT_MS });

  await sandbox.files.write(files.map((f) => ({ path: f.filename, data: f.code })));

  const runScript = files.find((f) => /(^|\/)run\.sh$/i.test(f.filename));
  const runCommand = runScript ? `bash "${runScript.filename}"` : fallbackRunCommand(files);

  await sandbox.commands.run(runCommand, { background: true });

  // Give the server a moment to actually start listening.
  await new Promise((resolve) => setTimeout(resolve, 4000));

  const host = sandbox.getHost(PORT);
  return { sandboxId: sandbox.sandboxId, previewUrl: `https://${host}` };
}

export async function stopCloudSandbox(sandboxId: string): Promise<void> {
  if (!process.env.E2B_API_KEY) return;
  const sandbox = await Sandbox.connect(sandboxId);
  await sandbox.kill();
}