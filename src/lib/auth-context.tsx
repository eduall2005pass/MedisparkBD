"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  browserLocalPersistence,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from "firebase/auth";
import { auth, googleProvider, isFirebaseConfigured } from "./firebase";import {
  fetchEnrollments,
  isActiveEnrollment,
  type Enrollment,
} from "./enrollments";

export type StudentProfile = {
  uid: string;
  studentId: string;
  fullName: string;
  gender: string;
  institution: string;
  hscBatch: string;
  studentLevel?: string;
  contactNumber: string;
  email: string;
  facebookUrl: string;
  profilePictureUrl: string;
  provider: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type StudentAccess = {
  registered: boolean;
  hasEnrollment: boolean;
  hasPaidEnrollment: boolean;
  /** True if the student is actively enrolled in at least one course with Q&A enabled. */
  hasQaAccess: boolean;
};

type AuthContextValue = {
  user: User | null;
  profile: StudentProfile | null;
  enrollments: Enrollment[];
  access: StudentAccess;
  authLoading: boolean;
  profileLoading: boolean;
  configured: boolean;
  /** Redirect-flow error (reactive state — survives the getRedirectResult race). */
  authError: string | null;
  signInWithGoogle: () => Promise<StudentProfile | null>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshEnrollments: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const REDIRECT_PENDING_KEY = "medispark:auth-redirect-pending";
const REDIRECT_PENDING_AT_KEY = "medispark:auth-redirect-pending-at";
const REDIRECT_ERROR_KEY = "medispark:auth-redirect-error";
const USE_REDIRECT_NEXT_KEY = "medispark:auth-use-redirect-next";

function safeGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {}
}
function safeRemove(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {}
}

function friendlyRedirectError(code: string, fallback: string): string {
  switch (code) {
    case "auth/unauthorized-domain":
      return "This website domain is not authorized for Google login. Please contact support (Firebase authorized-domains check needed).";
    case "auth/network-request-failed":
      return "Network error during Google login. Please check your connection and try again.";
    case "auth/web-storage-unsupported":
      return "Browser cookies/site-storage block kore rekheche, tai login complete hocche na. Cookies allow kore abar try koro.";
    case "auth/cancelled-popup-request":
    case "auth/user-cancelled":
      return "Google login cancelled. Please try again.";
    default:
      return fallback;
  }
}

async function fetchProfile(user: User): Promise<StudentProfile | null> {
  // Throws on token/network failure so callers can keep old state;
  // returns null only for a genuine 404 / missing profile.
  const token = await user.getIdToken();
  const response = await fetch("/api/me", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`profile fetch failed: ${response.status}`);
  const data = (await response.json()) as { profile?: StudentProfile | null };
  return data.profile ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const genRef = useRef(0);

  const loadUserData = useCallback(async (firebaseUser: User, gen?: number) => {
    setProfileLoading(true);
    try {
      // allSettled: valid enrollments still apply when profile fetch throws (and vice versa).
      const [profileResult, enrollmentsResult] = await Promise.allSettled([
        fetchProfile(firebaseUser),
        fetchEnrollments(firebaseUser),
      ]);
      // Stale async result must never clobber newer auth state.
      if (gen !== undefined && gen !== genRef.current) return null;
      let studentProfile: StudentProfile | null = null;
      if (profileResult.status === "fulfilled") {
        // null = genuine 404 / deleted profile → clear; value → set.
        // Rejected (token/network) → keep prev, touch nothing.
        studentProfile = profileResult.value;
        setProfile(studentProfile);
      }
      if (enrollmentsResult.status === "fulfilled") {
        // Genuine [] is valid → accept. Rejected → keep prev.
        setEnrollments(enrollmentsResult.value);
      }
      return profileResult.status === "fulfilled" ? studentProfile : null;
    } finally {
      if (gen === undefined || gen === genRef.current) {
        setProfileLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!auth) {
      // Firebase not configured — clear the initial loading state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAuthLoading(false);
      return;
    }
    // Pre-set persistence once on mount — NOT on click — so the popup call
    // stays a direct user gesture (await before signInWithPopup breaks the
    // gesture chain and causes browsers to block the popup as "popup-blocked").
    setPersistence(auth, browserLocalPersistence).catch(() => {
      // Ignore — signInWithGoogle will handle unsupported storage explicitly
    });

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const gen = ++genRef.current;
      setUser(firebaseUser);
      setAuthLoading(false);
      if (!firebaseUser) {
        setProfile(null);
        setEnrollments([]);
        setProfileLoading(false);
        return;
      }
      await loadUserData(firebaseUser, gen);
    });

    // Process a completed redirect sign-in. The page reloads after Google
    // returns, so this must run on mount (not only from the button handler)
    // to complete the sign-in.
    // NOTE: getRedirectResult settles ASYNC — LoginClient may already have
    // mounted before it finishes, so errors go into reactive `authError`
    // state (a sessionStorage-only handoff races and stays invisible).
    const pending = safeGet(REDIRECT_PENDING_KEY) === "1";
    const pendingAtRaw = safeGet(REDIRECT_PENDING_AT_KEY);
    const pendingAt = pendingAtRaw ? Number(pendingAtRaw) : 0;
    // Stale pending flag (e.g. tab left open, user never completed redirect)
    // should not show a scary adblock error on next visit. Treat as expired
    // after 10 minutes.
    const isStalePending = pending && pendingAt > 0 && Date.now() - pendingAt > 10 * 60 * 1000;
    if (isStalePending) {
      safeRemove(REDIRECT_PENDING_KEY);
      safeRemove(REDIRECT_PENDING_AT_KEY);
    }
    const hadPendingRedirect = pending && !isStalePending;

    let cancelled = false;
    getRedirectResult(auth)
      .then((result) => {
        if (cancelled) return;
        if (result?.user) {
          const gen = ++genRef.current;
          safeRemove(REDIRECT_PENDING_KEY);
          safeRemove(REDIRECT_PENDING_AT_KEY);
          safeRemove(REDIRECT_ERROR_KEY);
          safeRemove(USE_REDIRECT_NEXT_KEY);
          setAuthError(null);
          setUser(result.user);
          setAuthLoading(false);
          void loadUserData(result.user, gen);
          return;
        }
        // Redirect was started (pending flag set) but we came back with no
        // user — e.g. back button pressed at Google, or the browser dropped
        // the pending state. Only show error if the pending is fresh (user
        // just came back from redirect), otherwise clear silently to avoid
        // false "adblock" popup on first visit.
        if (hadPendingRedirect) {
          safeRemove(REDIRECT_PENDING_KEY);
          safeRemove(REDIRECT_PENDING_AT_KEY);
          // This is a fresh abort — show a gentle retry message, not adblock scare
          setAuthError(
            "Google login was not completed. Please click 'Continue with Google' again to try.",
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[auth] getRedirectResult failed:", err);
        safeRemove(REDIRECT_PENDING_KEY);
        safeRemove(REDIRECT_PENDING_AT_KEY);
        const code =
          typeof err === "object" && err !== null && "code" in err
            ? String((err as { code?: unknown }).code ?? "")
            : "";
        const rawMsg =
          err instanceof Error ? err.message : String(err ?? "Unknown error");
        const msg = friendlyRedirectError(code, rawMsg);
        setAuthError(msg);
        // Backup for LoginClient to show — use sessionStorage to survive the redirect
        safeSet(REDIRECT_ERROR_KEY, msg);
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loadUserData]);

  const refreshProfile = useCallback(async () => {
    if (!user) {
      setProfile(null);
      return;
    }
    setProfileLoading(true);
    try {
      const studentProfile = await fetchProfile(user);
      // null = genuine 404 / deleted → clear. Throw path below keeps prev.
      setProfile(studentProfile);
    } catch {
      // Keep old profile on token/network failure; never null it.
    } finally {
      setProfileLoading(false);
    }
  }, [user]);

  const refreshEnrollments = useCallback(async () => {
    if (!user) {
      setEnrollments([]);
      return;
    }
    try {
      const studentEnrollments = await fetchEnrollments(user);
      // Genuine [] is valid → accept. Throw path below keeps prev.
      setEnrollments(studentEnrollments);
    } catch {
      // Keep old enrollments on failure.
    }
  }, [user]);

  const signInWithGoogle = useCallback(async () => {
    if (!auth) {
      throw new Error("Firebase authentication is not configured.");
    }
    // Clear previous redirect errors on fresh attempt
    setAuthError(null);
    safeRemove(REDIRECT_ERROR_KEY);

    // If previous popup timed out (hung due to third-party cookie blocking),
    // the next click must use redirect DIRECTLY as a user gesture. Doing
    // redirect from a setTimeout loses the gesture and gets blocked.
    if (safeGet(USE_REDIRECT_NEXT_KEY) === "1") {
      safeRemove(USE_REDIRECT_NEXT_KEY);
      safeSet(REDIRECT_PENDING_KEY, "1");
      safeSet(REDIRECT_PENDING_AT_KEY, String(Date.now()));
      try {
        await signInWithRedirect(auth, googleProvider);
      } catch (redirectErr) {
        safeRemove(REDIRECT_PENDING_KEY);
        safeRemove(REDIRECT_PENDING_AT_KEY);
        throw redirectErr;
      }
      return null;
    }

    // Do NOT await setPersistence here — that breaks the user-gesture chain
    // and makes browsers treat signInWithPopup as "popup-blocked". Persistence
    // was already set on mount; best-effort try without await.
    // Only call popup SYNCHRONOUSLY in this click handler.

    // Try popup first (fast, no reload). Some browsers with strict tracking
    // protection cause the popup promise to NEVER settle — race with a
    // timeout and ask user to retry with redirect (next click will be redirect
    // as user gesture, so it won't be blocked).
    const POPUP_TIMEOUT_MS = 10_000;
    let popupTimer: ReturnType<typeof setTimeout> | null = null;
    const popupTimeout = new Promise<never>((_, reject) => {
      popupTimer = setTimeout(
        () => reject({ code: "auth/popup-timeout" }),
        POPUP_TIMEOUT_MS,
      );
    });
    try {
      const result = await Promise.race([
        signInWithPopup(auth, googleProvider),
        popupTimeout,
      ]);
      safeRemove(REDIRECT_PENDING_KEY);
      safeRemove(REDIRECT_PENDING_AT_KEY);
      safeRemove(USE_REDIRECT_NEXT_KEY);
      // Rely on onAuthStateChanged as the single source of truth for loading
      // user data — no gen bump / loadUserData here, so no double-fetch race.
      setUser(result.user);
      setAuthLoading(false);
      return null;
    } catch (err) {
      const code =
        typeof err === "object" && err !== null && "code" in err
          ? String((err as { code?: unknown }).code ?? "")
          : "";
      // Immediate fallback cases — these reject quickly while still in the
      // user-gesture window, so redirect as fallback will not be blocked.
      if (
        code === "auth/popup-blocked" ||
        code === "auth/operation-not-supported-in-this-environment"
      ) {
        safeSet(REDIRECT_PENDING_KEY, "1");
        safeSet(REDIRECT_PENDING_AT_KEY, String(Date.now()));
        try {
          await signInWithRedirect(auth, googleProvider);
        } catch (redirectErr) {
          safeRemove(REDIRECT_PENDING_KEY);
          safeRemove(REDIRECT_PENDING_AT_KEY);
          throw redirectErr;
        }
        return null;
      }
      // Popup hung — don't auto-redirect (would lose gesture and be blocked).
      // Flag next click to use redirect directly as user gesture.
      if (code === "auth/popup-timeout") {
        safeSet(USE_REDIRECT_NEXT_KEY, "1");
        throw new Error(
          "Popup didn't respond. Please click 'Continue with Google' again — next attempt will use redirect and should work in one click.",
        );
      }
      if (code === "auth/popup-closed-by-user") {
        throw new Error("Login popup closed before completing. Please try again.");
      }
      if (code === "auth/unauthorized-domain") {
        throw new Error(
          "This site's domain is not authorized for Google login. Please contact support.",
        );
      }
      if (code === "auth/web-storage-unsupported" || code === "auth/internal-error") {
        throw new Error(
          "Browser storage is blocked, so login can't complete. Please allow cookies/site data for this site and try again (no adblock needed).",
        );
      }
      if (code === "auth/network-request-failed") {
        throw new Error(
          "Network error during login. Please check your internet and try again.",
        );
      }
      throw err;
    } finally {
      if (popupTimer) clearTimeout(popupTimer);
    }
  }, [loadUserData]);

  const logout = useCallback(async () => {
    // Drop this student's offline exam snapshots so the next login on a
    // shared device never sees the previous student's cached results.
    try {
      const uid = user?.uid;
      if (uid) {
        const { clearOfflineCache } = await import("@/lib/offline-exam-cache");
        clearOfflineCache(uid);
      }
    } catch {
      // Cache cleanup must never block logout.
    }
    if (auth) {
      await signOut(auth);
    }
    genRef.current += 1;
    setUser(null);
    setProfile(null);
    setEnrollments([]);
  }, [user]);

const access = useMemo<StudentAccess>(() => {
    const activeEnrollments = enrollments.filter(isActiveEnrollment);
    return {
      registered: profile !== null,
      hasEnrollment: activeEnrollments.length > 0,
      hasPaidEnrollment: activeEnrollments.some(
        (enrollment) => enrollment.courseKind === "paid",
      ),
      hasQaAccess: activeEnrollments.some(
        (enrollment) => enrollment.qaAccess !== false,
      ),
    };
  }, [profile, enrollments]);

  const value = useMemo(
    () => ({
      user,
      profile,
      enrollments,
      access,
      authLoading,
      profileLoading,
      configured: isFirebaseConfigured,
      authError,
      signInWithGoogle,
      logout,
      refreshProfile,
      refreshEnrollments,
    }),
    [
      user,
      profile,
      enrollments,
      access,
      authLoading,
      profileLoading,
      authError,
      signInWithGoogle,
      logout,
      refreshProfile,
      refreshEnrollments,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
