// NFC scan of a FreeStyle Libre 2 sensor: reads its calibration and switches on Bluetooth streaming.
// Needs an installed build with NFC (iPhone 7+ / Android with NFC). Not available in Expo Go or the web preview.
import { Platform } from "react-native";

import { calibrationFromFRAM, crc16, decryptFRAM, ENABLE_STREAMING, Libre2Sensor, saveLibre2, usefulFunction } from "./libre2";

const LOOKUP = "0123456789ACDEFGHJKLMNPQRTUVWXYZ";

export function libreSerial(uid: number[]) {
  const b = [...uid].reverse().slice(2);
  const five = [
    b[0] >> 3,
    (b[0] << 2) + (b[1] >> 6),
    b[1] >> 1,
    (b[1] << 4) + (b[2] >> 4),
    (b[2] << 1) + (b[3] >> 7),
    b[3] >> 2,
    (b[3] << 3) + (b[4] >> 5),
    b[4],
    b[5] >> 3,
    b[5] << 2,
  ];
  return "3" + five.map((v) => LOOKUP[v & 0x1f]).join("");
}

export type LibreKind = "libre2" | "libre2gen2" | "libre3" | "libre1" | "unknown";
export function libreKind(info: number[]): LibreKind {
  const p = info[0];
  if ([0x9d, 0xc5, 0xc6, 0x7f].includes(p)) return "libre2";
  if ([0x76, 0x2b, 0x2c].includes(p)) return "libre2gen2";
  if ([0xdf, 0xa2, 0xe5, 0xe6, 0x70].includes(p)) return "libre1";
  if (info.length >= 24 && info[12] === 4) return "libre3";
  return "unknown";
}

const hexToBytes = (hex: string) => (hex.match(/../g) ?? []).map((h) => parseInt(h, 16));

let nfc: any = null;
function lib() {
  if (!nfc) nfc = require("react-native-nfc-manager");
  return nfc;
}

export async function nfcAvailable() {
  if (Platform.OS === "web") return false;
  try {
    const { default: NfcManager } = lib();
    return await NfcManager.isSupported();
  } catch {
    return false; // Expo Go: native module missing
  }
}

export class LibreScanError extends Error {}

/** Scans the sensor, enables streaming with a fresh unlock code and stores everything needed to read it by Bluetooth. */
export async function scanLibre2(): Promise<Libre2Sensor> {
  const { default: NfcManager, NfcTech, Nfc15693RequestFlagIOS } = lib();
  await NfcManager.start();
  const ios = Platform.OS === "ios";
  try {
    await NfcManager.requestTechnology(ios ? NfcTech.Iso15693IOS : NfcTech.NfcV, {
      alertMessage: "Hold the top of your iPhone near the Libre sensor",
    });
    const tag = await NfcManager.getTag();
    let uid = hexToBytes(tag?.id ?? "");
    if (uid.length !== 8) throw new LibreScanError("Couldn't read the sensor. Try again.");
    if (uid[0] === 0xe0) uid = uid.reverse(); // iPhone gives the bytes the other way round

    const flags = ios ? Nfc15693RequestFlagIOS.HighDataRate : 0x02;
    const custom = async (params: number[]) =>
      ios
        ? ((await NfcManager.iso15693HandlerIOS.customCommand({ flags, customCommandCode: 0xa1, customRequestParameters: params })) as number[])
        : ((await NfcManager.nfcVHandler.transceive([0x02, 0xa1, 0x07, ...params])) as number[]).slice(1);
    const readBlock = async (n: number) =>
      ios
        ? ((await NfcManager.iso15693HandlerIOS.readSingleBlock({ flags, blockNumber: n })) as number[])
        : ((await NfcManager.nfcVHandler.transceive([0x02, 0x20, n])) as number[]).slice(1);

    const patchInfo = await custom([]);
    const kind = libreKind(patchInfo);
    if (kind === "libre3") throw new LibreScanError("This is a Libre 3. It can't be read directly; use LibreLinkUp in Follower mode.");
    if (kind === "libre2gen2") throw new LibreScanError("This Libre 2 Plus uses newer encryption that can't be read directly yet. Use LibreLinkUp in Follower mode.");
    if (kind !== "libre2") throw new LibreScanError("This sensor isn't a Libre 2. Only Libre 2 and the European Libre 2 Plus are supported.");

    let fram: number[] = [];
    for (let i = 0; i < 43; i++) fram.push(...(await readBlock(i)).slice(0, 8));
    if (le(fram, 0) !== crc16(fram.slice(2, 24))) fram = decryptFRAM(uid, patchInfo, fram);
    const state = fram[4];
    if (state === 1) throw new LibreScanError("This sensor hasn't been started yet. Start it with the Libre app or reader first.");
    if (state >= 5) throw new LibreScanError("This sensor has ended. Put on a new one.");

    const unlockCode = (Math.random() * 0xffffffff) >>> 0;
    const p = [unlockCode & 0xff, (unlockCode >>> 8) & 0xff, (unlockCode >>> 16) & 0xff, (unlockCode >>> 24) & 0xff];
    const secret = le(patchInfo, 4) ^ ((p[1] << 8) | p[0]);
    const out = await custom([ENABLE_STREAMING, ...p, ...usefulFunction(uid, ENABLE_STREAMING, secret)]);
    if (out.length !== 6) throw new LibreScanError("The sensor didn't turn on Bluetooth. Hold still and scan again.");
    const mac = [...out]
      .reverse()
      .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
      .join(":");

    const sensor: Libre2Sensor = {
      uid,
      patchInfo,
      serial: libreSerial(uid),
      calibration: calibrationFromFRAM(fram),
      unlockCode,
      unlockCount: 0,
      mac,
    };
    await saveLibre2(sensor);
    if (ios) await NfcManager.setAlertMessageIOS?.("Libre sensor ready");
    return sensor;
  } finally {
    NfcManager.cancelTechnologyRequest().catch(() => {});
  }
}

const le = (d: number[], i: number) => d[i] | (d[i + 1] << 8);
