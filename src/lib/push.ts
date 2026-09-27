"use client";

// Dynamic import for firebase/messaging to keep it out of initial bundle (slow network optimization)
// Main bundle stays lightweight; messaging code only loads when user enables push.
async function getMessagingModule() {
  return import("firebase/messaging");
}

// Browser-side push subscription. The VAPID key must match the "Web Push
// certificates" configured in Firebase Console → Cloud Messaging.

const VAPID_KEY =
  process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ??
  "";

export type PushPermissionState = "unsupported" | "denied" | "default" | "granted" | "error";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "Notification" in window &&
    VAPID_KEY.length > 0
  );
}

export function currentPushState(): PushPermissionState {
  if (!isPushSupported()) return "unsupported";
  const permission = Notification.permission;
  if (permission === "granted") return "granted";
  if (permission === "denied") return "denied";
  return "default";
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  // Single root-scope worker: PWA asset cache + Firebase push together.
  // (Legacy /firebase-messaging-sw.js registrations are superseded by scope.)
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  return registration;
}

/** Ask permission, obtain an FCM token and register it with the backend. */
export async function enablePushNotifications(
  authHeaders: Record<string, string>,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (!isPushSupported()) {
    return { ok: false, error: "This browser does not support push notifications." };
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { ok: false, error: "Notification permission was not granted." };
    }
    const { isSupported: isSupportedMsg, getMessaging, getToken } = await getMessagingModule();
    if (!(await isSupportedMsg())) {
      return { ok: false, error: "Push messaging is not supported in this browser." };
    }
    const registration = await registerServiceWorker();
    // Drop any existing push subscription so the new one is always created
    // with the current VAPID key (stale subscriptions from a previous key
    // would make getToken() fail or return an unusable token).
    const existing = await registration.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();
    let token = "";
    try {
      token = await getToken(getMessaging(), {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Token generation failed: ${detail}` };
    }
    if (!token) {
      return { ok: false, error: "Could not obtain a registration token." };
    }
    const response = await fetch("/api/push/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        token,
        userAgent: navigator.userAgent,
      }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: data?.error ?? `Save failed (HTTP ${response.status}).` };
    }
    return { ok: true, token };
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { ok: false, error: `Push setup failed — ${detail}` };
  }
}

/** Remove the browser's token from the backend. */
export async function disablePushNotifications(
  authHeaders: Record<string, string>,
): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    let token: string | null = null;
    const { isSupported: isSupportedMsg, getMessaging, getToken } = await getMessagingModule();
    if (registration && VAPID_KEY && await isSupportedMsg()) {
      token = await getToken(getMessaging(), {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration,
      }).catch(() => null);
    }
    const response = await fetch("/api/push/tokens", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(token ? { token } : {}),
    });
    return response.ok || !token;
  } catch {
    return false;
  }
}
