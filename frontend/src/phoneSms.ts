// Android only: emergency texts sent from the phone's own SIM card (like xDrip+), no Twilio needed.
// The server decides when a text is due and queues it; this phone picks it up and sends it.
// Needs an installed Android build; not available in Expo Go, the web preview or on iPhone.
import { requireOptionalNativeModule } from "expo";
import { PermissionsAndroid, Platform } from "react-native";

import { api } from "./api";

const native = Platform.OS === "android" ? requireOptionalNativeModule<{ send(phone: string, body: string): Promise<boolean> }>("DirectSms") : null;

export const phoneSmsSupported = !!native;
export const isAndroid = Platform.OS === "android";

export type SmsPerm = "granted" | "denied" | "blocked";

export async function smsPermission(): Promise<boolean> {
  if (!isAndroid) return false;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS);
}

export async function requestSmsPermission(): Promise<SmsPerm> {
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.SEND_SMS);
  if (r === PermissionsAndroid.RESULTS.GRANTED) return "granted";
  return r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? "blocked" : "denied";
}

let busy = false;

/** Sends every queued emergency text and reports the result back to the server. */
export async function drainSmsOutbox() {
  if (!native || busy) return;
  busy = true;
  try {
    const items = await api<{ id: string; to: string; body: string }[]>("/sms/outbox");
    if (!items.length) return;
    const allowed = await smsPermission();
    for (const it of items) {
      let ok = false;
      let error: string | null = null;
      if (!allowed) error = "SMS permission is off";
      else {
        try {
          ok = await native.send(it.to, it.body);
        } catch (e) {
          error = (e as Error).message?.slice(0, 180) || "send failed";
        }
      }
      await api(`/sms/outbox/${it.id}`, { method: "POST", body: { ok, error } }).catch(() => {});
    }
  } catch {
    // offline: try again on the next tick
  } finally {
    busy = false;
  }
}
