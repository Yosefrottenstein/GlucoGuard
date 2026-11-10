import Ionicons from "@react-native-vector-icons/ionicons";
import { Pressable, Text, TextInput, View } from "react-native";

import type { GlucoseAlarm, Reminder, Settings } from "@/src/api";
import { Button, Card, Field, Hint, SectionTitle, ToggleRow } from "@/src/components/ui";
import { toDisplay, unitLabel } from "@/src/glucose";
import { SOUNDS } from "@/src/sounds";
import { spacing, useTheme } from "@/src/theme";
import { SetSetting, useSettingsStyles } from "./styles";

export type AlarmKey = "urgent_low" | "low" | "high" | "urgent_high";
export type ThrKey = AlarmKey | "target_low" | "target_high";
export const THR: { key: AlarmKey; label: string }[] = [
  { key: "urgent_low", label: "Urgent low" },
  { key: "low", label: "Low" },
  { key: "high", label: "High" },
  { key: "urgent_high", label: "Urgent high" },
];
export const TARGET: { key: ThrKey; label: string }[] = [
  { key: "target_low", label: "Target low" },
  { key: "target_high", label: "Target high" },
];
export const soundText = (a: { style: string; sound: string }) =>
  a.style === "vibrate" ? "Vibrate only" : `${SOUNDS.find((s) => s.id === a.sound)?.label ?? a.sound}${a.style === "both" ? " + vibrate" : ""}`;

export function AlarmsSection({
  draft,
  set,
  setNum,
  thr,
  setThr,
  onSound,
  onEditGlucoseAlarm,
  onEditReminder,
}: {
  draft: Settings;
  set: SetSetting;
  setNum: (key: keyof Settings, text: string) => void;
  thr: Record<ThrKey, string>;
  setThr: (k: ThrKey, v: string) => void;
  onSound: (key: string) => void;
  onEditGlucoseAlarm: (index: number, value: GlucoseAlarm) => void;
  onEditReminder: (index: number, value: Reminder) => void;
}) {
  const styles = useSettingsStyles();
  const { colors } = useTheme();
  const u = unitLabel(draft.unit);

  return (
    <>
      <SectionTitle>Target range</SectionTitle>
      <Card style={{ paddingVertical: spacing.xs }}>
        {TARGET.map((t, i) => (
          <View key={t.key} style={[styles.alarmRow, i === 0 && styles.bottomBorder]}>
            <View style={[styles.swatch, { backgroundColor: t.key === "target_low" ? colors.low : colors.high }]} />
            <Text style={[styles.radioTitle, { flex: 1 }]}>{t.label}</Text>
            <TextInput testID={`target-${t.key}`} value={thr[t.key]} onChangeText={(v) => setThr(t.key, v)} keyboardType="decimal-pad" style={styles.thrInput} />
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
          <SoundButton onPress={() => onSound("extreme_low")} testID="alarm-sound-extreme_low" />
          <SwitchLike value={draft.alarm_extreme_low} onChange={(v) => set("alarm_extreme_low", v)} testID="alarm-toggle-extreme_low" />
        </View>
        {THR.map((t) => (
          <View key={t.key} style={[styles.alarmRow, styles.bottomBorder]}>
            <Text style={[styles.radioTitle, { flex: 1 }]}>{t.label}</Text>
            <TextInput testID={`alarm-threshold-${t.key}`} value={thr[t.key]} onChangeText={(v) => setThr(t.key, v)} keyboardType="decimal-pad" style={styles.thrInput} />
            <Text style={styles.unitText}>{u}</Text>
            <SoundButton onPress={() => onSound(t.key)} testID={`alarm-sound-${t.key}`} />
            <SwitchLike
              value={draft[`alarm_${t.key}` as keyof Settings] as boolean}
              onChange={(v) => set(`alarm_${t.key}` as keyof Settings, v as never)}
              testID={`alarm-toggle-${t.key}`}
            />
          </View>
        ))}
        <ToggleRow label="Missed readings" sub="Alert when no new reading arrives" value={draft.alarm_missed} onChange={(v) => set("alarm_missed", v)} testID="alarm-toggle-missed" />
        <Pressable testID="alarm-sound-missed" onPress={() => onSound("missed")} style={[styles.soundRow, styles.bottomBorder]}>
          <Ionicons name="musical-notes" size={18} color={colors.brandPrimary} />
          <Text style={[styles.radioTitle, { flex: 1 }]}>Missed readings sound</Text>
          <Text style={styles.radioSub}>{soundText(draft.alarm_sounds.missed)}</Text>
        </Pressable>
        <Field label="Missed after" last value={String(draft.missed_minutes)} onChangeText={(v) => setNum("missed_minutes", v)} keyboardType="number-pad" suffix="min" testID="alarm-missed-minutes-input" />
      </Card>
      <Hint>
        Tap the note icon to set each alarm&apos;s sound, vibration, how often it repeats and how long Snooze lasts. Extreme low (below{" "}
        {toDisplay(50, draft.unit)} {u}) always plays sound only. Alarms ring while the app is open or woken by the sensor; emergency messages
        are sent even when the phone is locked.
      </Hint>

      <Text style={styles.subTitle}>Custom glucose alarms</Text>
      <Card style={{ paddingVertical: spacing.xs }}>
        {draft.glucose_alarms.length === 0 && <Text style={[styles.radioSub, { paddingVertical: spacing.md }]}>Add your own alarm for any number, above or below.</Text>}
        {draft.glucose_alarms.map((g, i) => (
          <Pressable
            key={g.id}
            testID={`glucose-alarm-row-${i}`}
            onPress={() => onEditGlucoseAlarm(i, g)}
            style={[styles.contactRow, i < draft.glucose_alarms.length - 1 && styles.bottomBorder]}
          >
            <Ionicons
              name={g.direction === "below" ? "arrow-down-circle" : "arrow-up-circle"}
              size={24}
              color={g.enabled ? (g.direction === "below" ? colors.low : colors.high) : colors.muted}
            />
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
          onEditGlucoseAlarm(-1, { id: `${Date.now()}`, title: "", direction: "below", value: 80, enabled: true, style: "both", sound: "classic", repeat_minutes: 5, snooze_minutes: 30 })
        }
        testID="glucose-alarm-add-button"
        style={{ marginTop: spacing.sm }}
      />

      <SectionTitle>Reminders</SectionTitle>
      <Card style={{ paddingVertical: spacing.xs }}>
        {draft.reminders.length === 0 && <Text style={[styles.radioSub, { paddingVertical: spacing.md }]}>No reminders yet. Add one for site change, insulin, meals…</Text>}
        {draft.reminders.map((r, i) => (
          <Pressable key={r.id} testID={`reminder-row-${i}`} onPress={() => onEditReminder(i, r)} style={[styles.contactRow, i < draft.reminders.length - 1 && styles.bottomBorder]}>
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
        onPress={() => onEditReminder(-1, { id: `${Date.now()}`, title: "", time: "08:00", repeat: "daily", date: null, enabled: true, style: "both", sound: "chime" })}
        testID="reminder-add-button"
        style={{ marginTop: spacing.sm }}
      />
    </>
  );
}

export function TimingFields({
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
      <Field label="Repeat every" value={String(value.repeat_minutes ?? 1)} onChangeText={(t) => onChange({ repeat_minutes: num(t) })} keyboardType="number-pad" suffix="min" testID={`${testIDPrefix}-repeat-input`} />
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
