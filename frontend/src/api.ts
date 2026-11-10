const BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;

export type Unit = "mgdl" | "mmol";
export type Source = "demo" | "manual" | "bluetooth" | "nightscout" | "dexcom" | "libre";
export type SensorType = "dexcom_g6" | "dexcom_g7" | "libre2" | "libre3";

export type Reading = { ts: string; sgv: number; direction: string };
export type Thresholds = { urgent_low: number; low: number; high: number; urgent_high: number; target_low: number; target_high: number };

export type Alarm = {
  type: string;
  label: string;
  started_at: string;
  snoozed: boolean;
  snoozed_until: string | null;
  emergency_sent_at: string | null;
};

export type Status = {
  reading: (Reading & { source: string }) | null;
  delta: number | null;
  source: Source;
  unit: Unit;
  last_sync: string | null;
  last_error: string | null;
  upload_errors: Record<string, string>;
  alarm: Alarm | null;
  thresholds: Thresholds;
};

export type Treatment = {
  id: string;
  ts: string;
  kind: "insulin" | "carbs" | "note";
  insulin: number | null;
  carbs: number | null;
  note: string | null;
};

export type Stats = {
  count: number;
  average?: number;
  median?: number;
  sd?: number;
  cv?: number;
  gmi?: number;
  a1c?: number;
  min?: number;
  max?: number;
  capture?: number;
  tir?: { very_low: number; low: number; in_range: number; high: number; very_high: number };
};

export type ChannelSchedule = { enabled: boolean; mode: "default" | "always" | "hours"; start: string; end: string };
export type Contact = { name: string; phone: string; sms: ChannelSchedule; call: ChannelSchedule };

export type Settings = Thresholds & {
  unit: Unit;
  source: Source;
  bt_sensor: SensorType;
  bt_transmitter_id: string;
  bt_device_id: string;
  bt_device_name: string;
  alarm_urgent_low: boolean;
  alarm_low: boolean;
  alarm_high: boolean;
  alarm_urgent_high: boolean;
  alarm_missed: boolean;
  missed_minutes: number;
  snooze_minutes: number;
  ns_url: string;
  ns_secret: string;
  ns_secret_set: boolean;
  ns_upload: boolean;
  dexcom_username: string;
  dexcom_password: string;
  dexcom_password_set: boolean;
  dexcom_region: "us" | "ous" | "jp";
  libre_email: string;
  libre_password: string;
  libre_password_set: boolean;
  tp_email: string;
  tp_password: string;
  tp_password_set: boolean;
  tp_upload: boolean;
  tp_env: "production" | "integration";
  em_enabled: boolean;
  em_name: string;
  em_contacts: Contact[];
  em_sms: boolean;
  em_call: boolean;
  em_sms_schedule: ChannelSchedule;
  em_call_schedule: ChannelSchedule;
  tz: string;
  em_triggers: ("urgent_low" | "low" | "high" | "urgent_high")[];
  em_delay_minutes: number;
  em_sms_repeat_minutes: number;
  em_call_repeat_minutes: number;
  em_location: boolean;
};

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    method: opts.method ?? "GET",
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : `Something went wrong (${res.status})`);
  }
  return data as T;
}

export const apiUrl = (path: string) => BASE + path;

export const qs = (params: Record<string, string | number | undefined>) =>
  "?" +
  Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
