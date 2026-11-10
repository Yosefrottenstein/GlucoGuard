// Sensor-ending warnings as local phone notifications (fire even when the app is closed).
import { format } from "date-fns";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import type { Settings } from "./api";
import type { AlertStyle, SoundId } from "./sounds";

export const notificationsSupported = Platform.OS !== "web";

if (notificationsSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: n.request.content.data?.sound !== false,
      shouldSetBadge: false,
    }),
  });
  Notifications.addNotificationReceivedListener((n) => {
    if (n.request.content.data?.vibrate) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  });
}

export function sensorEnd(s: { sensor_started_at: string | null; sensor_days: number }): Date | null {
  if (!s.sensor_started_at) return null;
  return new Date(Date.parse(s.sensor_started_at) + s.sensor_days * 86400000);
}

export function sensorEndsText(endsAt: string | Date): string {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return "Sensor has ended";
  const h = ms / 3600000;
  if (h >= 48) return `Sensor ends in ${Math.floor(h / 24)} days`;
  if (h >= 1) return `Sensor ends in ${Math.floor(h)} h ${Math.floor((h % 1) * 60)} min`;
  return `Sensor ends in ${Math.max(1, Math.round(ms / 60000))} min`;
}

export const offsetLabel = (m: number) => (m >= 60 ? `${m / 60} h` : `${m} min`);

// Android needs one channel per sound/vibration combo; iOS ignores channels.
export async function ensureChannel(style: AlertStyle, sound: SoundId): Promise<string> {
  const id = `alarm-${style}-${sound}`;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(id, {
      name: `Alarm (${sound}, ${style})`,
      importance: Notifications.AndroidImportance.MAX,
      sound: style === "vibrate" ? null : `${sound}.wav`,
      enableVibrate: style !== "sound",
      vibrationPattern: style !== "sound" ? [0, 500, 300, 500] : undefined,
    });
  }
  return id;
}

export async function scheduleReminders(s: Settings) {
  if (!notificationsSupported) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled.filter((n) => n.identifier.startsWith("reminder-")).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  for (const r of s.reminders) {
    if (!r.enabled) continue;
    const [hour, minute] = r.time.split(":").map(Number);
    const channelId = await ensureChannel(r.style, r.sound);
    const content = {
      title: r.title,
      body: r.repeat === "daily" ? `Daily reminder · ${r.time}` : `Reminder · ${r.time}`,
      sound: r.style === "vibrate" ? false : `${r.sound}.wav`,
      data: { sound: r.style !== "vibrate", vibrate: r.style !== "sound" },
    };
    if (r.repeat === "daily") {
      await Notifications.scheduleNotificationAsync({
        identifier: `reminder-${r.id}`,
        content,
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId },
      });
    } else if (r.date) {
      const at = new Date(`${r.date}T${r.time}:00`);
      if (at.getTime() > Date.now())
        await Notifications.scheduleNotificationAsync({
          identifier: `reminder-${r.id}`,
          content,
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId },
        });
    }
  }
}

export async function notificationPermission() {
  if (!notificationsSupported) return { granted: false, canAskAgain: false };
  return Notifications.getPermissionsAsync();
}

export async function requestNotificationPermission() {
  return Notifications.requestPermissionsAsync();
}

export async function scheduleSensorAlerts(s: Settings) {
  if (!notificationsSupported) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled.filter((n) => n.identifier.startsWith("sensor-end-")).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  const end = sensorEnd(s);
  if (!s.sensor_warn_enabled || !end) return;
  if (!(await Notifications.getPermissionsAsync()).granted) return;

  const style = s.sensor_warn_style;
  const sound = style !== "vibrate";
  const vibrate = style !== "sound";
  const channelId = await ensureChannel(style, s.sensor_warn_sound);
  for (const m of [...s.sensor_warn_offsets, 0]) {
    const at = end.getTime() - m * 60000;
    if (at <= Date.now()) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: `sensor-end-${m}`,
      content: {
        title: m ? "Sensor ending soon" : "Sensor has ended",
        body: m ? `Your sensor ends in ${offsetLabel(m)}, at ${format(end, "EEE HH:mm")}.` : "Insert a new sensor to keep getting readings.",
        sound: sound ? `${s.sensor_warn_sound}.wav` : false,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId },
    });
  }
}
