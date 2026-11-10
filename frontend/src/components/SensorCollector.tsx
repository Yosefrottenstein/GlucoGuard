import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { api, Settings } from "@/src/api";
import { bleSupported } from "@/src/ble";
import { startG7, stopG7 } from "@/src/g7";

// Runs the direct Bluetooth reader for the whole app while Master > Bluetooth > G7 is selected.
export function SensorCollector() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings") });
  const s = settings.data;
  const active = bleSupported && s?.source === "bluetooth" && s.bt_sensor === "dexcom_g7";
  const deviceId = s?.bt_device_id || undefined;

  useEffect(() => {
    if (!active) return;
    startG7(deviceId);
    return () => stopG7();
  }, [active, deviceId]);

  return null;
}
