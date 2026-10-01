import type { MetadataRoute } from "next";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

const CANONICAL_HOSTS = new Set(["medisparkbd.com", "www.medisparkbd.com"]);

export default async function robots(): Promise<MetadataRoute.Robots> {
  // Request-time host check — NEXT_PUBLIC_* is baked at build time so it
  // can't distinguish Vercel from VM. VM/staging hosts get disallow-all.
  const host = (await headers()).get("host")?.split(":")[0] ?? "";
  if (host && !CANONICAL_HOSTS.has(host)) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://medisparkbd.com";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/dashboard/", "/api/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
