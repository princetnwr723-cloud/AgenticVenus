import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { getOAuthProvider } from "@/lib/oauthProviders";
import { executePluginAction } from "@/lib/pluginActions";
import { encryptSecret, decryptSecret } from "@/lib/secretsVault";

export async function POST(req: NextRequest) {
  try {
    const authHeaderIn = req.headers.get("authorization") || "";
    const idToken = authHeaderIn.replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);

    const { toolId, actionId, params } = await req.json();
    if (!toolId || !actionId) {
      return NextResponse.json({ error: "toolId and actionId are required." }, { status: 400 });
    }

    const db = adminDb();
    const ref = db.collection("users").doc(decoded.uid).collection("pluginConnections").doc(toolId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: `${toolId} isn't connected.` }, { status: 400 });

    const conn = snap.data()!;
    if (!conn.accessToken_enc) return NextResponse.json({ error: `${toolId} isn't connected with OAuth.` }, { status: 400 });
    let accessToken = decryptSecret(conn.accessToken_enc);

    if (conn.expiresAt && Date.now() > conn.expiresAt - 60_000 && conn.refreshToken_enc) {
      const config = getOAuthProvider(toolId);
      if (config) {
        const refreshToken = decryptSecret(conn.refreshToken_enc);
        const refreshRes = await fetch(config.tokenUrl, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: process.env[config.clientIdEnv]!,
            client_secret: process.env[config.clientSecretEnv]!,
          }),
        });
        const refreshData = await refreshRes.json();
        if (refreshRes.ok && refreshData.access_token) {
          accessToken = refreshData.access_token;
          await ref.update({
            accessToken_enc: encryptSecret(accessToken),
            expiresAt: Date.now() + (refreshData.expires_in ? refreshData.expires_in * 1000 : 55 * 60 * 1000),
          });
        }
      }
    }

    const result = await executePluginAction(actionId, accessToken, params || {});
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[api/plugins/call]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Plugin action failed." }, { status: 500 });
  }
}