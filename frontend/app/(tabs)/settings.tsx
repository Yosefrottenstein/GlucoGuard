import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, GlucoseAlarm, Reminder, SensorType, Settings, Source, Status, Unit } from "@/src/api";
import { Sheet } from "@/src/components/Sheet";
import { useAuth } from "@/src/auth";
import { SoundPicker } from "@/src/components/SoundPicker";
import { stopSound } from "@/src/sounds";
import { SENSORS } from "@/src/ble";
import { ChipRow, MultiChipRow } from "@/src/components/ChipRow";
import { AlarmsSection, soundText, THR, TARGET, ThrKey, TimingFields } from "@/src/components/settings/AlarmsSection";
import { EmergencySection } from "@/src/components/settings/EmergencySection";
import { useSettingsStyles } from "@/src/components/settings/styles";
import { DexcomLoginFields, SecretKey, UploadsSection } from "@/src/components/settings/UploadsSection";
import { ContactSheet } from "@/src/components/ContactSheet";
import { PasswordSheet } from "@/src/components/PasswordSheet";
import { EmailSheet, NO_EMAIL_WARNING } from "@/src/components/EmailPrompt";
import { asTime, validTime } from "@/src/components/ScheduleEditor";
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
import { spacing, useTheme } from "@/src/theme";
import { CompanionCard } from "@/src/components/settings/CompanionCard";
import { HealthCard } from "@/src/components/settings/HealthCard";
import { healthPlatform } from "@/src/health";
import { isAndroid } from "@/src/phoneSms";

const useStyles = useSettingsStyles;
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

const EMPTY_SECRETS: Record<SecretKey, string> = { ns_secret: "", dexcom_password: "", libre_password: "", tp_password: "" };

type SourceOpt = { value: Source; title: string; sub: string };
const FOLLOWER: SourceOpt[] = [
  { value: "dexcom", title: "Dexcom Share", sub: "Dexcom G6, G7, ONE, ONE+ and Stelo with Share turned on" },
  { value: "libre", title: "LibreLinkUp", sub: "FreeStyle Libre 2, 2 Plus, 3 and 3 Plus" },
  { value: "nightscout", title: "Nightscout", sub: "Medtronic (CareLink), Eversense, Medtrum, AAPS, Loop and any uploader" },
];
const MASTER: SourceOpt[] = [
  { value: "bluetooth", title: "Bluetooth sensor", sub: "Talk to the sensor directly, then upload to Nightscout and Tidepool" },
  ...(isAndroid
    ? [{ value: "companion" as Source, title: "Companion app", sub: "Read glucose from Dexcom, Libre, Omnipod, CamAPS and other apps on this phone" }]
    : []),
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
  const { username, signOut } = useAuth();
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
  const [pwOpen, setPwOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ username: string; email: string | null }>("/auth/me") });

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
  const dxUpload = action("/dexcom/upload", (d) => `Uploaded ${d.uploaded} readings to Dexcom Share`);
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

  if (!draft) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }
  const u = unitLabel(draft.unit);
  const mode = isFollower(draft.source) ? "follower" : "master";
  const setSecret = (k: SecretKey, v: string) => (setSecrets({ ...secrets, [k]: v }), setDirty(true));
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
        <SectionTitle>Account</SectionTitle>
        <Card style={{ paddingVertical: spacing.xs }}>
          <View style={styles.syncRow}>
            <Ionicons name="person-circle" size={28} color={colors.muted} />
            <Text style={styles.syncText} testID="account-username">
              Signed in as {username || "you"}
            </Text>
            <Button title="Sign out" kind="secondary" onPress={signOut} testID="account-signout-button" />
          </View>
          <Button title="Change password" kind="secondary" onPress={() => setPwOpen(true)} testID="account-password-button" style={{ marginVertical: spacing.sm }} />
          <Pressable testID="account-email-row" onPress={() => setEmailOpen(true)} style={[styles.contactRow, styles.topBorder]}>
            <Ionicons name="mail" size={22} color={me.data?.email ? colors.brandPrimary : colors.warning} />
            <View style={{ flex: 1, paddingVertical: spacing.sm }}>
              <Text style={styles.radioTitle}>Recovery email</Text>
              <Text style={styles.radioSub} testID="account-email-text">
                {me.data?.email ?? NO_EMAIL_WARNING}
              </Text>
            </View>
            <Text style={[styles.radioTitle, { color: colors.brandPrimary }]}>{me.data?.email ? "Change" : "Add"}</Text>
          </Pressable>
        </Card>

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
            : "Master: this phone gets readings itself and uploads them to Nightscout, Tidepool and Dexcom Share."}
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
        {draft.source === "companion" && <CompanionCard />}
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
        {mode === "master" && <Hint>Turn on Nightscout, Tidepool or Dexcom Share upload below so your readings are shared.</Hint>}
        {draft.source === "dexcom" && (
          <Card style={styles.subCard}>
            <DexcomLoginFields
              draft={draft}
              set={set}
              secret={secrets.dexcom_password}
              onSecret={(v) => setSecret("dexcom_password", v)}
              secretPh={secretPh("dexcom_password")}
            />
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

        <AlarmsSection
          draft={draft}
          set={set}
          setNum={setNum}
          thr={thr}
          setThr={(k, v) => (setThr({ ...thr, [k]: v }), setDirty(true))}
          onSound={setSoundEdit}
          onEditGlucoseAlarm={(index, value) => setGaEdit({ index, value, text: index >= 0 ? toDisplay(value.value, draft.unit) : "" })}
          onEditReminder={(index, value) => setReminderEdit({ index, value })}
        />

        <EmergencySection
          draft={draft}
          set={set}
          setNum={setNum}
          ensureLocation={ensureLocation}
          onEditContact={setEditing}
          emTest={emTest}
          log={log.data ?? []}
        />

        <UploadsSection
          draft={draft}
          set={set}
          mode={mode}
          secrets={secrets}
          setSecret={setSecret}
          secretPh={secretPh}
          status={status.data}
          nsUpload={nsUpload}
          tpUpload={tpUpload}
          dxUpload={dxUpload}
        />
        {healthPlatform && <HealthCard />}

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

      <PasswordSheet visible={pwOpen} onClose={() => setPwOpen(false)} />
      {emailOpen && <EmailSheet visible current={me.data?.email} onClose={() => setEmailOpen(false)} />}
      <ContactSheet
        visible={editing !== null}
        contact={editing !== null && editing >= 0 ? draft.em_contacts[editing] : null}
        onTest={async (c, channel) => {
          // save this contact as shown in the sheet, then test only it
          if (draft.em_contacts.some((x, j) => x.phone === c.phone && j !== editing)) throw new Error("This phone number is already a contact");
          const isNew = editing === null || editing < 0;
          const list = [...draft.em_contacts];
          if (isNew) list.push(c);
          else list[editing] = c;
          const data = await api<Settings>("/settings", { method: "PUT", body: { em_contacts: list } });
          qc.setQueryData(["settings"], data);
          setDraft((d) => (d ? { ...d, em_contacts: data.em_contacts } : d));
          if (isNew) setEditing(data.em_contacts.length - 1);
          const r = await api<{ results: string[] }>(`/emergency/test?phone=${encodeURIComponent(c.phone)}&channel=${channel}`, { method: "POST" });
          qc.invalidateQueries({ queryKey: ["emergency-log"] });
          return r.results.join(" · ") || "Nothing to send";
        }}
        onSave={(c) => {
          if (draft.em_contacts.some((x, j) => x.phone === c.phone && j !== editing)) return toast("This phone number is already a contact", "error");
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
