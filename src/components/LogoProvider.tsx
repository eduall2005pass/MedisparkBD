"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { LogoInfo } from "@/lib/logo";
import { DEFAULT_LOGO } from "@/lib/logo";

export type ThemeLogos = {
  light: LogoInfo | null;
  dark: LogoInfo | null;
};

type LogoContextValue = {
  /** Shared/fallback logo — shown when no theme-specific variant is set. */
  logo: LogoInfo;
  /** LIGHT MODE logo uploaded by the admin (null = not set). */
  light: LogoInfo | null;
  /** DARK MODE logo uploaded by the admin (null = not set). */
  dark: LogoInfo | null;
  isCustom: boolean;
  refresh: () => Promise<void>;
};

const LogoContext = createContext<LogoContextValue>({
  logo: DEFAULT_LOGO,
  light: null,
  dark: null,
  isCustom: false,
  refresh: async () => {},
});

export function useLogo() {
  return useContext(LogoContext);
}

export function LogoProvider({
  children,
  initialLogo,
  initialThemeLogos,
}: {
  children: ReactNode;
  initialLogo: LogoInfo | null;
  initialThemeLogos?: ThemeLogos;
}) {
  const [active, setActive] = useState<LogoInfo>(initialLogo ?? DEFAULT_LOGO);
  const [light, setLight] = useState<LogoInfo | null>(
    initialThemeLogos?.light ?? null,
  );
  const [dark, setDark] = useState<LogoInfo | null>(
    initialThemeLogos?.dark ?? null,
  );

  // Keep SSR initial values in sync if server renders newer data on navigation/refresh
  useEffect(() => {
    if (!initialLogo) return;
    queueMicrotask(() => {
      setActive(initialLogo);
    });
  }, [initialLogo]);

  useEffect(() => {
    if (!initialThemeLogos) return;
    queueMicrotask(() => {
      setLight(initialThemeLogos.light);
      setDark(initialThemeLogos.dark);
    });
  }, [initialThemeLogos]);

  // Explicit refresh only — called by admin LogoManager after upload/remove.
  // No auto-refetch on mount/focus/visibility: SSR initialLogo is the source
  // of truth (server cache busts instantly via revalidateTag on upload), so
  // background refetching only spams /api/logo function invocations and
  // causes logo flicker on every tab switch.
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/logo`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as {
        logo: LogoInfo | null;
        light?: LogoInfo | null;
        dark?: LogoInfo | null;
      };
      setActive(data.logo ?? DEFAULT_LOGO);
      setLight(data.light ?? null);
      setDark(data.dark ?? null);
    } catch {
      return;
    }
  }, []);

  // SSR props are the source of truth -- synced via the effects above.
  // No background refetch here (fixes flicker + /api/logo spam on tab focus).

  const isCustom =
    active.fileName !== "default" || light !== null || dark !== null;

  return (
    <LogoContext.Provider
      value={{ logo: active, light, dark, isCustom, refresh }}
    >
      {children}
    </LogoContext.Provider>
  );
}
