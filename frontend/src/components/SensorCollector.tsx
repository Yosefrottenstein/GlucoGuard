import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { api, Settings } from "@/src/api";
import { bleSupported } from "@/src/ble";
import { setG7ActivationHandler, startG7, stopG7 } from "@/src/g7";
import { scheduleReminders, scheduleSensorAlerts } from "@/src/sensorAlerts";

// App-wide background work: direct Bluetooth reader (Master > Bluetooth > G7) and sensor-ending reminders.
export function SensorCollector() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings") });
  const s = settings.data;
  const active = bleSupported && s?.source === "bluetooth" && s.bt_sensor === "dexcom_g7";
  const deviceId = s?.bt_device_id || undefined;

  useEffect(() => {
    if (!active) return;
    setG7ActivationHandler(async (activatedAt) => {
      const current = qc.getQueryData<Settings>(["settings"]);
      const known = current?.sensor_started_at ? Date.parse(current.sensor_started_at) : 0;
      if (Math.abs(known - activatedAt.getTime()) < 3600000) return;
      const data = await api<Settings>("/settings", {
        method: "PUT",
        body: { sensor_started_at: activatedAt.toISOString(), sensor_days: 10.5 },
      }).catch(() => null);
      if (data) {
        qc.setQueryData(["settings"], data);
        qc.invalidateQueries({ queryKey: ["status"] });
      }
    });
    startG7(deviceId);
    return () => stopG7();
  }, [active, deviceId, qc]);

  useEffect(() => {
    if (s) scheduleSensorAlerts(s).catch(() => {});
  }, [s?.sensor_started_at, s?.sensor_days, s?.sensor_warn_enabled, s?.sensor_warn_style, s?.sensor_warn_offsets?.join(","), s]);

  useEffect(() => {
    if (s) scheduleReminders(s).catch(() => {});
  }, [s]);

  return null;
}
