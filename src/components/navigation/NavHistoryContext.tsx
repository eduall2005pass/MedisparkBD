"use client";

// Global in-app navigation history — the SINGLE navigation-history system
// synchronizing all three back channels:
//   Internal Website Navigation → Application Route History
//   → Browser Back / Android System Back.
//
// What it does:
// - Tracks the visited pathname trail (session-only, in-memory) so Back can
//   prefer the real previous page (filters/scroll preserved via router.back())
//   and only falls back to the hierarchical parent when there is no in-app
//   history (e.g. deep link / refresh). Never pushes duplicate entries.
// - Owns the explicit-parent registry (see ./route-parents): pages with an
//   unambiguous logical parent (Q&A subject → Q&A Main) ALWAYS resolve Back
//   to that parent — via custom Back AND via Browser/Android Back — never to
//   generic previous history (never history.back() / navigate(-1) for them).
// - Global popstate guard: when Back starts from an explicit-child page and
//   the browser would land anywhere except its parent (Home/Exam/Dashboard/
//   random route), it redirects to the explicit parent with router.push —
//   append-only, so no duplicate entries and no loops. Every other popstate
//   passes through untouched (other sections keep native behavior).
// - Never active during an exam lock: the existing exam back-trap,
//   exit-confirmation, timer, answers and auto-submit are fully preserved
//   (exam pages are not registered as explicit children anyway).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useExamLock } from "@/components/exam/ExamLockContext";
import {
  explicitParentFor,
  splitUrl,
} from "@/components/navigation/route-parents";

const MAX_ENTRIES = 30;

type NavHistoryValue = {
  /** True when a real in-app previous page exists (Back will use history). */
  canGoBack: boolean;
  /** Go to the previous page, or to `fallbackHref` when history is empty. */
  goBack: (fallbackHref: string) => void;
};

function fallbackNavigate(fallbackHref: string) {
  if (typeof window === "undefined") return;
  if (!fallbackHref || window.location.pathname === fallbackHref) return;
  if (window.history.length > 1) {
    window.history.back();
    return;
  }
  window.location.href = fallbackHref;
}

const NavHistoryContext = createContext<NavHistoryValue>({
  canGoBack: false,
  goBack: fallbackNavigate,
});

export function useNavHistory(): NavHistoryValue {
  return useContext(NavHistoryContext);
}

function currentFullUrl(): string {
  try {
    return window.location.pathname + window.location.search;
  } catch {
    return "";
  }
}

/**
 * Mount ONCE near the root (inside ExamLockProvider). Tracks full URL
 * changes: true back steps pop, forward steps push, replaces/duplicates
 * are ignored — the stack always mirrors the logical in-app trail.
 * Additionally enforces explicit-parent Back for registered child pages
 * across Browser Back and Android system Back (same popstate mechanism).
 */
export function NavHistoryProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isLocked } = useExamLock();
  const isLockedRef = useRef(isLocked);
  const stackRef = useRef<string[]>([]);
  const [depth, setDepth] = useState(0);

  const currentUrl = useMemo(() => {
    if (!pathname) return "";
    const search = searchParams?.toString();
    return search ? `${pathname}?${search}` : pathname;
  }, [pathname, searchParams]);

  // Full current URL (path + search), refreshed after EVERY render so the
  // popstate guard always knows which page Back started from. Read from
  // window.location directly (client-only effect) so no Suspense boundary
  // is needed anywhere up the tree.
  const fromRef = useRef<string>("");

  useEffect(() => {
    isLockedRef.current = isLocked;
  }, [isLocked]);

  useEffect(() => {
    const full = currentFullUrl();
    if (full) fromRef.current = full;
  });

  useEffect(() => {
    if (!currentUrl) return;
    const stack = stackRef.current;
    const top = stack[stack.length - 1];
    if (top === currentUrl) return; // replace / same-page: ignore
    if (stack.length >= 2 && stack[stack.length - 2] === currentUrl) {
      stack.pop(); // true back step: pop
    } else {
      stack.push(currentUrl); // forward step: push
      if (stack.length > MAX_ENTRIES) stack.splice(0, stack.length - MAX_ENTRIES);
    }
    setDepth(stack.length);
  }, [currentUrl]);

  // Browser Back / Android system Back enforcement for explicit-child pages.
  // Native pops that already land on the explicit parent (or start from a
  // page without one) are left completely untouched.
  useEffect(() => {
    const onPopState = () => {
      // Active exam: the existing exam lock trap owns Back — never interfere
      // (exit-confirmation, timer, answers, auto-submit all preserved).
      if (isLockedRef.current) return;
      const from = fromRef.current;
      const to = currentFullUrl();
      if (!from || !to || from === to) return;
      const { pathname: fromPath, search: fromSearch } = splitUrl(from);
      const parent = explicitParentFor(fromPath, fromSearch);
      if (!parent) return; // no explicit parent → native behavior
      const { pathname: toPath, search: toSearch } = splitUrl(to);
      if (explicitParentFor(toPath, toSearch) != null) return; // forward into a child — legitimate
      const { pathname: parentPath } = splitUrl(parent);
      if (toPath === parentPath) return; // already on the explicit parent
      // Back would land on a foreign page (pre-Q&A Home/Exam/Dashboard/
      // random route) → redirect to the explicit parent. push() is
      // append-only: no entry is destroyed, no duplicate is created, and no
      // loop is possible (the parent itself has no explicit parent).
      try {
        router.push(parent);
      } catch {
        // If the redirect fails, the child page's own URL-sync keeps state
        // consistent with wherever the browser landed.
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [router]);

  const goBack = useCallback(
    (fallbackHref: string) => {
      // 1. Explicit parent wins over generic history: registered child pages
      //    (Q&A subject → Q&A Main) always resolve to their logical parent
      //    via an explicit route — never history.back() / navigate(-1).
      //    replace() removes the child entry, so Back on the parent can
      //    never loop back into the child.
      const current = currentFullUrl();
      if (current) {
        const { pathname: currentPath, search: currentSearch } =
          splitUrl(current);
        const parent = explicitParentFor(currentPath, currentSearch);
        if (parent && current !== parent) {
          router.replace(parent, { scroll: false });
          return;
        }
      }
      // 2. History-first (existing behavior, untouched for all other pages):
      //    real previous page with filters + scroll preserved.
      const stack = stackRef.current;
      if (stack.length >= 2) {
        router.back(); // real previous page: filters + scroll preserved
        return;
      }
      if (!fallbackHref || pathname === fallbackHref) return; // never loop
      router.push(fallbackHref); // no history: hierarchical parent
    },
    [pathname, router],
  );

  const value = useMemo(
    () => ({ canGoBack: depth >= 2, goBack }),
    [depth, goBack],
  );

  return <NavHistoryContext.Provider value={value}>{children}</NavHistoryContext.Provider>;
}
