// lib/serverDeveloperRuntime.ts

import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";
import { extractCodeFiles } from "@/lib/codeExtract";
import { AGENT_CORE, DEV_CRAFT_GUIDE } from "@/lib/agents";
import { portForScope, sessionIdForScope } from "@/lib/workspaceScope";

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

type ExistingWorkspaceFile = {
  path: string;
  content: string;
};

const safePath = (p: string) => {
  const clean = p
    .replace(/\\/g, "/")
    .replace(/^\.?\/+/, "")
    .replace(/^workspace\//, "");

  if (!clean || clean.includes("..") || clean.startsWith("~")) {
    return null;
  }

  return clean;
};

function buildPrompt(
  task: string,
  history: ChatMessage[],
  existing: string,
  skills: string,
) {
  const fence = "```";

  const context = history
    .slice(-8)
    .map(
      (m) =>
        `${m.role}: ${m.content.slice(0, 1500)}`,
    )
    .join("\n");

  return `${AGENT_CORE}

You are the Developer Agent working inside a real persistent Linux cloud workspace.

Your job is to actually build, modify, debug and verify the user's project.

Do not only explain code.
Write the real files into the workspace.

${DEV_CRAFT_GUIDE}

${skills ? `\n${skills}\n` : ""}

USER TASK:
${task}

RECENT CONTEXT:
${context}

EXISTING WORKSPACE FILES:
${existing || "(empty)"}

IMPORTANT RULES:

1. Return complete files only.
2. Never return partial files.
3. Never return snippets.
4. Preserve existing functionality unless the task requires changing it.
5. Fix related TypeScript/build errors when they are caused by your changes.
6. Use safe relative file paths only.
7. For every file that must be created or changed use exactly:

FILE: path/to/file.ext
${fence}language
full file contents
${fence}

Do not return explanations outside the files.`;
}

async function waitForPort(
  uid: string,
  preferred: number,
  before: number[],
  tries = 20,
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
        p <= 9999,
    );

    if (fresh) {
      return fresh;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 1000),
    );
  }

  return null;
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
  onStep?: (step: string) => Promise<void> | void,
): Promise<ServerDeveloperResult> {
  const steps: string[] = [];

  const step = async (message: string) => {
    steps.push(message);
    await onStep?.(message);
  };

  // ---------------------------------------------------------
  // 1. ENSURE PERSISTENT WORKSPACE
  // ---------------------------------------------------------

  const workspace = await ensureWorkspace(uid);

  await step(
    `Persistent workspace ready: ${workspace.sandboxId.slice(
      0,
      10,
    )}…`,
  );

  // ---------------------------------------------------------
  // 2. READ EXISTING PROJECT
  // ---------------------------------------------------------

  const listing = await workspaceListFiles(
    uid,
    true,
    scope,
  ).catch(() => ({
    files: [] as ExistingWorkspaceFile[],
  }));

  const existingFiles: ExistingWorkspaceFile[] =
    Array.isArray(listing.files)
      ? listing.files
      : [];

  let budget = 60000;

  const existing = existingFiles
    .slice(0, 40)
    .map((file) => {
      const body = (file.content || "").slice(
        0,
        8000,
      );

      budget -= body.length;

      return budget > 0
        ? `FILE: ${file.path}\n\`\`\`\n${body}\n\`\`\``
        : `FILE: ${file.path} (omitted)`;
    })
    .join("\n\n");

  // ---------------------------------------------------------
  // 3. GENERATE IMPLEMENTATION
  // ---------------------------------------------------------

  await step("Analyzing the project and generating implementation…");

  let response = await sendChatMessage({
    providerId,
    apiKey,
    model,
    messages: [
      {
        role: "user",
        content: buildPrompt(
          task,
          history,
          existing,
          installedSkills,
        ),
      },
    ],
  });

  let files = extractCodeFiles([
    {
      role: "assistant",
      content: response.text || "",
    },
  ]).filter(
    (file) => !/^snippet-/.test(file.filename),
  );

  if (!files.length) {
    throw new Error(
      "Developer Agent returned no editable files.",
    );
  }

  // ---------------------------------------------------------
  // 4. WRITE REAL FILES
  // ---------------------------------------------------------

  const changedFiles: string[] = [];

  for (const file of files) {
    const path = safePath(file.filename);

    if (!path) {
      continue;
    }

    // IMPORTANT:
    // CodeFile uses `code`, NOT `content`.
    await workspaceWriteFile(
      uid,
      path,
      file.code,
      scope,
    );

    changedFiles.push(path);

    await step(`Wrote ${path}`);
  }

  // ---------------------------------------------------------
  // 5. PROJECT DETECTION
  // ---------------------------------------------------------

  const has = (name: string) =>
    changedFiles.includes(name) ||
    existingFiles.some(
      (file) => file.path === name,
    );

  const packageFile = files.find(
    (file) =>
      safePath(file.filename) ===
      "package.json",
  );

  const existingPackage = existingFiles.find(
    (file) =>
      file.path === "package.json",
  );

  const packageText =
    packageFile?.code ||
    existingPackage?.content ||
    "";

  const hasPackage =
    has("package.json") &&
    !!packageText;

  const hasHtml =
    changedFiles.some((path) =>
      path.endsWith(".html"),
    ) ||
    existingFiles.some((file) =>
      file.path.endsWith(".html"),
    );

  // ---------------------------------------------------------
  // 6. INSTALL DEPENDENCIES
  // ---------------------------------------------------------

  let buildOutput = "";
  let buildOk = true;

  if (hasPackage) {
    const needInstall =
      changedFiles.includes(
        "package.json",
      ) ||
      !(await workspaceExec(
        uid,
        "test -d node_modules && echo yes || echo no",
        scope,
        20,
      )
        .then((result) =>
          result.output.includes("yes"),
        )
        .catch(() => false));

    if (needInstall) {
      await step(
        "Installing project dependencies…",
      );

      const install = await workspaceExec(
        uid,
        "npm install --no-audit --no-fund",
        scope,
        300,
      );

      buildOutput = install.output;

      if (install.exitCode !== 0) {
        buildOk = false;
      }
    }
  }

  // ---------------------------------------------------------
  // 7. PRODUCTION BUILD
  // ---------------------------------------------------------

  if (
    buildOk &&
    hasPackage &&
    /"build"\s*:/.test(packageText)
  ) {
    await step(
      "Running production build…",
    );

    let build = await workspaceExec(
      uid,
      "npm run build",
      scope,
      300,
    );

    buildOutput = build.output;

    // -------------------------------------------------------
    // 8. SELF-REPAIR LOOP
    // -------------------------------------------------------

    for (
      let attempt = 1;
      attempt <= 2 &&
      build.exitCode !== 0;
      attempt++
    ) {
      await step(
        `Build failed — automatic repair attempt ${attempt}/2…`,
      );

      response = await sendChatMessage({
        providerId,
        apiKey,
        model,
        messages: [
          {
            role: "user",
            content: `Fix this real project.

Return ONLY complete changed files using:

FILE: path/to/file.ext
\`\`\`language
complete file
\`\`\`

Do not return explanations.

ORIGINAL TASK:
${task}

BUILD ERROR:
${build.output.slice(-14000)}

EXISTING CHANGED FILES:
${changedFiles.join("\n")}`,
          },
        ],
      });

      const repaired = extractCodeFiles([
        {
          role: "assistant",
          content: response.text || "",
        },
      ]).filter(
        (file) => !/^snippet-/.test(file.filename),
      );

      if (!repaired.length) {
        await step(
          "Repair agent returned no valid files.",
        );
        break;
      }

      for (const file of repaired) {
        const path = safePath(file.filename);

        if (!path) {
          continue;
        }

        // IMPORTANT:
        // CodeFile field is `code`.
        await workspaceWriteFile(
          uid,
          path,
          file.code,
          scope,
        );

        if (!changedFiles.includes(path)) {
          changedFiles.push(path);
        }

        await step(`Patched ${path}`);
      }

      build = await workspaceExec(
        uid,
        "npm run build",
        scope,
        300,
      );

      buildOutput = build.output;
    }

    buildOk = build.exitCode === 0;

    if (buildOk) {
      await step(
        "Production build passed successfully.",
      );
    }
  }

  // ---------------------------------------------------------
  // 9. LIVE PREVIEW
  // ---------------------------------------------------------

  let previewUrl: string | undefined;
  let previewPort: number | undefined;

  if (
    buildOk &&
    (hasPackage || hasHtml)
  ) {
    const isVite =
      /vite/i.test(packageText);

    const isNext =
      /"next"/i.test(packageText);

    const port = portForScope(
      scope,
      isVite,
    );

    const before =
      (
        await workspaceListeningPorts(
          uid,
        ).catch(() => ({
          ports: [] as number[],
        }))
      ).ports;

    await workspaceFreePort(
      uid,
      port,
    ).catch(() => undefined);

    const hasDev =
      /"dev"\s*:/.test(packageText);

    const hasStart =
      /"start"\s*:/.test(packageText);

    let command = "";

    if (
      hasPackage &&
      (hasDev || hasStart)
    ) {
      const script = hasDev
        ? "dev"
        : "start";

      let flags = "";

      if (isVite) {
        flags =
          ` -- --host 0.0.0.0 --port ${port}`;
      } else if (isNext) {
        flags =
          ` -- -H 0.0.0.0 -p ${port}`;
      }

      command =
        `HOST=0.0.0.0 PORT=${port} npm run ${script}${flags}`;
    } else {
      command =
        `python3 -m http.server ${port} --bind 0.0.0.0`;
    }

    await step(
      `Starting live preview on port ${port}…`,
    );

    await workspaceSessionExec(
      uid,
      sessionIdForScope(
        scope,
        "agenticvenus-dev",
      ),
      command,
      scope,
      true,
    );

    const livePort =
      await waitForPort(
        uid,
        port,
        before,
      );

    if (livePort) {
      const preview =
        await workspacePreview(
          uid,
          livePort,
        );

      previewUrl = preview.url;
      previewPort = livePort;

      await step(
        `Live preview ready: ${preview.url}`,
      );
    } else {
      await step(
        "Development server started, but the live preview port could not be detected.",
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