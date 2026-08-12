import { THEME_STORAGE_KEY, type ResolvedTheme, type ThemeMode } from "../types";

export const systemThemeQuery = window.matchMedia("(prefers-color-scheme: light)");

export function detectInitialThemeMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light" || stored === "system") {
      return stored;
    }
  } catch {}
  return "system";
}

export function resolveTheme(themeMode: ThemeMode): ResolvedTheme {
  return themeMode === "system" ? (systemThemeQuery.matches ? "light" : "dark") : themeMode;
}

export function applyTheme(themeMode: ThemeMode, persist = true): void {
  try {
    const resolvedTheme = resolveTheme(themeMode);
    document.documentElement.setAttribute("data-theme", resolvedTheme);
    document.documentElement.setAttribute("data-theme-mode", themeMode);
    document.documentElement.style.colorScheme = resolvedTheme;
    if (persist) {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    }
  } catch {}
}
