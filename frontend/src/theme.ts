// Design tokens for this app (light theme, from /app/design_guidelines.json).
import { useMemo } from "react";
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

export const fonts = { display: "SpaceGrotesk", text: "PlusJakartaSans" };
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 8, md: 14, lg: 22, pill: 999 };

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = (system === "light" || system === "dark") && themes[system] ? system : defaultScheme;
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
