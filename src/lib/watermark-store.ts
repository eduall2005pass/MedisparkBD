import { query } from "@/lib/mysql";
import { saveFile, removeFile, isLocalUpload } from "@/lib/storage";
import type { LogoInfo } from "@/lib/logo";
import { DEFAULT_LOGO } from "@/lib/logo";
import { fetchAdminAccount } from "@/lib/admin";

export const WATERMARK_LOGO_COLLECTION = "logos";
export const WATERMARK_LOGO_DOCUMENT_ID = "watermark";
export const WATERMARK_LOGO_STORAGE_DIR = "website/watermark";

type LogoRow = {
  url: string;
  file_name: string;
  width: number;
  height: number;
  storage_path: string;
  updated_at: Date | string;
  updated_by: string | null;
};

function withCacheBust(url: string, updatedAt: number): string {
  if (!url || updatedAt <= 0) return url;
  const sep = url.includes("?") ? "&" : "?";
  if (url.includes("v=")) return url;
  return `${url}${sep}v=${updatedAt}`;
}

function rowToLogo(data: LogoRow): LogoInfo {
  const updatedAt = Date.parse(typeof data.updated_at === "string" ? data.updated_at : new Date(data.updated_at).toISOString()) || 0;
  return {
    fileName: data.file_name,
    url: withCacheBust(data.url, updatedAt),
    width:
      typeof data.width === "number" && data.width > 0
        ? data.width
        : DEFAULT_LOGO.width,
    height:
      typeof data.height === "number" && data.height > 0
        ? data.height
        : DEFAULT_LOGO.height,
    updatedAt,
    updatedBy: data.updated_by ?? null,
  };
}

function safeBaseName(name: string): string {
  let base = (name || "").replace(/\\/g, "/");
  base = base.slice(base.lastIndexOf("/") + 1).replace(/\0/g, "").trim().replace(/[. ]+$/g, "");
  base = base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128).replace(/[. ]+$/g, "");
  return base || "logo";
}

export async function fetchWatermarkLogo(): Promise<LogoInfo | null> {
  try {
    const rows = await query<LogoRow[]>(
      "SELECT url, file_name, width, height, storage_path, updated_at, updated_by FROM logos WHERE id = ? LIMIT 1",
      [WATERMARK_LOGO_DOCUMENT_ID],
    );
    const data = rows[0];
    if (!data) return null;
    return rowToLogo(data);
  } catch {
    return null;
  }
}

export async function saveWatermarkLogo(
  file: File,
  width: number,
  height: number,
  adminUid: string,
): Promise<LogoInfo> {
  const extension = file.name.includes(".")
    ? `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`
    : ".png";
  const suffix = "watermark";
  const tempStoragePath = `${WATERMARK_LOGO_STORAGE_DIR}/${suffix}-${Date.now()}${extension}`;
  const buffer = await file.arrayBuffer();
  const cleanUrl = await saveFile(
    WATERMARK_LOGO_STORAGE_DIR,
    tempStoragePath.split("/").pop() ?? "",
    buffer,
  );
  const marker = "/medifiles/";
  const markerIndex = cleanUrl.indexOf(marker);
  const actualStoragePath =
    markerIndex !== -1
      ? cleanUrl.slice(markerIndex + marker.length).split(/[?#]/)[0]
      : tempStoragePath;

  let previousStoragePath: string | null = null;
  let previousUrl: string | null = null;
  try {
    const rows = await query<{ storage_path: string; url: string }[]>(
      "SELECT storage_path, url FROM logos WHERE id = ? LIMIT 1",
      [WATERMARK_LOGO_DOCUMENT_ID],
    );
    const row = rows[0];
    const previousPath: unknown = row?.storage_path;
    if (typeof previousPath === "string" && isLocalUpload(previousPath)) {
      previousStoragePath = previousPath;
    }
    if (typeof row?.url === "string" && row.url.includes("/medifiles/")) {
      previousUrl = row.url;
    }
  } catch {
    // Keep going — cleaning up the old file is best-effort only.
  }

  const safeDbName = safeBaseName(file.name).slice(0, 255);
  try {
    await query(
      `INSERT INTO logos
        (id, url, file_name, width, height, storage_path, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE
        url = VALUES(url),
        file_name = VALUES(file_name),
        width = VALUES(width),
        height = VALUES(height),
        storage_path = VALUES(storage_path),
        updated_at = NOW(),
        updated_by = VALUES(updated_by)`,
      [
        WATERMARK_LOGO_DOCUMENT_ID,
        cleanUrl,
        safeDbName,
        width,
        height,
        actualStoragePath,
        adminUid,
      ],
    );
  } catch (dbErr) {
    // No orphan: DB write failed so delete the newly uploaded file.
    await removeFile(cleanUrl).catch(() => undefined);
    throw dbErr;
  }

  if (previousUrl && previousUrl !== cleanUrl) {
    await removeFile(previousUrl);
  }
  if (previousStoragePath && previousStoragePath !== actualStoragePath) {
    await removeFile(previousStoragePath);
  }

  const account = await fetchAdminAccount(adminUid);
  const now = Date.now();
  return {
    fileName: safeDbName,
    url: withCacheBust(cleanUrl, now),
    width,
    height,
    updatedAt: now,
    updatedBy: account?.displayName ?? account?.email ?? adminUid,
  };
}

export async function removeWatermarkLogo(): Promise<void> {
  try {
    const rows = await query<{ storage_path: string; url: string }[]>(
      "SELECT storage_path, url FROM logos WHERE id = ? LIMIT 1",
      [WATERMARK_LOGO_DOCUMENT_ID],
    );
    const row = rows[0];
    const storagePath: unknown = row?.storage_path;
    const url: unknown = row?.url;
    await query("DELETE FROM logos WHERE id = ?", [WATERMARK_LOGO_DOCUMENT_ID]);
    if (typeof url === "string" && url.includes("/medifiles/")) {
      await removeFile(url);
    }
    if (typeof storagePath === "string" && isLocalUpload(storagePath)) {
      await removeFile(storagePath);
    }
  } catch {
    // The logo is either already gone or could not be removed.
  }
}
