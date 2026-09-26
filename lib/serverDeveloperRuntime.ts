// Server-side Developer Agent.
// Runs coding tasks inside the user's persistent Daytona workspace.

import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";
import { extractCodeFiles } from "@/lib/codeExtract";
import { AGENT_CORE, DEV_CRAFT_GUIDE } from "@/lib/agents";
import {
  ensureWorkspace,
  workspaceListFiles,
  workspaceWriteFile,
  workspaceExec,
  workspaceSessionExec,
  workspaceListeningPorts,
  workspaceFreePort,
  workspacePreview,
} from "@/lib/workspaceRuntime";

export type ServerDeveloperResult = {
  changedFiles: string[];
  buildOutput: string;
  buildOk: boolean;
  previewUrl?: string;
  previewPort?: number;
  steps: string[];
};

const safePath = (p: string) => {
  const clean = p
    .replace(/\\/g, "/")
    .replace(/^\.?\/+/, "")
    .replace(/^workspace\//, "");

  if (
    !clean ||
    clean.includes("..") ||
    clean.startsWith("~") ||
    clean.startsWith("/")
  ) {
    return null;
  }

  return clean;
};

function buildPrompt(
  task: string,
  history: ChatMessage[],
  existing: string,
  skills: string
) {
  const fence = "```";

  const context = history
    .slice(-8)
    .map((m) => `${m.role}: ${m.content.slice(0, 1500)}`)
    .join("\n");

  return `${AGENT_CORE}

You are the Developer Agent working inside a real persistent Linux cloud workspace.

Your job is to actually implement the user's request.

You have access to a persistent workspace containing the user's project.

Rules:

1. Inspect the existing project before changing it.
2. Preserve existing functionality.
3. Do not rewrite unrelated files.
4. Return complete files, never partial snippets.
5. Use safe relative file paths.
6. Prefer minimal, production-quality changes.
7. Keep the existing framework and architecture unless the task requires otherwise.
8. Do not invent APIs or packages that are not available.
9. Make the implementation actually runnable.
10. After implementation the runtime will build/test the project.
11. If a build error occurs, the agent can be called again to repair it.

${DEV_CRAFT_GUIDE}

${skills ? `\nAVAILABLE SKILLS:\n${skills}\n` : ""}

USER TASK:
${task}

RECENT CONTEXT:
${context || "(none)"}

EXISTING WORKSPACE:
${existing || "(empty)"}

Return ONLY complete files that must be created or changed.

For every changed file use exactly:

FILE: path/to/file.ext
${fence}language
complete file contents
${fence}

Never return partial files.
Never use unsafe paths.
Never include explanations outside the file blocks.
`;
}

async function waitForPort(
  uid: string,
  preferred: number,
  before: number[],
  tries = 20
) {
  const baseline = new Set(before);

  for (let i = 0; i < tries; i++) {
    const ports = await workspaceListeningPorts(uid).catch(() => ({
      ports: [] as number[],
    }));

    if (ports.ports.includes(preferred)) {
      return preferred;
    }

    const fresh = ports.ports.find(
      (p) =>
        !baseline.has(p) &&
        p >= 3000 &&
        p <= 9999
    );

    if (fresh) {
      return fresh;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return null;
}

async function runBuild(
  uid: string,
  scope: string,
  onStep?: (step: string) => Promise<void> | void
) {
  await onStep?.("🔨 Running production build…");

  const result = await workspaceExec(
    uid,
    "npm run build",
    scope
  );

  return {
    ok: result.exitCode === 0,
    output: `${result.stdout || ""}\n${result.stderr || ""}`.trim(),
  };
}

async function startPreview(
  uid: string,
  scope: string,
  onStep?: (step: string) => Promise<void> | void
) {
  await onStep?.("🚀 Starting the development server…");

  const beforeResult = await workspaceListeningPorts(uid).catch(() => ({
    ports: [] as number[],
  }));

  const before = beforeResult.ports;

  let preferred = 3000;

  try {
    const free = await workspaceFreePort(uid, 3000);

    if (typeof free === "number" && free > 0) {
      preferred = free;
    }
  } catch {
    // Keep 3000 as fallback.
  }

  const command =
    `npm run dev -- --hostname 0.0.0.0 --port ${preferred}`;

  await workspaceSessionExec(
    uid,
    command,
    scope
  );

  const port = await waitForPort(
    uid,
    preferred,
    before,
    25
  );

  if (!port) {
    await onStep?.(
      "⚠️ Development server did not expose a listening port."
    );

    return {
      port: undefined,
      previewUrl: undefined,
    };
  }

  await onStep?.(
    `🌐 Development server is running on port ${port}.`
  );

  let previewUrl: string | undefined;

  try {
    previewUrl = await workspacePreview(
      uid,
      port,
      scope
    );
  } catch {
    previewUrl = undefined;
  }

  return {
    port,
    previewUrl,
  };
}

export async function runServerDeveloperWorkspace(
  uid: string,
  providerId: string,
  apiKey: string,
  task: string,
  model: string | undefined,
  history: ChatMessage[],
  scope: string,
  installedSkills = "",
  onStep?: (step: string) => Promise<void> | void
): Promise<ServerDeveloperResult> {
  const steps: string[] = [];

  const step = async (message: string) => {
    steps.push(message);
    await onStep?.(message);
  };

  await step("💻 Preparing the persistent development workspace…");

  const workspace = await ensureWorkspace(uid);

  await step(
    `Persistent workspace ready: ${workspace.sandboxId.slice(
      0,
      10
    )}…`
  );

  const existingFiles = await workspaceListFiles(
    uid,
    true,
    scope
  ).catch(() => []);

  let budget = 60000;

  const existing = existingFiles
    .slice(0, 60)
    .map((file) => {
      const body = (file.content || "").slice(0, 8000);

      budget -= body.length;

      if (budget <= 0) {
        return `FILE: ${file.path} (omitted)`;
      }

      return `FILE: ${file.path}
\`\`\`
${body}
\`\`\``;
    })
    .join("\n\n");

  await step("🧠 Inspecting the existing project…");

  const prompt = buildPrompt(
    task,
    history,
    existing,
    installedSkills
  );

  await step("✍️ Generating the implementation…");

  const response = await sendChatMessage({
    providerId,
    apiKey,
    model,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  let files = extractCodeFiles([
    {
      role: "assistant",
      content: response.text || "",
    },
  ]).filter(
    (file) =>
      !/^snippet-/i.test(file.filename)
  );

  if (!files.length) {
    throw new Error(
      "Developer Agent returned no editable files."
    );
  }

  const changedFiles: string[] = [];

  for (const file of files) {
    const path = safePath(file.filename);

    if (!path) {
      continue;
    }

    await step(`📝 Updating ${path}…`);

    await workspaceWriteFile(
      uid,
      path,
      file.content,
      scope
    );

    changedFiles.push(path);
  }

  if (!changedFiles.length) {
    throw new Error(
      "Developer Agent returned only unsafe or invalid file paths."
    );
  }

  await step(
    `✅ Updated ${changedFiles.length} file${
      changedFiles.length === 1 ? "" : "s"
    }.`
  );

  let build = await runBuild(
    uid,
    scope,
    step
  );

  let repairAttempts = 0;

  while (!build.ok && repairAttempts < 2) {
    repairAttempts++;

    await step(
      `❌ Build failed. Repair attempt ${repairAttempts}/2…`
    );

    const repairPrompt = `${AGENT_CORE}

You are repairing a real project inside a persistent cloud workspace.

The user's original task was:

${task}

Files changed during the previous implementation:

${changedFiles.join("\n")}

The production build failed with:

${build.output.slice(-12000)}

Fix the build error while preserving the requested functionality.

Return ONLY the complete files that must be changed.

For every file:

FILE: path/to/file.ext
\`\`\`language
complete file
\`\`\`

Never return partial files.
Never use unsafe paths.
`;

    const repair = await sendChatMessage({
      providerId,
      apiKey,
      model,
      messages: [
        {
          role: "user",
          content: repairPrompt,
        },
      ],
    });

    const repairFiles = extractCodeFiles([
      {
        role: "assistant",
        content: repair.text || "",
      },
    ]);

    for (const file of repairFiles) {
      const path = safePath(file.filename);

      if (!path) {
        continue;
      }

      await step(`🔧 Repairing ${path}…`);

      await workspaceWriteFile(
        uid,
        path,
        file.content,
        scope
      );

      if (!changedFiles.includes(path)) {
        changedFiles.push(path);
      }
    }

    build = await runBuild(
      uid,
      scope,
      step
    );
  }

  if (!build.ok) {
    await step(
      "❌ Production build is still failing after automatic repair."
    );

    return {
      changedFiles,
      buildOutput: build.output,
      buildOk: false,
      steps,
    };
  }

  await step(
    "✅ Production build passed."
  );

  const preview = await startPreview(
    uid,
    scope,
    step
  );

  if (preview.previewUrl) {
    await step(
      "🌐 Live preview is ready."
    );
  }

  return {
    changedFiles,
    buildOutput: build.output,
    buildOk: true,
    previewUrl: preview.previewUrl,
    previewPort: preview.port,
    steps,
  };
}