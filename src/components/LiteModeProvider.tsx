"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const LiteModeContext = createContext(false);

/** True while the connection is slow/offline — UI renders the lite version. */
export function useLiteMode(): boolean {
  return useContext(LiteModeContext);
}

/** 1px transparent GIF used to hold not-yet-loaded images in lite mode. */
const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

type NetworkConnection = {
  effectiveType?: string;
  downlink?: number;
  saveData?: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

function readConnection(): NetworkConnection | null {
  try {
    const nav = navigator as Navigator & { connection?: NetworkConnection };
    return nav.connection ?? null;
  } catch {
    return null;
  }
}

/** Slow/offline when: browser offline, Data Saver on, 2G-class network. */
function computeLite(): boolean {
  try {
    if (typeof navigator === "undefined") return false;
    if (navigator.onLine === false) return true;
    const conn = readConnection();
    if (!conn) return false;
    if (conn.saveData === true) return true;
    const type = (conn.effectiveType ?? "").toLowerCase();
    if (type === "slow-2g" || type === "2g") return true;
    if (typeof conn.downlink === "number" && conn.downlink > 0 && conn.downlink < 0.5)
      return true;
    return false;
  } catch {
    return false;
  }
}

function holdImage(img: HTMLImageElement): void {
  if (img.dataset.liteSrc) return;
  // Already loaded images cost nothing more — leave them alone.
  if (img.complete && img.naturalWidth > 0) return;
  const src = img.currentSrc || img.src;
  if (!src || src.startsWith("data:")) return;
  img.dataset.liteSrc = src;
  const srcset = img.getAttribute("srcset");
  if (srcset) img.dataset.liteSrcset = srcset;
  img.removeAttribute("srcset");
  img.src = PIXEL;
}

function releaseImage(img: HTMLImageElement): void {
  const original = img.dataset.liteSrc;
  if (!original) return;
  delete img.dataset.liteSrc;
  const srcset = img.dataset.liteSrcset;
  delete img.dataset.liteSrcset;
  if (srcset) img.setAttribute("srcset", srcset);
  img.src = original;
}

function holdPendingImages(): void {
  try {
    document.querySelectorAll("img").forEach((img) => {
      holdImage(img as HTMLImageElement);
    });
  } catch {
    // Non-fatal.
  }
}

function releaseAllImages(): void {
  try {
    document.querySelectorAll("img[data-lite-src]").forEach((img) => {
      releaseImage(img as HTMLImageElement);
    });
  } catch {
    // Non-fatal.
  }
}

function pauseVideos(): void {
  try {
    document.querySelectorAll("video").forEach((video) => {
      const v = video as HTMLVideoElement;
      try {
        if (!v.paused) v.pause();
      } catch {
        // Non-fatal.
      }
    });
  } catch {
    // Non-fatal.
  }
}

export default function LiteModeProvider({ children }: { children: ReactNode }) {
  const [lite, setLite] = useState(false);

  // Detection: browser offline/Data-Saver/2G signals + change events +
  // lightweight 15s re-check (reads the Network Information API only —
  // no probe traffic). Flipping state re-renders — no page refresh, so a
  // restored connection auto-switches back to the full version.
  useEffect(() => {
    const evaluate = () => setLite(computeLite());
    evaluate();
    const conn = readConnection();
    window.addEventListener("online", evaluate);
    window.addEventListener("offline", evaluate);
    conn?.addEventListener?.("change", evaluate);
    const timer = window.setInterval(evaluate, 15_000);
    return () => {
      window.removeEventListener("online", evaluate);
      window.removeEventListener("offline", evaluate);
      conn?.removeEventListener?.("change", evaluate);
      window.clearInterval(timer);
    };
  }, []);

  // Apply / lift the lite version without a refresh.
  useEffect(() => {
    try {
      document.documentElement.dataset.litemode = lite ? "1" : "0";
    } catch {
      // Non-fatal.
    }
    if (lite) {
      holdPendingImages();
      pauseVideos();
    } else {
      // Connection restored → held images load back automatically.
      releaseAllImages();
    }
  }, [lite]);

  // While lite: hold images added later (route changes, lazy lists) and
  // pause autoplaying videos. Tap-to-load: tapping a held image loads
  // just that one.
  useEffect(() => {
    if (!lite) return;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node instanceof HTMLImageElement) holdImage(node);
          node.querySelectorAll?.("img").forEach((img) => {
            holdImage(img as HTMLImageElement);
          });
          if (node instanceof HTMLVideoElement) {
            try {
              if (!node.paused) node.pause();
            } catch {
              // Non-fatal.
            }
          }
          node.querySelectorAll?.("video").forEach((video) => {
            const v = video as HTMLVideoElement;
            try {
        if (!v.paused) v.pause();
      } catch {
        // Non-fatal.
      }
          });
        });
      }
    });
    const onTap = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const img = target?.closest?.("img[data-lite-src]") as HTMLImageElement | null;
      if (img) {
        event.preventDefault();
        releaseImage(img);
      }
    };
    try {
      observer.observe(document.body, { childList: true, subtree: true });
    } catch {
      // Non-fatal.
    }
    document.addEventListener("click", onTap, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", onTap, true);
    };
  }, [lite]);

  return <LiteModeContext.Provider value={lite}>{children}</LiteModeContext.Provider>;
}

/**
 * Tiny "LITE" pill pinned precisely to the upper-right corner of the logo.
 * Renders nothing once the connection is restored.
 */
export function LiteBadge() {
  const lite = useLiteMode();
  if (!lite) return null;
  return (
    <span
      aria-label="Lite mode — slow connection"
      title="Slow connection — showing the lite version"
      className="absolute -right-3 -top-2 rounded-md border border-amber-400/60 bg-amber-400 px-1.5 py-px text-[9px] font-extrabold leading-tight tracking-widest text-amber-950 shadow"
    >
      LITE
    </span>
  );
}
