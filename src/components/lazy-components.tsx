"use client";

import dynamic from "next/dynamic";

import MediSparkLoader from "@/components/MediSparkLoader";

// Heavy PDF libraries - only load when user clicks Generate/Download
export const PdfGenerator = dynamic(
  () =>
    import("@/app/admin/material-pdf/page").then(
      (mod) => mod.default
    ),
  {
    loading: () => <MediSparkLoader size="medium" label="Loading PDF generator…" />,
    ssr: false,
  }
);

// Admin-heavy components - defer until admin panel (use MediSparkLoader, not raw pulse)
export const AdminExamManager = dynamic(
  () => import("@/components/admin/ExamManager").then((mod) => mod.default),
  {
    loading: () => <MediSparkLoader size="small" label="Loading exam manager…" />,
    ssr: false,
  }
);

export const AdminCourseManager = dynamic(
  () => import("@/components/admin/CourseManager").then((mod) => mod.default),
  {
    loading: () => <MediSparkLoader size="small" label="Loading course manager…" />,
    ssr: false,
  }
);

// Firebase Auth - preload on idle (network-aware: skip on saveData/2G)
let firebaseAuthPromise: Promise<typeof import("firebase/auth")> | null = null;

function shouldPreload(): boolean {
  if (typeof navigator === "undefined") return true;
  const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData) return false;
  if (conn?.effectiveType && (conn.effectiveType.includes("2g") || conn.effectiveType === "slow-2g")) return false;
  return true;
}

export function preloadFirebaseAuth(): void {
  if (!shouldPreload()) return;
  if (!firebaseAuthPromise) {
    firebaseAuthPromise = import("firebase/auth");
  }
}

// Preload on first user interaction — lightweight, deferred
if (typeof window !== "undefined") {
  ["click", "keydown", "mousemove", "touchstart"].forEach((evt) => {
    window.addEventListener(
      evt,
      () => {
        preloadFirebaseAuth();
      },
      { once: true, passive: true }
    );
  });
  // Idle preload after 2.5s on fast networks only
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
  const preloadIdle = () => {
    if (shouldPreload()) preloadFirebaseAuth();
  };
  if (idle) idle(preloadIdle, { timeout: 3000 });
  else setTimeout(preloadIdle, 2500);
}

export function getFirebaseAuth(): Promise<typeof import("firebase/auth")> {
  if (!firebaseAuthPromise) {
    firebaseAuthPromise = import("firebase/auth");
  }
  return firebaseAuthPromise;
}