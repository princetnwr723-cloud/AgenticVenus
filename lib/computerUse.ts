// lib/computerUse.ts

import { Daytona } from "@daytona/sdk";
import { adminDb } from "@/lib/firebaseAdmin";
import { sanitizeScope } from "@/lib/workspaceScope";

const COLLECTION = "computerWorkspace";

export type ComputerAction =
  | {
      type: "screenshot";
    }
  | {
      type: "move";
      x: number;
      y: number;
    }
  | {
      type: "click";
      x: number;
      y: number;
      button?: "left" | "right" | "middle";
      double?: boolean;
    }
  | {
      type: "drag";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
  | {
      type: "type";
      text: string;
    }
  | {
      type: "key";
      key: string;
    }
  | {
      type: "hotkey";
      keys: string;
    }
  | {
      type: "scroll";
      amount: number;
      x?: number;
      y?: number;
      direction?: "up" | "down";
    }
  | {
      type: "launch";
      command: string;
    }
  | {
      type: "wait";
      ms: number;
    };

const sleep = (ms: number) =>
  new Promise<void>((resolve) =>
    setTimeout(resolve, ms)
  );

async function getStoredSandboxId(
  uid: string,
  scope: string
): Promise<string | undefined> {
  const snap = await adminDb()
    .collection("users")
    .doc(uid)
    .collection(COLLECTION)
    .doc(scope)
    .get();

  if (!snap.exists) {
    return undefined;
  }

  const sandboxId =
    snap.data()?.sandboxId;

  return typeof sandboxId === "string"
    ? sandboxId
    : undefined;
}

async function saveSandboxId(
  uid: string,
  scope: string,
  sandboxId: string
): Promise<void> {
  await adminDb()
    .collection("users")
    .doc(uid)
    .collection(COLLECTION)
    .doc(scope)
    .set(
      {
        sandboxId,
        updatedAt: Date.now(),
      },
      {
        merge: true,
      }
    );
}

export type StartComputerOptions = {
  uid?: string;
  scope?: string;
  gpu?: boolean;
};

export async function startComputer(
  apiKey: string,
  opts: StartComputerOptions = {}
): Promise<{
  sandboxId: string;
  gpuRequested: boolean;
}> {
  if (!apiKey?.trim()) {
    throw new Error(
      "DAYTONA_KEY_MISSING"
    );
  }

  const {
    uid,
    gpu,
  } = opts;

  const scope = sanitizeScope(
    opts.scope
  );

  const daytona = new Daytona({
    apiKey: apiKey.trim(),
  });

  let sandbox: any = null;

  /*
   * Reuse the same persistent sandbox.
   * This is important because the user's:
   *
   * - files
   * - installed apps
   * - browser sessions
   * - desktop state
   *
   * should survive restart.
   */
  if (uid) {
    const existingId =
      await getStoredSandboxId(
        uid,
        scope
      );

    if (existingId) {
      sandbox =
        await daytona
          .get(existingId)
          .catch(() => null);
    }
  }

  /*
   * Create a new persistent sandbox
   * only when there is no usable one.
   */
  if (!sandbox) {
    const createOptions: any = {
      language: "typescript",
      autoDeleteInterval: -1,
      networkBlockAll: false,
    };

    if (gpu) {
      try {
        sandbox =
          await daytona.create({
            ...createOptions,
            resources: {
              gpu: 1,
            },
          });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        throw new Error(
          `GPU sandbox request failed: ${message}`
        );
      }
    } else {
      sandbox =
        await daytona.create(
          createOptions
        );
    }
  } else {
    /*
     * Resume the existing sandbox if
     * Daytona has stopped it.
     */
    if (
      sandbox.state &&
      sandbox.state !== "started"
    ) {
      await sandbox
        .start(60)
        .catch(
          (error: unknown) => {
            throw new Error(
              `Failed to resume Daytona sandbox: ${
                error instanceof Error
                  ? error.message
                  : String(error)
              }`
            );
          }
        );
    }
  }

  if (!sandbox?.id) {
    throw new Error(
      "Daytona returned an invalid sandbox."
    );
  }

  /*
   * Start the real desktop/computer-use
   * environment.
   */
  try {
    await sandbox.computerUse.start();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    throw new Error(
      `COMPUTER_USE_START_FAILED: ${message}`
    );
  }

  /*
   * Persist sandbox ID before returning.
   */
  if (uid) {
    await saveSandboxId(
      uid,
      scope,
      sandbox.id
    );
  }

  return {
    sandboxId: sandbox.id,
    gpuRequested: !!gpu,
  };
}

/**
 * Get Daytona signed preview URL.
 *
 * Used for the live computer/VNC view.
 */
export async function getSignedPreviewUrl(
  sandboxId: string,
  apiKey: string,
  port: number,
  expiresInSeconds = 43200
): Promise<{
  url: string;
  token: string;
}> {
  if (!sandboxId) {
    throw new Error(
      "SANDBOX_ID_MISSING"
    );
  }

  if (!apiKey?.trim()) {
    throw new Error(
      "DAYTONA_KEY_MISSING"
    );
  }

  const response =
    await fetch(
      `https://app.daytona.io/api/sandbox/${encodeURIComponent(
        sandboxId
      )}/ports/${port}/signed-preview-url?expiresInSeconds=${expiresInSeconds}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept:
            "application/json",
        },
        cache: "no-store",
      }
    );

  const data =
    await response
      .json()
      .catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        `Daytona preview request failed with status ${response.status}.`
    );
  }

  if (
    typeof data?.url !==
      "string" ||
    typeof data?.token !==
      "string"
  ) {
    throw new Error(
      "Daytona returned an invalid signed preview URL."
    );
  }

  return {
    url: data.url,
    token: data.token,
  };
}

/**
 * Daytona screenshot response can have
 * different shapes depending on SDK version.
 */
function extractBase64(
  shot: any
): string {
  const raw =
    typeof shot === "string"
      ? shot
      : shot?.screenshot ??
        shot?.image ??
        shot?.data ??
        shot?.base64 ??
        "";

  if (
    typeof raw !== "string" ||
    !raw
  ) {
    throw new Error(
      "Daytona returned an empty screenshot."
    );
  }

  return raw.replace(
    /^data:[^,]+,/,
    ""
  );
}

const KEY_ALIASES: Record<
  string,
  string
> = {
  enter: "Return",
  return: "Return",

  esc: "Escape",
  escape: "Escape",

  del: "Delete",
  delete: "Delete",

  backspace: "BackSpace",

  tab: "Tab",

  space: "space",

  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",

  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",

  pageup: "Page_Up",
  pagedown: "Page_Down",

  home: "Home",
  end: "End",
};

function normalizeKey(
  key: string
): string {
  const normalized =
    key.trim().toLowerCase();

  return (
    KEY_ALIASES[normalized] ??
    key.trim()
  );
}

/**
 * Execute one real computer-use action.
 *
 * IMPORTANT:
 * This function is exported because:
 *
 * app/api/computer/act/route.ts
 *
 * imports it directly.
 */
export async function runComputerAction(
  sandboxId: string,
  apiKey: string,
  action: ComputerAction
): Promise<{
  screenshotBase64: string;
}> {
  if (!sandboxId) {
    throw new Error(
      "SANDBOX_ID_MISSING"
    );
  }

  if (!apiKey?.trim()) {
    throw new Error(
      "DAYTONA_KEY_MISSING"
    );
  }

  if (!action?.type) {
    throw new Error(
      "COMPUTER_ACTION_MISSING"
    );
  }

  const daytona =
    new Daytona({
      apiKey: apiKey.trim(),
    });

  let sandbox: any;

  try {
    sandbox =
      await daytona.get(
        sandboxId
      );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    throw new Error(
      `Failed to load Daytona sandbox: ${message}`
    );
  }

  if (!sandbox) {
    throw new Error(
      "Daytona sandbox was not found."
    );
  }

  /*
   * Make sure Computer Use is running
   * before sending mouse/keyboard commands.
   */
  try {
    await sandbox.computerUse.start();
  } catch (error) {
    /*
     * Some SDK versions throw when the
     * computer environment is already
     * running. We don't blindly fail here.
     *
     * The actual action below will determine
     * whether the desktop is usable.
     */
    console.warn(
      "[computerUse] computerUse.start() during action:",
      error
    );
  }

  const cu: any =
    sandbox.computerUse;

  try {
    switch (action.type) {
      case "screenshot": {
        break;
      }

      case "move": {
        await cu.mouse.move(
          action.x,
          action.y
        );

        break;
      }

      case "click": {
        await cu.mouse.click(
          action.x,
          action.y,
          action.button ||
            "left",
          !!action.double
        );

        break;
      }

      case "drag": {
        await cu.mouse.drag(
          action.x1,
          action.y1,
          action.x2,
          action.y2,
          "left"
        );

        break;
      }

      case "type": {
        await cu.keyboard.type(
          action.text
        );

        break;
      }

      case "key": {
        if (
          action.key.includes("+")
        ) {
          const keys =
            action.key
              .split("+")
              .map(normalizeKey)
              .join("+");

          await cu.keyboard.hotkey(
            keys
          );
        } else {
          await cu.keyboard.press(
            normalizeKey(
              action.key
            )
          );
        }

        break;
      }

      case "hotkey": {
        const keys =
          action.keys
            .split("+")
            .map(normalizeKey)
            .join("+");

        await cu.keyboard.hotkey(
          keys
        );

        break;
      }

      case "scroll": {
        const x =
          action.x ?? 640;

        const y =
          action.y ?? 400;

        const direction =
          action.direction ??
          (action.amount < 0
            ? "up"
            : "down");

        const amount =
          Math.max(
            1,
            Math.min(
              Math.abs(
                action.amount
              ),
              30
            )
          );

        await cu.mouse.scroll(
          x,
          y,
          direction,
          amount
        );

        break;
      }

      case "launch": {
        /*
         * Run a command in the desktop
         * without blocking the API request.
         */
        const cmd =
          action.command.replace(
            /'/g,
            "'\\''"
          );

        await sandbox.process.executeCommand(
          `nohup sh -c '${cmd}' >/tmp/av-launch.log 2>&1 &`,
          undefined,
          {
            DISPLAY: ":0",
          },
          15
        );

        await sleep(2500);

        break;
      }

      case "wait": {
        await sleep(
          Math.min(
            Math.max(
              action.ms,
              0
            ),
            5000
          )
        );

        break;
      }

      default: {
        throw new Error(
          `Unsupported computer action: ${String(
            (action as any).type
          )}`
        );
      }
    }

    /*
     * Give the desktop time to visually
     * update after an interaction.
     */
    if (
      action.type !==
        "screenshot" &&
      action.type !== "wait"
    ) {
      await sleep(600);
    }

    /*
     * Always return a fresh screenshot so
     * the agent can see what actually happened.
     */
    const shot =
      await cu.screenshot
        .takeFullScreen();

    return {
      screenshotBase64:
        extractBase64(shot),
    };
  } catch (error) {
    console.error(
      "[computerUse] runComputerAction failed:",
      {
        sandboxId,
        actionType:
          action.type,
        error,
      }
    );

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    throw new Error(
      `Computer action failed (${action.type}): ${message}`
    );
  }
}

/**
 * Stop the computer sandbox.
 *
 * We intentionally keep the sandbox ID
 * saved so the SAME sandbox can be resumed.
 */
export async function stopComputer(
  sandboxId: string,
  apiKey: string,
  uid?: string,
  scope?: string
): Promise<void> {
  if (!sandboxId) {
    return;
  }

  if (!apiKey?.trim()) {
    throw new Error(
      "DAYTONA_KEY_MISSING"
    );
  }

  const daytona =
    new Daytona({
      apiKey: apiKey.trim(),
    });

  const sandbox =
    await daytona
      .get(sandboxId)
      .catch(() => null);

  if (sandbox) {
    try {
      if (
        typeof sandbox.stop ===
        "function"
      ) {
        await sandbox.stop(60);
      } else if (
        typeof sandbox.delete ===
        "function"
      ) {
        /*
         * Fallback only for SDK versions
         * without stop().
         */
        await sandbox.delete();
      }
    } catch (error) {
      console.warn(
        "[computerUse] stop failed:",
        error
      );
    }
  }

  /*
   * Keep the same ID so a future Start
   * can resume the same desktop whenever
   * Daytona still has it.
   */
  if (uid) {
    await saveSandboxId(
      uid,
      sanitizeScope(scope),
      sandboxId
    ).catch(() => undefined);
  }
}