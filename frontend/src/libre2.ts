// FreeStyle Libre 2 / 2 Plus (EU, non-Gen2) direct Bluetooth reader.
// Same open-source approach as xDrip+, xDrip4iOS and DiaBLE: the sensor is scanned once with NFC to read its
// calibration and switch on Bluetooth streaming with our own unlock code, then it sends encrypted data every minute.
// The official Libre app can't stream from the sensor at the same time.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

import { api } from "./api";
import { bleSupported, getManager } from "./ble";
import { T1, T2 } from "./libre2Tables";
import { queryClient } from "./query-client";

export const LIBRE2 = {
  SERVICE: "0000FDE3-0000-1000-8000-00805F9B34FB",
  LOGIN: "0000F001-0000-1000-8000-00805F9B34FB",
  DATA: "0000F002-0000-1000-8000-00805F9B34FB",
};

const KEY = [0xa0c5, 0x6860, 0x0000, 0x14c6];
const SECRET = 0x1b6a;
const ACTIVATE = 0x1b;
export const ENABLE_STREAMING = 0x1e;

export type Calibration = { i1: number; i2: number; i3: number; i4: number; i5: number; i6: number };
export type Libre2Sensor = {
  uid: number[]; // 8 bytes, as Abbott uses them (ends with 0x07 0xE0)
  patchInfo: number[];
  serial: string;
  calibration: Calibration;
  unlockCode: number;
  unlockCount: number;
  mac?: string;
};

// ---------- crypto (port of DiaBLE Libre2.swift) ----------
const w = (hi: number, lo: number) => ((hi << 8) | lo) & 0xffff;

function prepareVariables(id: number[], x: number, y: number) {
  return [(w(id[5], id[4]) + x + y) & 0xffff, (w(id[3], id[2]) + KEY[2]) & 0xffff, (w(id[1], id[0]) + x * 2) & 0xffff, 0x241a ^ KEY[3]];
}

function prepareVariables2(id: number[], i1: number, i2: number, i3: number, i4: number) {
  return [(w(id[5], id[4]) + i1) & 0xffff, (w(id[3], id[2]) + i2) & 0xffff, (w(id[1], id[0]) + i3 + KEY[2]) & 0xffff, (i4 + KEY[3]) & 0xffff];
}

function processCrypto(input: number[]) {
  const op = (v: number) => {
    let r = v >> 2;
    if (v & 1) r ^= KEY[1];
    if (v & 2) r ^= KEY[0];
    return r & 0xffff;
  };
  const r0 = op(input[0]) ^ input[3];
  const r1 = op(r0) ^ input[2];
  const r2 = op(r1) ^ input[1];
  const r3 = op(r2) ^ input[0];
  const r4 = op(r3);
  const r5 = op(r4 ^ r0);
  const r6 = op(r5 ^ r1);
  const r7 = op(r6 ^ r2);
  return [r3 ^ r7, r2 ^ r6, r1 ^ r5, r0 ^ r4];
}

export function usefulFunction(id: number[], x: number, y: number) {
  const k = processCrypto(prepareVariables(id, x, y));
  const r1 = k[0] ^ 0x4163;
  const r2 = k[1] ^ 0x4344;
  return [r1 & 0xff, (r1 >> 8) & 0xff, r2 & 0xff, (r2 >> 8) & 0xff];
}

const CRC_TABLE = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x8408 : c >>> 1;
    t.push(c);
  }
  return t;
})();

export function crc16(data: number[]) {
  let crc = 0xffff;
  for (const b of data) crc = (crc >> 8) ^ CRC_TABLE[(crc ^ b) & 0xff];
  let rev = 0;
  for (let i = 0; i < 16; i++) {
    rev = ((rev << 1) | (crc & 1)) & 0xffff;
    crc >>= 1;
  }
  return rev;
}

const le16 = (d: number[], i: number) => d[i] | (d[i + 1] << 8);

export function decryptFRAM(id: number[], info: number[], data: number[]) {
  const out: number[] = [];
  const arg = w(info[5], info[4]) ^ 0x44;
  for (let i = 0; i < 43; i++) {
    const k = processCrypto(prepareVariables(id, i, arg));
    for (let j = 0; j < 4; j++) {
      out.push(data[i * 8 + j * 2] ^ (k[j] & 0xff), data[i * 8 + j * 2 + 1] ^ ((k[j] >> 8) & 0xff));
    }
  }
  return out;
}

export function streamingUnlockPayload(id: number[], info: number[], enableTime: number, unlockCount: number) {
  const time = (enableTime + unlockCount) >>> 0;
  const b = [time & 0xff, (time >>> 8) & 0xff, (time >>> 16) & 0xff, (time >>> 24) & 0xff];
  const ad = usefulFunction(id, ACTIVATE, SECRET);
  const ed = usefulFunction(id, ENABLE_STREAMING, (enableTime & 0xffff) ^ w(info[5], info[4]));
  const t2 = processCrypto(
    prepareVariables2(id, w(ed[1], ed[0]) ^ w(b[3], b[2]), w(ad[1], ad[0]), w(ed[3], ed[2]) ^ w(b[1], b[0]), w(ad[3], ad[2])),
  );
  const bytes = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const t31 = crc16([0xc1, 0xc4, 0xc3, 0xc0, 0xd4, 0xe1, 0xe7, 0xba, ...bytes(t2[0])]);
  const t32 = crc16([...bytes(t2[1]), ...bytes(t2[2]), ...bytes(t2[3])]);
  const t33 = crc16([ad[0], ad[1], ad[2], ad[3], ed[0], ed[1]]);
  const t34 = crc16([ed[2], ed[3], b[0], b[1], b[2], b[3]]);
  const t4 = processCrypto(prepareVariables2(id, t31, t32, t33, t34));
  return [...b, ...t4.flatMap(bytes)];
}

export function decryptBLE(id: number[], data: number[]) {
  const d = usefulFunction(id, ACTIVATE, SECRET);
  const x = (w(d[1], d[0]) ^ w(d[3], d[2])) | 0x63;
  const y = w(data[1], data[0]) ^ 0x63;
  const key: number[] = [];
  let k = processCrypto(prepareVariables(id, x, y));
  for (let i = 0; i < 8; i++) {
    k.forEach((v) => key.push(v & 0xff, (v >> 8) & 0xff));
    k = processCrypto(k);
  }
  const res = data.slice(2).map((v, i) => v ^ key[i]);
  if (crc16(res.slice(0, 42)) !== le16(res, 42)) return null;
  return res;
}

// ---------- calibration & parsing ----------
export function readBits(buf: number[], byteOffset: number, bitOffset: number, bitCount: number) {
  let res = 0;
  for (let i = 0; i < bitCount; i++) {
    const total = byteOffset * 8 + bitOffset + i;
    if ((buf[Math.floor(total / 8)] >> (total % 8)) & 1) res |= 1 << i;
  }
  return res;
}

export function calibrationFromFRAM(fram: number[]): Calibration {
  const i3 = readBits(fram, 0x150, 0, 8);
  return {
    i1: readBits(fram, 2, 0, 3),
    i2: readBits(fram, 2, 3, 0xa),
    i3: readBits(fram, 0x150, 0x21, 1) ? -i3 : i3,
    i4: readBits(fram, 0x150, 8, 0xe),
    i5: readBits(fram, 0x150, 0x28, 0xc) << 2,
    i6: readBits(fram, 0x150, 0x34, 0xc) << 2,
  };
}

export function factoryGlucose(raw: number, rawTemp: number, tempAdj: number, c: Calibration): number | null {
  if (raw <= 0 || !c.i2 || c.i4 === c.i3) return null;
  const R = (rawTemp * 72500) / (tempAdj + c.i6) - 1000;
  if (!(R > 0)) return null;
  const lr = Math.log(R);
  const temperature = 1 / (Math.pow(lr, 3) * 0.00000005283566 + Math.pow(lr, 2) * 0.0000007061775 + lr * 0.0001964561 + 0.0009180023) - 273.15;
  const g3 = ((65 * (raw - c.i3)) / (c.i4 - c.i3)) * Math.pow(1.045, 32.5 - temperature);
  const v1 = T1[c.i2 - 1];
  const v2 = T2[c.i2 - 1];
  if (v1 === undefined || !v2) return null;
  const value = Math.round((g3 - v1) / v2);
  return value >= 39 && value <= 501 ? value : null;
}

const TREND_OFFSETS = [0, 2, 4, 6, 7, 12, 15];

/** Decrypted 44-byte packet -> current value (mg/dL), trend direction, minutes since start. */
export function parseLibre2(data: number[], c: Calibration, receivedAt: number) {
  const wear = le16(data, 40);
  const trend = TREND_OFFSETS.map((offset, i) => {
    const raw = readBits(data, i * 4, 0, 0xe);
    const temp = readBits(data, i * 4, 0xe, 0xc) << 2;
    let adj = readBits(data, i * 4, 0x1a, 0x5) << 2;
    if (readBits(data, i * 4, 0x1f, 1)) adj = -adj;
    return { offset, sgv: factoryGlucose(raw, temp, adj, c) };
  });
  const now = trend[0].sgv;
  const ago = trend.find((t) => t.offset >= 4 && t.sgv !== null);
  const slope = now !== null && ago ? (now - (ago.sgv as number)) / ago.offset : null;
  return { wearMinutes: wear, sgv: now, ts: new Date(receivedAt).toISOString(), direction: slopeToDirection(slope) };
}

function slopeToDirection(s: number | null) {
  if (s === null) return "NONE";
  if (s <= -3) return "DoubleDown";
  if (s <= -2) return "SingleDown";
  if (s <= -1) return "FortyFiveDown";
  if (s < 1) return "Flat";
  if (s < 2) return "FortyFiveUp";
  if (s < 3) return "SingleUp";
  return "DoubleUp";
}

// ---------- saved sensor ----------
const STORE = "libre2-sensor";
export const loadLibre2 = async (): Promise<Libre2Sensor | null> => {
  const raw = await AsyncStorage.getItem(STORE);
  return raw ? (JSON.parse(raw) as Libre2Sensor) : null;
};
export const saveLibre2 = (s: Libre2Sensor) => AsyncStorage.setItem(STORE, JSON.stringify(s));

// ---------- Bluetooth reader ----------
export type Libre2Status = { state: "idle" | "searching" | "connected" | "error"; message: string; lastValue?: number; lastReadingAt?: number };
let status: Libre2Status = { state: "idle", message: "Not started" };
const listeners = new Set<() => void>();
const setStatus = (p: Partial<Libre2Status>) => {
  status = { ...status, ...p };
  listeners.forEach((l) => l());
};
export const useLibre2Status = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );

const toB64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const fromB64 = (b64: string) => Array.from(atob(b64), (c) => c.charCodeAt(0));

let running = false;
let connecting = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let subs: { remove: () => void }[] = [];
let buffer: number[] = [];
let pending: { ts: string; sgv: number; direction: string }[] = [];
let lastSent = 0;

async function flush() {
  if (!pending.length) return;
  const batch = pending;
  pending = [];
  try {
    await api("/readings/batch", { method: "POST", body: { readings: batch } });
    queryClient.invalidateQueries({ queryKey: ["status"] });
    queryClient.invalidateQueries({ queryKey: ["readings"] });
  } catch {
    pending = [...batch, ...pending].slice(-500);
  }
}

function onData(sensor: Libre2Sensor, b64?: string | null) {
  if (!b64) return;
  buffer.push(...fromB64(b64));
  if (buffer.length < 46) return;
  const packet = buffer.slice(0, 46);
  buffer = [];
  const dec = decryptBLE(sensor.uid, packet);
  if (!dec) return setStatus({ message: "Couldn't read the sensor data. Scan the sensor with NFC again." });
  const r = parseLibre2(dec, sensor.calibration, Date.now());
  if (r.sgv === null) return setStatus({ message: "Sensor warming up or signal issue" });
  setStatus({ lastValue: r.sgv, lastReadingAt: Date.now(), message: "Connected, live every minute" });
  // the sensor streams every minute; keep one reading per ~5 minutes like other sources
  if (Date.now() - lastSent < 270000) return;
  lastSent = Date.now();
  pending.push({ ts: r.ts, sgv: r.sgv, direction: r.direction });
  flush();
}

const clearSubs = () => {
  subs.forEach((s) => s.remove());
  subs = [];
};

async function connect(id: string) {
  if (connecting || !running) return;
  connecting = true;
  const m = getManager();
  try {
    m.stopDeviceScan();
    const sensor = await loadLibre2();
    if (!sensor) throw new Error("no sensor");
    const device = await m.connectToDevice(id, { timeout: 15000 });
    await device.discoverAllServicesAndCharacteristics();
    clearSubs();
    buffer = [];
    subs.push(device.monitorCharacteristicForService(LIBRE2.SERVICE, LIBRE2.DATA, (err: any, c: any) => !err && onData(sensor, c?.value)));
    sensor.unlockCount += 1;
    await saveLibre2(sensor);
    await device.writeCharacteristicWithResponseForService(
      LIBRE2.SERVICE,
      LIBRE2.LOGIN,
      toB64(streamingUnlockPayload(sensor.uid, sensor.patchInfo, sensor.unlockCode, sensor.unlockCount)),
    );
    subs.push(
      m.onDeviceDisconnected(id, () => {
        clearSubs();
        setStatus({ state: "searching", message: "Reconnecting to your Libre" });
      }),
    );
    setStatus({ state: "connected", message: "Connected, waiting for the first reading" });
  } catch {
    setStatus({ state: "searching", message: "Looking for your Libre (keep it close to the phone)" });
  } finally {
    connecting = false;
  }
}

async function loop(savedId?: string) {
  if (!running) return;
  const m = getManager();
  const state = await m.state();
  const sensor = await loadLibre2();
  if (!sensor) setStatus({ state: "error", message: "Scan your Libre sensor with NFC first (Pair sensor)" });
  else if (state === "Unauthorized") setStatus({ state: "error", message: "Allow Bluetooth for xDrip in Settings" });
  else if (state !== "PoweredOn") setStatus({ state: "error", message: "Bluetooth is off" });
  else if (status.state !== "connected") {
    setStatus({ state: "searching", message: "Searching for your Libre" });
    m.startDeviceScan(null, null, (err: any, d: any) => {
      const name: string = d?.localName ?? d?.name ?? "";
      const mac = sensor.mac && d?.id?.toUpperCase?.() === sensor.mac;
      if (!err && d && (d.id === savedId || mac || name.startsWith("ABBOTT") || name.endsWith(sensor.serial))) connect(d.id);
    });
  }
  flush();
  timer = setTimeout(() => loop(savedId), 30000);
}

export function startLibre2(savedId?: string) {
  if (!bleSupported || running) return;
  running = true;
  loop(savedId);
}

export function stopLibre2() {
  running = false;
  if (timer) clearTimeout(timer);
  clearSubs();
  getManager()?.stopDeviceScan();
  setStatus({ state: "idle", message: "Stopped" });
}
