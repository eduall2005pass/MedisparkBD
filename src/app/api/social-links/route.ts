import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin";
import {
  fetchAllSocialLinks,
  saveSocialLinks,
  deleteSocialLink,
  upsertSocialLink,
  type SocialLinkUpdate,
} from "@/lib/social-links";
import { isSocialPlatformKey, type SocialPlatformKey, getSocialLabel } from "@/lib/social-links-constants";
import { URL_MESSAGE, isValidHttpUrl } from "@/lib/form-validation";

// Public content: edge-cached for fast loads (60s revalidation).
export const revalidate = 300;

export async function GET() {
  const links = await fetchAllSocialLinks();
  return NextResponse.json({ links });
}

export async function PUT(request: NextRequest) {
  const admin = await requirePermission(request, "manageContent");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    links?: unknown;
  } | null;

  if (!body || !Array.isArray(body.links)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const updates: SocialLinkUpdate[] = [];
  for (const raw of body.links) {
    const entry = raw as Record<string, unknown>;
    const rawKey = typeof entry.key === "string" ? entry.key.trim().toLowerCase().replace(/\s+/g, "-") : null;
    if (!rawKey || !isSocialPlatformKey(rawKey)) {
      return NextResponse.json(
        { error: `Invalid platform key: ${String(entry.key ?? "")}` },
        { status: 400 },
      );
    }
    const label = typeof entry.label === "string" && entry.label.trim().length > 0 ? entry.label.trim() : getSocialLabel(rawKey);
    const icon = typeof entry.icon === "string" && entry.icon.trim().length > 0 ? entry.icon.trim() : null;
    const urlRaw = typeof entry.url === "string" ? entry.url.trim() : "";
    if (urlRaw !== "" && !isValidHttpUrl(urlRaw)) {
      return NextResponse.json(
        { error: `${getSocialLabel(rawKey)} URL: ${URL_MESSAGE}` },
        { status: 400 },
      );
    }
    updates.push({
      key: rawKey as SocialPlatformKey,
      label,
      icon,
      url: urlRaw !== "" ? urlRaw : null,
      isActive: entry.isActive === true || entry.isActive === "true" || entry.isActive === "1",
    });
  }

  try {
    const links = await saveSocialLinks(updates, admin.uid);
    const finalLinks = await fetchAllSocialLinks();
    return NextResponse.json({
      message: "Social links saved successfully.",
      links: finalLinks,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save social links.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const admin = await requirePermission(request, "manageContent");
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.key !== "string" || !body.key.trim()) {
    return NextResponse.json({ error: "Platform Name is required." }, { status: 400 });
  }
  const rawKey = (body.key as string).trim().toLowerCase().replace(/\s+/g, "-");
  if (!isSocialPlatformKey(rawKey)) {
    return NextResponse.json({ error: "Invalid platform key format." }, { status: 400 });
  }
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : getSocialLabel(rawKey);
  const icon = typeof body.icon === "string" && body.icon.trim() ? body.icon.trim() : null;
  const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : null;
  const isActive = body.isActive === true || body.isActive === "true" || body.isActive === "1" || body.isActive === undefined ? true : false;

  try {
    const links = await upsertSocialLink({ key: rawKey, label, icon, url, isActive }, admin.uid);
    return NextResponse.json({ message: "Social link added.", links });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add social link.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await requirePermission(request, "manageContent");
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { searchParams } = new URL(request.nextUrl);
  const rawKey = searchParams.get("key")?.trim().toLowerCase();
  if (!rawKey) return NextResponse.json({ error: "Platform key is required." }, { status: 400 });

  try {
    const deleted = await deleteSocialLink(rawKey);
    if (!deleted) return NextResponse.json({ error: "Social link not found." }, { status: 404 });
    const links = await fetchAllSocialLinks();
    return NextResponse.json({ message: "Social link deleted.", links });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete social link.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
