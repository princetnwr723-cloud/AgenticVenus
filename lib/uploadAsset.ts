// lib/uploadAsset.ts
// 3D models and other binary assets are usually way bigger than
// Firestore's 1MB-per-document limit allows for inline base64 — this
// uploads them to Firebase Storage instead and returns a real, fetchable
// URL. Simpler for the Codespace preview too — Three.js loaders can just
// fetch the URL directly, no base64 decode needed.

import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";

const MAX_ASSET_SIZE = 50 * 1024 * 1024; // 50MB — generous for most 3D models

export async function uploadAssetFile(uid: string, file: File): Promise<string> {
  if (file.size > MAX_ASSET_SIZE) {
    throw new Error(`"${file.name}" is too large (max 50MB).`);
  }
  const path = `users/${uid}/uploads/${Date.now()}-${file.name}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}