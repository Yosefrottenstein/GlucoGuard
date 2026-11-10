import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ChannelSchedule, GlucoseAlarm, Reminder, SensorType, Settings, Source, Status, Unit } from "@/src/api";
import { Sheet } from "@/src/components/Sheet";
import { SoundPicker } from "@/src/components/SoundPicker";
import { SOUNDS, stopSound } from "@/src/sounds";
import { SENSORS } from "@/src/ble";
import { ChipRow, MultiChipRow } from "@/src/components/ChipRow";
import { ContactSheet } from "@/src/components/ContactSheet";
import { asTime, describeSchedule, ScheduleEditor, validTime } from "@/src/components/ScheduleEditor";
import { useToast } from "@/src/components/Toast";
import { Button, Card, Field, Hint, SectionTitle, ToggleRow } from "@/src/components/ui";
import { agoText, fromDisplay, toDisplay, unitLabel } from "@/src/glucose";
import { usesNativeTabs } from "@/src/navigation";
import {
  notificationPermission,
  notificationsSupported,
  offsetLabel,
  requestNotificationPermission,
  sensorEndsText,
} from "@/src/sensorAlerts";
import { format, isValid, parse } from "date-fns";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type AlarmKey = "urgent_low" | "low" | "high" | "urgent_high";
type ThrKey = AlarmKey | "target_low" | "target_high";
const THR: { key: AlarmKey; label: string }[] = [
  { key: "urgent_low", label: "Urgent low" },
  { key: "low", label: "Low" },
  { key: "high", label: "High" },
  { key: "urgent_high", label: "Urgent high" },
];
const TARGET: { key: ThrKey; label: string }[] = [
  { key: "target_low", label: "Target low" },
  { key: "target_high", label: "Target high" },
];
const ALL_THR: { key: ThrKey; label: string }[] = [...TARGET, ...THR];
const SOUND_TITLES: Record<string, string> = {
  sensor: "Sensor reminder",
  extreme_low: "Extreme low",
  urgent_low: "Urgent low",
  low: "Low",
  high: "High",
  urgent_high: "Urgent high",
  missed: "Missed readings",
};
const soundText = (a: { style: string; sound: string }) =>
  a.style === "vibrate" ? "Vibrate only" : `${SOUNDS.find((s) => s.id === a.sound)?.label ?? a.sound}${a.style === "both" ? " + vibrate" : ""}`;
type SecretKey = "ns_secret" | "dexcom_password" | "libre_password" | "tp_password";
const EMPTY_SECRETS: Record<SecretKey, string> = { ns_secret: "", dexcom_password: "", libre_password: "", tp_password: "" };

type SourceOpt = { value: Source; title: string; sub: string };
const FOLLOWER: SourceOpt[] = [
  { value: "dexcom", title: "Dexcom Share", sub: "Dexcom G6, G7, ONE, ONE+ and Stelo with Share turned on" },
  { value: "libre", title: "LibreLinkUp", sub: "FreeStyle Libre 2, 2 Plus, 3 and 3 Plus" },
  { value: "nightscout", title: "Nightscout", sub: "Medtronic (CareLink), Eversense, Medtrum, AAPS, Loop and any uploader" },
];
const MASTER: SourceOpt[] = [
  { value: "bluetooth", title: "Bluetooth sensor", sub: "Talk to the sensor directly, then upload to Nightscout and Tidepool" },
  { value: "manual", title: "Manual entry", sub: "Type finger-stick or sensor values yourself" },
  { value: "demo", title: "Demo sensor", sub: "Realistic sample data to try the app" },
];
const isFollower = (s: Source) => FOLLOWER.some((o) => o.value === s);
const SENSOR_OPTIONS = (Object.keys(SENSORS) as SensorType[]).map((k) => ({ value: k, label: SENSORS[k].label }));

export default function SettingsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings") });
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<Status>("/status"), refetchInterval: 30000 });
  const log = useQuery({
    queryKey: ["emergency-log"],
    queryFn: () => api<{ id: string; ts: string; test: boolean; results: string[] }[]>("/emergency/log"),
  });

  const [draft, setDraft] = useState<Settings | null>(null);
  const [thr, setThr] = useState<Record<ThrKey, string>>({ urgent_low: "", low: "", high: "", urgent_high: "", target_low: "", target_high: "" });
  const [secrets, setSecrets] = useState(EMPTY_SECRETS);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<number | null>(null); // -1 = new contact
  const [permSheet, setPermSheet] = useState<null | "ask" | "settings">(null);
  const [notifSheet, setNotifSheet] = useState<null | "ask" | "settings">(null);
  const [soundEdit, setSoundEdit] = useState<string | null>(null);
  const [reminderEdit, setReminderEdit] = useState<{ index: number; value: Reminder } | null>(null);
  const [gaEdit, setGaEdit] = useState<{ index: number; value: GlucoseAlarm; text: string } | null>(null);
  const [startText, setStartText] = useState("");

  useEffect(() => {
    if (settings.data && !dirty) {
      setDraft(settings.data);
      setStartText(settings.data.sensor_started_at ? format(new Date(settings.data.sensor_started_at), "yyyy-MM-dd HH:mm") : "");
      setThr(Object.fromEntries(ALL_THR.map((t) => [t.key, toDisplay(settings.data[t.key], settings.data.unit)])) as Record<ThrKey, string>);
    }
  }, [settings.data, dirty]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setDirty(true);
  };
  const setNum = (key: keyof Settings, text: string) => set(key, (parseInt(text.replace(/\D/g, ""), 10) || 0) as never);

  const changeUnit = (u: Unit) => {
    if (!draft || u === draft.unit) return;
    const next = { ...thr };
    ALL_THR.forEach((t) => {
      const mg = fromDisplay(thr[t.key], draft.unit);
      next[t.key] = mg ? toDisplay(mg, u) : "";
    });
    setThr(next);
    set("unit", u);
  };

  const buildPatch = () => {
    if (!draft) throw new Error("Settings not loaded");
    const patch: Record<string, unknown> = { ...draft };
    for (const t of ALL_THR) {
      const mg = fromDisplay(thr[t.key], draft.unit);
      if (!mg) throw new Error(`Enter a value for ${t.label.toLowerCase()}.`);
      patch[t.key] = mg;
    }
    (Object.keys(EMPTY_SECRETS) as SecretKey[]).forEach((k) => {
      patch[k] = secrets[k];
      delete patch[`${k}_set`];
    });
    for (const s of [draft.em_sms_schedule, draft.em_call_schedule]) {
      if (s.mode === "hours" && !(validTime(s.start) && validTime(s.end))) throw new Error("Enter hours as HH:MM, e.g. 22:00");
    }
    if (draft.em_sms_repeat_minutes < 1 || draft.em_call_repeat_minutes < 1) throw new Error("Resend time must be at least 1 minute.");
    patch.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    if (startText.trim()) {
      const d = parse(startText.trim(), "yyyy-MM-dd HH:mm", new Date());
      if (!isValid(d) || d.getTime() > Date.now() + 60000) throw new Error("Sensor start: use YYYY-MM-DD HH:MM, not in the future.");
      patch.sensor_started_at = d.toISOString();
    } else patch.sensor_started_at = null;
    return patch;
  };

  const save = useMutation({
    mutationFn: async () => api<Settings>("/settings", { method: "PUT", body: buildPatch() }),
    onSuccess: (data) => {
      qc.setQueryData(["settings"], data);
      setSecrets(EMPTY_SECRETS);
      setDirty(false);
      qc.invalidateQueries();
      toast("Settings saved", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const action = (path: string, okText: (d: any) => string) =>
    useMutation({
      mutationFn: async () => {
        if (dirty) await save.mutateAsync();
        return api<any>(path, { method: "POST" });
      },
      onSuccess: (d) => {
        qc.invalidateQueries();
        toast(okText(d), "success");
      },
      onError: (e: Error) => toast(e.message, "error"),
    });
  /* eslint-disable react-hooks/rules-of-hooks */
  const syncNow = action("/sync", (d) => (d.error ? `Sync problem: ${d.error}` : `Synced. ${d.added} new readings`));
  const nsUpload = action("/nightscout/upload", (d) => `Uploaded ${d.uploaded} items to Nightscout`);
  const tpUpload = action("/tidepool/upload", (d) => `Uploaded ${d.uploaded} items to Tidepool`);
  const emTest = action("/emergency/test", (d) => d.results.join(" · ") || "Test sent");
  /* eslint-enable react-hooks/rules-of-hooks */

  const ensureLocation = async () => {
    const p = await Location.getForegroundPermissionsAsync();
    if (!p.granted) setPermSheet(p.canAskAgain ? "ask" : "settings");
  };
  const requestLocation = async () => {
    const r = await Location.requestForegroundPermissionsAsync();
    if (r.granted) {
      setPermSheet(null);
      toast("Location will be included in emergency texts", "success");
    } else setPermSheet("settings");
  };

  const ensureNotifications = async () => {
    if (!notificationsSupported) return;
    const p = await notificationPermission();
    if (!p.granted) setNotifSheet(p.canAskAgain ? "ask" : "settings");
  };
  const requestNotifications = async () => {
    const r = await requestNotificationPermission();
    if (r.granted) {
      setNotifSheet(null);
      toast("Sensor reminders turned on", "success");
    } else setNotifSheet("settings");
  };

  const saveGlucoseAlarm = () => {
    if (!gaEdit || !draft) return;
    const g = gaEdit.value;
    const mg = fromDisplay(gaEdit.text, draft.unit);
    if (!g.title.trim()) return toast("Give the alarm a title", "error");
    if (!mg || mg < 40 || mg > 400) return toast(`Enter a value between ${toDisplay(40, draft.unit)} and ${toDisplay(400, draft.unit)}`, "error");
    if (g.repeat_minutes < 1 || g.snooze_minutes < 1) return toast("Repeat and snooze must be at least 1 minute", "error");
    const list = [...draft.glucose_alarms];
    const clean = { ...g, title: g.title.trim(), value: mg };
    if (gaEdit.index >= 0) list[gaEdit.index] = clean;
    else list.push(clean);
    set("glucose_alarms", list);
    setGaEdit(null);
    stopSound();
    toast("Alarm ready. Tap Save to keep it.", "info");
  };

  const saveReminder = () => {
    if (!reminderEdit || !draft) return;
    const r = reminderEdit.value;
    if (!r.title.trim()) return toast("Give the reminder a title", "error");
    if (!validTime(r.time)) return toast("Enter the time as HH:MM, e.g. 08:30", "error");
    if (r.repeat === "once" && !/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? "")) return toast("Enter the date as YYYY-MM-DD", "error");
    const list = [...draft.reminders];
    const clean = { ...r, title: r.title.trim() };
    if (reminderEdit.index >= 0) list[reminderEdit.index] = clean;
    else list.push(clean);
    set("reminders", list);
    setReminderEdit(null);
    stopSound();
    ensureNotifications();
    toast("Reminder ready. Tap Save to keep it.", "info");
  };

  const channelText = (own: ChannelSchedule, enabledGlobally: boolean, def: ChannelSchedule) =>
    !enabledGlobally || !own.enabled ? "off" : describeSchedule(own.mode === "default" ? def : own);

  if (!draft) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }
  const u = unitLabel(draft.unit);
  const mode = isFollower(draft.source) ? "follower" : "master";
  const secretPh = (k: SecretKey) => (draft[`${k}_set` as keyof Settings] ? "Saved ••••••" : "Not set");

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>Settings</Text>
        <Pressable
          testID="settings-save-button"
          disabled={!dirty || save.isPending}
          onPress={() => save.mutate()}
          style={[styles.saveBtn, !dirty && { opacity: 0.4 }]}
        >
          {save.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save</Text>}
        </Pressable>
      </View>

      <KeyboardAwareScrollView
        bottomOffset={24}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: bottomChrome + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionTitle>Glucose unit</SectionTitle>
        <ChipRow
          options={[
            { value: "mgdl", label: "mg/dL" },
            { value: "mmol", label: "mmol/L" },
          ]}
          value={draft.unit}
          onChange={changeUnit}
          testIDPrefix="settings-unit"
          padded={false}
        />

        <SectionTitle>Data source</SectionTitle>
        <ChipRow
          options={[
            { value: "follower", label: "Follower" },
            { value: "master", label: "Master" },
          ]}
          value={mode}
          onChange={(m) => m !== mode && set("source", m === "follower" ? "dexcom" : "bluetooth")}
          testIDPrefix="settings-mode"
          padded={false}
        />
        <Hint>
          {mode === "follower"
            ? "Follower: reads your glucose from a cloud service your sensor app already uploads to."
            : "Master: this phone gets readings itself and uploads them to Nightscout and Tidepool."}
        </Hint>
        <Card style={{ paddingVertical: spacing.xs, marginTop: spacing.sm }}>
          {(mode === "follower" ? FOLLOWER : MASTER).map((s, i) => (
            <Pressable
              key={s.value}
              testID={`settings-source-${s.value}`}
              onPress={() => set("source", s.value)}
              style={[styles.radioRow, i > 0 && styles.topBorder]}
            >
              <Ionicons
                name={draft.source === s.value ? "radio-button-on" : "radio-button-off"}
                size={22}
                color={draft.source === s.value ? colors.brandPrimary : colors.borderStrong}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.radioTitle}>{s.title}</Text>
                <Text style={styles.radioSub}>{s.sub}</Text>
              </View>
            </Pressable>
          ))}
        </Card>
        {draft.source === "bluetooth" && (
          <Card style={styles.subCard} testID="bluetooth-sensor-card">
            <View style={styles.inlineChips}>
              <Text style={styles.inlineLabel}>Sensor</Text>
              <ChipRow options={SENSOR_OPTIONS} value={draft.bt_sensor} onChange={(v) => set("bt_sensor", v)} testIDPrefix="bt-sensor" padded={false} />
            </View>
            {draft.bt_sensor === "dexcom_g6" && (
              <Field
                label="Transmitter ID"
                value={draft.bt_transmitter_id}
                onChangeText={(v) => set("bt_transmitter_id", v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
                placeholder="8XXXXX"
                autoCapitalize="characters"
                testID="bt-transmitter-input"
              />
            )}
            <View style={styles.syncRow}>
              <Text style={styles.syncText} testID="bt-paired-device">
                {draft.bt_device_name ? `Paired: ${draft.bt_device_name}` : "No sensor paired yet"}
              </Text>
              <Button
                title={draft.bt_device_name ? "Pair again" : "Pair sensor"}
                kind="secondary"
                onPress={async () => {
                  if (dirty) await save.mutateAsync().catch(() => null);
                  router.push("/sensor");
                }}
                testID="bt-pair-button"
              />
            </View>
          </Card>
        )}
        {mode === "master" && <Hint>Turn on Nightscout and Tidepool upload below so your readings are shared.</Hint>}
        {draft.source === "dexcom" && (
          <Card style={styles.subCard}>
            <Field label="Username" value={draft.dexcom_username} onChangeText={(v) => set("dexcom_username", v)} placeholder="Dexcom account" testID="dexcom-username-input" />
            <Field
              label="Password"
              value={secrets.dexcom_password}
              onChangeText={(v) => (setSecrets({ ...secrets, dexcom_password: v }), setDirty(true))}
              placeholder={secretPh("dexcom_password")}
              secureTextEntry
              testID="dexcom-password-input"
            />
            <View style={styles.inlineChips}>
              <Text style={styles.inlineLabel}>Region</Text>
              <ChipRow
                options={[
                  { value: "us", label: "USA" },
                  { value: "ous", label: "Outside USA" },
                  { value: "jp", label: "Japan" },
                ]}
                value={draft.dexcom_region}
                onChange={(v) => set("dexcom_region", v)}
                testIDPrefix="dexcom-region"
                padded={false}
              />
            </View>
          </Card>
        )}
        {draft.source === "libre" && (
          <Card style={styles.subCard}>
            <Field label="Email" value={draft.libre_email} onChangeText={(v) => set("libre_email", v)} placeholder="LibreLinkUp email" keyboardType="email-address" testID="libre-email-input" />
            <Field
              label="Password"
              last
              value={secrets.libre_password}
              onChangeText={(v) => (setSecrets({ ...secrets, libre_password: v }), setDirty(true))}
              placeholder={secretPh("libre_password")}
              secureTextEntry
              testID="libre-password-input"
            />
          </Card>
        )}
        {draft.source === "nightscout" && <Hint>Uses the Nightscout address and secret in the Nightscout section below.</Hint>}
        {draft.source === "dexcom" && <Hint>Turn on Share in your Dexcom app and add at least one follower.</Hint>}
        {draft.source === "libre" && (
          <Hint>Invite this email as a follower from your Libre app, accept it in LibreLinkUp, then sign in here.</Hint>
        )}
        <View style={styles.syncRow}>
          <Text style={styles.syncText} testID="settings-sync-status">
            {status.data?.last_error
              ? `Problem: ${status.data.last_error}`
              : status.data?.reading
                ? `Last reading ${agoText(status.data.reading.ts)}`
                : "No readings yet"}
          </Text>
          <Button title="Sync now" kind="secondary" onPress={() => syncNow.mutate()} loading={syncNow.isPending} testID="settings-sync-button" />
        </View>
        {mode === "follower" && (
          <Hint>Want the phone to read the sensor itself by Bluetooth? Switch to Master.</Hint>
        )}

        <SectionTitle>Sensor session</SectionTitle>
        <Card style={{ paddingVertical: spacing.xs }}>
          <Field
            label="Started"
            value={startText}
            onChangeText={(v) => (setStartText(v), setDirty(true))}
            placeholder="YYYY-MM-DD HH:MM"
            keyboardType="numbers-and-punctuation"
            testID="sensor-started-input"
          />
          <View style={[styles.syncRow, { marginTop: 0, paddingVertical: spacing.sm }, styles.bottomBorder]}>
            <Text style={styles.syncText} testID="sensor-ends-text">
              {startText && draft.sensor_started_at ? sensorEndsText(new Date(Date.parse(draft.sensor_started_at) + draft.sensor_days * 86400000)) : "Enter when you put the sensor on"}
            </Text>
            <Button
              title="Started now"
              kind="secondary"
              onPress={() => (setStartText(format(new Date(), "yyyy-MM-dd HH:mm")), setDirty(true))}
              testID="sensor-started-now-button"
            />
          </View>
          <View style={[styles.inlineChips, styles.bottomBorder]}>
            <Text style={styles.inlineLabel}>Sensor length</Text>
            <ChipRow
              options={[
                { value: "10", label: "10 days (G6)" },
                { value: "10.5", label: "10.5 days (G7)" },
                { value: "14", label: "14 days (Libre)" },
                { value: "15", label: "15 days (Libre Plus)" },
              ]}
              value={String(draft.sensor_days)}
              onChange={(v) => set("sensor_days", Number(v))}
              testIDPrefix="sensor-length"
              padded={false}
            />
          </View>
          <ToggleRow
            label="Sensor ending reminders"
            sub="Phone notifications, even when the app is closed"
            value={draft.sensor_warn_enabled}
            onChange={(v) => {
              set("sensor_warn_enabled", v);
              if (v) ensureNotifications();
            }}
            testID="sensor-warn-toggle"
            last={!draft.sensor_warn_enabled}
          />
          {draft.sensor_warn_enabled && (
            <>
              <View style={[styles.inlineChips, styles.bottomBorder]}>
                <Text style={styles.inlineLabel}>Remind me before the end</Text>
                <MultiChipRow
                  options={[1440, 720, 360, 60, 30].map((m) => ({ value: String(m), label: offsetLabel(m) }))}
                  values={draft.sensor_warn_offsets.map(String)}
                  onChange={(v) => set("sensor_warn_offsets", v.map(Number).sort((a, b) => b - a))}
                  testIDPrefix="sensor-warn-offset"
                />
              </View>
              <Pressable testID="sensor-warn-sound-button" onPress={() => setSoundEdit("sensor")} style={styles.soundRow}>
                <Ionicons name="musical-notes" size={18} color={colors.brandPrimary} />
                <Text style={[styles.radioTitle, { flex: 1 }]}>Alert sound</Text>
                <Text style={styles.radioSub}>{soundText({ style: draft.sensor_warn_style, sound: draft.sensor_warn_sound })}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            </>
          )}
        </Card>
        <Hint>
          A G7 connected by Bluetooth sets the start time automatically. &quot;Vibrate only&quot; reminders are silent when the app is closed
          on iPhone, and vibrate when it&apos;s open.
        </Hint>

        <SectionTitle>Target range</SectionTitle>
        <Card style={{ paddingVertical: spacing.xs }}>
          {TARGET.map((t, i) => (
            <View key={t.key} style={[styles.alarmRow, i === 0 && styles.bottomBorder]}>
              <View style={[styles.swatch, { backgroundColor: t.key === "target_low" ? colors.low : colors.high }]} />
              <Text style={[styles.radioTitle, { flex: 1 }]}>{t.label}</Text>
              <TextInput
                testID={`target-${t.key}`}
                value={thr[t.key]}
                onChangeText={(v) => (setThr({ ...thr, [t.key]: v }), setDirty(true))}
                keyboardType="decimal-pad"
                style={styles.thrInput}
              />
              <Text style={styles.unitText}>{u}</Text>
            </View>
          ))}
        </Card>
        <View style={styles.legendRow}>
          {[
            { c: colors.low, l: "Below range" },
            { c: colors.inRange, l: "In range" },
            { c: colors.high, l: "Above range" },
          ].map((x) => (
            <View key={x.l} style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: x.c }]} />
              <Text style={styles.radioSub}>{x.l}</Text>
            </View>
          ))}
        </View>
        <Hint>Colours the graph dots and sets time in range. Alarm levels below are separate.</Hint>

        <SectionTitle>Alarms</SectionTitle>
        <Card style={{ paddingVertical: spacing.xs }}>
          <View style={[styles.alarmRow, styles.bottomBorder]}>
            <Text style={[styles.radioTitle, { flex: 1 }]}>Extreme low</Text>
            <Text style={[styles.thrInput, styles.fixedThr]} testID="alarm-threshold-extreme_low">
              {toDisplay(50, draft.unit)}
            </Text>
            <Text style={styles.unitText}>{u}</Text>
            <SoundButton onPress={() => setSoundEdit("extreme_low")} testID="alarm-sound-extreme_low" />
            <SwitchLike value={draft.alarm_extreme_low} onChange={(v) => set("alarm_extreme_low", v)} testID="alarm-toggle-extreme_low" />
          </View>
          {THR.map((t) => (
            <View key={t.key} style={[styles.alarmRow, styles.bottomBorder]}>
              <Text style={[styles.radioTitle, { flex: 1 }]}>{t.label}</Text>
              <TextInput
                testID={`alarm-threshold-${t.key}`}
                value={thr[t.key]}
                onChangeText={(v) => (setThr({ ...thr, [t.key]: v }), setDirty(true))}
                keyboardType="decimal-pad"
                style={styles.thrInput}
              />
              <Text style={styles.unitText}>{u}</Text>
              <SoundButton onPress={() => setSoundEdit(t.key)} testID={`alarm-sound-${t.key}`} />
              <SwitchLike
                value={draft[`alarm_${t.key}` as keyof Settings] as boolean}
                onChange={(v) => set(`alarm_${t.key}` as keyof Settings, v as never)}
                testID={`alarm-toggle-${t.key}`}
              />
            </View>
          ))}
          <ToggleRow label="Missed readings" sub="Alert when no new reading arrives" value={draft.alarm_missed} onChange={(v) => set("alarm_missed", v)} testID="alarm-toggle-missed" />
          <Pressable testID="alarm-sound-missed" onPress={() => setSoundEdit("missed")} style={[styles.soundRow, styles.bottomBorder]}>
            <Ionicons name="musical-notes" size={18} color={colors.brandPrimary} />
            <Text style={[styles.radioTitle, { flex: 1 }]}>Missed readings sound</Text>
            <Text style={styles.radioSub}>{soundText(draft.alarm_sounds.missed)}</Text>
          </Pressable>
          <Field label="Missed after" last value={String(draft.missed_minutes)} onChangeText={(v) => setNum("missed_minutes", v)} keyboardType="number-pad" suffix="min" testID="alarm-missed-minutes-input" />
        </Card>
        <Hint>
          Tap the note icon to set each alarm&apos;s sound, vibration, how often it repeats and how long Snooze lasts. Extreme low (below{" "}
          {toDisplay(50, draft.unit)} {u}) always plays sound only. Alarms ring while the app is open or woken by the G7; emergency messages
          are sent by the server even when the phone is locked.
        </Hint>

        <Text style={styles.subTitle}>Custom glucose alarms</Text>
        <Card style={{ paddingVertical: spacing.xs }}>
          {draft.glucose_alarms.length === 0 && (
            <Text style={[styles.radioSub, { paddingVertical: spacing.md }]}>Add your own alarm for any number, above or below.</Text>
          )}
          {draft.glucose_alarms.map((g, i) => (
            <Pressable
              key={g.id}
              testID={`glucose-alarm-row-${i}`}
              onPress={() => setGaEdit({ index: i, value: g, text: toDisplay(g.value, draft.unit) })}
              style={[styles.contactRow, i < draft.glucose_alarms.length - 1 && styles.bottomBorder]}
            >
              <Ionicons name={g.direction === "below" ? "arrow-down-circle" : "arrow-up-circle"} size={24} color={g.enabled ? (g.direction === "below" ? colors.low : colors.high) : colors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.radioTitle}>{g.title}</Text>
                <Text style={styles.radioSub}>
                  {g.direction === "below" ? "Below" : "Above"} {toDisplay(g.value, draft.unit)} {u} · {soundText(g)} · every {g.repeat_minutes} min · snooze{" "}
                  {g.snooze_minutes} min{g.enabled ? "" : " · off"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ))}
        </Card>
        <Button
          title="Add glucose alarm"
          kind="secondary"
          onPress={() =>
            setGaEdit({
              index: -1,
              text: "",
              value: { id: `${Date.now()}`, title: "", direction: "below", value: 80, enabled: true, style: "both", sound: "classic", repeat_minutes: 5, snooze_minutes: 30 },
            })
          }
          testID="glucose-alarm-add-button"
          style={{ marginTop: spacing.sm }}
        />

        <SectionTitle>Reminders</SectionTitle>
        <Card style={{ paddingVertical: spacing.xs }}>
          {draft.reminders.length === 0 && (
            <Text style={[styles.radioSub, { paddingVertical: spacing.md }]}>No reminders yet. Add one for site change, insulin, meals…</Text>
          )}
          {draft.reminders.map((r, i) => (
            <Pressable
              key={r.id}
              testID={`reminder-row-${i}`}
              onPress={() => setReminderEdit({ index: i, value: r })}
              style={[styles.contactRow, i < draft.reminders.length - 1 && styles.bottomBorder]}
            >
              <Ionicons name="alarm" size={24} color={r.enabled ? colors.brandPrimary : colors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.radioTitle}>{r.title}</Text>
                <Text style={styles.radioSub}>
                  {r.repeat === "daily" ? "Every day" : r.date} at {r.time} · {soundText(r)}
                  {r.enabled ? "" : " · off"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ))}
        </Card>
        <Button
          title="Add reminder"
          kind="secondary"
          onPress={() =>
            setReminderEdit({
              index: -1,
              value: { id: `${Date.now()}`, title: "", time: "08:00", repeat: "daily", date: null, enabled: true, style: "both", sound: "chime" },
            })
          }
          testID="reminder-add-button"
          style={{ marginTop: spacing.sm }}
        />

        <SectionTitle>Emergency messages</SectionTitle>
        <Card style={{ paddingVertical: spacing.xs }}>
          <ToggleRow
            label="Emergency messages"
            sub="Alert contacts when an alarm isn't snoozed in time"
            value={draft.em_enabled}
            onChange={(v) => {
              set("em_enabled", v);
              if (v && draft.em_location) ensureLocation();
            }}
            testID="emergency-enabled-toggle"
          />
          <Field label="Your name" value={draft.em_name} onChangeText={(v) => set("em_name", v)} placeholder="Used in the message" autoCapitalize="words" testID="emergency-name-input" />
          <ToggleRow
            label="Include my location"
            sub="Adds a map link to the text"
            value={draft.em_location}
            onChange={(v) => {
              set("em_location", v);
              if (v) ensureLocation();
            }}
            testID="emergency-location-toggle"
          />
          <View style={[styles.inlineChips, styles.bottomBorder]}>
            <Text style={styles.inlineLabel}>Send for these alarms</Text>
            <MultiChipRow
              options={[
                { value: "urgent_low", label: "Urgent low" },
                { value: "low", label: "Low" },
                { value: "high", label: "High" },
                { value: "urgent_high", label: "Urgent high" },
              ]}
              values={draft.em_triggers}
              onChange={(v) => set("em_triggers", v)}
              testIDPrefix="emergency-trigger"
            />
          </View>
          <Field label="Wait before" last value={String(draft.em_delay_minutes)} onChangeText={(v) => setNum("em_delay_minutes", v)} keyboardType="number-pad" suffix="min" testID="emergency-delay-input" />
        </Card>

        <Text style={styles.subTitle}>Text messages (SMS)</Text>
        <Card style={{ paddingVertical: spacing.xs }}>
          <ToggleRow label="Send text messages" value={draft.em_sms} onChange={(v) => set("em_sms", v)} testID="emergency-sms-toggle" last={!draft.em_sms} />
          {draft.em_sms && (
            <>
              <Field label="Resend every" value={String(draft.em_sms_repeat_minutes)} onChangeText={(v) => setNum("em_sms_repeat_minutes", v)} keyboardType="number-pad" suffix="min" testID="emergency-sms-repeat-input" />
              <View style={styles.inlineChips}>
                <Text style={styles.inlineLabel}>Default hours for texts</Text>
                <ScheduleEditor value={draft.em_sms_schedule} onChange={(v) => set("em_sms_schedule", v)} testIDPrefix="emergency-sms-schedule" />
              </View>
            </>
          )}
        </Card>

        <Text style={styles.subTitle}>Voice calls</Text>
        <Card style={{ paddingVertical: spacing.xs }}>
          <ToggleRow label="Make phone calls" sub="A voice reads the alert aloud" value={draft.em_call} onChange={(v) => set("em_call", v)} testID="emergency-call-toggle" last={!draft.em_call} />
          {draft.em_call && (
            <>
              <Field label="Call again every" value={String(draft.em_call_repeat_minutes)} onChangeText={(v) => setNum("em_call_repeat_minutes", v)} keyboardType="number-pad" suffix="min" testID="emergency-call-repeat-input" />
              <View style={styles.inlineChips}>
                <Text style={styles.inlineLabel}>Default hours for calls</Text>
                <ScheduleEditor value={draft.em_call_schedule} onChange={(v) => set("em_call_schedule", v)} testIDPrefix="emergency-call-schedule" />
              </View>
            </>
          )}
        </Card>
        <Hint>
          While glucose stays at the same alarm level, texts and calls repeat at these intervals until you snooze. If the level changes (for
          example low to urgent low), it starts over.
        </Hint>

        <Text style={styles.subTitle}>Contacts</Text>
        <Card style={{ paddingVertical: spacing.xs }}>
          {draft.em_contacts.length === 0 && <Text style={[styles.radioSub, { paddingVertical: spacing.md }]}>No contacts yet.</Text>}
          {draft.em_contacts.map((c, i) => (
            <Pressable
              key={`${c.phone}-${i}`}
              onPress={() => setEditing(i)}
              style={[styles.contactRow, i < draft.em_contacts.length - 1 && styles.bottomBorder]}
              testID={`emergency-contact-${i}`}
            >
              <Ionicons name="person-circle" size={28} color={colors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.radioTitle}>{c.name}</Text>
                <Text style={styles.radioSub}>
                  {c.phone} · Text {channelText(c.sms, draft.em_sms, draft.em_sms_schedule)} · Call{" "}
                  {channelText(c.call, draft.em_call, draft.em_call_schedule)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ))}
        </Card>
        <Button title="Add contact" kind="secondary" onPress={() => setEditing(-1)} testID="emergency-add-contact-button" style={{ marginTop: spacing.sm }} />
        <Button
          title="Send test message"
          kind="danger"
          onPress={() => emTest.mutate()}
          loading={emTest.isPending}
          testID="emergency-test-button"
          style={{ marginTop: spacing.sm }}
        />
        <Hint>Messages are not sent while the demo sensor is selected. Real texts and calls go through Twilio, which charges per message.</Hint>
        {(log.data ?? []).slice(0, 3).map((l) => (
          <Text key={l.id} style={styles.logLine} testID="emergency-log-line">
            {l.test ? "Test" : "Alert"} · {agoText(l.ts)} · {l.results.join(", ")}
          </Text>
        ))}

        <SectionTitle>Nightscout</SectionTitle>
        <Card style={{ paddingVertical: spacing.xs }}>
          <Field label="Site URL" value={draft.ns_url} onChangeText={(v) => set("ns_url", v.trim())} placeholder="https://mysite.herokuapp.com" keyboardType="url" testID="nightscout-url-input" />
          <Field
            label="API secret"
            value={secrets.ns_secret}
            onChangeText={(v) => (setSecrets({ ...secrets, ns_secret: v }), setDirty(true))}
            placeholder={secretPh("ns_secret")}
            secureTextEntry
            testID="nightscout-secret-input"
          />
          <ToggleRow label="Upload to Nightscout" sub="Readings and entries, every minute" value={draft.ns_upload} onChange={(v) => set("ns_upload", v)} testID="nightscout-upload-toggle" last />
        </Card>
        {status.data?.upload_errors?.nightscout ? <Text style={styles.err}>{status.data.upload_errors.nightscout}</Text> : null}
        <Button title="Upload now" kind="secondary" onPress={() => nsUpload.mutate()} loading={nsUpload.isPending} testID="nightscout-upload-button" style={{ marginTop: spacing.sm }} />

        <SectionTitle>Tidepool</SectionTitle>
        <Card style={{ paddingVertical: spacing.xs }}>
          <Field label="Email" value={draft.tp_email} onChangeText={(v) => set("tp_email", v.trim())} placeholder="Tidepool email" keyboardType="email-address" testID="tidepool-email-input" />
          <Field
            label="Password"
            value={secrets.tp_password}
            onChangeText={(v) => (setSecrets({ ...secrets, tp_password: v }), setDirty(true))}
            placeholder={secretPh("tp_password")}
            secureTextEntry
            testID="tidepool-password-input"
          />
          <ToggleRow label="Upload to Tidepool" sub="Every 15 minutes" value={draft.tp_upload} onChange={(v) => set("tp_upload", v)} testID="tidepool-upload-toggle" last />
        </Card>
        {status.data?.upload_errors?.tidepool ? <Text style={styles.err}>{status.data.upload_errors.tidepool}</Text> : null}
        <Button title="Upload now" kind="secondary" onPress={() => tpUpload.mutate()} loading={tpUpload.isPending} testID="tidepool-upload-button" style={{ marginTop: spacing.sm }} />

        <Hint>
          This app is for information only. Don&apos;t make treatment decisions from it alone. Confirm with a meter and follow your care
          team&apos;s advice.
        </Hint>
      </KeyboardAwareScrollView>

      <Sheet visible={!!soundEdit} onClose={() => setSoundEdit(null)} title={soundEdit ? `${SOUND_TITLES[soundEdit]} sound` : ""} testID="alarm-sound-sheet">
        {soundEdit && (
          <SoundPicker
            value={soundEdit === "sensor" ? { style: draft.sensor_warn_style, sound: draft.sensor_warn_sound } : draft.alarm_sounds[soundEdit]}
            soundOnly={soundEdit === "extreme_low"}
            onChange={(v) => {
              if (soundEdit === "sensor") {
                setDraft((d) => (d ? { ...d, sensor_warn_style: v.style, sensor_warn_sound: v.sound } : d));
                setDirty(true);
              } else set("alarm_sounds", { ...draft.alarm_sounds, [soundEdit]: v });
            }}
            testIDPrefix="alarm-sound"
          />
        )}
        {soundEdit && soundEdit !== "sensor" && (
          <TimingFields
            value={draft.alarm_sounds[soundEdit]}
            onChange={(v) => set("alarm_sounds", { ...draft.alarm_sounds, [soundEdit]: { ...draft.alarm_sounds[soundEdit], ...v } })}
            testIDPrefix={`alarm-${soundEdit}`}
          />
        )}
        <Button title="Done" onPress={() => (stopSound(), setSoundEdit(null))} testID="alarm-sound-done-button" style={{ marginTop: spacing.lg }} />
      </Sheet>

      <Sheet visible={!!gaEdit} onClose={() => setGaEdit(null)} title={gaEdit && gaEdit.index >= 0 ? "Edit glucose alarm" : "New glucose alarm"} testID="glucose-alarm-sheet">
        {gaEdit && (
          <>
            <Field
              label="Title"
              value={gaEdit.value.title}
              onChangeText={(v) => setGaEdit({ ...gaEdit, value: { ...gaEdit.value, title: v } })}
              placeholder="e.g. Dropping, eat something"
              autoCapitalize="sentences"
              testID="glucose-alarm-title-input"
            />
            <View style={[styles.alarmRow, styles.bottomBorder]}>
              <ChipRow
                options={[
                  { value: "below", label: "Below" },
                  { value: "above", label: "Above" },
                ]}
                value={gaEdit.value.direction}
                onChange={(v) => setGaEdit({ ...gaEdit, value: { ...gaEdit.value, direction: v } })}
                testIDPrefix="glucose-alarm-direction"
                padded={false}
              />
              <TextInput
                testID="glucose-alarm-value-input"
                value={gaEdit.text}
                onChangeText={(v) => setGaEdit({ ...gaEdit, text: v })}
                keyboardType="decimal-pad"
                style={styles.thrInput}
              />
              <Text style={styles.unitText}>{u}</Text>
            </View>
            <ToggleRow
              label="Alarm on"
              value={gaEdit.value.enabled}
              onChange={(v) => setGaEdit({ ...gaEdit, value: { ...gaEdit.value, enabled: v } })}
              testID="glucose-alarm-enabled-toggle"
              last
            />
            <SoundPicker value={gaEdit.value} onChange={(v) => setGaEdit({ ...gaEdit, value: { ...gaEdit.value, ...v } })} testIDPrefix="glucose-alarm-sound" />
            <TimingFields value={gaEdit.value} onChange={(v) => setGaEdit({ ...gaEdit, value: { ...gaEdit.value, ...v } })} testIDPrefix="glucose-alarm" />
            <Button title="Save alarm" onPress={saveGlucoseAlarm} testID="glucose-alarm-save-button" style={{ marginTop: spacing.lg }} />
            {gaEdit.index >= 0 && (
              <Button
                title="Delete alarm"
                kind="secondary"
                onPress={() => {
                  set("glucose_alarms", draft.glucose_alarms.filter((_, j) => j !== gaEdit.index));
                  setGaEdit(null);
                }}
                testID="glucose-alarm-delete-button"
                style={{ marginTop: spacing.sm }}
              />
            )}
          </>
        )}
      </Sheet>

      <Sheet
        visible={!!reminderEdit}
        onClose={() => setReminderEdit(null)}
        title={reminderEdit && reminderEdit.index >= 0 ? "Edit reminder" : "New reminder"}
        testID="reminder-sheet"
      >
        {reminderEdit && (
          <>
            <Field
              label="Title"
              value={reminderEdit.value.title}
              onChangeText={(v) => setReminderEdit({ ...reminderEdit, value: { ...reminderEdit.value, title: v } })}
              placeholder="e.g. Site change"
              autoCapitalize="sentences"
              testID="reminder-title-input"
            />
            <Field
              label="Time"
              value={reminderEdit.value.time}
              onChangeText={(v) => setReminderEdit({ ...reminderEdit, value: { ...reminderEdit.value, time: asTime(v) } })}
              placeholder="HH:MM"
              keyboardType="number-pad"
              maxLength={5}
              testID="reminder-time-input"
            />
            <View style={styles.inlineChips}>
              <ChipRow
                options={[
                  { value: "daily", label: "Every day" },
                  { value: "once", label: "Once" },
                ]}
                value={reminderEdit.value.repeat}
                onChange={(v) =>
                  setReminderEdit({
                    ...reminderEdit,
                    value: { ...reminderEdit.value, repeat: v, date: v === "once" ? (reminderEdit.value.date ?? format(new Date(), "yyyy-MM-dd")) : null },
                  })
                }
                testIDPrefix="reminder-repeat"
                padded={false}
              />
            </View>
            {reminderEdit.value.repeat === "once" && (
              <Field
                label="Date"
                value={reminderEdit.value.date ?? ""}
                onChangeText={(v) => setReminderEdit({ ...reminderEdit, value: { ...reminderEdit.value, date: v } })}
                placeholder="YYYY-MM-DD"
                keyboardType="numbers-and-punctuation"
                testID="reminder-date-input"
              />
            )}
            <ToggleRow
              label="Reminder on"
              value={reminderEdit.value.enabled}
              onChange={(v) => setReminderEdit({ ...reminderEdit, value: { ...reminderEdit.value, enabled: v } })}
              testID="reminder-enabled-toggle"
              last
            />
            <SoundPicker
              value={reminderEdit.value}
              onChange={(v) => setReminderEdit({ ...reminderEdit, value: { ...reminderEdit.value, ...v } })}
              testIDPrefix="reminder-sound"
            />
            <Button title="Save reminder" onPress={saveReminder} testID="reminder-save-button" style={{ marginTop: spacing.lg }} />
            {reminderEdit.index >= 0 && (
              <Button
                title="Delete reminder"
                kind="secondary"
                onPress={() => {
                  set("reminders", draft.reminders.filter((_, j) => j !== reminderEdit.index));
                  setReminderEdit(null);
                }}
                testID="reminder-delete-button"
                style={{ marginTop: spacing.sm }}
              />
            )}
          </>
        )}
      </Sheet>

      <ContactSheet
        visible={editing !== null}
        contact={editing !== null && editing >= 0 ? draft.em_contacts[editing] : null}
        smsDefault={draft.em_sms_schedule}
        callDefault={draft.em_call_schedule}
        onSave={(c) => {
          const list = [...draft.em_contacts];
          if (editing !== null && editing >= 0) list[editing] = c;
          else list.push(c);
          set("em_contacts", list);
          setEditing(null);
          toast("Contact updated. Tap Save to keep it.", "info");
        }}
        onDelete={
          editing !== null && editing >= 0
            ? () => {
                set("em_contacts", draft.em_contacts.filter((_, j) => j !== editing));
                setEditing(null);
              }
            : undefined
        }
        onClose={() => setEditing(null)}
      />

      <Modal visible={!!notifSheet} transparent animationType="slide" onRequestClose={() => setNotifSheet(null)}>
        <Pressable style={styles.backdrop} onPress={() => setNotifSheet(null)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} testID="notification-permission-sheet">
          <Ionicons name="notifications" size={32} color={colors.brandPrimary} />
          <Text style={styles.sheetTitle}>Get reminded before your sensor ends</Text>
          <Text style={styles.sheetBody}>
            {notifSheet === "settings"
              ? "Notifications are turned off for this app. Turn them on in Settings to get sensor reminders."
              : "We'll remind you 24 hours, 12 hours, 6 hours, 1 hour and 30 minutes before your sensor ends, so you can have a new one ready."}
          </Text>
          {notifSheet === "settings" ? (
            <Button
              title="Open Settings"
              onPress={() => {
                setNotifSheet(null);
                Linking.openSettings();
              }}
              testID="notification-open-settings-button"
            />
          ) : (
            <Button title="Allow notifications" onPress={requestNotifications} testID="notification-allow-button" />
          )}
          <Button title="Not now" kind="secondary" onPress={() => setNotifSheet(null)} testID="notification-not-now-button" />
        </View>
      </Modal>

      <Modal visible={!!permSheet} transparent animationType="slide" onRequestClose={() => setPermSheet(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPermSheet(null)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} testID="location-permission-sheet">
          <Ionicons name="location" size={32} color={colors.brandPrimary} />
          <Text style={styles.sheetTitle}>Share your location in emergencies</Text>
          <Text style={styles.sheetBody}>
            {permSheet === "settings"
              ? "Location is turned off for this app. Turn it on in Settings so your contacts can find you during a severe low."
              : "If a severe low isn't snoozed, your contacts get a map link to where you are. It's only used for these messages."}
          </Text>
          {permSheet === "settings" ? (
            <Button
              title="Open Settings"
              onPress={() => {
                setPermSheet(null);
                Linking.openSettings();
              }}
              testID="location-open-settings-button"
            />
          ) : (
            <Button title="Allow location" onPress={requestLocation} testID="location-allow-button" />
          )}
          <Button title="Not now" kind="secondary" onPress={() => setPermSheet(null)} testID="location-not-now-button" />
        </View>
      </Modal>
    </View>
  );
}

function TimingFields({
  value,
  onChange,
  testIDPrefix,
}: {
  value: { repeat_minutes?: number; snooze_minutes?: number };
  onChange: (v: { repeat_minutes?: number; snooze_minutes?: number }) => void;
  testIDPrefix: string;
}) {
  const num = (t: string) => Math.min(720, parseInt(t.replace(/\D/g, ""), 10) || 0);
  return (
    <View style={{ marginTop: spacing.md }}>
      <Field
        label="Repeat every"
        value={String(value.repeat_minutes ?? 1)}
        onChangeText={(t) => onChange({ repeat_minutes: num(t) })}
        keyboardType="number-pad"
        suffix="min"
        testID={`${testIDPrefix}-repeat-input`}
      />
      <Field
        label="Snooze for"
        value={String(value.snooze_minutes ?? 30)}
        onChangeText={(t) => onChange({ snooze_minutes: num(t) })}
        keyboardType="number-pad"
        suffix="min"
        testID={`${testIDPrefix}-snooze-input`}
        last
      />
    </View>
  );
}

function SoundButton({ onPress, testID }: { onPress: () => void; testID: string }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} hitSlop={6} style={{ width: 32, height: 44, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name="musical-notes" size={20} color={colors.onSurfaceTertiary} />
    </Pressable>
  );
}

function SwitchLike({ value, onChange, testID }: { value: boolean; onChange: (v: boolean) => void; testID: string }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={() => onChange(!value)} hitSlop={8} style={{ width: 36, height: 44, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={value ? "notifications" : "notifications-off-outline"} size={22} color={value ? colors.brandPrimary : colors.muted} />
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: c.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: c.divider,
  },
  title: { fontFamily: fonts.display, fontSize: 28, fontWeight: "700", color: c.onSurface },
  saveBtn: { backgroundColor: c.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.xl, minHeight: 40, minWidth: 80, alignItems: "center", justifyContent: "center" },
  saveText: { color: c.onBrandPrimary, fontFamily: fonts.text, fontWeight: "700", fontSize: 15 },
  radioRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  topBorder: { borderTopWidth: 0.5, borderTopColor: c.divider },
  bottomBorder: { borderBottomWidth: 0.5, borderBottomColor: c.divider },
  radioTitle: { fontFamily: fonts.text, fontSize: 15, fontWeight: "600", color: c.onSurface },
  radioSub: { fontFamily: fonts.text, fontSize: 12, color: c.muted, marginTop: 2 },
  subCard: { marginTop: spacing.sm, paddingVertical: spacing.xs },
  inlineChips: { paddingTop: spacing.sm },
  inlineLabel: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  syncRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md },
  syncText: { flex: 1, fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceTertiary },
  alarmRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52 },
  swatch: { width: 12, height: 12, borderRadius: 6 },
  soundRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48 },
  fixedThr: { lineHeight: 40, color: c.muted, overflow: "hidden" },
  legendRow: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  thrInput: {
    width: 72,
    height: 40,
    backgroundColor: c.surface,
    borderRadius: radius.sm,
    textAlign: "center",
    fontFamily: fonts.display,
    fontSize: 17,
    fontWeight: "700",
    color: c.onSurface,
  },
  unitText: { width: 50, fontFamily: fonts.text, fontSize: 12, color: c.muted },
  subTitle: { fontFamily: fonts.text, fontSize: 13, fontWeight: "700", color: c.muted, marginTop: spacing.lg, marginBottom: spacing.sm, marginLeft: spacing.xs },
  contactRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 56 },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  logLine: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceTertiary, marginTop: spacing.xs, marginHorizontal: spacing.xs },
  err: { fontFamily: fonts.text, fontSize: 12, color: c.error, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  backdrop: { ...({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const), backgroundColor: c.scrim },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: c.surfaceSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  sheetTitle: { fontFamily: fonts.display, fontSize: 22, fontWeight: "700", color: c.onSurface },
  sheetBody: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceTertiary },
}));
