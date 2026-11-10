import { format, isToday } from "date-fns";

import type { Thresholds, Unit } from "./api";
import type { ThemeColors } from "./theme";

const MMOL = 18.0182;

export const unitLabel = (u: Unit) => (u === "mmol" ? "mmol/L" : "mg/dL");

export function toDisplay(mg: number, unit: Unit): string {
  return unit === "mmol" ? (mg / MMOL).toFixed(1) : String(Math.round(mg));
}

export function fromDisplay(text: string, unit: Unit): number | null {
  const n = parseFloat(text.replace(",", "."));
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(unit === "mmol" ? n * MMOL : n);
}

export function deltaText(delta: number | null, unit: Unit): string {
  if (delta === null) return "";
  const v = unit === "mmol" ? (delta / MMOL).toFixed(1) : String(Math.round(delta));
  return `${delta >= 0 ? "+" : ""}${v} ${unitLabel(unit)}`;
}

const ARROWS: Record<string, string> = {
  DoubleUp: "⇈",
  SingleUp: "↑",
  FortyFiveUp: "↗",
  Flat: "→",
  FortyFiveDown: "↘",
  SingleDown: "↓",
  DoubleDown: "⇊",
};
export const arrow = (direction: string) => ARROWS[direction] ?? "";

export function levelColor(mg: number, t: Thresholds, colors: ThemeColors): string {
  if (mg < t.target_low) return colors.low;
  if (mg > t.target_high) return colors.high;
  return colors.inRange;
}

export const fmtTime = (d: Date | string) => format(new Date(d), "HH:mm");
export const fmtDateTime = (d: Date | string) =>
  isToday(new Date(d)) ? format(new Date(d), "HH:mm") : format(new Date(d), "MMM d, HH:mm");

export function minutesAgo(d: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000));
}

export function agoText(d: string): string {
  const m = minutesAgo(d);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

export const SOURCE_LABELS: Record<string, string> = {
  demo: "Demo sensor",
  manual: "Manual entry",
  bluetooth: "Bluetooth sensor",
  nightscout: "Nightscout",
  dexcom: "Dexcom Share",
  libre: "LibreLinkUp",
};
