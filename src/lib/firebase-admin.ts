import { readFileSync } from "node:fs";
import {
  cert,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";

const serviceAccountPath =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? "";

function normalizePrivateKey(value: string): string {
  return value
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .trim();
}

let parseError: string | null = null;

function getServiceAccount(): Record<string, string> | null {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson && rawJson.length > 0) {
    try {
      const parsed = JSON.parse(rawJson) as Record<string, string>;
      if (parsed.private_key) {
        parsed.private_key = normalizePrivateKey(parsed.private_key);
      }
      parseError = null;
      return parsed;
    } catch (err) {
      // Don't hard-fail here: fall through to the individual
      // FIREBASE_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY vars so one
      // broken JSON paste can't silently disable server-side auth
      // (which makes every logged-in user look unregistered).
      parseError =
        err instanceof Error ? err.message : String(err ?? "unknown error");
    }
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (projectId && clientEmail && privateKey) {
    return {
      project_id: projectId,
      client_email: clientEmail,
      private_key: normalizePrivateKey(privateKey),
    };
  }
  if (serviceAccountPath.length > 0) {
    try {
      return JSON.parse(
        readFileSync(serviceAccountPath, "utf8"),
      ) as Record<string, string>;
    } catch {
      return null;
    }
  }
  return null;
}

let cachedServiceAccount: Record<string, string> | null | undefined;

function getCachedServiceAccount(): Record<string, string> | null {
  if (cachedServiceAccount === undefined) {
    cachedServiceAccount = getServiceAccount();
  }
  return cachedServiceAccount;
}

export const isFirebaseAdminConfigured = getCachedServiceAccount() !== null;

export function getFirebaseAdminApp(): App {
  const serviceAccount = getCachedServiceAccount();
  if (!serviceAccount) {
    throw new Error(
      parseError
        ? `Firebase Admin is not configured: FIREBASE_SERVICE_ACCOUNT_JSON is invalid (${parseError}).`
        : "Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.",
    );
  }
  if (!getApps().length) {
    initializeApp({
      credential: cert(serviceAccount as Parameters<typeof cert>[0]),
    });
  }
  return getApps()[0];
}

export function getFirebaseAdminAuth() {
  return getAuth(getFirebaseAdminApp());
}


/**
 * Verifies a Firebase ID token and returns the decoded claims, or null
 * when the token is missing or invalid.
 */
let adminMisconfigWarned = false;

export async function verifyFirebaseToken(
  token: string | null | undefined,
): Promise<DecodedIdToken | null> {
  if (!token || token.length === 0) {
    return null;
  }
  if (!isFirebaseAdminConfigured) {
    throw new Error(
      "Firebase Admin is not configured. Server APIs cannot verify users. " +
        (parseError
          ? `FIREBASE_SERVICE_ACCOUNT_JSON is invalid: ${parseError}`
          : "Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY."),
    );
  }
  try {
    return await getFirebaseAdminAuth().verifyIdToken(token, true);
  } catch {
    return null;
  }
}
