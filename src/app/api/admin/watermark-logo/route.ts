import { NextRequest, NextResponse } from "next/server";
import {
  fetchWatermarkLogo,
  saveWatermarkLogo,
  removeWatermarkLogo,
} from "@/lib/watermark-store";
import { requirePermission } from "@/lib/admin";
import {
  MAX_LOGO_FILE_SIZE,
  ALLOWED_LOGO_EXTENSIONS,
} from "@/lib/logo";
import { makeTransparentPng } from "@/lib/logo-background";

export async function GET() {
  const logo = await fetchWatermarkLogo();
  return NextResponse.json({ logo }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const admin = await requirePermission(request, "manageContent");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const formData = await request.formData();
  const file = formData.get("logo");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "No logo file provided." },
      { status: 400 },
    );
  }
  const extension = file.name.includes(".")
    ? `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`
    : "";
  if (!ALLOWED_LOGO_EXTENSIONS.includes(extension as never)) {
    return NextResponse.json(
      { error: "Unsupported file type. Use PNG, JPG, WebP, GIF or SVG." },
      { status: 400 },
    );
  }
  if (file.size > MAX_LOGO_FILE_SIZE) {
    return NextResponse.json(
      { error: "Logo file must be 5 MB or smaller." },
      { status: 400 },
    );
  }
  try {
    const rawBytes = new Uint8Array(await file.arrayBuffer());
    let processedBytes: Buffer;
    let processedFileName: string;
    let processedMime: string;
    let width = 512;
    let height = 512;

    if (extension === ".svg") {
      processedBytes = Buffer.from(rawBytes);
      const svgBase = file.name.replace(/\\/g, "/").split("/").pop()?.replace(/\0/g, "").trim().replace(/[. ]+$/g, "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128).replace(/[. ]+$/g, "") || "logo.svg";
      processedFileName = svgBase.toLowerCase().endsWith(".svg") ? svgBase : `${svgBase}.svg`;
      processedMime = "image/svg+xml";
      try {
        const { parseImageDimensions } = await import("@/lib/image-dimensions");
        const dims = parseImageDimensions(rawBytes, extension);
        width = dims.width;
        height = dims.height;
      } catch {
        // keep fallback 512
      }
    } else {
      try {
        processedBytes = await makeTransparentPng(rawBytes);
      } catch {
        try {
          const sharp = (await import("sharp")).default;
          processedBytes = await sharp(rawBytes).ensureAlpha().png({ palette: false }).toBuffer();
        } catch {
          processedBytes = Buffer.from(rawBytes);
        }
      }
      try {
        const { parseImageDimensions } = await import("@/lib/image-dimensions");
        const dims = parseImageDimensions(new Uint8Array(processedBytes), ".png");
        width = dims.width;
        height = dims.height;
      } catch {
        try {
          const { parseImageDimensions } = await import("@/lib/image-dimensions");
          const dims = parseImageDimensions(rawBytes, extension);
          width = dims.width;
          height = dims.height;
        } catch {
          // keep fallback 512
        }
      }
      const rawBase = file.name.includes(".")
        ? file.name.slice(0, file.name.lastIndexOf("."))
        : file.name;
      const base = rawBase.replace(/\\/g, "/").split("/").pop()?.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "logo";
      processedFileName = `${base}.png`;
      processedMime = "image/png";
    }

    const freshFile = new File(
      [new Uint8Array(processedBytes)],
      processedFileName,
      { type: processedMime },
    );
    const logo = await saveWatermarkLogo(
      freshFile,
      width,
      height,
      admin.uid,
    );
    return NextResponse.json({ logo }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save the watermark logo.";
    if (message.includes("MEDIA_UPLOAD_TOKEN")) {
      return NextResponse.json(
        { error: "Storage not configured (MEDIA_UPLOAD_TOKEN missing)." },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await requirePermission(request, "manageContent");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    await removeWatermarkLogo();
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Could not remove the watermark logo." },
      { status: 500 },
    );
  }
}
