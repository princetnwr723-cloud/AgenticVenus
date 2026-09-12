// lib/uploadAsset.ts
// 3D models and other binary assets are usually way bigger than
// Firestore's 1MB-per-document limit allows for inline base64 — this
// uploads them to Vercel Blob instead (free tier included on Vercel,
// no separate paid plan needed like Firebase Storage now requires) and
// returns a real, fetchable URL. Uses the CLIENT upload path (not a
// simple server route) because Vercel serverless functions cap request
// bodies at 4.5MB — a real .glb file can easily be bigger than that —
// so the browser uploads directly to Blob storage after our server
// authorizes it with a short-lived token.

import { upload } from "@vercel/blob/client";
import { auth } from "@/lib/firebase";

const MAX_ASSET_SIZE = 50 * 1024 * 1024; // 50MB — generous for most 3D models

export async function uploadAssetFile(file: File): Promise<string> {
  if (file.size > MAX_ASSET_SIZE) {
    throw new Error(`"${file.name}" is too large (max 50MB).`);
  }

  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Not signed in.");

  const blob = await upload(file.name, file, {
    access: "public",
    handleUploadUrl: "/api/blob/upload",
    clientPayload: JSON.stringify({ idToken }),
  });

  return blob.url;
}