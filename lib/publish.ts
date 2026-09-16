// lib/publish.ts
// Real "Publish" — whatever the Developer Agent built in Codespace, put
// it on a real live URL using the user's own Vercel or Netlify token.
// Vercel: small text files can be inlined directly in the deploy
// request. Netlify: zip the project and upload it in one shot.

import JSZip from "jszip";
import type { CodeFile } from "@/lib/codeExtract";

export async function publishToVercel(files: CodeFile[], apiToken: string, projectName: string): Promise<{ url: string }> {
  const res = await fetch("https://api.vercel.com/v13/deployments", {
    method: "POST",
    headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: projectName,
      target: "production",
      files: files.map((f) => ({ file: f.filename, data: f.code })),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Vercel deployment failed.");
  return { url: `https://${data.url}` };
}

export async function publishToNetlify(files: CodeFile[], apiToken: string, siteName: string): Promise<{ url: string }> {
  const listRes = await fetch("https://api.netlify.com/api/v1/sites", { headers: { authorization: `Bearer ${apiToken}` } });
  const sites = await listRes.json();
  const existing = Array.isArray(sites) ? sites.find((s: any) => s.name === siteName) : null;

  let siteId: string;
  if (existing) {
    siteId = existing.id;
  } else {
    const createRes = await fetch("https://api.netlify.com/api/v1/sites", {
      method: "POST",
      headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name: siteName }),
    });
    const created = await createRes.json();
    if (!createRes.ok) throw new Error(created?.message || "Failed to create the Netlify site.");
    siteId = created.id;
  }

  const zip = new JSZip();
  for (const f of files) zip.file(f.filename, f.code);
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/zip" },
    body: zipBuffer,
  });
  const deploy = await deployRes.json();
  if (!deployRes.ok) throw new Error(deploy?.message || "Netlify deployment failed.");
  return { url: deploy.ssl_url || deploy.url };
}