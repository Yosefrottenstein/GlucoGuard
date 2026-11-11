// Direct Bluetooth access to CGM sensors (Master mode).
// Works only in an installed build (TestFlight / App Store); not in Expo Go or the web preview.
import Constants, { ExecutionEnvironment } from "expo-constants";
import { PermissionsAndroid, Platform } from "react-native";

import type { SensorType } from "./api";

export const bleSupported =
  Platform.OS !== "web" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

export type FoundDevice = { id: string; name: string; rssi: number | null };

export const SENSORS: Record<SensorType, { label: string; hint: string; match: (name: string, tx: string) => boolean }> = {
  dexcom_g6: {
    label: "Dexcom G6 / ONE",
    hint: "Enter the 6-character transmitter ID printed on the transmitter.",
    match: (n, tx) => n.startsWith("Dexcom") && (!tx || n.endsWith(tx.slice(-2).toUpperCase())),
  },
  dexcom_g7: {
    label: "Dexcom G7 / ONE+",
    hint: "Keep the official Dexcom G7 app installed and running. It starts the sensor and handles its security; GlucoGuard listens to the same sensor.",
    match: (n) => n.startsWith("DXCM"),
  },
  libre2: {
    label: "Libre 2 / 2 Plus",
    hint: "Scan the sensor once with your phone's NFC to switch on Bluetooth, then readings arrive every minute. Works with Libre 2 and European Libre 2 Plus. The Libre app can't stream at the same time.",
    match: (n) => n.startsWith("ABBOTT"),
  },
  libre3: {
    label: "Libre 3 / 3 Plus",
    hint: "Libre 3 uses strong encryption that no open-source app (including xDrip+) can read directly. Use LibreLinkUp in Follower mode instead.",
    match: () => false,
  },
};

let manager: any = null;

export function getManager(): any {
  if (!bleSupported) return null;
  if (!manager) {
    // Lazy require: the native module doesn't exist in Expo Go / web.
    const { BleManager } = require("react-native-ble-plx");
    manager = new BleManager({ restoreStateIdentifier: "xdrip-ble", restoreStateFunction: () => {} });
  }
  return manager;
}

export type PermResult = "granted" | "denied" | "blocked";

export async function requestAndroidBluetooth(): Promise<PermResult> {
  if (Platform.OS !== "android") return "granted";
  const perms =
    Number(Platform.Version) >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const res = await PermissionsAndroid.requestMultiple(perms);
  const values = Object.values(res);
  if (values.every((v) => v === PermissionsAndroid.RESULTS.GRANTED)) return "granted";
  return values.some((v) => v === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) ? "blocked" : "denied";
}

// Resolves with the adapter state once known ("PoweredOn", "PoweredOff", "Unauthorized", ...).
export function waitForState(): Promise<string> {
  const m = getManager();
  return new Promise((resolve) => {
    const sub = m.onStateChange((state: string) => {
      if (state !== "Unknown" && state !== "Resetting") {
        sub.remove();
        resolve(state);
      }
    }, true);
  });
}

export function scan(sensor: SensorType, tx: string, onDevice: (d: FoundDevice) => void, onError: (msg: string) => void) {
  const m = getManager();
  if (sensor === "dexcom_g7") {
    // A G7 already connected by the Dexcom app doesn't advertise; iOS can still hand it to us.
    m.connectedDevices(["F8083532-849E-531C-C594-30F1F86A4EA5"])
      .then((list: any[]) => list.forEach((d) => onDevice({ id: d.id, name: d.name ?? d.localName ?? "Dexcom G7", rssi: null })))
      .catch(() => {});
  }
  m.startDeviceScan(null, { allowDuplicates: false }, (error: any, device: any) => {
    if (error) {
      onError(error.message ?? "Bluetooth scan failed");
      return;
    }
    const name: string = device?.localName ?? device?.name ?? "";
    if (device && SENSORS[sensor].match(name, tx)) onDevice({ id: device.id, name, rssi: device.rssi ?? null });
  });
  return () => m.stopDeviceScan();
}
