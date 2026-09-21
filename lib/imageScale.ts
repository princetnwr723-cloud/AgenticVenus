// lib/imageScale.ts
// Vision models silently downscale big screenshots, so the (x, y) they answer
// with is in the *downscaled* picture, not the real screen. That is exactly why
// the agent kept tapping below the search icon. We downscale ourselves, tell the
// model the exact size it is looking at, and multiply its answer by `factor`
// to get back to real pixels.

export type ScaledImage = {
  base64: string;
  mimeType: string;
  width: number; // size the model sees
  height: number;
  factor: number; // multiply model coordinates by this to get real screen pixels
  sourceWidth: number;
  sourceHeight: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't decode the screenshot."));
    img.src = src;
  });
}

export async function scaleImage(base64: string, mimeType: string, maxEdge = 1280): Promise<ScaledImage> {
  const clean = base64.replace(/^data:[^,]+,/, "");
  const img = await loadImage(`data:${mimeType};base64,${clean}`);
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const longest = Math.max(sw, sh);

  if (longest <= maxEdge) {
    return { base64: clean, mimeType, width: sw, height: sh, factor: 1, sourceWidth: sw, sourceHeight: sh };
  }

  const ratio = maxEdge / longest;
  const w = Math.max(1, Math.round(sw * ratio));
  const h = Math.max(1, Math.round(sh * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { base64: clean, mimeType, width: sw, height: sh, factor: 1, sourceWidth: sw, sourceHeight: sh };
  ctx.drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
  return { base64: out, mimeType: "image/jpeg", width: w, height: h, factor: sw / w, sourceWidth: sw, sourceHeight: sh };
}