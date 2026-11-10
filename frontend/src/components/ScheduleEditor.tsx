import { Text, TextInput, View } from "react-native";

import type { ChannelSchedule } from "@/src/api";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { ChipRow } from "./ChipRow";

const NIGHT = { start: "00:00", end: "07:00" };

// Formats typed digits as HH:MM
const asTime = (text: string) => {
  const d = text.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
};

export const validTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

export const describeSchedule = (s: ChannelSchedule) => (s.mode === "hours" ? `${s.start}–${s.end}` : "always");

export function ScheduleEditor({
  value,
  onChange,
  allowDefault,
  defaultText,
  testIDPrefix,
}: {
  value: ChannelSchedule;
  onChange: (v: ChannelSchedule) => void;
  allowDefault?: boolean;
  defaultText?: string;
  testIDPrefix: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const current =
    value.mode === "hours" ? (value.start === NIGHT.start && value.end === NIGHT.end ? "night" : "custom") : value.mode;

  const options = [
    ...(allowDefault ? [{ value: "default", label: "Default" }] : []),
    { value: "always", label: "Always" },
    { value: "night", label: "Night 00–07" },
    { value: "custom", label: "Custom hours" },
  ];

  const pick = (v: string) => {
    if (v === "default" || v === "always") onChange({ ...value, mode: v });
    else if (v === "night") onChange({ ...value, mode: "hours", ...NIGHT });
    else
      onChange({
        ...value,
        mode: "hours",
        start: current === "custom" ? value.start : "22:00",
        end: current === "custom" ? value.end : "07:00",
      });
  };

  return (
    <View>
      <ChipRow options={options} value={current} onChange={pick} testIDPrefix={testIDPrefix} padded={false} />
      {current === "default" && defaultText ? <Text style={styles.note}>{defaultText}</Text> : null}
      {current === "custom" && (
        <View style={styles.timesRow}>
          <Text style={styles.label}>From</Text>
          <TextInput
            testID={`${testIDPrefix}-start-input`}
            value={value.start}
            onChangeText={(t) => onChange({ ...value, start: asTime(t) })}
            keyboardType="number-pad"
            placeholder="22:00"
            placeholderTextColor={colors.muted}
            style={[styles.time, !validTime(value.start) && styles.bad]}
            maxLength={5}
          />
          <Text style={styles.label}>to</Text>
          <TextInput
            testID={`${testIDPrefix}-end-input`}
            value={value.end}
            onChangeText={(t) => onChange({ ...value, end: asTime(t) })}
            keyboardType="number-pad"
            placeholder="07:00"
            placeholderTextColor={colors.muted}
            style={[styles.time, !validTime(value.end) && styles.bad]}
            maxLength={5}
          />
        </View>
      )}
      {value.mode === "hours" && (
        <Text style={styles.note}>
          Active {value.start}–{value.end} every day, your phone&apos;s time
        </Text>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  timesRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
  label: { fontFamily: fonts.text, fontSize: 14, color: c.onSurfaceTertiary },
  time: {
    width: 76,
    height: 40,
    backgroundColor: c.surface,
    borderRadius: radius.sm,
    textAlign: "center",
    fontFamily: fonts.display,
    fontSize: 17,
    fontWeight: "700",
    color: c.onSurface,
    borderWidth: 1,
    borderColor: c.surface,
  },
  bad: { borderColor: c.error },
  note: { fontFamily: fonts.text, fontSize: 12, color: c.muted, marginBottom: spacing.sm },
}));
