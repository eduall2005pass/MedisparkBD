import { NextRequest, NextResponse } from "next/server";
import { revalidateTag, revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin";
import {
  fetchSeoSettings,
  normalizeSeoSettingsInput,
  saveSeoSettings,
} from "@/lib/seo-settings";
import { saveFile, removeFile } from "@/lib/storage";

// Public content: edge-cached for fast loads (60s revalidation).
export const revalidate = 300;

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
};

const ALLOWED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

function asString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

export async function GET() {
  const seo = await fetchSeoSettings();
  return NextResponse.json({ seo }, { headers: CACHE_HEADERS });
}

export async function PUT(request: NextRequest) {
  const admin = await requirePermission(request, "manageContent");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let raw: Record<string, unknown>;
  let imageFile: File | null = null;

  // Track which SEO fields were explicitly provided (for multipart partial updates like image-only upload)
  const providedKeys = new Set<string>();
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    raw = {};
    // Only include fields that were actually sent — prevents wiping other SEO fields on image-only upload
    for (const key of ["siteTitle", "metaDescription", "keywords", "ogTitle", "ogDescription"] as const) {
      if (formData.has(key)) {
        raw[key] = asString(formData.get(key));
        providedKeys.add(key);
      }
    }
    // ogImageUrl can be sent via JSON part of multipart (rare) — preserve if present
    if (formData.has("ogImageUrl")) {
      raw["ogImageUrl"] = asString(formData.get("ogImageUrl"));
      providedKeys.add("ogImageUrl");
    }
    const rawImage = formData.get("ogImage");
    if (rawImage instanceof File && rawImage.size > 0) imageFile = rawImage;
    // Also handle alternative field name "ogImageUrl" as file? No, that's URL string
  } else {
    const body = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!body) {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 },
      );
    }
    raw = body;
    for (const key of Object.keys(raw)) providedKeys.add(key);
  }

  // Pre-validate image before touching DB to surface errors early.
  if (imageFile) {
    const extension = imageFile.name.includes(".")
      ? `.${imageFile.name.split(".").pop()?.toLowerCase() ?? ""}`
      : "";
    if (!ALLOWED_IMAGE_EXTENSIONS.includes(extension)) {
      return NextResponse.json(
        { error: "Unsupported image file type. Use PNG, JPG, WebP or GIF." },
        { status: 400 },
      );
    }
    if (imageFile.size > MAX_IMAGE_FILE_SIZE) {
      return NextResponse.json(
        { error: "Social sharing image must be 5 MB or smaller." },
        { status: 400 },
      );
    }
  }

  try {
    const current = await fetchSeoSettings();
    const normalized = normalizeSeoSettingsInput(raw);

    // Reject blob: URLs — they are temporary browser-only and not persistable
    if (normalized.ogImageUrl && normalized.ogImageUrl.startsWith("blob:")) {
      return NextResponse.json(
        { error: "Invalid image URL (blob:). Please upload the image file instead." },
        { status: 400 },
      );
    }
    // For multipart partial updates (e.g., image-only upload from Website Information), preserve current values for missing fields
    const isMultipart = contentType.includes("multipart/form-data");
    let merged: typeof normalized;
    if (isMultipart) {
      merged = { ...current } as typeof normalized;
      for (const key of ["siteTitle", "metaDescription", "keywords", "ogTitle", "ogDescription", "ogImageUrl"] as const) {
        if (providedKeys.has(key)) {
          (merged as Record<string, unknown>)[key] = (normalized as Record<string, unknown>)[key];
        }
      }
    } else {
      // JSON path: if ogImageUrl not provided, keep current; also preserve other fields if not provided
      merged = { ...current } as typeof normalized;
      for (const key of ["siteTitle", "metaDescription", "keywords", "ogTitle", "ogDescription", "ogImageUrl"] as const) {
        if (providedKeys.has(key)) {
          (merged as Record<string, unknown>)[key] = (normalized as Record<string, unknown>)[key];
        }
      }
      // For JSON saveAll, ogImageUrl is expected to be provided; if missing, keep current (already merged)
    }

    let ogImageUrl = merged.ogImageUrl;
    if (imageFile) {
      try {
        ogImageUrl = await saveFile("seo", imageFile.name, await imageFile.arrayBuffer());
      } catch (uploadError) {
        console.error("[seo-settings] Social Share Image upload failed:", uploadError);
        const msg = uploadError instanceof Error ? uploadError.message : "Image upload failed.";
        return NextResponse.json({ error: msg }, { status: 500 });
      }
      // Ensure we never store a blob: URL
      if (ogImageUrl.startsWith("blob:")) {
        console.error("[seo-settings] Upload returned blob: URL, rejecting:", ogImageUrl);
        return NextResponse.json({ error: "Upload returned an invalid URL." }, { status: 500 });
      }
      merged.ogImageUrl = ogImageUrl;
    } else if (!isMultipart && providedKeys.has("ogImageUrl")) {
      // JSON update with explicit ogImageUrl (could be empty to clear)
      merged.ogImageUrl = normalized.ogImageUrl;
    }

    const seo = await saveSeoSettings(merged, admin.uid);

    // Only delete old image after new image is successfully saved and DB updated
    if (imageFile && current.ogImageUrl && current.ogImageUrl !== seo.ogImageUrl) {
      await removeFile(current.ogImageUrl); // Best-effort cleanup of the old image.
    }

    // Live Website synchronization: bust cached SEO so new image appears immediately
    try {
      (revalidateTag as unknown as (tag: string, profile: string) => void)("seo", "max");
      revalidatePath("/", "layout");
      revalidatePath("/admin/website/seo");
      revalidatePath("/admin/website-information");
    } catch {
      // revalidateTag may not be available in all runtimes
    }

    // Prevent browser/CDN caching of the JSON response so admin sees fresh data after refresh
    return NextResponse.json(
      { seo },
      {
        headers: {
          ...CACHE_HEADERS,
          "Cache-Control": "no-store, must-revalidate",
        },
      },
    );
  } catch (error) {
    console.error("[seo-settings] Failed to save SEO settings:", error);
    const message =
      error instanceof Error ? error.message : "Failed to save SEO settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await requirePermission(request, "manageContent");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const url = new URL(request.url);
  if (url.searchParams.get("target") !== "og-image") {
    return NextResponse.json({ error: "Unknown target." }, { status: 400 });
  }
  try {
    const current = await fetchSeoSettings();
    const seo = await saveSeoSettings({ ...current, ogImageUrl: "" }, admin.uid);
    if (current.ogImageUrl) await removeFile(current.ogImageUrl);
    try {
      (revalidateTag as unknown as (tag: string, profile: string) => void)("seo", "max");
      revalidatePath("/", "layout");
      revalidatePath("/admin/website/seo");
      revalidatePath("/admin/website-information");
    } catch {}
    return NextResponse.json(
      { seo },
      {
        headers: {
          ...CACHE_HEADERS,
          "Cache-Control": "no-store, must-revalidate",
        },
      },
    );
  } catch (error) {
    console.error("[seo-settings] Failed to remove Social Share Image:", error);
    const message =
      error instanceof Error ? error.message : "Failed to remove the image.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
