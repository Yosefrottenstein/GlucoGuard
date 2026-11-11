import { useQuery } from "@tanstack/react-query";
import { addDays, format, startOfDay } from "date-fns";
import { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, qs, Stats, Status } from "@/src/api";
import { ChipRow } from "@/src/components/ChipRow";
import { Card } from "@/src/components/ui";
import { GriCard } from "@/src/components/GriCard";
import { toDisplay, unitLabel } from "@/src/glucose";
import { usesNativeTabs } from "@/src/navigation";
import { sensorEndsText } from "@/src/sensorAlerts";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const PERIODS = [
  { value: "1", label: "Today" },
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
] as const;
type Period = (typeof PERIODS)[number]["value"];

export default function StatsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const [period, setPeriod] = useState<Period>("7");
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<Status>("/status") });
  const start = useMemo(() => startOfDay(addDays(new Date(), -(Number(period) - 1))), [period]);
  const stats = useQuery({
    queryKey: ["stats", "screen", period],
    queryFn: () => api<Stats>(`/stats${qs({ start: start.toISOString() })}`),
  });
  const unit = status.data?.unit ?? "mgdl";
  const t = status.data?.thresholds;
  const d = stats.data;
  const u = unitLabel(unit);

  const lo = d?.bands?.low ?? Math.max(t?.target_low ?? 70, 54);
  const hi = d?.bands?.high ?? Math.min(t?.target_high ?? 180, 250);
  const segments = d?.tir
    ? [
        { key: "very_high", label: `Very high (>${toDisplay(250, unit)})`, value: d.tir.very_high, color: colors.low },
        ...(hi < 250
          ? [{ key: "high", label: `High (${toDisplay(hi + 1, unit)}–${toDisplay(250, unit)})`, value: d.tir.high, color: colors.high }]
          : []),
        { key: "in_range", label: `In range (${toDisplay(lo, unit)}–${toDisplay(hi, unit)})`, value: d.tir.in_range, color: colors.inRange },
        ...(lo > 54
          ? [{ key: "low", label: `Low (${toDisplay(54, unit)}–${toDisplay(lo - 1, unit)})`, value: d.tir.low, color: colors.warning }]
          : []),
        { key: "very_low", label: `Very low (<${toDisplay(54, unit)})`, value: d.tir.very_low, color: colors.low },
      ]
    : [];

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>Statistics</Text>
        <ChipRow options={[...PERIODS]} value={period} onChange={setPeriod} testIDPrefix="stats-period" />
      </View>
      {stats.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : !d || d.count === 0 ? (
        <View style={styles.center}>
          <Text style={styles.muted} testID="stats-empty">
            Not enough readings yet for statistics.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottomChrome + 24, gap: spacing.lg }}>
          {status.data?.sensor && (
            <Card testID="stats-sensor-card">
              <Text style={styles.cardTitle}>Sensor</Text>
              <View style={styles.legendRow}>
                <Text style={styles.legend}>Started on</Text>
                <Text style={styles.legendValue} testID="stats-sensor-started">
                  {format(new Date(status.data.sensor.started_at), "EEE, MMM d · HH:mm")}
                </Text>
              </View>
              <View style={[styles.legendRow, { marginTop: spacing.sm }]}>
                <Text style={styles.legend}>Ends on</Text>
                <Text style={styles.legendValue} testID="stats-sensor-ends">
                  {format(new Date(status.data.sensor.ends_at), "EEE, MMM d · HH:mm")}
                </Text>
              </View>
              <Text style={[styles.footnote, { textAlign: "left", marginTop: spacing.sm }]}>{sensorEndsText(status.data.sensor.ends_at)}</Text>
            </Card>
          )}
          <Animated.View entering={FadeInDown.duration(350)}>
            <Card testID="tir-card">
              <Text style={styles.cardTitle}>Time in range</Text>
              <Text style={styles.big} testID="stats-tir-value">
                {d.tir!.in_range}%
              </Text>
              <View style={styles.bar}>
                {segments
                  .slice()
                  .reverse()
                  .map((s) => (s.value > 0 ? <View key={s.key} style={{ flex: s.value, backgroundColor: s.color }} /> : null))}
              </View>
              <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                {segments.map((s) => (
                  <View key={s.key} style={styles.legendRow}>
                    <View style={[styles.swatch, { backgroundColor: s.color }]} />
                    <Text style={styles.legend}>{s.label}</Text>
                    <Text style={styles.legendValue} testID={`stats-tir-${s.key}`}>
                      {s.value}%
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          </Animated.View>
          {d.gri && <GriCard gri={d.gri} />}
          <Animated.View entering={FadeInDown.duration(350).delay(80)} style={styles.grid}>
            <Tile label="Average" value={toDisplay(d.average!, unit)} sub={u} testID="stats-average" />
            <Tile label="Median" value={toDisplay(d.median!, unit)} sub={u} testID="stats-median" />
            <Tile label="GMI" value={`${d.gmi}%`} sub="glucose mgmt. indicator" testID="stats-gmi" />
            <Tile label="Est. HbA1c" value={`${d.a1c}%`} sub="from average" testID="stats-a1c" />
            <Tile label="Std. deviation" value={toDisplay(d.sd!, unit)} sub={u} testID="stats-sd" />
            <Tile label="Variability (CV)" value={`${d.cv}%`} sub={d.cv! <= 36 ? "stable" : "high"} testID="stats-cv" />
            <Tile label="Lowest" value={toDisplay(d.min!, unit)} sub={u} testID="stats-min" />
            <Tile label="Highest" value={toDisplay(d.max!, unit)} sub={u} testID="stats-max" />
            <Tile label="Readings" value={String(d.count)} sub={`${d.capture}% captured`} testID="stats-count" />
          </Animated.View>
          <Text style={styles.footnote}>
            GMI and HbA1c are estimates from sensor readings and may differ from a lab test.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

function Tile({ label, value, sub, testID }: { label: string; value: string; sub: string; testID: string }) {
  const styles = useStyles();
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue} testID={testID}>
        {value}
      </Text>
      <Text style={styles.tileSub}>{sub}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { backgroundColor: c.surface, borderBottomWidth: 0.5, borderBottomColor: c.divider },
  title: { fontFamily: fonts.display, fontSize: 28, fontWeight: "700", color: c.onSurface, paddingHorizontal: spacing.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  muted: { fontFamily: fonts.text, fontSize: 14, color: c.muted, textAlign: "center" },
  cardTitle: { fontFamily: fonts.text, fontSize: 14, fontWeight: "600", color: c.muted },
  big: { fontFamily: fonts.display, fontSize: 48, fontWeight: "700", color: c.inRange, marginVertical: spacing.xs },
  bar: { flexDirection: "row", height: 18, borderRadius: radius.sm, overflow: "hidden", backgroundColor: c.surfaceTertiary },
  legendRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  legend: { flex: 1, fontFamily: fonts.text, fontSize: 14, color: c.onSurfaceTertiary },
  legendValue: { fontFamily: fonts.display, fontSize: 15, fontWeight: "700", color: c.onSurface },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  tile: { width: "47.5%", flexGrow: 1, backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg },
  tileLabel: { fontFamily: fonts.text, fontSize: 13, color: c.muted, fontWeight: "600" },
  tileValue: { fontFamily: fonts.display, fontSize: 28, fontWeight: "700", color: c.onSurface, marginTop: spacing.xs },
  tileSub: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  footnote: { fontFamily: fonts.text, fontSize: 12, color: c.muted, textAlign: "center" },
}));
