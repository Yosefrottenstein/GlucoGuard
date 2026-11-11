// Android "Companion app" mode: glucose read from the notifications of Dexcom, Libre, Omnipod, CamAPS… on this phone.
// Needs the installed Android app with Notification access turned on. Not available in Expo Go, web or iPhone.
import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

import { api } from "./api";
import { queryClient } from "./query-client";

type Native = {
  hasAccess(): boolean;
  openAccessSettings(): void;
  drain(): string;
  lastSource(): string | null;
  configure(baseUrl: string, token: string): void;
};
const native = Platform.OS === "android" ? requireOptionalNativeModule<Native>("CompanionGlucose") : null;

export const companionSupported = !!native;
export const companionHasAccess = () => !!native?.hasAccess();
export const openCompanionAccess = () => native?.openAccessSettings();
/** Empty url/token turns background uploading off (e.g. signed out or another source chosen). */
export const configureCompanion = (baseUrl: string, token: string | null) => native?.configure(baseUrl, token ?? "");

const APP_NAMES: [string, string][] = [
  ["com.dexcom.", "Dexcom"],
  ["com.freestylelibre", "FreeStyle Libre"],
  ["com.abbott.", "Abbott"],
  ["com.insulet.", "Omnipod"],
  ["com.camdiab.", "CamAPS FX"],
  ["com.senseonics.", "Eversense"],
  ["com.medtrum.", "Medtrum"],
  ["com.betabionics", "Beta Bionics iLet"],
  ["com.sequel", "twiist"],
  ["com.tandemdiabetes.", "Tandem"],
  ["com.medtronic.", "Medtronic"],
  ["com.microtechmd.", "MicroTech"],
  ["com.sinocare.", "Sinocare"],
];
export const companionSourceName = () => {
  const pkg = native?.lastSource();
  return pkg ? (APP_NAMES.find(([p]) => pkg.startsWith(p))?.[1] ?? pkg) : null;
};

const direction = (perMin: number) =>
  perMin <= -3 ? "DoubleDown" : perMin <= -2 ? "SingleDown" : perMin <= -1 ? "FortyFiveDown" : perMin < 1 ? "Flat" : perMin < 2 ? "FortyFiveUp" : perMin < 3 ? "SingleUp" : "DoubleUp";

let last: { ts: number; sgv: number } | null = null;
let failed: { ts: string; sgv: number; direction: string }[] = [];

/** Uploads values the notification listener collected; keeps about one reading per 5 minutes. */
export async function drainCompanion() {
  if (!native) return;
  const items = JSON.parse(native.drain() || "[]") as { ts: number; sgv: number }[];
  const out = [...failed];
  for (const it of items) {
    if (last && it.ts - last.ts < 270000) continue;
    const dir = last && it.ts - last.ts < 900000 ? direction((it.sgv - last.sgv) / ((it.ts - last.ts) / 60000)) : "NONE";
    out.push({ ts: new Date(it.ts).toISOString(), sgv: it.sgv, direction: dir });
    last = it;
  }
  if (!out.length) return;
  try {
    await api("/readings/batch", { method: "POST", body: { readings: out, source: "companion" } });
    failed = [];
    queryClient.invalidateQueries({ queryKey: ["status"] });
    queryClient.invalidateQueries({ queryKey: ["readings"] });
  } catch {
    failed = out.slice(-500);
  }
}
