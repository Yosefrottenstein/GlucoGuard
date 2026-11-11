import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState } from "react-native";

import { api, Settings } from "@/src/api";
import { bleSupported } from "@/src/ble";
import { setG7ActivationHandler, startG7, stopG7 } from "@/src/g7";
import { startLibre2, stopLibre2 } from "@/src/libre2";
import { configureCompanion, drainCompanion } from "@/src/companion";
import { getToken } from "@/src/auth";
import { healthPlatform, readHealth, syncHealth } from "@/src/health";
import { drainSmsOutbox, phoneSmsSupported } from "@/src/phoneSms";
import { scheduleReminders, scheduleSensorAlerts } from "@/src/sensorAlerts";

// App-wide background work: direct Bluetooth readers (G7, Libre 2), phone texts and sensor-ending reminders.
export function SensorCollector() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings") });
  const s = settings.data;
  const bt = bleSupported && s?.source === "bluetooth";
  const g7 = bt && s?.bt_sensor === "dexcom_g7";
  const libre2 = bt && s?.bt_sensor === "libre2";
  const deviceId = s?.bt_device_id || undefined;
  const phoneSms = phoneSmsSupported && s?.em_enabled && s.em_contacts.some((c) => c.sms.enabled && c.sms_via === "phone");

  useEffect(() => {
    if (!g7) return;
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
  }, [g7, deviceId, qc]);

  useEffect(() => {
    if (!libre2) return;
    startLibre2(deviceId);
    return () => stopLibre2();
  }, [libre2, deviceId]);

  const companion = s?.source === "companion";
  useEffect(() => {
    if (!companion) return;
    // hand the server address + sign-in to the Android listener so it uploads even when the app is closed
    configureCompanion(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api`, getToken());
    drainCompanion();
    const t = setInterval(drainCompanion, 60000);
    return () => {
      clearInterval(t);
      configureCompanion("", null);
    };
  }, [companion]);

  const healthSource = healthPlatform && s?.source === "health";
  useEffect(() => {
    if (!healthSource) return;
    readHealth();
    const t = setInterval(readHealth, 5 * 60000);
    return () => clearInterval(t);
  }, [healthSource]);

  useEffect(() => {
    if (!healthPlatform) return;
    syncHealth();
    const t = setInterval(syncHealth, 5 * 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!phoneSms) return;
    drainSmsOutbox();
    const t = setInterval(drainSmsOutbox, 20000);
    const sub = AppState.addEventListener("change", (st) => st === "active" && drainSmsOutbox());
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [phoneSms]);

  useEffect(() => {
    if (s) scheduleSensorAlerts(s).catch(() => {});
  }, [s?.sensor_started_at, s?.sensor_days, s?.sensor_warn_enabled, s?.sensor_warn_style, s?.sensor_warn_offsets?.join(","), s]);

  useEffect(() => {
    if (s) scheduleReminders(s).catch(() => {});
  }, [s]);

  return null;
}
