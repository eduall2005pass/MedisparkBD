import { NextRequest } from "next/server";
import { getFirebaseUser } from "@/lib/auth-api";
import { fetchUpload } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Private uploads: require auth. fetchUpload exposes no bucket/visibility
  // metadata, so there are no explicitly-public buckets to exempt.
  const user = await getFirebaseUser(request);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{16,64}$/i.test(id)) {
    return new Response("Not found", { status: 404 });
  }
  const upload = await fetchUpload(id);
  if (!upload) {
    return new Response("Not found", { status: 404 });
  }
  const safeFileName = upload.fileName.replace(/[\r\n"]/g, "");
  const mimeType = upload.mimeType;
  // Only raster images and PDFs render inline. SVG can carry scripts and
  // text/html (or any unknown legacy mimeType) must never render in the
  // site origin — force a download instead.
  const isInlineSafe =
    mimeType === "application/pdf" ||
    mimeType === "image/png" ||
    mimeType === "image/jpeg" ||
    mimeType === "image/webp" ||
    mimeType === "image/gif" ||
    mimeType === "image/avif" ||
    mimeType === "image/x-icon" ||
    mimeType === "image/vnd.microsoft.icon";
  return new Response(new Uint8Array(upload.data), {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(upload.data.length),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Content-Disposition": `${isInlineSafe ? "inline" : "attachment"}; filename="${safeFileName}"`,
    },
  });
}
