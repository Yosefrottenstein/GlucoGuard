// Design tokens for this app (light theme, from /app/design_guidelines.json).
import { useMemo, useSyncExternalStore } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FDFBF7",
  onSurface: "#1C2B2D",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#1C2B2D",
  surfaceTertiary: "#F4EFE6",
  onSurfaceTertiary: "#2C4446",
  surfaceInverse: "#1C2B2D",
  onSurfaceInverse: "#FDFBF7",
  muted: "#748C8E",

  brand: "#2B7A78",
  onBrand: "#FFFFFF",
  brandPrimary: "#2B7A78",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#E2F1F0",
  onBrandSecondary: "#1F5F5D",
  brandTertiary: "#E2F1F0",
  onBrandTertiary: "#1F5F5D",

  success: "#4E9F76",
  onSuccess: "#FFFFFF",
  warning: "#D97706",
  onWarning: "#FFFFFF",
  error: "#D32F2F",
  onError: "#FFFFFF",
  info: "#4A8C8E",
  onInfo: "#FFFFFF",

  border: "#E9E3D9",
  borderStrong: "#D1C7B7",
  divider: "#E9E3D9",

  // glucose ranges (graph dots): red low, sage green in range, amber high
  inRange: "#4E9F76",
  high: "#D97706",
  low: "#D32F2F",
  // treatment markers
  insulin: "#E07A5F",
  carbs: "#F4A261",
  scrim: "rgba(28, 43, 45, 0.4)",
};

export type ThemeColors = typeof light;

// Night mode: deep blue-green surfaces, softer text, same glucose colour meanings (slightly brighter to read in the dark)
const dark: ThemeColors = {
  surface: "#0E181A",
  onSurface: "#E6EFEE",
  surfaceSecondary: "#162326",
  onSurfaceSecondary: "#E6EFEE",
  surfaceTertiary: "#1E2E31",
  onSurfaceTertiary: "#B3C5C3",
  surfaceInverse: "#E6EFEE",
  onSurfaceInverse: "#0E181A",
  muted: "#7E9694",

  brand: "#4FB3AE",
  onBrand: "#0E181A",
  brandPrimary: "#4FB3AE",
  onBrandPrimary: "#0E181A",
  brandSecondary: "#1F3A3B",
  onBrandSecondary: "#9ED9D5",
  brandTertiary: "#1F3A3B",
  onBrandTertiary: "#9ED9D5",

  success: "#5FBF8C",
  onSuccess: "#0E181A",
  warning: "#F0A23B",
  onWarning: "#0E181A",
  error: "#F06262",
  onError: "#0E181A",
  info: "#6BB3B5",
  onInfo: "#0E181A",

  border: "#26383B",
  borderStrong: "#36504F",
  divider: "#223235",

  inRange: "#5FBF8C",
  high: "#F0A23B",
  low: "#F06262",
  insulin: "#EE8F75",
  carbs: "#F4B37A",
  scrim: "rgba(0, 0, 0, 0.6)",
};

export const fonts = { display: "SpaceGrotesk", text: "PlusJakartaSans" };
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 8, md: 14, lg: 22, pill: 999 };

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light, dark };

// User choice: "system" follows the phone, or force light/dark. Saved by src/appearance.ts.
export type AppearancePref = "system" | ColorScheme;
let pref: AppearancePref = "system";
const prefListeners = new Set<() => void>();
export const getAppearancePref = () => pref;
export function setAppearancePref(p: AppearancePref) {
  pref = p;
  setColorScheme(p === "system" ? null : p);
  prefListeners.forEach((l) => l());
}
const subscribePref = (l: () => void) => {
  prefListeners.add(l);
  return () => prefListeners.delete(l);
};
export const useAppearancePref = () => useSyncExternalStore(subscribePref, getAppearancePref);

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const p = useAppearancePref();
  const wanted = p === "system" ? system : p;
  const scheme: ColorScheme = (wanted === "light" || wanted === "dark") && themes[wanted] ? wanted : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
