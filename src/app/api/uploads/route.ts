import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/admin";
import { saveFile, isLocalUpload, removeFile, ALLOWED_UPLOAD_DIRS } from "@/lib/storage";

export const dynamic = "force-dynamic";

const ALLOWED_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".avif",
  ".ico",
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".wav",
  ".pdf",
];

const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif", ".ico"]);

function safeUploadName(name: string): string {
  let base = (name || "").replace(/\\/g, "/");
  base = base.slice(base.lastIndexOf("/") + 1).replace(/\0/g, "").trim().replace(/[. ]+$/g, "");
  base = base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128).replace(/[. ]+$/g, "");
  return base || "file";
}

/** Canonicalize a previous-file URL and allow it only when it points at our
 * own local upload prefix. Resolves dot segments, strips leading slashes for
 * normalization, and rejects anything whose normalized form contains `..`. */
function canonicalPreviousUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s || s.length > 2048) return null;
  s = s.split(/[?#]/)[0].replace(/\\/g, "/").trim();
  if (!s || /[<>]/.test(s) || s.includes("\0")) return null;
  if (/^https?:\/\//i.test(s)) {
    const pathStart = s.indexOf("/", s.indexOf("//") + 2);
    const origin = pathStart === -1 ? s : s.slice(0, pathStart);
    const path = pathStart === -1 ? "/" : s.slice(pathStart);
    const out: string[] = [];
    for (const seg of path.split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") return null;
      let decoded = seg;
      try {
        decoded = decodeURIComponent(seg);
      } catch {
        return null;
      }
      if (decoded === ".." || decoded.includes("/") || decoded.includes("\\")) return null;
      out.push(seg);
    }
    const canonical = `${origin}/${out.join("/")}`;
    if (canonical.includes("..")) return null;
    return isLocalUpload(canonical) ? canonical : null;
  }
  const hadLeadingSlash = s.startsWith("/");
  const stripped = s.replace(/^\/+/, "");
  if (!stripped) return null;
  const out: string[] = [];
  for (const seg of stripped.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") return null;
    let decoded = seg;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      return null;
    }
    if (decoded === ".." || decoded.includes("/") || decoded.includes("\\")) return null;
    out.push(seg);
  }
  const normalized = out.join("/");
  if (!normalized || normalized.includes("..")) return null;
  const candidate = hadLeadingSlash ? `/${normalized}` : normalized;
  return isLocalUpload(candidate) ? candidate : null;
}

/** Generic admin media upload: multipart { file, dir?, previousUrl? }.
 * Any content manager may upload: course managers (course covers, class
 * materials), course-content managers (classes/materials), exam managers
 * (banners, question images) and content managers (logos, banners, FAQ). */
export async function POST(request: NextRequest) {
  const admin = await requireAnyPermission(request, ["manageContent", "manageCourses", "manageCourseContent", "manageExams", "managePublicExam", "manageQa"]);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") || "";
  const isMultipart = contentType.includes("multipart/form-data");
  
  let dir = "misc";
  let safeName = "file";
  let previousUrl: string | null = null;
  let fileData: File | Blob | ArrayBuffer | ReadableStream<Uint8Array> | null = null;
  let size = 0;
  
  if (isMultipart) {
    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
    }
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    fileData = file;
    size = file.size;
    const rawDir = formData.get("dir");
    dir = typeof rawDir === "string" && rawDir.trim().length > 0 ? rawDir.trim().replace(/[^A-Za-z0-9/_-]/g, "") : "misc";
    safeName = safeUploadName(file.name);
    previousUrl = formData.get("previousUrl") as string | null;
  } else {
    // RAW binary streaming mode (zero RAM pressure)
    const rawDir = request.nextUrl.searchParams.get("dir");
    dir = typeof rawDir === "string" && rawDir.trim().length > 0 ? rawDir.trim().replace(/[^A-Za-z0-9/_-]/g, "") : "misc";
    safeName = safeUploadName(request.nextUrl.searchParams.get("name") || "file");
    previousUrl = request.nextUrl.searchParams.get("previousUrl") || null;
    size = Number(request.headers.get("content-length") || 0);
    fileData = request.body;
    if (!fileData || size === 0) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
  }

  if (size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File exceeds the 512 MB limit." }, { status: 413 });
  }

  const dot = safeName.lastIndexOf(".");
  const extension = dot === -1 ? "" : safeName.slice(dot).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return NextResponse.json(
      { error: `Unsupported file type "${extension || "unknown"}".` },
      { status: 400 },
    );
  }

  // Tighter cap for image kinds (512MB blanket only for audio/pdf).
  const cap = IMAGE_EXTS.has(extension) ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
  if (size > cap) {
    return NextResponse.json(
      { error: `File exceeds the ${cap === MAX_IMAGE_BYTES ? "10 MB" : "512 MB"} limit.` },
      { status: 413 },
    );
  }

  if (!ALLOWED_UPLOAD_DIRS.has(dir)) {
    return NextResponse.json({ error: "Invalid upload directory." }, { status: 400 });
  }

  try {
    const url = await saveFile(dir, safeName, fileData as File | Blob | ArrayBuffer | ReadableStream<Uint8Array>, size, extension);

    const safePrevious = canonicalPreviousUrl(previousUrl);
    if (safePrevious && safePrevious !== url) {
      await removeFile(safePrevious).catch(() => undefined);
    }

    return NextResponse.json({ url });
  } catch (error) {
    console.error("Media upload failed:", error);
    const msg = error instanceof Error ? error.message : "Upload failed.";
    if (msg.includes("MEDIA_UPLOAD_TOKEN") || msg.includes("File exceeds")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Upload failed. Please try again." },
      { status: 500 },
    );
  }
}
