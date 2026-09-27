"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import { loginHref } from "@/lib/nav-links";
import { useAuth } from "@/lib/auth-context";
import { useExamLock } from "@/components/exam/ExamLockContext";
import {
  DEFAULT_NAVBAR_CONFIG,
  NAVBAR_SECTION_FALLBACKS,
  type NavbarConfig,
} from "@/lib/navbar-constants";

/** Per-item menu icons — only items listed here show an icon. */
const MENU_ITEM_ICONS: Record<string, React.ReactNode> = {
  qa: (
    <svg
      aria-hidden
      className="h-4 w-4 shrink-0 text-primary-500"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      <path d="M9.7 9.3a2.4 2.4 0 0 1 4.7.7c0 1.6-2.4 2.1-2.4 3.4" />
      <circle cx="12" cy="16.4" r="0.4" fill="currentColor" />
    </svg>
  ),
};

export default function Navbar({ config }: { config?: NavbarConfig }) {
  const router = useRouter();
  const settings = config ?? DEFAULT_NAVBAR_CONFIG;
  const { user } = useAuth();
  const { isLocked, requestExit } = useExamLock();
  const actionHref = user ? "/dashboard" : loginHref;
  const actionLabel = user ? "Dashboard" : "Login";
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  /**
   * Unread notification count — database-backed (survives refresh).
   * The indicator dot renders ONLY when this is > 0. Null = unknown /
   * logged out → hidden. Refreshed instantly via the
   * "medispark:notifications-read" event, on window focus, and by polling
   * so newly arrived notifications light the dot again.
   */
  const [unreadCount, setUnreadCount] = useState<number | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 32);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const userUid = user?.uid ?? null;
  useEffect(() => {
    if (!userUid || !user) return;
    let cancelled = false;
    async function loadUnread() {
      try {
        const token = await user!.getIdToken();
        const response = await fetch("/api/notifications?count=1", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = (await response.json().catch(() => null)) as {
          unreadCount?: unknown;
        } | null;
        const count = Number(data?.unreadCount ?? 0) || 0;
        if (!cancelled) setUnreadCount(count);
      } catch {
        // Keep the last known state — never flash a stale dot on errors.
      }
    }
    void loadUnread();
    const onRead = (event: Event) => {
      const detail = (event as CustomEvent<{ unreadCount?: unknown }>).detail;
      if (detail && typeof detail.unreadCount === "number") {
        setUnreadCount(detail.unreadCount);
      } else {
        void loadUnread();
      }
    };
    const onFocus = () => void loadUnread();
    window.addEventListener("medispark:notifications-read", onRead as EventListener);
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(loadUnread, 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener("medispark:notifications-read", onRead as EventListener);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- user is stable per uid; refetch on account switch only
  }, [userUid]);

  if (!settings.showNavbar) return null;

  const menuItems = settings.items
    .filter((item) => item.isActive)
    .map((item) => ({
      ...item,
      href: item.href ?? NAVBAR_SECTION_FALLBACKS[item.key] ?? null,
    }));

  /**
   * Smooth-scroll to a "/#section" target, navigating home first if needed.
   * Waits (with retries) for the Home page to render the section before
   * scrolling, so slow loads don't silently skip the anchor.
   */
  async function goToSection(hashHref: string) {
    const sectionId = hashHref.slice(2);
    if (window.location.pathname !== "/") {
      await router.push("/");
    }
    const scroll = () =>
      document.getElementById(sectionId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    // Retry until the section exists on the page (max ~5s).
    for (let attempt = 0; attempt < 50; attempt++) {
      if (document.getElementById(sectionId)) {
        scroll();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  function isSectionLink(href: string): boolean {
    return /^\/#[\w-]+$/.test(href);
  }

  function handleGuardedNav(
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string,
  ) {
    if (!isLocked) return;
    e.preventDefault();
    e.stopPropagation();
    if (isSectionLink(href)) {
      requestExit(() => {
        void goToSection(href);
      });
    } else {
      // absolute URL for pending navigation
      const url = href.startsWith("http") ? href : window.location.origin + href;
      requestExit(() => {
        window.location.href = url;
      });
    }
  }

  return (
    <header
      className={`sticky top-0 z-50 border-b border-ink/10 bg-dark-950/90 backdrop-blur transition-all duration-300 ${
        scrolled ? "lg:shadow-xl lg:shadow-black/25" : ""
      }`}
    >
      <nav
        className={`mx-auto flex max-w-6xl items-center justify-between px-4 py-3 transition-all duration-300 sm:px-6 ${
          scrolled ? "lg:py-1.5" : ""
        }`}
      >
        <Link
          href="/"
          onClick={(e) => handleGuardedNav(e, "/")}
          className={`flex w-1/3 max-w-[330px] shrink-0 transition-all duration-300 hover:opacity-90 ${
            scrolled ? "lg:max-w-[220px]" : ""
          }`}
        >
          <Logo size="large" />
        </Link>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link
            href="/dashboard/notifications"
            aria-label="Notifications"
            onClick={(e) => handleGuardedNav(e, "/dashboard/notifications")}
            className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-ink/10 bg-ink/5 text-neutral-300 transition hover:border-primary-500/50 hover:bg-primary-500/10 hover:text-heading"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {userUid && unreadCount !== null && unreadCount > 0 && (
              <span
                className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary-500"
                aria-label={`${unreadCount} unread notifications`}
              />
            )}
          </Link>

          {/* Compact theme toggle — sits immediately beside the notification icon. */}
          <ThemeToggle />

          {settings.showLoginButton && (
            <Link
              href={actionHref}
              onClick={(e) => handleGuardedNav(e, actionHref)}
              title={user ? "Dashboard" : undefined}
              aria-label={user ? "Dashboard" : undefined}
              className={
                user
                  ? "relative flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600 text-white shadow-lg shadow-primary-900/40 transition hover:bg-primary-700 active:scale-[0.98]"
                  : "flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-900/40 transition hover:bg-primary-700 active:scale-[0.98] sm:px-4"
              }
            >
              {user ? (
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  viewBox="0 0 24 24"
                >
                  <rect x="3" y="3" width="7" height="9" rx="1" />
                  <rect x="14" y="3" width="7" height="5" rx="1" />
                  <rect x="14" y="12" width="7" height="9" rx="1" />
                  <rect x="3" y="16" width="7" height="5" rx="1" />
                </svg>
              ) : (
                <>
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                  >
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <span>{actionLabel}</span>
                </>
              )}
            </Link>
          )}

          {settings.showMoreMenu && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-label="Menu"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition ${
                  menuOpen
                    ? "border-primary-500/50 bg-primary-500/10 text-heading"
                    : "border-ink/10 bg-ink/5 text-neutral-300 hover:border-primary-500/50 hover:bg-primary-500/10 hover:text-heading"
                }`}
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  viewBox="0 0 24 24"
                >
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setMenuOpen(false)}
                    aria-hidden="true"
                  />
                  <div
                    role="menu"
                    aria-label="Menu"
                    className="absolute right-0 top-full z-50 mt-2 min-w-52 rounded-xl border border-ink/10 bg-dark-950/95 p-1.5 shadow-2xl shadow-black/40 backdrop-blur"
                  >
                    {menuItems.map((item) =>
                      item.href ? (
                        <Link
                          key={item.key}
                          href={item.href}
                          role="menuitem"
                          onClick={(event) => {
                            if (isLocked) {
                              event.preventDefault();
                              event.stopPropagation();
                              const href = item.href as string;
                              if (isSectionLink(href)) {
                                requestExit(() => void goToSection(href));
                              } else {
                                const url = href.startsWith("http")
                                  ? href
                                  : window.location.origin + href;
                                requestExit(() => {
                                  window.location.href = url;
                                });
                              }
                              return;
                            }
                            if (isSectionLink(item.href as string)) {
                              event.preventDefault();
                              void goToSection(item.href as string);
                              return;
                            }
                            setMenuOpen(false);
                          }}
                          className={
                            MENU_ITEM_ICONS[item.key]
                              ? "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-neutral-300 transition hover:bg-primary-500/10 hover:text-heading"
                              : "block rounded-lg px-3 py-2 text-sm font-medium text-neutral-300 transition hover:bg-primary-500/10 hover:text-heading"
                          }
                        >
                          {MENU_ITEM_ICONS[item.key]}
                          <span>{item.label}</span>
                        </Link>
                      ) : (
                        <span
                          key={item.key}
                          role="menuitem"
                          aria-disabled="true"
                          className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-neutral-600"
                        >
                          {item.label}
                          <span className="rounded-full border border-ink/10 bg-ink/5 px-2 py-0.5 text-[10px] font-semibold text-neutral-500">
                            Soon
                          </span>
                        </span>
                      ),
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </nav>
    </header>
  );
}
