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

/**
 * IMPORTANT:
 *
 * workspaceListFiles() can return files with only:
 *   { path: string }
 *
 * or, when includeContent=true:
 *   { path: string, content: string }
 *
 * Therefore content MUST be optional here.
 */
type ExistingWorkspaceFile = {
  path: string;
  content?: string;
};

type GeneratedFile = {
  id: string;
  filename: string;
  language: string;
  code: string;
};

function cleanPath(input: string): string | null {
  const value = String(input || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^\.\/+/, "");

  if (!value) return null;

  if (
    value.includes("..") ||
    value.startsWith("~") ||
    value.includes("\0")
  ) {
    return null;
  }

  return value;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) =>
    setTimeout(resolve, ms),
  );
}

async function notifyStep(
  steps: string[],
  message: string,
  onStep?: (step: string) => Promise<void> | void,
) {
  steps.push(message);

  try {
    await onStep?.(message);
  } catch {
    // Progress reporting must never break the actual task.
  }
}

function buildDeveloperPrompt(
  task: string,
  history: ChatMessage[],
  existingFiles: string,
  skills: string,
): string {
  const recentContext = history
    .slice(-10)
    .map((message) => {
      const content = String(
        message.content ?? "",
      ).slice(0, 2500);

      return `${message.role}: ${content}`;
    })
    .join("\n");

  return `${AGENT_CORE}

You are the Developer Agent running inside a persistent real cloud workspace.

Your job is to ACTUALLY build the user's project.

Do not merely explain how to do the task.
You must generate the complete files required to implement the task.

${DEV_CRAFT_GUIDE}

${skills ? `\nAVAILABLE SKILLS:\n${skills}\n` : ""}

USER TASK:
${task}

RECENT CONVERSATION:
${recentContext || "(none)"}

CURRENT PROJECT FILES:
${existingFiles || "(empty project)"}

STRICT IMPLEMENTATION RULES:

1. Return complete files.
2. Never return partial snippets.
3. Never use placeholders such as:
   - TODO
   - implement here
   - rest of code
   - unchanged code
4. Preserve existing functionality unless the user explicitly asks to remove it.
5. Fix TypeScript errors caused by your changes.
6. Keep imports valid.
7. Use relative workspace paths.
8. Do not use absolute filesystem paths.
9. If package.json needs changing, return the COMPLETE package.json.
10. If an existing file needs changing, return the COMPLETE file.
11. Do not invent APIs that do not exist in the project.
12. Prefer the project's existing utilities and architecture.
13. The final result must be runnable.

FILE FORMAT:

FILE: path/to/file.ext
\`\`\`language
COMPLETE FILE CONTENT
\`\`\`

Return ONLY the files that need to be created or changed.
`;
}

function extractGeneratedFiles(
  responseText: string,
): GeneratedFile[] {
  const extracted = extractCodeFiles([
    {
      role: "assistant",
      content: responseText || "",
    },
  ]);

  return extracted
    .filter((file) => {
      if (!file?.filename) return false;

      if (
        file.filename.startsWith("snippet-")
      ) {
        return false;
      }

      return typeof file.code === "string";
    })
    .map((file) => ({
      id: file.id,
      filename: file.filename,
      language: file.language,
      code: file.code,
    }));
}

async function getExistingFiles(
  uid: string,
  scope: string,
): Promise<ExistingWorkspaceFile[]> {
  try {
    const result = await workspaceListFiles(
      uid,
      true,
      scope,
    );

    if (!Array.isArray(result.files)) {
      return [];
    }

    return result.files.map((file) => ({
      path: file.path,
      content:
        "content" in file &&
        typeof file.content === "string"
          ? file.content
          : undefined,
    }));
  } catch {
    return [];
  }
}

function formatExistingFiles(
  files: ExistingWorkspaceFile[],
): string {
  const MAX_FILES = 60;
  const MAX_FILE_CHARS = 8000;
  const MAX_TOTAL_CHARS = 60000;

  let total = 0;

  const output: string[] = [];

  for (
    const file of files.slice(0, MAX_FILES)
  ) {
    if (total >= MAX_TOTAL_CHARS) {
      break;
    }

    const content =
      typeof file.content === "string"
        ? file.content.slice(
            0,
            MAX_FILE_CHARS,
          )
        : "(content unavailable)";

    total += content.length;

    output.push(
      `FILE: ${file.path}\n\`\`\`\n${content}\n\`\`\``,
    );
  }

  return output.join("\n\n");
}

async function writeGeneratedFiles(
  uid: string,
  scope: string,
  files: GeneratedFile[],
  changedFiles: string[],
  onStep?: (
    step: string,
  ) => Promise<void> | void,
  steps?: string[],
) {
  for (const file of files) {
    const path = cleanPath(file.filename);

    if (!path) {
      continue;
    }

    if (!file.code.trim()) {
      continue;
    }

    /*
     * IMPORTANT:
     *
     * CodeFile uses:
     *   code
     *
     * NOT:
     *   content
     */
    await workspaceWriteFile(
      uid,
      path,
      file.code,
      scope,
    );

    if (!changedFiles.includes(path)) {
      changedFiles.push(path);
    }

    if (steps) {
      await notifyStep(
        steps,
        `Updated ${path}`,
        onStep,
      );
    }
  }
}

function projectHasFile(
  files: ExistingWorkspaceFile[],
  changedFiles: string[],
  filename: string,
) {
  return (
    changedFiles.includes(filename) ||
    files.some(
      (file) => file.path === filename,
    )
  );
}

function getPackageJson(
  existingFiles: ExistingWorkspaceFile[],
  generatedFiles: GeneratedFile[],
): string {
  const generated = generatedFiles.find(
    (file) =>
      cleanPath(file.filename) ===
      "package.json",
  );

  if (generated?.code) {
    return generated.code;
  }

  const existing = existingFiles.find(
    (file) =>
      file.path === "package.json",
  );

  return existing?.content || "";
}

function hasPackageScript(
  packageJson: string,
  script: string,
): boolean {
  if (!packageJson) return false;

  try {
    const parsed = JSON.parse(
      packageJson,
    );

    return Boolean(
      parsed?.scripts &&
        typeof parsed.scripts[script] ===
          "string",
    );
  } catch {
    return false;
  }
}

function detectProject(
  packageJson: string,
) {
  let parsed: any = {};

  try {
    parsed = JSON.parse(
      packageJson || "{}",
    );
  } catch {
    parsed = {};
  }

  const dependencies = {
    ...(parsed.dependencies || {}),
    ...(parsed.devDependencies || {}),
  };

  return {
    hasPackage:
      Boolean(packageJson.trim()),

    hasNext:
      Boolean(dependencies.next),

    hasVite:
      Boolean(dependencies.vite),

    hasDev:
      Boolean(
        parsed.scripts?.dev,
      ),

    hasStart:
      Boolean(
        parsed.scripts?.start,
      ),

    hasBuild:
      Boolean(
        parsed.scripts?.build,
      ),
  };
}

async function runBuild(
  uid: string,
  scope: string,
): Promise<{
  ok: boolean;
  output: string;
}> {
  const result = await workspaceExec(
    uid,
    "npm run build",
    scope,
    300,
  );

  /*
   * workspaceExec() returns:
   *   output
   *
   * NOT stdout/stderr.
   */
  return {
    ok: result.exitCode === 0,
    output: result.output || "",
  };
}

async function installDependencies(
  uid: string,
  scope: string,
): Promise<{
  ok: boolean;
  output: string;
}> {
  const result = await workspaceExec(
    uid,
    "npm install --no-audit --no-fund",
    scope,
    300,
  );

  return {
    ok: result.exitCode === 0,
    output: result.output || "",
  };
}

async function hasNodeModules(
  uid: string,
  scope: string,
): Promise<boolean> {
  try {
    const result = await workspaceExec(
      uid,
      "test -d node_modules && echo yes || echo no",
      scope,
      20,
    );

    return (
      result.exitCode === 0 &&
      result.output.includes("yes")
    );
  } catch {
    return false;
  }
}

async function waitForListeningPort(
  uid: string,
  preferredPort: number,
  previousPorts: number[],
  attempts = 25,
): Promise<number | null> {
  const previous = new Set(
    previousPorts,
  );

  for (
    let attempt = 0;
    attempt < attempts;
    attempt++
  ) {
    try {
      const result =
        await workspaceListeningPorts(
          uid,
        );

      const ports = Array.isArray(
        result.ports,
      )
        ? result.ports
        : [];

      if (
        ports.includes(
          preferredPort,
        )
      ) {
        return preferredPort;
      }

      const newlyOpened = ports.find(
        (port) =>
          !previous.has(port) &&
          port >= 3000 &&
          port <= 9999,
      );

      if (newlyOpened) {
        return newlyOpened;
      }
    } catch {
      // Keep waiting.
    }

    await sleep(1000);
  }

  return null;
}

async function startLivePreview(
  uid: string,
  scope: string,
  packageJson: string,
  hasHtml: boolean,
): Promise<{
  url?: string;
  port?: number;
  message?: string;
}> {
  const project = detectProject(
    packageJson,
  );

  let preferredPort: number;

  try {
    preferredPort = portForScope(
      scope,
      project.hasVite,
    );
  } catch {
    preferredPort = 3000;
  }

  const beforeResult =
    await workspaceListeningPorts(
      uid,
    ).catch(() => ({
      ports: [] as number[],
    }));

  const beforePorts =
    Array.isArray(
      beforeResult.ports,
    )
      ? beforeResult.ports
      : [];

  await workspaceFreePort(
    uid,
    preferredPort,
  ).catch(() => undefined);

  let command = "";

  if (
    project.hasPackage &&
    project.hasDev
  ) {
    if (project.hasVite) {
      command =
        `HOST=0.0.0.0 npm run dev -- --host 0.0.0.0 --port ${preferredPort}`;
    } else if (project.hasNext) {
      command =
        `HOSTNAME=0.0.0.0 npm run dev -- --hostname 0.0.0.0 --port ${preferredPort}`;
    } else {
      command =
        `HOST=0.0.0.0 PORT=${preferredPort} npm run dev`;
    }
  } else if (
    project.hasPackage &&
    project.hasStart
  ) {
    if (project.hasNext) {
      command =
        `HOSTNAME=0.0.0.0 npm run start -- --hostname 0.0.0.0 --port ${preferredPort}`;
    } else {
      command =
        `HOST=0.0.0.0 PORT=${preferredPort} npm run start`;
    }
  } else if (hasHtml) {
    command =
      `python3 -m http.server ${preferredPort} --bind 0.0.0.0`;
  } else {
    return {
      message:
        "No supported development/start script was found.",
    };
  }

  const sessionId =
    `developer-${scope
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .slice(0, 70)}`;

  await workspaceSessionExec(
    uid,
    sessionId,
    command,
    scope,
    true,
  );

  const livePort =
    await waitForListeningPort(
      uid,
      preferredPort,
      beforePorts,
    );

  if (!livePort) {
    return {
      message:
        "Development server started, but no listening preview port was detected.",
    };
  }

  try {
    const preview =
      await workspacePreview(
        uid,
        livePort,
      );

    return {
      url: preview.url,
      port: livePort,
    };
  } catch {
    return {
      port: livePort,
      message:
        "Preview server is running, but a preview URL could not be generated.",
    };
  }
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
  onStep?: (
    step: string,
  ) => Promise<void> | void,
): Promise<ServerDeveloperResult> {
  const steps: string[] = [];
  const changedFiles: string[] = [];

  // ---------------------------------------------------------
  // 1. PERSISTENT WORKSPACE
  // ---------------------------------------------------------

  const workspace =
    await ensureWorkspace(uid);

  await notifyStep(
    steps,
    `Persistent workspace ready: ${workspace.sandboxId.slice(
      0,
      12,
    )}…`,
    onStep,
  );

  // ---------------------------------------------------------
  // 2. READ CURRENT PROJECT
  // ---------------------------------------------------------

  const existingFiles =
    await getExistingFiles(
      uid,
      scope,
    );

  const existingText =
    formatExistingFiles(
      existingFiles,
    );

  await notifyStep(
    steps,
    `Inspected ${existingFiles.length} workspace files.`,
    onStep,
  );

  // ---------------------------------------------------------
  // 3. ASK DEVELOPER MODEL TO IMPLEMENT TASK
  // ---------------------------------------------------------

  await notifyStep(
    steps,
    "Analyzing the project and generating implementation…",
    onStep,
  );

  let response =
    await sendChatMessage({
      providerId,
      apiKey,
      model,
      messages: [
        {
          role: "user",
          content:
            buildDeveloperPrompt(
              task,
              history,
              existingText,
              installedSkills,
            ),
        },
      ],
    });

  let generatedFiles =
    extractGeneratedFiles(
      response.text || "",
    );

  if (!generatedFiles.length) {
    throw new Error(
      "Developer Agent returned no valid files.",
    );
  }

  // ---------------------------------------------------------
  // 4. WRITE FILES
  // ---------------------------------------------------------

  await writeGeneratedFiles(
    uid,
    scope,
    generatedFiles,
    changedFiles,
    onStep,
    steps,
  );

  // ---------------------------------------------------------
  // 5. DETECT PROJECT
  // ---------------------------------------------------------

  let packageJson =
    getPackageJson(
      existingFiles,
      generatedFiles,
    );

  const project =
    detectProject(
      packageJson,
    );

  const hasHtml =
    generatedFiles.some(
      (file) =>
        cleanPath(file.filename)
          ?.toLowerCase()
          .endsWith(".html"),
    ) ||
    existingFiles.some(
      (file) =>
        file.path
          .toLowerCase()
          .endsWith(".html"),
    );

  // ---------------------------------------------------------
  // 6. INSTALL DEPENDENCIES
  // ---------------------------------------------------------

  let buildOutput = "";
  let buildOk = true;

  if (project.hasPackage) {
    const packageChanged =
      changedFiles.includes(
        "package.json",
      );

    const modulesExist =
      await hasNodeModules(
        uid,
        scope,
      );

    if (
      packageChanged ||
      !modulesExist
    ) {
      await notifyStep(
        steps,
        "Installing project dependencies…",
        onStep,
      );

      const install =
        await installDependencies(
          uid,
          scope,
        );

      buildOutput =
        install.output;

      if (!install.ok) {
        buildOk = false;

        await notifyStep(
          steps,
          "Dependency installation failed.",
          onStep,
        );
      } else {
        await notifyStep(
          steps,
          "Dependencies installed successfully.",
          onStep,
        );
      }
    }
  }

  // ---------------------------------------------------------
  // 7. BUILD
  // ---------------------------------------------------------

  if (
    buildOk &&
    project.hasPackage &&
    project.hasBuild
  ) {
    await notifyStep(
      steps,
      "Running production build…",
      onStep,
    );

    let build =
      await runBuild(
        uid,
        scope,
      );

    buildOutput =
      build.output;

    // -------------------------------------------------------
    // 8. AUTOMATIC SELF-REPAIR
    // -------------------------------------------------------

    for (
      let attempt = 1;
      attempt <= 2 &&
      !build.ok;
      attempt++
    ) {
      await notifyStep(
        steps,
        `Build failed — automatic repair ${attempt}/2…`,
        onStep,
      );

      const repairPrompt = `You are repairing the user's REAL project.

USER TASK:
${task}

BUILD ERROR:
${build.output.slice(-18000)}

FILES THAT WERE CHANGED:
${changedFiles.join("\n")}

CURRENT PROJECT FILES:
${existingText}

Fix the build.

Return ONLY COMPLETE files using this format:

FILE: path/to/file.ext
\`\`\`language
COMPLETE FILE CONTENT
\`\`\`

Do not return explanations.
Do not return snippets.
Do not use placeholders.
Do not change unrelated files unless required for the fix.`;

      response =
        await sendChatMessage({
          providerId,
          apiKey,
          model,
          messages: [
            {
              role: "user",
              content:
                repairPrompt,
            },
          ],
        });

      const repairedFiles =
        extractGeneratedFiles(
          response.text || "",
        );

      if (!repairedFiles.length) {
        await notifyStep(
          steps,
          "Repair agent returned no valid files.",
          onStep,
        );

        break;
      }

      await writeGeneratedFiles(
        uid,
        scope,
        repairedFiles,
        changedFiles,
        onStep,
        steps,
      );

      packageJson =
        getPackageJson(
          existingFiles,
          repairedFiles,
        );

      build =
        await runBuild(
          uid,
          scope,
        );

      buildOutput =
        build.output;
    }

    buildOk = build.ok;

    if (buildOk) {
      await notifyStep(
        steps,
        "Production build passed successfully.",
        onStep,
      );
    } else {
      await notifyStep(
        steps,
        "Production build is still failing after automatic repair.",
        onStep,
      );
    }
  }

  // ---------------------------------------------------------
  // 9. LIVE PROJECT PREVIEW
  // ---------------------------------------------------------

  let previewUrl:
    | string
    | undefined;

  let previewPort:
    | number
    | undefined;

  if (
    buildOk &&
    (
      project.hasPackage ||
      hasHtml
    )
  ) {
    await notifyStep(
      steps,
      "Starting live project preview…",
      onStep,
    );

    const preview =
      await startLivePreview(
        uid,
        scope,
        packageJson,
        hasHtml,
      );

    previewUrl =
      preview.url;

    previewPort =
      preview.port;

    if (previewUrl) {
      await notifyStep(
        steps,
        `Live preview ready: ${previewUrl}`,
        onStep,
      );
    } else if (
      preview.message
    ) {
      await notifyStep(
        steps,
        preview.message,
        onStep,
      );
    }
  }

  // ---------------------------------------------------------
  // 10. FINAL RESULT
  // ---------------------------------------------------------

  return {
    changedFiles,
    buildOutput,
    buildOk,
    previewUrl,
    previewPort,
    steps,
  };
}