// Dexcom G7 / ONE+ / Stelo direct Bluetooth reader.
// Works like Loop's G7SensorKit and xDrip4iOS: the official Dexcom app stays installed and handles
// starting the sensor and its security handshake. This app connects to the same sensor and listens to
// the glucose message the sensor sends every 5 minutes.
import { useSyncExternalStore } from "react";

import { api } from "./api";
import { bleSupported, getManager } from "./ble";
import { queryClient } from "./query-client";

export const G7 = {
  ADVERTISEMENT: "FEBC",
  CGM: "F8083532-849E-531C-C594-30F1F86A4EA5",
  CONTROL: "F8083534-849E-531C-C594-30F1F86A4EA5",
  AUTH: "F8083535-849E-531C-C594-30F1F86A4EA5",
  BACKFILL: "F8083536-849E-531C-C594-30F1F86A4EA5",
};

export type G7Status = {
  state: "idle" | "searching" | "connected" | "error";
  message: string;
  deviceName?: string;
  lastValue?: number;
  lastReadingAt?: number;
  sensorState?: string;
};

let status: G7Status = { state: "idle", message: "Not started" };
const listeners = new Set<() => void>();
const setStatus = (p: Partial<G7Status>) => {
  status = { ...status, ...p };
  listeners.forEach((l) => l());
};
export const useG7Status = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );

const STATES: Record<number, string> = {
  1: "Sensor stopped",
  2: "Sensor warming up",
  3: "Sensor signal noisy",
  6: "OK",
  15: "Session expired",
  18: "Temporary sensor issue",
  24: "Sensor expired",
  25: "Sensor failed",
  26: "Session ended",
};

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

function trendToDirection(t: number | null): string {
  if (t === null) return "NONE";
  if (t <= -3) return "DoubleDown";
  if (t <= -2) return "SingleDown";
  if (t <= -1) return "FortyFiveDown";
  if (t < 1) return "Flat";
  if (t < 2) return "FortyFiveUp";
  if (t < 3) return "SingleUp";
  return "DoubleUp";
}

// Byte layout from LoopKit G7SensorKit (G7GlucoseMessage):
// 0:0x4E 1:status 2-5:timestamp 6-7:sequence 10-11:age(s) 12-13:glucose 14:algorithm state 15:trend 16-17:predicted
export function parseG7Glucose(bytes: Uint8Array, receivedAt: number) {
  if (bytes.length < 19 || bytes[0] !== 0x4e || bytes[1] !== 0) return null;
  const u16 = (i: number) => bytes[i] | (bytes[i + 1] << 8);
  const algorithm = bytes[14];
  const raw = u16(12);
  const trendByte = bytes[15];
  const trend = trendByte === 0x7f ? null : ((trendByte << 24) >> 24) / 10;
  return {
    sequence: u16(6),
    algorithm,
    // bytes 2-5: seconds since the sensor was started -> sensor start time
    activatedAt: new Date(receivedAt - (bytes[2] | (bytes[3] << 8) | (bytes[4] << 16) | ((bytes[5] << 24) >>> 0)) * 1000),
    sgv: raw === 0xffff || algorithm !== 6 ? null : raw & 0xfff,
    ts: new Date(receivedAt - u16(10) * 1000).toISOString(),
    direction: trendToDirection(trend),
  };
}

let running = false;
let connecting = false;
let activationHandler: ((d: Date) => void) | null = null;
export const setG7ActivationHandler = (fn: (d: Date) => void) => {
  activationHandler = fn;
};
let timer: ReturnType<typeof setTimeout> | null = null;
let subs: { remove: () => void }[] = [];
let pending: { ts: string; sgv: number; direction: string }[] = [];
let lastSequence = -1;

async function flush() {
  if (!pending.length) return;
  const batch = pending;
  pending = [];
  try {
    await api("/readings/batch", { method: "POST", body: { readings: batch } });
    queryClient.invalidateQueries({ queryKey: ["status"] });
    queryClient.invalidateQueries({ queryKey: ["readings"] });
  } catch {
    pending = [...batch, ...pending].slice(-500); // keep for the next try (offline)
  }
}

function onControl(b64: string | null | undefined) {
  if (!b64) return;
  const msg = parseG7Glucose(fromBase64(b64), Date.now());
  if (!msg || msg.sequence === lastSequence) return;
  lastSequence = msg.sequence;
  setStatus({ sensorState: STATES[msg.algorithm] ?? `State ${msg.algorithm}` });
  activationHandler?.(msg.activatedAt);
  if (msg.sgv === null) return;
  pending.push({ ts: msg.ts, sgv: msg.sgv, direction: msg.direction });
  setStatus({ lastValue: msg.sgv, lastReadingAt: Date.now() });
  flush();
}

function clearSubs() {
  subs.forEach((s) => s.remove());
  subs = [];
}

async function connect(id: string) {
  if (connecting || !running) return;
  connecting = true;
  const m = getManager();
  try {
    m.stopDeviceScan();
    let device;
    try {
      device = await m.connectToDevice(id, { timeout: 15000 });
    } catch (e) {
      if (!(await m.isDeviceConnected(id))) throw e;
      device = (await m.devices([id]))[0];
    }
    await device.discoverAllServicesAndCharacteristics();
    clearSubs();
    for (const ch of [G7.AUTH, G7.CONTROL, G7.BACKFILL]) {
      subs.push(
        device.monitorCharacteristicForService(G7.CGM, ch, (err: any, c: any) => {
          if (!err && ch === G7.CONTROL) onControl(c?.value);
        }),
      );
    }
    subs.push(
      m.onDeviceDisconnected(id, () => {
        clearSubs();
        setStatus({ state: "searching", message: "Waiting for the next reading" });
      }),
    );
    setStatus({ state: "connected", message: "Connected, listening", deviceName: device.name ?? device.localName ?? "G7" });
    flush();
  } catch {
    setStatus({ state: "searching", message: "Waiting for the sensor (it wakes every 5 minutes)" });
  } finally {
    connecting = false;
  }
}

async function loop(savedId?: string) {
  if (!running) return;
  const m = getManager();
  const state = await m.state();
  if (state === "Unauthorized") setStatus({ state: "error", message: "Allow Bluetooth for xDrip in iPhone Settings" });
  else if (state !== "PoweredOn") setStatus({ state: "error", message: "Bluetooth is off" });
  else if (status.state !== "connected") {
    // Already connected by the Dexcom app? iOS lets us share that connection.
    const connected = await m.connectedDevices([G7.CGM]).catch(() => []);
    const match = connected.find((d: any) => !savedId || d.id === savedId);
    if (match) await connect(match.id);
    else {
      setStatus({ state: "searching", message: "Searching for your G7" });
      m.startDeviceScan([G7.ADVERTISEMENT], null, (err: any, d: any) => {
        const name: string = d?.localName ?? d?.name ?? "";
        if (!err && d && name.startsWith("DXCM") && (!savedId || d.id === savedId)) connect(d.id);
      });
    }
  }
  flush();
  timer = setTimeout(() => loop(savedId), 30000);
}

export function startG7(savedId?: string) {
  if (!bleSupported || running) return;
  running = true;
  loop(savedId);
}

export function stopG7() {
  running = false;
  if (timer) clearTimeout(timer);
  clearSubs();
  getManager()?.stopDeviceScan();
  setStatus({ state: "idle", message: "Stopped" });
}
