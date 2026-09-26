export async function startComputer(
  apiKey: string,
  opts: StartComputerOptions = {}
): Promise<{
  sandboxId: string;
  gpuRequested: boolean;
}> {
  if (!apiKey?.trim()) {
    throw new Error(
      "DAYTONA_KEY_MISSING: No Daytona API key."
    );
  }

  const {
    uid,
    gpu = false,
  } = opts;

  const scope =
    sanitizeScope(
      opts.scope
    );

  const daytona =
    new Daytona({
      apiKey: apiKey.trim(),
    });

  let sandbox: any = null;

  try {
    /*
     * Reuse the user's persistent computer.
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
     * Create only when the persistent
     * sandbox doesn't exist anymore.
     */
    if (!sandbox) {
      const createOpts: any = {
        language: "typescript",

        /*
         * Keep the sandbox persistent.
         */
        autoDeleteInterval: -1,

        /*
         * Browser, npm, apt, etc. need
         * outbound network.
         */
        networkBlockAll: false,

        /*
         * Daytona's default sandbox image
         * contains the Computer Use/VNC stack.
         */
        envVars: {
          VNC_RESOLUTION:
            "1280x800",
        },
      };

      if (gpu) {
        try {
          sandbox =
            await daytona.create({
              ...createOpts,
              resources: {
                gpu: 1,
              },
            });
        } catch (err) {
          throw new Error(
            `GPU_SANDBOX_FAILED: ${
              err instanceof Error
                ? err.message
                : String(err)
            }`
          );
        }
      } else {
        sandbox =
          await daytona.create(
            createOpts
          );
      }
    }

    /*
     * Resume a stopped persistent sandbox.
     */
    if (
      sandbox.state &&
      sandbox.state !== "started"
    ) {
      await sandbox.start(60);
    }

    /*
     * Start Daytona Computer Use.
     */
    try {
      await sandbox.computerUse.start();
    } catch (err) {
      throw new Error(
        `COMPUTER_USE_START_FAILED: ${
          err instanceof Error
            ? err.message
            : String(err)
        }`
      );
    }

    /*
     * Verify the desktop is actually alive.
     */
    try {
      await sandbox.computerUse
        .screenshot
        .takeFullScreen();
    } catch (err) {
      throw new Error(
        `COMPUTER_SCREENSHOT_FAILED: Desktop started but screenshot verification failed: ${
          err instanceof Error
            ? err.message
            : String(err)
        }`
      );
    }

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
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : String(err);

    console.error(
      "[computer] START FAILED:",
      message,
      err
    );

    throw new Error(message);
  }
}