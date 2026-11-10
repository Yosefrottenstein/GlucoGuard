import Ionicons from "@react-native-vector-icons/ionicons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { ChannelSchedule, TimeWindow } from "@/src/api";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { ChipRow } from "./ChipRow";
import { TimeGrid } from "./TimeSelect";

const DAY_SHORT = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_NAME = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ALL = [0, 1, 2, 3, 4, 5, 6];
const PRESETS: { label: string; days: number[] }[] = [
  { label: "Every day", days: ALL },
  { label: "Weekdays", days: [0, 1, 2, 3, 4] },
  { label: "Weekend", days: [5, 6] },
];
const newWindow = (): TimeWindow => ({ days: ALL, start: "22:00", end: "07:00" });

// Formats typed digits as HH:MM
export const asTime = (text: string) => {
  const d = text.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
};

export const validTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export const describeDays = (days: number[]) => {
  const preset = PRESETS.find((p) => sameDays(p.days, days));
  if (preset) return preset.label === "Every day" ? "" : `${preset.label} `;
  return `${days.map((d) => DAY_NAME[d]).join(", ")} `;
};

export const describeWindow = (w: TimeWindow) => `${describeDays(w.days)}${w.start}–${w.end}`;

export const describeSchedule = (s: ChannelSchedule) => {
  if (s.mode !== "hours" || !s.windows.length) return "any time";
  return s.windows.length === 1 ? describeWindow(s.windows[0]) : `${describeWindow(s.windows[0])} +${s.windows.length - 1} more`;
};

export function ScheduleEditor({
  value,
  onChange,
  testIDPrefix,
}: {
  value: ChannelSchedule;
  onChange: (v: ChannelSchedule) => void;
  testIDPrefix: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const options = [
    { value: "always" as const, label: "Any time" },
    { value: "hours" as const, label: "Only at set hours" },
  ];
  const pick = (mode: ChannelSchedule["mode"]) =>
    onChange({ ...value, mode, windows: mode === "hours" && !value.windows.length ? [newWindow()] : value.windows });
  const setWindow = (i: number, w: TimeWindow) => onChange({ ...value, windows: value.windows.map((x, j) => (j === i ? w : x)) });

  return (
    <View>
      <ChipRow options={options} value={value.mode === "hours" ? "hours" : "always"} onChange={pick} testIDPrefix={testIDPrefix} padded={false} />
      {value.mode === "hours" && (
        <>
          {value.windows.map((w, i) => (
            <WindowEditor
              key={`${i}-${value.windows.length}`}
              value={w}
              onChange={(nw) => setWindow(i, nw)}
              onRemove={value.windows.length > 1 ? () => onChange({ ...value, windows: value.windows.filter((_, j) => j !== i) }) : undefined}
              testIDPrefix={`${testIDPrefix}-window-${i}`}
            />
          ))}
          {value.windows.length < 10 && (
            <Pressable
              testID={`${testIDPrefix}-add-window`}
              onPress={() => onChange({ ...value, windows: [...value.windows, { days: ALL, start: "13:00", end: "15:00" }] })}
              style={styles.add}
            >
              <Ionicons name="add-circle" size={18} color={colors.brandPrimary} />
              <Text style={styles.addText}>Add another time window</Text>
            </Pressable>
          )}
          <Text style={styles.note}>Uses your phone&apos;s time zone. A window like 22:00–07:00 runs overnight into the next day.</Text>
        </>
      )}
    </View>
  );
}

function WindowEditor({
  value,
  onChange,
  onRemove,
  testIDPrefix,
}: {
  value: TimeWindow;
  onChange: (w: TimeWindow) => void;
  onRemove?: () => void;
  testIDPrefix: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState<null | "start" | "end">(null);
  const toggleDay = (d: number) => {
    const days = value.days.includes(d) ? value.days.filter((x) => x !== d) : [...value.days, d].sort();
    if (days.length) onChange({ ...value, days });
  };

  return (
    <View style={styles.window} testID={testIDPrefix}>
      <View style={styles.daysRow}>
        {DAY_SHORT.map((l, d) => {
          const on = value.days.includes(d);
          return (
            <Pressable
              key={d}
              testID={`${testIDPrefix}-day-${d}`}
              accessibilityLabel={DAY_NAME[d]}
              onPress={() => toggleDay(d)}
              style={[styles.day, on && styles.dayOn]}
            >
              <Text style={[styles.dayText, on && styles.dayTextOn]}>{l}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.presets}>
        {PRESETS.map((p) => (
          <Pressable key={p.label} testID={`${testIDPrefix}-preset-${p.label}`} onPress={() => onChange({ ...value, days: p.days })} hitSlop={6}>
            <Text style={[styles.preset, sameDays(p.days, value.days) && { color: colors.brandPrimary }]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.timesRow}>
        <Text style={styles.label}>From</Text>
        <TimeButton value={value.start} active={open === "start"} onPress={() => setOpen(open === "start" ? null : "start")} testID={`${testIDPrefix}-start`} />
        <Text style={styles.label}>to</Text>
        <TimeButton value={value.end} active={open === "end"} onPress={() => setOpen(open === "end" ? null : "end")} testID={`${testIDPrefix}-end`} />
        <View style={{ flex: 1 }} />
        {onRemove && (
          <Pressable testID={`${testIDPrefix}-remove`} onPress={onRemove} hitSlop={8} style={styles.remove} accessibilityLabel="Remove time window">
            <Ionicons name="trash-outline" size={20} color={colors.muted} />
          </Pressable>
        )}
      </View>
      {open && (
        <TimeGrid value={value[open]} onChange={(t) => onChange({ ...value, [open]: t })} testIDPrefix={`${testIDPrefix}-${open}`} />
      )}
    </View>
  );
}

function TimeButton({ value, active, onPress, testID }: { value: string; active: boolean; onPress: () => void; testID: string }) {
  const styles = useStyles();
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.time, active && styles.timeActive]}>
      <Text style={styles.timeText}>{value}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  window: { backgroundColor: c.surface, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm },
  daysRow: { flexDirection: "row", justifyContent: "space-between", gap: 4 },
  day: { flex: 1, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  dayOn: { backgroundColor: c.brandPrimary },
  dayText: { fontFamily: fonts.text, fontSize: 14, fontWeight: "700", color: c.onSurfaceTertiary },
  dayTextOn: { color: c.onBrandPrimary },
  presets: { flexDirection: "row", gap: spacing.lg, marginLeft: spacing.xs },
  preset: { fontFamily: fonts.text, fontSize: 13, fontWeight: "600", color: c.muted, lineHeight: 44 },
  timesRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  label: { fontFamily: fonts.text, fontSize: 14, color: c.onSurfaceTertiary },
  time: {
    minWidth: 80,
    height: 44,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1.5,
    borderColor: c.surfaceSecondary,
  },
  timeActive: { borderColor: c.brandPrimary },
  timeText: { fontFamily: fonts.display, fontSize: 17, fontWeight: "700", color: c.onSurface },
  remove: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  add: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 44, marginTop: spacing.xs },
  addText: { fontFamily: fonts.text, fontSize: 14, fontWeight: "700", color: c.brandPrimary },
  note: { fontFamily: fonts.text, fontSize: 12, color: c.muted, marginVertical: spacing.sm },
}));
