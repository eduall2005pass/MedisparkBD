"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type BrowserKey =
  | "chrome-android"
  | "chrome-desktop"
  | "samsung"
  | "safari-ios"
  | "safari-macos"
  | "firefox"
  | "other";

type Guide = { label: string; steps: string[] };

const GUIDES: Record<BrowserKey, Guide> = {
  "chrome-android": {
    label: "Chrome (Android)",
    steps: [
      "Tap the ⋮ menu at the top-right corner.",
      "Tap “Add to Home screen” (or “Install app”).",
      "Tap “Install” — MediSpark opens like a native app.",
    ],
  },
  "chrome-desktop": {
    label: "Chrome (PC)",
    steps: [
      "Look for the Install icon at the right end of the address bar and click it.",
      "Or open the ⋮ menu → “Install MediSpark…”.",
      "Click “Install” — the app opens in its own window.",
    ],
  },
  samsung: {
    label: "Samsung Internet",
    steps: [
      "Tap the ☰ menu at the bottom-right.",
      "Tap “Add page to” → “Home screen”.",
      "Confirm — MediSpark is added to your home screen.",
    ],
  },
  "safari-ios": {
    label: "Safari (iPhone / iPad)",
    steps: [
      "Tap the Share button (square with ↑) in the toolbar.",
      "Scroll down and tap “Add to Home Screen”.",
      "Tap “Add” — MediSpark appears on your home screen.",
    ],
  },
  "safari-macos": {
    label: "Safari (Mac)",
    steps: [
      "In the menu bar, go to File → “Add to Dock…”.",
      "Click “Add” — MediSpark joins your Dock like a native app.",
      "Needs Safari 17+ on macOS Sonoma or later.",
    ],
  },
  firefox: {
    label: "Firefox",
    steps: [
      "Tap the ⋮ menu → “Install” (Android) or “Add to Home screen”.",
      "On Firefox for PC there is no app install — press Ctrl+D to bookmark instead.",
      "For the full app experience, open this site in Chrome or Edge once and install from there.",
    ],
  },
  other: {
    label: "Other browsers",
    steps: [
      "Open the browser menu (⋮ or ☰).",
      "Look for “Add to Home screen”, “Install” or “Add page to”.",
      "Confirm — MediSpark will be added to your home screen.",
    ],
  },
};

const GUIDE_ORDER: BrowserKey[] = [
  "chrome-android",
  "chrome-desktop",
  "samsung",
  "safari-ios",
  "safari-macos",
  "firefox",
  "other",
];

function detectBrowser(): BrowserKey {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  const isIOS =
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Mac/i.test(ua) && typeof document !== "undefined" && "ontouchend" in document);
  const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);
  if (isIOS) return isSafari || /fxios|crios/i.test(ua) ? "safari-ios" : "safari-ios";
  if (/samsungbrowser/i.test(ua)) return "samsung";
  if (/firefox|fxios/i.test(ua)) return "firefox";
  if (/edg|chrome|crios/i.test(ua)) {
    return /android/i.test(ua) ? "chrome-android" : "chrome-desktop";
  }
  if (isSafari) return "safari-macos";
  return /android/i.test(ua) ? "chrome-android" : "other";
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
  if ((window.navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  return false;
}

const BTN_CLASS =
  "rounded-xl border border-ink/20 bg-ink/5 px-6 py-3.5 text-center font-semibold text-heading transition hover:border-primary-500/60 hover:bg-ink/10 active:scale-[0.98]";

/**
 * Hero install button with auto-detect:
 * - Installed (standalone) → "Open in App" linking home.
 * - Chrome/Edge with install prompt → native install popup on tap.
 * - Every other browser → per-browser Add-to-Home-Screen guide modal.
 */
export default function InstallAppButton() {
  const [installed, setInstalled] = useState<boolean>(() => isStandalone());
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [promptUsed, setPromptUsed] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [guideTab, setGuideTab] = useState<BrowserKey>(() => detectBrowser());
  const [portalMounted, setPortalMounted] = useState(false);
  useEffect(() => {
    setPortalMounted(true);
    return () => setPortalMounted(false);
  }, []);

  useEffect(() => {
    // Re-check after mount (SSR renders blind) without a sync setState.
    void Promise.resolve().then(() => {
      if (isStandalone()) setInstalled(true);
    });
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      // A fresh event = a fresh native-prompt chance (Chrome re-fires this
      // on later page loads after a dismiss), so reset the used flag.
      setDeferred(event as BeforeInstallPromptEvent);
      setPromptUsed(false);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      setGuideOpen(false);
      setMinimized(false);
    };
    const media = window.matchMedia("(display-mode: standalone)");
    const onMedia = (e: MediaQueryListEvent) => {
      if (e.matches) onInstalled();
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    if (typeof media.addEventListener === "function") media.addEventListener("change", onMedia);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      if (typeof media.removeEventListener === "function") media.removeEventListener("change", onMedia);
    };
  }, []);

  // Escape closes the guide.
  useEffect(() => {
    if (!guideOpen || minimized) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setGuideOpen(false);
        setMinimized(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [guideOpen, minimized]);

  /** Fire Chrome's native install popup. True when the user accepted. */
  const tryNativeInstall = useCallback(async (): Promise<boolean> => {
    if (!deferred || promptUsed) return false;
    setPromptUsed(true);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        setInstalled(true);
        setDeferred(null);
        setGuideOpen(false);
        setMinimized(false);
        return true;
      }
    } catch {
      // Native popup unavailable — fall through to the guide steps.
    }
    // One event object can only prompt once — drop it so the next
    // beforeinstallprompt (next page load) becomes the new chance.
    setDeferred(null);
    return false;
  }, [deferred, promptUsed]);

  const handleClick = useCallback(async () => {
    const accepted = await tryNativeInstall();
    if (accepted) return;
    setGuideTab(detectBrowser());
    setMinimized(false);
    setGuideOpen(true);
  }, [tryNativeInstall]);

  if (installed) {
    // Already running inside the installed app → the original Dashboard
    // button (opening the app again would be pointless).
    return (
      <Link href="/dashboard" aria-label="Go to Dashboard" className={BTN_CLASS}>
        Dashboard
      </Link>
    );
  }

  const guide = GUIDES[guideTab];

  return (
    <>
      <button type="button" onClick={() => void handleClick()} aria-label="Install MediSpark as an app" className={BTN_CLASS}>
        <span className="inline-flex items-center gap-2">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 19h16" />
          </svg>
          Install as App
        </span>
      </button>

      {/* Portal to <body>: ancestor transforms (hero animation) break
          position:fixed and trap stacking — the banner slider would paint
          above the modal otherwise. */}
      {portalMounted &&
        createPortal(
          <>
            {guideOpen && !minimized && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="How to install the MediSpark app"
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => { setGuideOpen(false); setMinimized(false); }}
        >
          <div
            className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-ink/10 bg-dark-900 p-5 shadow-2xl shadow-black/50 sm:rounded-3xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-extrabold text-heading">Install MediSpark</h2>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setMinimized(true)}
                  aria-label="Minimize install guide"
                  title="Minimize"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/15 bg-dark-800 text-lg font-bold leading-none text-neutral-200 transition hover:border-primary-500/60 hover:text-heading"
                >
                  —
                </button>
                <button
                  type="button"
                  onClick={() => { setGuideOpen(false); setMinimized(false); }}
                  aria-label="Close install guide"
                  title="Close"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/15 bg-dark-800 text-sm font-bold leading-none text-neutral-200 transition hover:border-primary-500/60 hover:text-heading"
                >
                  ✕
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-neutral-400">
              Pick your browser below and follow the steps — takes less than a minute.
            </p>
            {deferred && !promptUsed ? (
              <button
                type="button"
                onClick={() => void tryNativeInstall()}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-3 text-sm font-extrabold text-white shadow-lg shadow-primary-900/40 transition hover:bg-primary-500 active:scale-[0.98]"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 19h16" />
                </svg>
                Install Now
              </button>
            ) : (
              <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                No native popup right now? Reload this page once, then tap “Install as App” again — Chrome will offer the install popup.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {GUIDE_ORDER.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setGuideTab(key)}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${
                    guideTab === key
                      ? "bg-primary-600 text-white"
                      : "border border-ink/10 bg-dark-850 text-neutral-400 hover:text-heading"
                  }`}
                >
                  {GUIDES[key].label}
                </button>
              ))}
            </div>
            <ol className="mt-4 space-y-2.5">
              {guide.steps.map((step, index) => (
                <li key={index} className="flex gap-3 rounded-xl border border-ink/10 bg-dark-850 p-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-600/15 text-[11px] font-extrabold text-primary-300">
                    {index + 1}
                  </span>
                  <p className="text-xs leading-relaxed text-neutral-300 sm:text-sm">{step}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
            )}

            {guideOpen && minimized && (
        <button
          type="button"
          onClick={() => setMinimized(false)}
          aria-label="Expand install guide"
          title="Expand install guide"
          className="fixed bottom-20 right-4 z-[100] flex items-center gap-2 rounded-full border border-primary-500/50 bg-dark-900/95 px-4 py-3 text-xs font-extrabold text-heading shadow-xl shadow-black/40 backdrop-blur transition hover:bg-dark-850 active:scale-[0.97] sm:bottom-6"
        >
          <svg className="h-4 w-4 text-primary-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 19h16" />
          </svg>
          Install guide
          <span aria-hidden="true">▲</span>
        </button>
            )}
          </>,
          document.body,
        )}
    </>
  );
}
