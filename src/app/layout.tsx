import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import BottomNav from "@/components/BottomNav";
import Footer from "@/components/Footer";
import { ThemeProvider } from "@/components/ThemeProvider";
import { LogoProvider } from "@/components/LogoProvider";
import { WebsiteSettingsProvider } from "@/components/WebsiteSettingsProvider";
import { AuthProvider } from "@/lib/auth-context";
import HideOnAdmin from "@/components/admin/HideOnAdmin";
import { ExamLockProvider } from "@/components/exam/ExamLockContext";
import { NavHistoryProvider } from "@/components/navigation/NavHistoryContext";
import AnnouncementBar from "@/components/home/AnnouncementBar";
import { getActiveLogo, fetchThemeLogos } from "@/lib/logo-store";
import { getWebsiteSettingsWithFallback } from "@/lib/website-settings";
import { fetchSeoSettings, DEFAULT_SEO_SETTINGS } from "@/lib/seo-settings";
import { fetchNavbarConfig } from "@/lib/navbar";
import { DEFAULT_NAVBAR_CONFIG } from "@/lib/navbar-constants";
import { DEFAULT_WEBSITE_SETTINGS } from "@/lib/website-settings-constants";
import {
  fetchThemeSettings,
  buildThemeOverrideCss,
  DEFAULT_THEME_SETTINGS,
} from "@/lib/theme-settings";
import { Suspense } from "react";
import { unstable_cache } from "next/cache";
import { GlobalLoadingProvider } from "@/components/GlobalLoading";
import PwaRegister from "@/components/pwa/PwaRegister";
import { SWRConfig } from "swr";
import "./globals.css";

// Branding/settings change rarely — cache layout data long (30-60min) to
// minimize Vercel Data Cache / ISR writes. Admin edits bust instantly via
// revalidateTag (see /api/logo, /api/seo-settings), so long TTL is safe.
const getCachedSeo = unstable_cache(fetchSeoSettings, ["layout-seo"], {
  revalidate: 1800,
  tags: ["seo"],
});
const getCachedActiveLogo = unstable_cache(getActiveLogo, ["layout-logo"], {
  revalidate: 3600,
  tags: ["logo", "layout-logo", "logo-theme"],
});
const getCachedThemeLogos = unstable_cache(fetchThemeLogos, ["layout-themelogos"], {
  revalidate: 3600,
  tags: ["logo", "layout-themelogos", "logo-theme"],
});
const getCachedWebsiteSettings = unstable_cache(
  getWebsiteSettingsWithFallback,
  ["layout-website-settings"],
  { revalidate: 1800, tags: ["website-settings"] },
);
const getCachedNavbarConfig = unstable_cache(fetchNavbarConfig, ["layout-navbar"], {
  revalidate: 1800,
  tags: ["navbar"],
});
const getCachedThemeSettings = unstable_cache(
  fetchThemeSettings,
  ["layout-theme"],
  { revalidate: 1800, tags: ["theme"] },
);

const DEFAULT_SITE_TITLE =
  "MediSpark — HSC Academic & Medical Admission Preparation";
const DEFAULT_META_DESCRIPTION =
  "MediSpark is an HSC academic and medical admission preparation platform — courses, exams, and Q&A built for future medical students.";

export async function generateMetadata(): Promise<Metadata> {
  let seo = DEFAULT_SEO_SETTINGS;
  try {
    seo = await getCachedSeo();
  } catch {
    seo = DEFAULT_SEO_SETTINGS;
  }
  const siteTitle = seo.siteTitle || DEFAULT_SITE_TITLE;
  const description = seo.metaDescription || DEFAULT_META_DESCRIPTION;
  return {
    metadataBase: new URL(
      process.env.NEXT_PUBLIC_SITE_URL ?? "https://medisparkbd.com",
    ),
    title: {
      default: siteTitle,
      template: `%s | ${seo.siteTitle || "MediSpark"}`,
    },
    description,
    manifest: "/manifest.webmanifest",
    themeColor: "#0b1220",
    appleWebApp: {
      capable: true,
      title: "MediSpark",
      statusBarStyle: "black-translucent",
    },
    icons: {
      icon: [
        { url: "/icons/icon-192-v2.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512-v2.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/icons/apple-touch-icon-v2.png", sizes: "180x180", type: "image/png" }],
    },
    keywords: seo.keywords
      ? seo.keywords
          .split(",")
          .map((keyword) => keyword.trim())
          .filter(Boolean)
      : undefined,
    openGraph: {
      title: seo.ogTitle || siteTitle,
      description: seo.ogDescription || description,
      images: seo.ogImageUrl ? [seo.ogImageUrl] : undefined,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: seo.ogTitle || siteTitle,
      description: seo.ogDescription || description,
      images: seo.ogImageUrl ? [seo.ogImageUrl] : undefined,
    },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let initialLogo = null;
  let initialThemeLogos: Awaited<ReturnType<typeof getCachedThemeLogos>> = { light: null, dark: null };
  let initialSettings = DEFAULT_WEBSITE_SETTINGS;
  let navbarConfig = DEFAULT_NAVBAR_CONFIG;
  let themeSettings = DEFAULT_THEME_SETTINGS;
  try {
    const [logo, themeLogos, settings, nav, theme] = await Promise.all([
      getCachedActiveLogo().catch(() => null),
      getCachedThemeLogos().catch(() => ({ light: null, dark: null })),
      getCachedWebsiteSettings().catch(() => DEFAULT_WEBSITE_SETTINGS),
      getCachedNavbarConfig().catch(() => DEFAULT_NAVBAR_CONFIG),
      getCachedThemeSettings().catch(() => DEFAULT_THEME_SETTINGS),
    ]);
    initialLogo = logo;
    initialThemeLogos = themeLogos;
    initialSettings = settings;
    navbarConfig = nav;
    themeSettings = theme;
  } catch {
    // Safe fallbacks above keep the whole site renderable if data fetches fail.
  }
  const themeOverrideCss = buildThemeOverrideCss(themeSettings);
  return (
    <html
      lang="en"
      className="h-full antialiased"
      data-button-style={themeSettings.buttonStyle}
      data-radius={themeSettings.borderRadius}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("medispark-theme");if(t!=="light"&&t!=="dark"){t="${themeSettings.themeMode}";}document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","${themeSettings.themeMode}");}})();`,
          }}
        />
        {themeOverrideCss && (
          <style dangerouslySetInnerHTML={{ __html: themeOverrideCss }} />
        )}
        {initialSettings.faviconUrl && (
          <link rel="icon" href={initialSettings.faviconUrl} />
        )}
        {/* First-load performance: resource hints */}
        <link rel="preconnect" href="https://medispark.duckdns.org" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://firebasestorage.googleapis.com" />
        <link rel="dns-prefetch" href="https://firestore.googleapis.com" />
      </head>
      <body className="flex min-h-full flex-col bg-dark-950 text-neutral-300">
        <PwaRegister />
        <Suspense fallback={null}>
          <GlobalLoadingProvider>
            <ThemeProvider>
              <WebsiteSettingsProvider initialSettings={initialSettings}>
                <LogoProvider
                  initialLogo={initialLogo}
                  initialThemeLogos={initialThemeLogos}
                >
<AuthProvider>
                    <SWRConfig value={{ revalidateOnFocus: false, revalidateOnReconnect: true, dedupingInterval: 30000 }}>
                      <ExamLockProvider>
                        <NavHistoryProvider>
                          <HideOnAdmin>
                            <AnnouncementBar />
                            <Navbar config={navbarConfig} />
                          </HideOnAdmin>
                          {children}
                          <HideOnAdmin>
                            <Footer />
                            <BottomNav />
                          </HideOnAdmin>
                        </NavHistoryProvider>
                      </ExamLockProvider>
                    </SWRConfig>
                  </AuthProvider>
                </LogoProvider>
              </WebsiteSettingsProvider>
            </ThemeProvider>
          </GlobalLoadingProvider>
        </Suspense>
      </body>
    </html>
  );
}