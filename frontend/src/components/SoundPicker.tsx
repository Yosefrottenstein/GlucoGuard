import Ionicons from "@react-native-vector-icons/ionicons";
import { Pressable, Text, View } from "react-native";

import { AlarmSound, AlertStyle, playSound, SOUNDS, SoundId } from "@/src/sounds";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { ChipRow } from "./ChipRow";

export function SoundPicker({
  value,
  onChange,
  soundOnly,
  testIDPrefix,
}: {
  value: AlarmSound;
  onChange: (v: AlarmSound) => void;
  soundOnly?: boolean;
  testIDPrefix: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View>
      <Text style={styles.label}>Alert with</Text>
      {soundOnly ? (
        <Text style={styles.locked} testID={`${testIDPrefix}-locked`}>
          Sound only. This alarm always plays out loud.
        </Text>
      ) : (
        <ChipRow
          options={[
            { value: "both", label: "Sound + vibrate" },
            { value: "sound", label: "Sound" },
            { value: "vibrate", label: "Vibrate only" },
          ]}
          value={value.style}
          onChange={(v: AlertStyle) => onChange({ ...value, style: v })}
          testIDPrefix={`${testIDPrefix}-style`}
          padded={false}
        />
      )}
      {value.style !== "vibrate" && (
        <>
          <Text style={styles.label}>Sound</Text>
          <View style={styles.list}>
            {SOUNDS.map((s) => {
              const active = s.id === value.sound;
              return (
                <Pressable
                  key={s.id}
                  testID={`${testIDPrefix}-sound-${s.id}`}
                  onPress={() => {
                    onChange({ ...value, sound: s.id as SoundId });
                    playSound(s.id);
                  }}
                  style={[styles.row, active && styles.rowActive]}
                >
                  <Ionicons name={active ? "radio-button-on" : "radio-button-off"} size={20} color={active ? colors.brandPrimary : colors.borderStrong} />
                  <Text style={styles.rowText}>{s.label}</Text>
                  <Ionicons name="play-circle-outline" size={22} color={colors.muted} />
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  label: { fontFamily: fonts.text, fontSize: 13, color: c.muted, marginTop: spacing.md },
  locked: { fontFamily: fonts.text, fontSize: 14, fontWeight: "600", color: c.error, marginVertical: spacing.sm },
  list: { marginTop: spacing.sm, borderRadius: radius.md, backgroundColor: c.surface, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, minHeight: 46 },
  rowActive: { backgroundColor: c.brandTertiary },
  rowText: { flex: 1, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
}));
