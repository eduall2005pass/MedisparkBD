import { NextRequest, NextResponse } from "next/server";

const CANONICAL_HOSTS = new Set(["medisparkbd.com", "www.medisparkbd.com"]);

// Any non-canonical host (VM: app./vm., previews, duckdns) gets
// X-Robots-Tag: noindex so Google never indexes duplicates.
// Vercel (medisparkbd.com) stays indexed.
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const host = req.headers.get("host")?.split(":")[0] ?? "";
  if (host && !CANONICAL_HOSTS.has(host)) {
    res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  return res;
}

export const config = { matcher: "/:path*" };
