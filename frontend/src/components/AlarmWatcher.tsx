import { useQuery } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { AppState, Platform, Vibration } from "react-native";

import { api, Settings, Status } from "@/src/api";
import { ensureChannel } from "@/src/sensorAlerts";
import { AlarmSound, playSound, stopSound } from "@/src/sounds";

const FALLBACK: AlarmSound = { style: "both", sound: "classic" };

// Plays the chosen sound / vibration for the active glucose alarm until it's snoozed or clears.
export function AlarmWatcher() {
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<Status>("/status"), refetchInterval: 30000 });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings") });
  const notified = useRef("");
  const alarm = status.data?.alarm;
  const cfg: AlarmSound | null = alarm
    ? alarm.type.startsWith("custom:")
      ? (settings.data?.glucose_alarms?.find((g) => `custom:${g.id}` === alarm.type) ?? FALLBACK)
      : (settings.data?.alarm_sounds?.[alarm.type] ?? FALLBACK)
    : null;
  const key = alarm && !alarm.snoozed ? `${alarm.type}-${alarm.started_at}` : "";

  useEffect(() => {
    if (!key || !cfg || !alarm) {
      stopSound();
      return;
    }
    const style = alarm.type === "extreme_low" ? "sound" : cfg.style;
    if (AppState.currentState !== "active") {
      // App in background (e.g. woken by the G7): show a phone notification with the alarm sound.
      if (Platform.OS !== "web" && notified.current !== key) {
        notified.current = key;
        ensureChannel(style, cfg.sound).then((channelId) =>
          Notifications.scheduleNotificationAsync({
            content: { title: alarm.label, body: "Open GlucoGuard to snooze.", sound: style === "vibrate" ? false : `${cfg.sound}.wav`, data: { sound: style !== "vibrate" } },
            trigger: Platform.OS === "android" ? { channelId } : null,
          }),
        );
      }
      return;
    }
    const tick = () => {
      if (style !== "vibrate") playSound(cfg.sound);
      if (style !== "sound") Vibration.vibrate([0, 500, 300, 500]);
    };
    tick();
    // re-alert on the alarm's own interval while it stays active and isn't snoozed
    const id = setInterval(tick, Math.max(1, cfg.repeat_minutes ?? 1) * 60000);
    return () => {
      clearInterval(id);
      stopSound();
      Vibration.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cfg?.style, cfg?.sound, cfg?.repeat_minutes]);

  return null;
}
