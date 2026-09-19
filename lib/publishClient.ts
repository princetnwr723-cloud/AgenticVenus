import { auth } from "@/lib/firebase";
import type { CodeFile } from "@/lib/codeExtract";

export async function publishProject(
  target: "vercel" | "netlify", files: CodeFile[], projectName?: string
): Promise<{ url: string; verified: boolean; verificationReason: string }> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Not signed in.");
  const res = await fetch("/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ target, files, projectName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Publish failed.");
  return { url: data.url, verified: data.verified, verificationReason: data.verificationReason };
}