import { NextRequest, NextResponse } from "next/server";
import { getFirebaseUser } from "@/lib/auth-api";
import { saveFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

const ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"] as const;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// In-memory per-student upload throttle: 10 uploads per 10 minutes.
// Best-effort flood control for single-instance dev; production abuse
// control should use a persistent store (e.g. qa_uploads table).
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const uploadHits = new Map<string, number[]>();

function safeUploadName(name: string): string {
  let base = (name || "").replace(/\\/g, "/");
  base = base.slice(base.lastIndexOf("/") + 1).replace(/\0/g, "").trim().replace(/[. ]+$/g, "");
  base = base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128).replace(/[. ]+$/g, "");
  return base || "file";
}

function isRateLimited(uid: string): boolean {
  const now = Date.now();
  const hits = (uploadHits.get(uid) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    uploadHits.set(uid, hits);
    return true;
  }
  hits.push(now);
  uploadHits.set(uid, hits);
  return false;
}

/**
 * Student picture upload for Q&A questions. Images only — audio/video and
 * every other file type are rejected. Requires a signed-in student.
 */
export async function POST(request: NextRequest) {
  const user = await getFirebaseUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (isRateLimited(user.uid)) {
    return NextResponse.json(
      { error: "Too many uploads. Please try again later." },
      { status: 429 },
    );
  }

  // Early reject: multipart overhead means content-length exceeds the file
  // size, but a grossly oversized body can be refused before buffering it.
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES + 1024 * 1024) {
    return NextResponse.json(
      { error: "Picture must be 8 MB or smaller." },
      { status: 413 },
    );
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No picture provided." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json(
      { error: "Only image files are allowed." },
      { status: 400 },
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "Picture must be 8 MB or smaller." },
      { status: 413 },
    );
  }
  const safeName = safeUploadName(file.name);
  const dot = safeName.lastIndexOf(".");
  const extension =
    dot === -1 ? "" : safeName.slice(dot).toLowerCase();
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(extension)) {
    return NextResponse.json(
      { error: `Unsupported picture type "${extension || "unknown"}".` },
      { status: 400 },
    );
  }

  // Server-side magic-byte verification — file.type/extension are client-claimed.
  const buffer = await file.arrayBuffer();
  // Re-check the fully-buffered size before processing: client-claimed
  // file.size can be spoofed, so never trust it alone.
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "Picture must be 8 MB or smaller." },
      { status: 413 },
    );
  }
  const bytes = new Uint8Array(buffer);
  const isPng =
    bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpg =
    bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isGif =
    bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
  const isWebp =
    bytes.length > 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!isPng && !isJpg && !isGif && !isWebp) {
    return NextResponse.json(
      { error: "File content is not a valid image." },
      { status: 400 },
    );
  }

  // Flood control: in-memory per-student throttle above (10 uploads/10 min)
  // plus the Q&A question rate limit (max 10 questions/hour), since every
  // upload must attach to a rate-limited question POST.

  try {
    const url = await saveFile("qa", safeName, bytes.buffer as ArrayBuffer);
    return NextResponse.json({ url }, { status: 201 });
  } catch (error) {
    console.error("[api/qa/image] upload failed:", error);
    return NextResponse.json(
      { error: "Upload failed. Please try again." },
      { status: 500 },
    );
  }
}
