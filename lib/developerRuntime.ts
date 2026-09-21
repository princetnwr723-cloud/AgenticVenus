"use client";

import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";
import { extractCodeFiles } from "@/lib/codeExtract";
import { AGENT_CORE, DEV_CRAFT_GUIDE } from "@/lib/agents";
import {
  ensureAgentWorkspace,
  getAgentPreview,
  listAgentFiles,
  listAgentPorts,
  runAgentCommand,
  runAgentSessionCommand,
  writeAgentFile,
} from "@/lib/workspaceClient";

export type DeveloperRunResult = {
  changedFiles: string[];
  buildOutput: string;
  buildOk: boolean;
  previewUrl?: string;
  previewPort?: number;
  steps: string[];
};

// A request is a coding task when it pairs a build-ish verb with a software
// noun, or mentions an unmistakable dev term. The old regex matched single
// words like "make", "app" or "post", so ordinary chat messages spun up a cloud
// workspace (and then reported a failed build).
const VERB = /\b(build|create|make|develop|code|write|fix|debug|refactor|implement|generate|design|add|update|change|edit|improve|deploy)\b/i;
const NOUN =
  /\b(website|web\s?site|web\s?app|webapp|landing\s?page|homepage|portfolio|dashboard|game|app|application|component|frontend|front-end|backend|back-end|api|script|repo|repository|project|codebase|bug|3d|three\.?js|webgl|canvas|animation|css|html|javascript|typescript|react|next\.?js|vite|python|node|tailwind|function|endpoint|scene|shader)\b/i;
const STRONG = /(three\.?js|webgl|next\.?js|\breact\b|typescript|javascript|\bnpm\b|\bcodespace\b|localhost|\.(tsx?|jsx?|html?|css|py)\b|```)/i;
const NOT_CODE = /\b(email|e-mail|mail|gmail|calendar|slack|linkedin|tweet|instagram|caption|poem|essay|blog post|article|resume|cv|report|presentation|ppt|invoice|whatsapp|meeting|reminder)\b/i;

export function looksLikeDeveloperTask(task: string) {
  const text = task.trim();
  if (text.length < 8) return false;
  if (STRONG.test(text)) return true;
  if (NOT_CODE.test(text)) return false;
  return VERB.test(text) && NOUN.test(text);
}

const NO_WORKSPACE_HELP =
  "No cloud workspace is connected (Daytona key missing in Settings → Integrations), so nothing could be built or previewed for real. Write every file in full in your reply — each in its own fenced block with `FILE: path/to/file` above it — and they will appear in Codespace. Tell the user that adding a Daytona key enables a real terminal, build and live localhost preview.";

function safePath(path: string): string | null {
  const clean = path.replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/^workspace\//, "");
  if (!clean || clean.includes("..") || clean.startsWith("~")) return null;
  return clean;
}

function buildPrompt(task: string, history: ChatMessage[], existingContext: string): string {
  return `${AGENT_CORE}

You are the Developer Agent working inside a real persistent cloud workspace (Linux, Node 20+, Python 3). Build or fix the user's requested project for real.

${DEV_CRAFT_GUIDE}

USER TASK:
${task}

RECENT CONTEXT:
${history.slice(-8).map((m) => `${m.role}: ${m.content.slice(0, 1500)}`).join("\n")}

EXISTING WORKSPACE FILES (edit these instead of recreating the project blindly):
${existingContext || "(empty workspace)"}

OUTPUT FORMAT — return ONLY the complete files that you need to create or change. For EVERY file use exactly:

FILE: path/to/file.ext
\`\`\`language
full file contents
\`\`\`

Rules: paths are relative to the project root (no leading slash). Every file must be complete — never partial diffs. Do not add explanations outside the file blocks. If it is a static site, include index.html. If it needs npm, include a complete package.json with "dev" and "build" scripts.`;
}

async function detectServerPort(preferred: number, tries = 18): Promise<number | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const ports = await listAgentPorts();
      if (ports.includes(preferred)) return preferred;
      const candidate = ports.find((p) => p >= 3000 && p <= 9999);
      if (candidate) return candidate;
    } catch {
      // keep trying
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

export async function runDeveloperWorkspace(
  providerId: string,
  apiKey: string,
  task: string,
  model: string | undefined,
  history: ChatMessage[],
  onStep?: (step: string) => void
): Promise<DeveloperRunResult> {
  const steps: string[] = [];
  const step = (s: string) => {
    steps.push(s);
    onStep?.(s);
  };

  let workspace;
  try {
    workspace = await ensureAgentWorkspace();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("NO_DAYTONA")) throw new Error(NO_WORKSPACE_HELP);
    throw err;
  }
  step(`Workspace ready: ${workspace.sandboxId.slice(0, 10)}…`);

  const existingFiles = await listAgentFiles(true).catch(() => []);
  let budget = 60_000;
  const existingContext = existingFiles
    .slice(0, 25)
    .map((f) => {
      const body = (f.content || "").slice(0, 8000);
      budget -= body.length;
      return budget > 0 ? `FILE: ${f.path}\n\`\`\`\n${body}\n\`\`\`` : `FILE: ${f.path} (omitted for length)`;
    })
    .join("\n\n");

  step("Writing the project…");
  const response = await sendChatMessage({
    providerId,
    apiKey,
    model,
    messages: [{ role: "user", content: buildPrompt(task, history, existingContext) }],
  });
  const files = extractCodeFiles([{ role: "assistant", content: response.text || "" }]).filter((f) => !/^snippet-/.test(f.filename));
  if (!files.length) throw new Error("Developer Agent did not return editable project files.");

  const written: string[] = [];
  for (const file of files) {
    const path = safePath(file.filename);
    if (!path) {
      step(`Skipped unsafe path ${file.filename}`);
      continue;
    }
    await writeAgentFile(path, file.code);
    written.push(path);
    step(`Wrote ${path}`);
  }

  const has = (name: string) => written.includes(name) || existingFiles.some((f) => f.path === name);
  const packageText =
    files.find((f) => safePath(f.filename) === "package.json")?.code || existingFiles.find((f) => f.path === "package.json")?.content || "";
  const hasPackage = has("package.json") && !!packageText;
  const hasHtml = written.some((p) => p.endsWith(".html")) || existingFiles.some((f) => f.path.endsWith(".html"));

  let buildOutput = "";
  let buildOk = true;

  if (hasPackage) {
    const packageChanged = written.includes("package.json");
    const needInstall = packageChanged || !(await runAgentCommand("test -d node_modules && echo yes || echo no", "workspace", 20).then((r) => r.output.includes("yes")).catch(() => false));
    if (needInstall) {
      step("Installing dependencies…");
      const install = await runAgentCommand("npm install --no-audit --no-fund", "workspace", 300);
      if (install.exitCode !== 0) {
        buildOk = false;
        buildOutput = install.output;
      }
    }

    if (buildOk && /"build"\s*:/.test(packageText)) {
      step("Running production build…");
      let build = await runAgentCommand("npm run build", "workspace", 300);
      buildOutput = build.output;
      for (let attempt = 1; attempt <= 2 && build.exitCode !== 0; attempt++) {
        step(`Build failed. Repair attempt ${attempt}/2…`);
        const repair = await sendChatMessage({
          providerId,
          apiKey,
          model,
          messages: [
            {
              role: "user",
              content: `The real workspace command failed. Fix the project and return only the complete changed files, each as:\n\nFILE: path/to/file.ext\n\`\`\`language\nfull file contents\n\`\`\`\n\nTASK:\n${task}\n\nBUILD ERROR:\n${build.output.slice(-14000)}`,
            },
          ],
        });
        const repaired = extractCodeFiles([{ role: "assistant", content: repair.text || "" }]).filter((f) => !/^snippet-/.test(f.filename));
        if (!repaired.length) break;
        for (const file of repaired) {
          const path = safePath(file.filename);
          if (!path) continue;
          await writeAgentFile(path, file.code);
          step(`Patched ${path}`);
        }
        build = await runAgentCommand("npm run build", "workspace", 300);
        buildOutput = build.output;
      }
      buildOk = build.exitCode === 0;
    }
  }

  // ---- start something to preview on localhost ----
  let previewUrl: string | undefined;
  let previewPort: number | undefined;

  if (buildOk && (hasPackage || hasHtml)) {
    const isVite = /vite/i.test(packageText);
    const isNext = /"next"/i.test(packageText);
    const hasDev = /"dev"\s*:/.test(packageText);
    const hasStart = /"start"\s*:/.test(packageText);
    const port = hasPackage ? (isVite ? 5173 : 3000) : 3000;
    const session = `agenticvenus-dev-${Date.now()}`;

    let command: string;
    if (hasPackage && (hasDev || hasStart)) {
      const script = hasDev ? "dev" : "start";
      const flags = isVite ? `-- --host 0.0.0.0 --port ${port}` : isNext ? `-- -H 0.0.0.0 -p ${port}` : "";
      command = `HOST=0.0.0.0 PORT=${port} npm run ${script} ${flags}`.trim();
    } else {
      command = `(python3 -m http.server ${port} --bind 0.0.0.0 || npx --yes serve -l ${port} .)`;
    }

    step(`Starting the server on port ${port}…`);
    // The bracket trick stops pkill from matching (and killing) its own shell.
    await runAgentSessionCommand("pkill -f '[n]ext dev|[v]ite|[h]ttp.server|[s]erve -l' || true", "agenticvenus-kill", false).catch(() => undefined);
    await runAgentSessionCommand(command, session, true).catch((e) => step(`Server start failed: ${e instanceof Error ? e.message : String(e)}`));

    const live = await detectServerPort(port);
    if (live) {
      try {
        const preview = await getAgentPreview(live);
        previewUrl = preview.url;
        previewPort = live;
        step(`Live preview ready on localhost:${live}.`);
      } catch (e) {
        step(`Preview URL unavailable: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      step("The server didn't open a port yet — use the Terminal in Codespace to check its output.");
    }
  }

  return { changedFiles: written, buildOutput, buildOk, previewUrl, previewPort, steps };
}