// lib/serverDeveloperRuntime.ts

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
import { portForScope } from "@/lib/workspaceScope";

export type ServerDeveloperResult = {
  changedFiles: string[];
  buildOutput: string;
  buildOk: boolean;
  previewUrl?: string;
  previewPort?: number;
  steps: string[];
};

const MAX_CONTEXT_CHARS = 60000;

/**
 * Prevent the model from writing outside the workspace.
 */
function safePath(path: string): string | null {
  const clean = String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^\.\/+/, "")
    .trim();

  if (!clean) return null;

  if (
    clean.includes("../") ||
    clean === ".." ||
    clean.startsWith("../") ||
    clean.startsWith("~") ||
    clean.startsWith("/")
  ) {
    return null;
  }

  return clean;
}

/**
 * Build the developer-agent prompt.
 */
function buildDeveloperPrompt(
  task: string,
  history: ChatMessage[],
  existingFiles: string,
  installedSkills: string
): string {
  const recentHistory = history
    .slice(-10)
    .map((message) => {
      return `${message.role.toUpperCase()}:\n${message.content.slice(
        0,
        2500
      )}`;
    })
    .join("\n\n");

  return `${AGENT_CORE}

${DEV_CRAFT_GUIDE}

You are the autonomous Developer Agent operating inside a REAL persistent cloud workspace.

The user's task is:

${task}

YOUR RESPONSIBILITY

You must actually implement the user's request in the existing workspace.

Do not merely explain how to do it.

WORKSPACE RULES

1. Inspect the existing project before making changes.
2. Preserve existing functionality.
3. Do not rewrite unrelated files.
4. Do not delete working features unless the user's task explicitly requires it.
5. Use the existing framework and dependencies whenever possible.
6. Do not invent unavailable packages or APIs.
7. Write production-quality code.
8. Handle loading, error and empty states where appropriate.
9. Keep TypeScript types correct.
10. Do not leave TODOs or fake implementations.
11. Do not return partial files.
12. Return complete contents for every file you change.
13. Use only safe relative file paths.
14. After the files are written, the server runtime will run the project build.
15. If the build fails, a repair pass will be performed.

FILE OUTPUT FORMAT

Return ONLY files that need to be created or changed.

For each file use:

FILE: path/to/file.ext
\`\`\`language
COMPLETE FILE CONTENT
\`\`\`

Example:

FILE: app/page.tsx
\`\`\`tsx
export default function Page() {
  return <main>Hello</main>;
}
\`\`\`

IMPORTANT

- Never return a partial file.
- Never use "...".
- Never use placeholder code.
- Never use unsafe paths.
- Never put explanations outside the file blocks.

${
  installedSkills
    ? `AVAILABLE SKILLS:\n${installedSkills}\n`
    : ""
}

RECENT CONVERSATION:

${recentHistory || "(no recent conversation)"}

CURRENT WORKSPACE:

${existingFiles || "(workspace is empty)"}
`;
}

/**
 * Convert workspace files into compact model context.
 */
function serializeWorkspaceFiles(
  files: Array<{ path: string; content?: string }>
): string {
  let used = 0;
  const chunks: string[] = [];

  for (const file of files) {
    const content = String(file.content || "");

    if (!content) {
      chunks.push(`FILE: ${file.path}\n(empty)`);
      continue;
    }

    if (used >= MAX_CONTEXT_CHARS) {
      chunks.push(`FILE: ${file.path}\n(content omitted due to context limit)`);
      continue;
    }

    const remaining = MAX_CONTEXT_CHARS - used;
    const clipped = content.slice(0, Math.min(remaining, 12000));

    chunks.push(
      `FILE: ${file.path}\n\`\`\`\n${clipped}\n\`\`\``
    );

    used += clipped.length;
  }

  return chunks.join("\n\n");
}

/**
 * Wait until a development server becomes visible on the expected port.
 */
async function waitForPort(
  uid: string,
  expectedPort: number,
  attempts = 25
): Promise<number | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const result = await workspaceListeningPorts(uid);

      if (result.ports.includes(expectedPort)) {
        return expectedPort;
      }
    } catch {
      // The sandbox may still be starting the process.
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return null;
}

/**
 * Run npm build.
 *
 * IMPORTANT:
 * workspaceExec returns `output`, not stdout/stderr.
 */
async function runProductionBuild(
  uid: string,
  scope: string,
  onStep?: (message: string) => Promise<void> | void
) {
  await onStep?.("🔨 Running production build...");

  const result = await workspaceExec(
    uid,
    "npm run build",
    scope,
    300
  );

  return {
    ok: result.exitCode === 0,
    output: String(result.output || ""),
  };
}

/**
 * Start the user's development server on the stable port assigned
 * to this workspace scope.
 */
async function startDevelopmentServer(
  uid: string,
  scope: string,
  onStep?: (message: string) => Promise<void> | void
) {
  await onStep?.("🚀 Starting the development server...");

  /*
   * Each workspace scope receives a stable port.
   *
   * This prevents two chats from fighting over port 3000.
   */
  const port = portForScope(scope, false);

  /*
   * Free only this exact port.
   *
   * We never run broad pkill commands because the same Daytona
   * sandbox can contain multiple workspace scopes.
   */
  await workspaceFreePort(uid, port);

  const sessionId = `developer-preview-${scope || "global"}`;

  /*
   * Next.js accepts:
   *
   * npm run dev -- --hostname 0.0.0.0 --port PORT
   *
   * The command is intentionally run asynchronously so the HTTP
   * request does not wait forever for the dev server.
   */
  const command =
    `npm run dev -- --hostname 0.0.0.0 --port ${port}`;

  try {
    await workspaceSessionExec(
      uid,
      sessionId,
      command,
      scope,
      true
    );
  } catch (error) {
    /*
     * If a dev server is already running in this scope, we still
     * continue and check the port.
     */
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    await onStep?.(
      `ℹ️ Development server start returned: ${message}`
    );
  }

  const detectedPort = await waitForPort(
    uid,
    port,
    30
  );

  if (!detectedPort) {
    await onStep?.(
      "⚠️ Development server did not become available."
    );

    return {
      port: undefined,
      previewUrl: undefined,
    };
  }

  await onStep?.(
    `🌐 Development server is running on port ${detectedPort}.`
  );

  /*
   * workspacePreview returns:
   *
   * {
   *   sandboxId,
   *   port,
   *   url
   * }
   */
  try {
    const preview = await workspacePreview(
      uid,
      detectedPort
    );

    return {
      port: detectedPort,
      previewUrl: preview.url,
    };
  } catch (error) {
    await onStep?.(
      `⚠️ Preview URL could not be generated: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    return {
      port: detectedPort,
      previewUrl: undefined,
    };
  }
}

/**
 * Main autonomous developer runtime.
 */
export async function runServerDeveloperWorkspace(
  uid: string,
  providerId: string,
  apiKey: string,
  task: string,
  model: string | undefined,
  history: ChatMessage[],
  scope: string,
  installedSkills = "",
  onStep?: (message: string) => Promise<void> | void
): Promise<ServerDeveloperResult> {
  const steps: string[] = [];

  const step = async (message: string) => {
    steps.push(message);
    await onStep?.(message);
  };

  /*
   * ------------------------------------------------------------
   * 1. Prepare persistent Daytona workspace
   * ------------------------------------------------------------
   */

  await step(
    "💻 Preparing the persistent Daytona development workspace..."
  );

  const workspace = await ensureWorkspace(uid);

  await step(
    `☁️ Connected to persistent workspace ${workspace.sandboxId.slice(
      0,
      12
    )}...`
  );

  /*
   * ------------------------------------------------------------
   * 2. Inspect project
   * ------------------------------------------------------------
   */

  await step(
    "🔎 Inspecting the existing project..."
  );

  /*
   * IMPORTANT:
   * workspaceListFiles returns { files }, not a direct array.
   */
  const listing = await workspaceListFiles(
    uid,
    true,
    scope
  );

  const existingFiles = Array.isArray(listing.files)
    ? listing.files
    : [];

  const existingContext =
    serializeWorkspaceFiles(existingFiles);

  /*
   * ------------------------------------------------------------
   * 3. Ask the connected model to implement the task
   * ------------------------------------------------------------
   */

  await step(
    "🧠 Planning the implementation..."
  );

  const prompt = buildDeveloperPrompt(
    task,
    history,
    existingContext,
    installedSkills
  );

  await step(
    "✍️ Generating the implementation..."
  );

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

  const generatedFiles = extractCodeFiles([
    {
      role: "assistant",
      content: response.text || "",
    },
  ]);

  if (!generatedFiles.length) {
    throw new Error(
      "Developer Agent returned no editable files."
    );
  }

  /*
   * ------------------------------------------------------------
   * 4. Write files
   * ------------------------------------------------------------
   */

  const changedFiles: string[] = [];

  for (const file of generatedFiles) {
    const path = safePath(file.filename);

    if (!path) {
      await step(
        `⚠️ Skipped unsafe file path: ${file.filename}`
      );
      continue;
    }

    /*
     * Prevent accidental overwriting of environment secrets.
     */
    if (
      path === ".env" ||
      path.startsWith(".env.") &&
      path !== ".env.example"
    ) {
      await step(
        `🔐 Skipped protected environment file: ${path}`
      );
      continue;
    }

    await step(
      `📝 Writing ${path}...`
    );

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
      "Developer Agent returned no safe files to write."
    );
  }

  await step(
    `✅ Updated ${changedFiles.length} file${
      changedFiles.length === 1 ? "" : "s"
    }.`
  );

  /*
   * ------------------------------------------------------------
   * 5. Build
   * ------------------------------------------------------------
   */

  let build = await runProductionBuild(
    uid,
    scope,
    step
  );

  /*
   * ------------------------------------------------------------
   * 6. Automatic repair
   * ------------------------------------------------------------
   */

  let repairAttempts = 0;

  while (!build.ok && repairAttempts < 2) {
    repairAttempts++;

    await step(
      `❌ Build failed. Starting automatic repair ${repairAttempts}/2...`
    );

    const repairPrompt = `${AGENT_CORE}

You are the repair engineer for a REAL project inside a persistent cloud workspace.

ORIGINAL USER TASK:

${task}

FILES CURRENTLY CHANGED:

${changedFiles.join("\n")}

PRODUCTION BUILD ERROR:

${build.output.slice(-16000)}

YOUR JOB:

Fix the actual build/type/runtime error.

Do not rewrite unrelated functionality.

Do not invent packages.

Return ONLY COMPLETE FILES that need changing.

Format:

FILE: path/to/file.ext
\`\`\`language
COMPLETE FILE CONTENT
\`\`\`

Never return partial files.
Never use unsafe paths.
Never explain the fix outside the file blocks.
`;

    const repairResponse = await sendChatMessage({
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
        content: repairResponse.text || "",
      },
    ]);

    if (!repairFiles.length) {
      await step(
        "⚠️ Repair model returned no files."
      );
      break;
    }

    for (const file of repairFiles) {
      const path = safePath(file.filename);

      if (!path) {
        continue;
      }

      if (
        path === ".env" ||
        (path.startsWith(".env.") &&
          path !== ".env.example")
      ) {
        continue;
      }

      await step(
        `🔧 Repairing ${path}...`
      );

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

    build = await runProductionBuild(
      uid,
      scope,
      step
    );
  }

  /*
   * ------------------------------------------------------------
   * 7. Stop if build is still broken
   * ------------------------------------------------------------
   */

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
    "✅ Production build passed successfully."
  );

  /*
   * ------------------------------------------------------------
   * 8. Start live preview
   * ------------------------------------------------------------
   */

  const preview = await startDevelopmentServer(
    uid,
    scope,
    step
  );

  if (preview.previewUrl) {
    await step(
      "🟢 Live preview is ready."
    );
  }

  /*
   * ------------------------------------------------------------
   * 9. Final result
   * ------------------------------------------------------------
   */

  return {
    changedFiles,
    buildOutput: build.output,
    buildOk: true,
    previewUrl: preview.previewUrl,
    previewPort: preview.port,
    steps,
  };
}