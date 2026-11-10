import * as Location from "expo-location";
import { useEffect } from "react";

import { api } from "@/src/api";

// Sends the phone's location to the server every 5 minutes while the app is open,
// so emergency texts can include where you are. Never asks for permission itself.
export function useLocationReporter(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const report = async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted || cancelled) return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
      if (pos && !cancelled) {
        api("/location", { method: "POST", body: { lat: pos.coords.latitude, lon: pos.coords.longitude } }).catch(() => {});
      }
    };
    report();
    const id = setInterval(report, 5 * 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);
}
