"use client";

import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";
import { extractCodeFiles } from "@/lib/codeExtract";
import { ensureAgentWorkspace, getAgentPreview, runAgentCommand, runAgentSessionCommand, writeAgentFile } from "@/lib/workspaceClient";

export type DeveloperRunResult = {
  changedFiles: string[];
  buildOutput: string;
  buildOk: boolean;
  previewUrl?: string;
  steps: string[];
};

const CODE_TASK_RE = /\b(build|create|make|develop|code|website|web app|app|game|component|landing page|project|repository|repo|fix|debug|refactor|typescript|javascript|react|next\.js|vite|python|html|css)\b/i;

export function looksLikeDeveloperTask(task: string) { return CODE_TASK_RE.test(task); }

export async function runDeveloperWorkspace(
  providerId: string,
  apiKey: string,
  task: string,
  model: string | undefined,
  history: ChatMessage[],
  onStep?: (step: string) => void,
): Promise<DeveloperRunResult> {
  const steps: string[] = [];
  const step = (s: string) => { steps.push(s); onStep?.(s); };
  const workspace = await ensureAgentWorkspace();
  step(`Workspace ready: ${workspace.sandboxId.slice(0, 10)}…`);

  const prompt = `You are the Developer Agent working inside a real persistent cloud workspace. Build/fix the user's requested project for real.\n\nUSER TASK:\n${task}\n\nRECENT CONTEXT:\n${history.slice(-8).map((m) => `${m.role}: ${m.content}`).join("\n")}\n\nReturn ONLY the complete files that you need to create or change, using this exact format for every file:\n\nFILE: path/to/file.ext\n	description optional\n\`\`\`language\nfull file contents\n\`\`\`\n\nDo not return a vague plan. Write production-ready code. Keep existing project structure when possible.`;

  const response = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
  const files = extractCodeFiles([{ role: "assistant", content: response.text || "" }]);
  if (!files.length) throw new Error("Developer Agent did not return editable project files.");

  for (const file of files) {
    await writeAgentFile(file.filename, file.code);
    step(`Wrote ${file.filename}`);
  }

  const packageFile = files.find((f) => f.filename === "package.json" || f.filename.endsWith("/package.json"));
  let buildOutput = "";
  let buildOk = true;
  if (packageFile) {
    step("Installing dependencies…");
    const install = await runAgentCommand("npm install --no-audit --no-fund", "workspace", 300);
    if (install.exitCode !== 0) {
      buildOk = false;
      buildOutput = install.output;
    } else {
      step("Running production build…");
      let build = await runAgentCommand("npm run build", "workspace", 300);
      buildOutput = build.output;
      for (let attempt = 1; attempt <= 2 && build.exitCode !== 0; attempt++) {
        step(`Build failed. Repair attempt ${attempt}/2…`);
        const repair = await sendChatMessage({
          providerId, apiKey, model,
          messages: [{ role: "user", content: `The real workspace command failed. Fix the project and return only the complete changed files in FILE: path + fenced code format.\n\nTASK:\n${task}\n\nBUILD ERROR:\n${build.output.slice(-14000)}` }],
        });
        const repaired = extractCodeFiles([{ role: "assistant", content: repair.text || "" }]);
        if (!repaired.length) break;
        for (const file of repaired) { await writeAgentFile(file.filename, file.code); step(`Patched ${file.filename}`); }
        build = await runAgentCommand("npm run build", "workspace", 300);
        buildOutput = build.output;
      }
      buildOk = build.exitCode === 0;
    }

    if (buildOk) {
      const port = /vite/i.test(packageFile.code) ? 5173 : 3000;
      step(`Starting dev server on ${port}…`);
      await runAgentSessionCommand(`npm run dev -- --hostname 0.0.0.0 --port ${port}`, "agenticvenus-dev", true);
      await new Promise((r) => setTimeout(r, 1800));
      try {
        const preview = await getAgentPreview(port);
        step("Live preview ready.");
        return { changedFiles: files.map((f) => f.filename), buildOutput, buildOk, previewUrl: preview.url, steps };
      } catch (e) {
        step(`Preview URL unavailable: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return { changedFiles: files.map((f) => f.filename), buildOutput, buildOk, steps };
}
