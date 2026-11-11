// Saves the user's light / dark / system choice on this phone.
import AsyncStorage from "@react-native-async-storage/async-storage";

import { AppearancePref, setAppearancePref } from "./theme";

const KEY = "appearance";

export async function loadAppearance() {
  const v = (await AsyncStorage.getItem(KEY).catch(() => null)) as AppearancePref | null;
  if (v === "light" || v === "dark" || v === "system") setAppearancePref(v);
}

export function saveAppearance(p: AppearancePref) {
  setAppearancePref(p);
  AsyncStorage.setItem(KEY, p).catch(() => {});
}
