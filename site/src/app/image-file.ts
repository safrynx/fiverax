"use client";

/**
 * Prepares an image chosen in the browser for the bot's profile: center-cropped and resized to what Discord shows
 * (avatar 512×512 PNG, banner 1020×360, the 17:6 of a Discord profile), so uploads stay small. Animated GIFs are kept
 * as they are (a canvas would freeze them), within the size limit.
 */

export type ImageKind = "avatar" | "banner";
const TARGET: Record<ImageKind, { w: number; h: number }> = { avatar: { w: 512, h: 512 }, banner: { w: 1020, h: 360 } };
const TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const approxBytes = (dataUri: string) => Math.floor(((dataUri.length - dataUri.indexOf(",") - 1) * 3) / 4);

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });
}

export async function imageToDataUri(file: File, kind: ImageKind, maxBytes: number): Promise<string> {
  if (!TYPES.includes(file.type)) throw new Error("Format accepté : PNG, JPG, GIF ou WebP.");
  if (file.type === "image/gif") {
    if (file.size > maxBytes) throw new Error(`GIF trop lourd : ${(file.size / 1e6).toFixed(1)} Mo pour ${(maxBytes / 1e6).toFixed(1)} Mo au maximum.`);
    return readAsDataUrl(file);
  }
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("Image illisible.");
  const { w, h } = TARGET[kind];
  const scale = Math.max(w / bitmap.width, h / bitmap.height);
  const sw = w / scale;
  const sh = h / scale;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Ton navigateur ne peut pas préparer l'image.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, w, h);
  bitmap.close();
  let out = canvas.toDataURL(kind === "avatar" ? "image/png" : "image/jpeg", 0.9);
  if (approxBytes(out) > maxBytes) out = canvas.toDataURL("image/jpeg", 0.82);
  if (approxBytes(out) > maxBytes) throw new Error("Image trop lourde, même réduite.");
  return out;
}
