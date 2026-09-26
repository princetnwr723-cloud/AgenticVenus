import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { resolveIntegrationSecret } from "@/lib/secretsResolve";
import { startBrowserSession } from "@/lib/browserUse";

export const maxDuration = 60;

export async function POST(
  req: NextRequest
) {
  try {
    const authHeader =
      req.headers.get("authorization") || "";

    const idToken =
      authHeader.replace(
        /^Bearer\s+/i,
        ""
      );

    if (!idToken) {
      return NextResponse.json(
        {
          error:
            "AUTH_REQUIRED: Missing Firebase auth token.",
        },
        { status: 401 }
      );
    }

    const decoded =
      await adminAuth().verifyIdToken(
        idToken
      );

    const apiKey =
      await resolveIntegrationSecret(
        decoded.uid,
        "browserlessApiKey"
      );

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "BROWSERLESS_KEY_MISSING: Add your Browserless API key in Settings → Integrations.",
        },
        { status: 400 }
      );
    }

    const body =
      await req.json().catch(
        () => ({})
      );

    const profileName =
      typeof body?.profileName ===
      "string"
        ? body.profileName.trim()
        : undefined;

    const result =
      await startBrowserSession(
        decoded.uid,
        apiKey,
        profileName || undefined
      );

    return NextResponse.json({
      ok: true,
      sessionId:
        result.sessionId,
      liveUrl:
        result.liveUrl || "",
      profileName:
        result.profileName,
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : String(err);

    console.error(
      "[api/browser/start] FAILED:",
      message,
      err
    );

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}