import { Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import type { Gri } from "@/src/api";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { Card } from "./ui";

const ZONES = ["A", "B", "C", "D", "E"] as const;
const ZONE_TEXT: Record<Gri["zone"], string> = {
  A: "Lowest risk",
  B: "Low risk",
  C: "Moderate risk",
  D: "High risk",
  E: "Highest risk",
};

/** Glycemia Risk Index: 0 (lowest risk) to 100 (highest). Lows count most. */
export function GriCard({ gri }: { gri: Gri }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const zoneColor = { A: colors.inRange, B: colors.brandPrimary, C: colors.high, D: colors.warning, E: colors.low }[gri.zone];

  return (
    <Animated.View entering={FadeInDown.duration(350).delay(40)}>
      <Card testID="gri-card">
        <Text style={styles.title}>Glycemia Risk Index (GRI)</Text>
        <View style={styles.row}>
          <Text style={[styles.big, { color: zoneColor }]} testID="stats-gri-value">
            {gri.value}
          </Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.zone, { color: zoneColor }]} testID="stats-gri-zone">
              Zone {gri.zone} · {ZONE_TEXT[gri.zone]}
            </Text>
            <Text style={styles.sub}>0 is the lowest risk, 100 the highest. Lower is better.</Text>
          </View>
        </View>
        <View style={styles.scale}>
          {ZONES.map((z) => (
            <View key={z} style={[styles.seg, z === gri.zone && { backgroundColor: zoneColor }]}>
              <Text style={[styles.segText, z === gri.zone && { color: colors.onBrandPrimary }]}>{z}</Text>
            </View>
          ))}
        </View>
        <View style={styles.marker}>
          <View style={[styles.dot, { left: `${Math.min(98, gri.value)}%`, backgroundColor: zoneColor }]} />
        </View>
        <View style={styles.parts}>
          <Text style={styles.part} testID="stats-gri-hypo">
            Low part {gri.hypo}
          </Text>
          <Text style={styles.part} testID="stats-gri-hyper">
            High part {gri.hyper}
          </Text>
        </View>
        <Text style={styles.note}>
          Developed by diabetes experts led by Dr. David Klonoff and checked against how clinicians rank real CGM reports. Time below 54 mg/dL
          weighs most, then 54–69, then above 250 and 181–250.
        </Text>
      </Card>
    </Animated.View>
  );
}

const useStyles = makeStyles((c) => ({
  title: { fontFamily: fonts.text, fontSize: 14, fontWeight: "600", color: c.muted },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginVertical: spacing.xs },
  big: { fontFamily: fonts.display, fontSize: 48, fontWeight: "700" },
  zone: { fontFamily: fonts.text, fontSize: 16, fontWeight: "700" },
  sub: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceTertiary, marginTop: 2 },
  scale: { flexDirection: "row", gap: 4, marginTop: spacing.sm },
  seg: { flex: 1, height: 24, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceTertiary },
  segText: { fontFamily: fonts.text, fontSize: 12, fontWeight: "700", color: c.onSurfaceTertiary },
  marker: { height: 10, marginTop: 4 },
  dot: { position: "absolute", width: 10, height: 10, borderRadius: 5 },
  parts: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm },
  part: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceTertiary },
  note: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.muted, marginTop: spacing.md },
}));
