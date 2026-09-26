export async function startBrowserSession(
  uid: string,
  apiKey: string,
  profileName?: string
): Promise<{
  sessionId: string;
  liveUrl: string;
  profileName?: string;
}> {
  if (!apiKey?.trim()) {
    throw new Error(
      "BROWSERLESS_KEY_MISSING: Browserless API key is empty."
    );
  }

  const profile = profileName?.trim()
    ? `&profile=${encodeURIComponent(profileName.trim())}`
    : "";

  const endpoint =
    connectionUrl(apiKey.trim(), profile);

  let browser: Browser | null = null;

  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: endpoint,
      protocolTimeout: 60_000,
    });

    const page = await activePage(browser);

    if (!page) {
      throw new Error(
        "BROWSER_PAGE_FAILED: Browser connected but no page could be created."
      );
    }

    const sessionId = crypto.randomUUID();

    /*
     * IMPORTANT:
     * Save the session only after Browserless connection succeeds.
     */
    let reconnectEndpoint: string;

    try {
      reconnectEndpoint =
        await refreshReconnectEndpoint(
          browser,
          apiKey.trim()
        );
    } catch (err) {
      throw new Error(
        `BROWSER_RECONNECT_FAILED: ${
          err instanceof Error
            ? err.message
            : String(err)
        }`
      );
    }

    try {
      await saveSession(
        uid,
        sessionId,
        reconnectEndpoint
      );
    } catch (err) {
      throw new Error(
        `BROWSER_SESSION_SAVE_FAILED: ${
          err instanceof Error
            ? err.message
            : String(err)
        }`
      );
    }

    /*
     * Live view is optional.
     * Browser automation must continue even if live view
     * isn't available on the Browserless plan.
     */
    let liveUrl = "";

    try {
      const pages =
        await browser.pages();

      const livePage =
        pages[pages.length - 1] ||
        page;

      const cdp =
        await livePage.createCDPSession();

      const live =
        (await cdp.send(
          "Browserless.liveURL" as any,
          {
            timeout:
              REQUESTED_SESSION_MS,
            interactable: true,
            resizable: true,
            showBrowserInterface: true,
            quality: 70,
            type: "jpeg",
          } as any
        )) as {
          error?: string;
          liveURL?: string;
        };

      if (!live.error) {
        liveUrl =
          live.liveURL || "";
      }
    } catch (err) {
      console.warn(
        "[browser] live view unavailable:",
        err
      );

      /*
       * Do NOT fail browser automation because
       * live view isn't available.
       */
      liveUrl = "";
    }

    return {
      sessionId,
      liveUrl,
      profileName,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : String(err);

    console.error(
      "[browser] START FAILED:",
      message,
      err
    );

    throw new Error(
      `Browser start failed: ${message}`
    );
  } finally {
    /*
     * Disconnect only.
     * Do NOT close the remote Browserless session.
     */
    if (browser) {
      try {
        await browser.disconnect();
      } catch {
        // Best effort.
      }
    }
  }
}