// app/api/blob/upload/route.ts
// Authorizes the browser's direct upload to Vercel Blob. The browser
// calls upload() from '@vercel/blob/client', which first hits this
// route to get a short-lived upload token — this is what lets a large
// file (a 3D model, say) go straight from the user's browser to Blob
// storage without passing through our server's 4.5MB request limit.

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        try {
          const { idToken } = JSON.parse(clientPayload || "{}");
          if (!idToken) throw new Error("Missing auth token.");
          await adminAuth().verifyIdToken(idToken);
        } catch {
          throw new Error("Not authenticated.");
        }

        return {
          allowedContentTypes: ["*/*"],
          addRandomSuffix: true,
          maximumSizeInBytes: 50 * 1024 * 1024,
        };
      },
      onUploadCompleted: async () => {
        // Nothing extra to do — the client already has the blob URL
        // from the upload() call itself.
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}