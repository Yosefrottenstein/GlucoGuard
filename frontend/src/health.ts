// iPhone only: copies GlucoGuard readings into Apple Health (blood glucose). Needs an installed iOS build.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import { api, qs } from "./api";

const ON_KEY = "health-upload";
const LAST_KEY = "health-upload-last";
export const healthPlatform = Platform.OS === "ios";

let hk: typeof import("@kingstinct/react-native-healthkit") | null = null;
function lib() {
  if (!healthPlatform) return null;
  if (!hk) {
    try {
      hk = require("@kingstinct/react-native-healthkit");
    } catch {
      return null; // Expo Go: native module missing
    }
  }
  return hk;
}

export const healthAvailable = () => {
  try {
    return !!lib()?.isHealthDataAvailable();
  } catch {
    return false;
  }
};
export const healthUploadOn = async () => (await AsyncStorage.getItem(ON_KEY)) === "on";

/** Asks iOS for write access (iOS never says if the user declined writing, so we just try). */
export async function enableHealthUpload() {
  const h = lib();
  if (!h) throw new Error("Apple Health works in the installed iPhone app, not in Expo Go or the preview.");
  await h.requestAuthorization({ toShare: ["HKQuantityTypeIdentifierBloodGlucose"] });
  await AsyncStorage.setItem(ON_KEY, "on");
  if (!(await AsyncStorage.getItem(LAST_KEY))) await AsyncStorage.setItem(LAST_KEY, new Date(Date.now() - 24 * 3600000).toISOString());
  await syncHealth();
}

export const disableHealthUpload = () => AsyncStorage.setItem(ON_KEY, "off");

let busy = false;
export async function syncHealth() {
  const h = lib();
  if (!h || busy || !(await healthUploadOn())) return 0;
  busy = true;
  try {
    const since = new Date(Math.max(Date.parse((await AsyncStorage.getItem(LAST_KEY)) ?? "") || 0, Date.now() - 89 * 86400000)).toISOString();
    const rows = await api<{ ts: string; sgv: number; source?: string }[]>(`/readings${qs({ start: since })}`);
    let n = 0;
    const sinceMs = Date.parse(since);
    for (const r of rows) {
      const at = new Date(r.ts);
      if (at.getTime() <= sinceMs || r.source === "demo") continue;
      await h.saveQuantitySample("HKQuantityTypeIdentifierBloodGlucose", "mg/dL", r.sgv, at, at);
      // remember progress after each sample so a failure part-way never duplicates
      await AsyncStorage.setItem(LAST_KEY, at.toISOString());
      n++;
    }
    return n;
  } catch {
    return 0;
  } finally {
    busy = false;
  }
}
