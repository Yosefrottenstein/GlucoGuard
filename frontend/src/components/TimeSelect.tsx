import { Pressable, Text, View } from "react-native";

import { fonts, makeStyles, radius, spacing } from "@/src/theme";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

/** Tap-to-pick hour and minute grid, no typing. */
export function TimeGrid({ value, onChange, testIDPrefix }: { value: string; onChange: (v: string) => void; testIDPrefix: string }) {
  const styles = useStyles();
  const [h, m] = value.split(":");
  return (
    <View style={styles.wrap} testID={`${testIDPrefix}-grid`}>
      <Text style={styles.label}>Hour</Text>
      <View style={styles.grid}>
        {HOURS.map((x) => (
          <Pressable key={x} testID={`${testIDPrefix}-hour-${x}`} onPress={() => onChange(`${x}:${m}`)} style={[styles.cell, x === h && styles.on]}>
            <Text style={[styles.cellText, x === h && styles.onText]}>{x}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Minute</Text>
      <View style={styles.grid}>
        {MINUTES.map((x) => (
          <Pressable key={x} testID={`${testIDPrefix}-minute-${x}`} onPress={() => onChange(`${h}:${x}`)} style={[styles.cell, x === m && styles.on]}>
            <Text style={[styles.cellText, x === m && styles.onText]}>:{x}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { backgroundColor: c.surface, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm },
  label: { fontFamily: fonts.text, fontSize: 12, color: c.muted, marginVertical: spacing.xs },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  cell: { width: "14.6%", minHeight: 44, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  on: { backgroundColor: c.brandPrimary },
  cellText: { fontFamily: fonts.display, fontSize: 15, fontWeight: "600", color: c.onSurface },
  onText: { color: c.onBrandPrimary },
}));
