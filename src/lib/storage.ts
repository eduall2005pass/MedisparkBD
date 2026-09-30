import { randomUUID } from "node:crypto";
import { exec, query } from "@/lib/mysql";
import sharp from "sharp";

// Media files live on the Azure VM's disk under /var/www/medispark-uploads
// and are served over HTTPS by nginx at MEDIA_FILES_BASE_URL. saveFile()
// forwards bytes to the VM's upload endpoint; only the returned URL is kept.
// The uploads table (LONGBLOB) is legacy — /api/files/[id] still serves old
// rows so nothing breaks, but new writes never touch the database.

export const UPLOADS_BASE_URL = "/api/files";

const MEDIA_FILES_BASE_URL =
  process.env.MEDIA_FILES_BASE_URL ?? "https://medispark.duckdns.org/medifiles";
const MEDIA_UPLOAD_URL =
  process.env.MEDIA_UPLOAD_URL ?? "https://medispark.duckdns.org/medifiles-upload";
const MEDIA_DELETE_URL =
  process.env.MEDIA_DELETE_URL ?? "https://medispark.duckdns.org/medifiles-delete";

function mediaToken(): string {
  const token = (process.env.MEDIA_UPLOAD_TOKEN ?? "").trim();
  if (!token) {
    throw new Error(
      "MEDIA_UPLOAD_TOKEN is not configured — set it in the environment to upload media files.",
    );
  }
  return token;
}

type MimeByExtension = Record<string, string>;

const MIME_BY_EXTENSION: MimeByExtension = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
};

function detectMimeType(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const extension = dot === -1 ? "" : fileName.slice(dot).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

async function ensureUploadsTable(): Promise<void> {
  await exec(
    `CREATE TABLE IF NOT EXISTS uploads (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      directory VARCHAR(255) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(127) NOT NULL,
      size INT NOT NULL DEFAULT 0,
      data LONGBLOB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
}

const COMPRESSIBLE_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

function minifySvg(buffer: Buffer): Buffer {
  try {
    let text = buffer.toString("utf8");
    if (!text.slice(0, 4096).toLowerCase().includes("<svg")) return buffer;
    // NOTE: even sanitized, SVGs must be served downstream with
    // `Content-Disposition: attachment` (or `Content-Security-Policy: sandbox`)
    // so any residual inline vector cannot execute in the site origin.
    // Strip executable / external-content vectors before storing
    text = text.replace(/<!--[\s\S]*?-->/g, "");
    text = text.replace(/<\?[\s\S]*?\?>/g, "");
    text = text.replace(/<!DOCTYPE[^>]*>/gi, "");
    text = text.replace(/<script[\s\S]*?<\/script\s*>/gi, "");
    text = text.replace(/<(iframe|object|embed|foreignobject|handler|listener)[\s\S]*?(<\/\1\s*>|$)/gi, "");
    // Drop <image> tags pointing at external resources (keep #fragment refs).
    text = text.replace(/<image\b[^>]*?(?:\/>|>(?:<\/image\s*>)?)/gi, (tag) => {
      const m = tag.match(/(?:href|xlink:href|src)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const val = ((m?.[2] ?? m?.[3] ?? m?.[4]) ?? "").trim();
      if (!val) return tag;
      const norm = val.toLowerCase().replace(/[\s\0-\x1f]+/g, "");
      if (norm.startsWith("//") || /^[a-z][a-z0-9+.-]*:/.test(norm)) return "";
      return tag;
    });
    // Event handlers, incl. the `<svg/onload=` slash variant (no whitespace).
    text = text.replace(/[\s\/]on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    // Dangerous URL schemes in hyperlink/resource attributes.
    text = text.replace(/\s(href|xlink:href|src|action|formaction)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (attr) => {
      const vm = attr.match(/=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/);
      const val = ((vm?.[2] ?? vm?.[3] ?? vm?.[4]) ?? "").trim().toLowerCase().replace(/[\s\0-\x1f]+/g, "");
      if (/^(javascript|vbscript|data):/.test(val)) return "";
      return attr;
    });
    // CSS vectors: @import and remote url() references.
    text = text.replace(/@import[^;]+;/gi, "");
    text = text.replace(/url\(\s*["']?(?:https?:[^)"']+|data:[^)"']+|\/\/[^)"']+)["']?\s*\)/gi, "");
    // CSS expression()/binding vectors inside style attributes.
    text = text.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi, (m, q: string) =>
      /expression\s*\(|behaviou?r\s*:|binding\s*:/i.test(q) ? "" : m,
    );
    // Collapse whitespace between tags, trim
    text = text.replace(/>\s+</g, "><").replace(/\s{2,}/g, " ").trim();
    return Buffer.from(text, "utf8");
  } catch {
    return buffer;
  }
}

async function compressFileIfNeeded(
  buffer: Buffer,
  fileName: string,
): Promise<Buffer> {
  const dot = fileName.lastIndexOf(".");
  const ext = dot === -1 ? "" : fileName.slice(dot).toLowerCase();
  // SVG: sanitize (strip script/on*/foreignObject) + lossless minify
  if (ext === ".svg") {
    return minifySvg(buffer);
  }
  // PDF/Audio (mp3/m4a/aac/ogg/opus/wav/pdf): already compressed containers.
  // Lossless re-encode would need ffmpeg/ghostscript which aren't on Vercel/VM and risks quality loss,
  // so keep original bytes (PDF is already DEFLATE-compressed, MP3/AAC/OPUS are perceptual codecs).
  // Only WAV (uncompressed PCM) could be losslessly converted to FLAC, but we keep it to preserve exact upload.
  if ([".pdf", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".mp4", ".webm", ".gif", ".ico"].includes(ext)) {
    return buffer;
  }
  if (!COMPRESSIBLE_IMAGE_EXTS.has(ext)) return buffer;
  if (buffer.length < 8 * 1024) return buffer;
  try {
    const image = sharp(buffer, { failOn: "none" });
    const meta = await image.metadata();
    let pipeline = image;
    if (meta.width && meta.width > 2048) {
      pipeline = pipeline.resize({ width: 2048, withoutEnlargement: true });
    }
    if (ext === ".jpg" || ext === ".jpeg") {
      const out = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
      return out.length < buffer.length ? out : buffer;
    }
    if (ext === ".png") {
      const out = await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toBuffer();
      return out.length < buffer.length ? out : buffer;
    }
    if (ext === ".webp") {
      const out = await pipeline.webp({ quality: 82, effort: 6 }).toBuffer();
      return out.length < buffer.length ? out : buffer;
    }
    if (ext === ".avif") {
      const out = await pipeline.avif({ quality: 50, effort: 4 }).toBuffer();
      return out.length < buffer.length ? out : buffer;
    }
    return buffer;
  } catch {
    return buffer;
  }
}

export const MAX_SAVE_BYTES = 512 * 1024 * 1024;

// Allowlist of upload directories. Every server-side saveFile() caller and
// every `dir` accepted by /api/uploads must be listed here; anything else is
// rejected. Built from current callers (grep saveFile/dir usage).
export const ALLOWED_UPLOAD_DIRS = new Set([
  "qa",
  "course-images",
  "course-categories",
  "course-materials",
  "courses",
  "routines",
  "exams",
  "media-library",
  "misc",
  "jerseys",
  "seo",
  "backups",
  "student-profiles",
  "admin/profile",
  "mentor-photos",
  "review-photos",
  "homepage-courses",
  "website/logo",
  "website/favicon",
  "website/hero",
  "website/watermark",
  "website-banners",
]);

export function sanitizeDir(directory: string): string {
  const raw = (directory || "").split(/[?#]/)[0].replace(/\\/g, "/").trim();
  if (raw.includes("..")) throw new Error("Invalid upload directory.");
  const clean = raw
    .split("/")
    .filter((p) => p && p !== ".")
    .map((p) => p.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64))
    .filter(Boolean)
    .join("/");
  if (!clean) throw new Error("Invalid upload directory.");
  if (!ALLOWED_UPLOAD_DIRS.has(clean)) throw new Error("Invalid upload directory.");
  return clean.slice(0, 128);
}

export function sanitizeFileName(fileName: string): string {
  let base = (fileName || "").split(/[?#]/)[0].replace(/\\/g, "/");
  base = base.slice(base.lastIndexOf("/") + 1).replace(/\0/g, "").trim().replace(/[. ]+$/g, "");
  if (!base || base === "." || base === "..") base = `file-${randomUUID()}`;
  base = base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128).replace(/[. ]+$/g, "");
  return base || `file-${randomUUID()}`;
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/** Magic-byte check (not just extension) — strict per type; unknown extensions are denied. */
function validateMagic(buffer: Buffer, ext: string): void {
  if (buffer.length < 4) throw new Error("Empty or truncated file.");
  const head = buffer.subarray(0, 16);
  const textHead = buffer.subarray(0, Math.min(buffer.length, 2048)).toString("utf8").toLowerCase();
  const is = (...sigs: number[][]) => sigs.some((s) => s.every((b, i) => head[i] === b));
  const isFtyp = (h: Buffer) =>
    h.length >= 8 && h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70;
  switch (ext) {
    case ".png":
      if (!is([0x89, 0x50, 0x4e, 0x47])) throw new Error("File content does not match .png type.");
      return;
    case ".jpg":
    case ".jpeg":
      if (!is([0xff, 0xd8, 0xff])) throw new Error("File content does not match JPEG type.");
      return;
    case ".gif":
      if (!textHead.startsWith("gif87a") && !textHead.startsWith("gif89a")) throw new Error("File content does not match .gif type.");
      return;
    case ".webp":
      if (!(head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && textHead.slice(8, 12) === "webp")) throw new Error("File content does not match .webp type.");
      return;
    case ".avif": {
      if (buffer.length < 12 || !isFtyp(head)) throw new Error("File content does not match .avif type.");
      const brands = buffer.subarray(0, Math.min(buffer.length, 64)).toString("ascii").toLowerCase();
      if (!brands.includes("avif")) throw new Error("File content does not match .avif type.");
      return;
    }
    case ".pdf":
      if (!textHead.startsWith("%pdf")) throw new Error("File content does not match .pdf type.");
      return;
    case ".ico":
      if (!is([0x00, 0x00, 0x01, 0x00])) throw new Error("File content does not match .ico type.");
      return;
    case ".svg":
      if (!textHead.includes("<svg")) throw new Error("File content does not match .svg type.");
      return;
    case ".wav":
      if (!(head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46)) throw new Error("File content does not match .wav type.");
      return;
    case ".mp3": {
      const id3 = head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33;
      const frameSync = head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
      if (!id3 && !frameSync) throw new Error("File content does not match .mp3 type.");
      return;
    }
    case ".m4a": {
      if (!isFtyp(head)) throw new Error("File content does not match .m4a type.");
      const brands = buffer.subarray(0, Math.min(buffer.length, 64)).toString("ascii").toLowerCase();
      if (!/(m4a|mp4|isom|mp42)/.test(brands)) throw new Error("File content does not match .m4a type.");
      return;
    }
    case ".aac": {
      const adts = head[0] === 0xff && (head[1] & 0xf0) === 0xf0;
      if (!adts && !textHead.startsWith("adif")) throw new Error("File content does not match .aac type.");
      return;
    }
    case ".ogg":
    case ".opus":
      if (!(head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53)) throw new Error(`File content does not match ${ext} type.`);
      return;
    case ".json": {
      const stripped = buffer.subarray(0, Math.min(buffer.length, 2048)).toString("utf8").replace(/^\uFEFF/, "").trimStart();
      if (!stripped.startsWith("{") && !stripped.startsWith("[")) throw new Error("File content does not match .json type.");
      return;
    }
    default:
      throw new Error("Unsupported file type.");
  }
}

export async function saveFile(
  directory: string,
  fileName: string,
  data: ArrayBuffer | Buffer,
): Promise<string> {
  const rawBytes =
    data instanceof ArrayBuffer ? Buffer.from(new Uint8Array(data)) : data;
  if (rawBytes.length === 0) throw new Error("Empty file.");
  if (rawBytes.length > MAX_SAVE_BYTES) throw new Error("File exceeds the size limit.");
  const safeDir = sanitizeDir(directory);
  const safeName = sanitizeFileName(fileName);
  validateMagic(rawBytes, extOf(safeName));
  const bytes = await compressFileIfNeeded(rawBytes, safeName);

  const endpoint = new URL(MEDIA_UPLOAD_URL);
  endpoint.searchParams.set("dir", safeDir);
  endpoint.searchParams.set("name", safeName);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": detectMimeType(safeName),
      "X-Medifiles-Token": mediaToken(),
    },
    body: new Uint8Array(bytes),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`Media upload failed (${response.status}):`, detail.slice(0, 200));
    throw new Error("Media upload failed. Please try again.");
  }

  const result = (await response.json()) as { url?: string };
  if (!result.url) throw new Error("Media upload failed. Please try again.");

  return `${MEDIA_FILES_BASE_URL}/${result.url.replace(/^\/medifiles\//, "")}`;
}

function extractLegacyFileId(storagePath: string): string | null {
  if (!storagePath.startsWith(`${UPLOADS_BASE_URL}/`)) return null;
  const id = storagePath.slice(UPLOADS_BASE_URL.length + 1).split(/[?#]/)[0];
  return /^[0-9a-f-]{16,64}$/i.test(id) ? id : null;
}

function extractMediaPath(url: string): string | null {
  const marker = "/medifiles/";
  const index = url.indexOf(marker);
  if (index === -1) return null;
  return url.slice(index + marker.length).split(/[?#]/)[0];
}

export async function removeFile(storagePath: string): Promise<void> {
  if (!storagePath || typeof storagePath !== "string") return;

  const mediaPath = extractMediaPath(storagePath);
  const isVmUrl = storagePath.startsWith(MEDIA_FILES_BASE_URL);
  const isRelativeVmPath =
    !storagePath.startsWith("http") &&
    !storagePath.startsWith("/") &&
    /^[A-Za-z0-9._-]+\/[A-Za-z0-9._\/-]+$/.test(storagePath.split(/[?#]/)[0]) &&
    mediaPath === null;

  // Case 1: full VM URL (e.g. https://medispark.duckdns.org/medifiles/...)
  if (mediaPath && isVmUrl) {
    try {
      await fetch(MEDIA_DELETE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Medifiles-Token": mediaToken(),
        },
        body: JSON.stringify({ url: storagePath }),
      });
    } catch {
      // Best-effort cleanup.
    }
    return;
  }

  // Case 2: relative VM path — e.g. "website/logo/uuid.png" → construct full URL
  if (isRelativeVmPath) {
    const clean = storagePath.split(/[?#]/)[0];
    const fullUrl = `${MEDIA_FILES_BASE_URL}/${clean}`;
    try {
      await fetch(MEDIA_DELETE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Medifiles-Token": mediaToken(),
        },
        body: JSON.stringify({ url: fullUrl }),
      });
    } catch {
      // Best-effort cleanup.
    }
    return;
  }

  // Case 2b: relative URL with /medifiles/ prefix (e.g. "/medifiles/course-images/uuid.png")
  if (mediaPath && !isVmUrl && storagePath.includes("/medifiles/")) {
    const fullUrl = `${MEDIA_FILES_BASE_URL}/${mediaPath}`;
    try {
      await fetch(MEDIA_DELETE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Medifiles-Token": mediaToken(),
        },
        body: JSON.stringify({ url: fullUrl }),
      });
    } catch {
      // Best-effort cleanup.
    }
    return;
  }

  // Legacy DB blob.
  const id = extractLegacyFileId(storagePath);
  if (!id) return;
  try {
    await exec("DELETE FROM uploads WHERE id = ?", [id]);
  } catch {
    // Best-effort cleanup.
  }
}

export function isLocalUpload(url: string): boolean {
  // Accepts VM-hosted media URLs, "/api/files/<id>" legacy URLs and legacy
  // relative VM paths (e.g. "website/logo/...", "course-images/...") while
  // rejecting external URLs (other https://... hosts).
  if (!url || typeof url !== "string") return false;
  if (url.startsWith(`${MEDIA_FILES_BASE_URL}/`)) return true;
  if (url.startsWith(`${UPLOADS_BASE_URL}/`)) return true;
  if (url.startsWith("https://") || url.startsWith("http://")) return false;
  // Relative VM path: at least one slash, looks like a storage dir
  // Covers "website/logo/...", "course-images/...", "media-library/..." etc.
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._\/-]+$/.test(url.split(/[?#]/)[0]);
}

export async function fetchUpload(
  id: string,
): Promise<{ data: Buffer; mimeType: string; fileName: string } | null> {
  try {
    const rows = await query<
      { data: Buffer; mime_type: string; file_name: string }[]
    >(
      "SELECT data, mime_type, file_name FROM uploads WHERE id = ? LIMIT 1",
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      data: Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data),
      mimeType: row.mime_type || "application/octet-stream",
      fileName: row.file_name,
    };
  } catch {
    return null;
  }
}
