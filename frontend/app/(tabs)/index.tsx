import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { startOfDay } from "date-fns";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, qs, Reading, Settings, Stats, Status, Treatment } from "@/src/api";
import { AISummaryCard } from "@/src/components/AISummaryCard";
import { ChipRow } from "@/src/components/ChipRow";
import { GlucoseChart } from "@/src/components/GlucoseChart";
import { TreatmentSheet } from "@/src/components/TreatmentSheet";
import { useToast } from "@/src/components/Toast";
import { Card } from "@/src/components/ui";
import { agoText, arrow, deltaText, fmtTime, levelColor, minutesAgo, SOURCE_LABELS, toDisplay, unitLabel } from "@/src/glucose";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { useLocationReporter } from "@/src/useLocationReporter";
import { useG7Status } from "@/src/g7";
import { sensorEndsText } from "@/src/sensorAlerts";

const RANGES = [
  { value: "3", label: "3h" },
  { value: "6", label: "6h" },
  { value: "12", label: "12h" },
  { value: "24", label: "24h" },
] as const;
type Range = (typeof RANGES)[number]["value"];

export default function Home() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const qc = useQueryClient();
  const toast = useToast();
  const [range, setRange] = useState<Range>("3");
  const [sheet, setSheet] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const status = useQuery({ queryKey: ["status"], queryFn: () => api<Status>("/status"), refetchInterval: 30000 });
  const g7 = useG7Status();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings") });
  useLocationReporter(!!settings.data?.em_enabled && !!settings.data?.em_location);

  const end = useMemo(() => Date.now(), [status.dataUpdatedAt, range, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = end - Number(range) * 3600000;
  const readings = useQuery({
    queryKey: ["readings", "home", range, Math.floor(end / 60000)],
    queryFn: () => api<Reading[]>(`/readings${qs({ start: new Date(start).toISOString() })}`),
    placeholderData: (prev) => prev,
  });
  const dayStart = startOfDay(new Date());
  const treatments = useQuery({
    queryKey: ["treatments", "home"],
    queryFn: () => api<Treatment[]>(`/treatments${qs({ start: new Date(Date.now() - 24 * 3600000).toISOString() })}`),
    refetchInterval: 60000,
  });
  const today = useQuery({
    queryKey: ["stats", "today", dayStart.toISOString()],
    queryFn: () => api<Stats>(`/stats${qs({ start: dayStart.toISOString() })}`),
    refetchInterval: 120000,
  });

  const alarm = status.data?.alarm;

  const snooze = useMutation({
    mutationFn: () => api("/alarm/ack", { method: "POST", body: {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["status"] });
      toast("Alarm snoozed", "success");
    },
  });
  const delTreatment = useMutation({
    mutationFn: (id: string) => api(`/treatments/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries(),
  });

  const onRefresh = async () => {
    await api("/sync", { method: "POST" }).catch(() => {});
    await qc.invalidateQueries();
  };

  if (status.isLoading || !status.data) {
    return (
      <View style={[styles.root, styles.center]}>
        {status.isError ? (
          <View style={{ alignItems: "center", gap: spacing.md }}>
            <Text style={styles.muted}>Could not reach the server.</Text>
            <Pressable testID="home-retry-button" onPress={() => status.refetch()} style={styles.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator color={colors.brandPrimary} />
        )}
      </View>
    );
  }

  const s = status.data;
  const unit = s.unit;
  const r = s.reading;
  const stale = r ? minutesAgo(r.ts) > 15 : true;
  const valueColor = r && !stale ? levelColor(r.sgv, s.thresholds, colors) : colors.muted;
  const alarmColor = alarm && ["extreme_low", "low", "urgent_low", "missed"].includes(alarm.type) ? colors.error : colors.warning;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.brand}>GlucoGuard</Text>
        <View style={styles.pill} testID="home-source-pill">
          <View style={[styles.dot, { backgroundColor: s.last_error ? colors.error : colors.success }]} />
          <Text style={styles.pillText}>
            {s.source === "bluetooth" && g7.state !== "idle" ? `G7 · ${g7.state === "connected" ? "connected" : "searching"}` : SOURCE_LABELS[s.source]}
          </Text>
        </View>
      </View>

      {alarm && !alarm.snoozed && (
        <Animated.View entering={FadeInDown} style={[styles.alarm, { backgroundColor: alarmColor }]} testID="alarm-banner">
          <Ionicons name="alert-circle" size={22} color={colors.onError} />
          <View style={{ flex: 1 }}>
            <Text style={styles.alarmTitle} testID="alarm-banner-label">
              {alarm.label}
            </Text>
            <Text style={styles.alarmSub}>
              Since {fmtTime(alarm.started_at)}
              {alarm.emergency_sent_at ? " · emergency contacts alerted" : ""}
            </Text>
          </View>
          <Pressable testID="alarm-snooze-button" onPress={() => snooze.mutate()} style={styles.snoozeBtn}>
            <Text style={styles.snoozeText}>Snooze {alarm.snooze_minutes}m</Text>
          </Pressable>
        </Animated.View>
      )}

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottomChrome + 96, gap: spacing.lg }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} />}
      >
        <Animated.View entering={FadeInDown.duration(400)}>
          <Card testID="current-glucose-card">
            {r ? (
              <>
                <View style={styles.valueRow}>
                  <Text
                    testID="current-glucose-value"
                    style={[styles.value, { color: valueColor }, stale && styles.strike]}
                  >
                    {toDisplay(r.sgv, unit)}
                  </Text>
                  <Text testID="current-trend-arrow" style={[styles.arrow, { color: valueColor }]}>
                    {stale ? "" : arrow(r.direction)}
                  </Text>
                </View>
                <View style={styles.metaRow}>
                  <Text style={styles.meta} testID="current-glucose-delta">
                    {deltaText(s.delta, unit) || unitLabel(unit)}
                  </Text>
                  <Text style={styles.meta} testID="current-glucose-age">
                    {agoText(r.ts)}
                  </Text>
                </View>
              </>
            ) : (
              <Text style={styles.muted} testID="no-readings-text">
                {s.source === "bluetooth"
                  ? `Bluetooth sensor: ${g7.message}. Readings appear here when the sensor sends one (every 5 minutes).`
                  : "No readings yet. Pick a data source in Settings."}
              </Text>
            )}
            {s.last_error ? (
              <Text style={styles.errorText} testID="source-error-text">
                {s.last_error}
              </Text>
            ) : null}
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(80)}>
          <Card style={{ paddingHorizontal: spacing.sm }}>
            <ChipRow options={[...RANGES]} value={range} onChange={setRange} testIDPrefix="chart-range" padded={false} />
            <GlucoseChart
              testID="home-glucose-chart"
              readings={readings.data ?? []}
              treatments={treatments.data ?? []}
              start={start}
              end={end}
              thresholds={s.thresholds}
              unit={unit}
            />
            <Text style={styles.chartHint}>Tap a dot to see its value and time</Text>
            {s.sensor ? (
              <Text
                testID="home-sensor-ends"
                style={[
                  styles.sensorNotice,
                  Date.parse(s.sensor.ends_at) - Date.now() < 86400000 && { color: colors.error, fontWeight: "700" },
                ]}
              >
                {sensorEndsText(s.sensor.ends_at)}
              </Text>
            ) : null}
          </Card>
        </Animated.View>

        {today.data && today.data.count > 0 && (
          <Animated.View entering={FadeInDown.duration(400).delay(140)} style={styles.statsRow}>
            <MiniStat label="In range today" value={`${today.data.tir?.in_range ?? 0}%`} testID="today-tir" />
            <MiniStat label="Average" value={toDisplay(today.data.average ?? 0, unit)} testID="today-average" />
            <MiniStat label="Readings" value={String(today.data.count)} testID="today-count" />
          </Animated.View>
        )}

        <AISummaryCard start={dayStart} end={new Date()} label={dayStart.toISOString().slice(0, 10)} />

        <View>
          <Text style={styles.sectionTitle}>Last 24 hours</Text>
          <Card style={{ paddingVertical: spacing.xs }}>
            {(treatments.data ?? []).length === 0 ? (
              <Text style={[styles.muted, { paddingVertical: spacing.md }]}>No insulin, carbs or notes logged.</Text>
            ) : (
              treatments.data!.map((t, i) => (
                <View key={t.id} style={[styles.tRow, i > 0 && styles.tBorder]} testID={`treatment-row-${t.id}`}>
                  <Ionicons
                    name={t.kind === "insulin" ? "eyedrop" : t.kind === "carbs" ? "restaurant" : "document-text"}
                    size={18}
                    color={t.kind === "insulin" ? colors.insulin : t.kind === "carbs" ? colors.carbs : colors.muted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tTitle}>
                      {t.kind === "insulin" ? `${t.insulin} U insulin` : t.kind === "carbs" ? `${t.carbs} g carbs` : "Note"}
                    </Text>
                    {t.note ? <Text style={styles.tNote}>{t.note}</Text> : null}
                  </View>
                  <Text style={styles.tTime}>{fmtTime(t.ts)}</Text>
                  <Pressable
                    hitSlop={10}
                    testID={`treatment-delete-${t.id}`}
                    onPress={() => delTreatment.mutate(t.id)}
                    style={styles.delBtn}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.muted} />
                  </Pressable>
                </View>
              ))
            )}
          </Card>
        </View>
      </ScrollView>

      <Pressable
        testID="add-treatment-fab"
        onPress={() => setSheet(true)}
        style={({ pressed }) => [styles.fab, { bottom: bottomChrome + 16 }, pressed && { transform: [{ scale: 0.95 }] }]}
      >
        <Ionicons name="add" size={30} color={colors.onSurfaceInverse} />
      </Pressable>

      <TreatmentSheet visible={sheet} onClose={() => setSheet(false)} allowReading={s.source === "manual"} unit={unit} />
    </View>
  );
}

function MiniStat({ label, value, testID }: { label: string; value: string; testID: string }) {
  const styles = useStyles();
  return (
    <View style={styles.mini}>
      <Text style={styles.miniValue} testID={testID}>
        {value}
      </Text>
      <Text style={styles.miniLabel}>{label}</Text>
    </View>
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
  },
  brand: { fontFamily: fonts.display, fontSize: 28, fontWeight: "700", color: c.onSurface },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surfaceSecondary,
    paddingHorizontal: spacing.md,
    height: 32,
    borderRadius: radius.pill,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontFamily: fonts.text, fontSize: 13, fontWeight: "600", color: c.onSurfaceTertiary },
  alarm: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  alarmTitle: { color: c.onError, fontFamily: fonts.display, fontSize: 17, fontWeight: "700" },
  alarmSub: { color: c.onError, fontFamily: fonts.text, fontSize: 12, opacity: 0.9 },
  snoozeBtn: { backgroundColor: c.surfaceSecondary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, minHeight: 40, justifyContent: "center" },
  snoozeText: { color: c.onSurface, fontFamily: fonts.text, fontWeight: "700", fontSize: 14 },
  valueRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  value: { fontFamily: fonts.display, fontSize: 84, fontWeight: "700", lineHeight: 92, letterSpacing: -2 },
  strike: { textDecorationLine: "line-through" },
  arrow: { fontSize: 56, fontWeight: "700" },
  metaRow: { flexDirection: "row", justifyContent: "space-between" },
  meta: { fontFamily: fonts.text, fontSize: 15, color: c.onSurfaceTertiary, fontWeight: "500" },
  muted: { fontFamily: fonts.text, fontSize: 14, color: c.muted },
  errorText: { fontFamily: fonts.text, fontSize: 13, color: c.error, marginTop: spacing.sm },
  chartHint: { fontFamily: fonts.text, fontSize: 11, color: c.muted, textAlign: "center", marginTop: spacing.xs },
  sensorNotice: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceTertiary, textAlign: "center", marginTop: 2 },
  statsRow: { flexDirection: "row", gap: spacing.md },
  mini: { flex: 1, backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.md },
  miniValue: { fontFamily: fonts.display, fontSize: 22, fontWeight: "700", color: c.onSurface },
  miniLabel: { fontFamily: fonts.text, fontSize: 12, color: c.muted, marginTop: 2 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 18, fontWeight: "700", color: c.onSurface, marginBottom: spacing.sm },
  tRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 52 },
  tBorder: { borderTopWidth: 0.5, borderTopColor: c.divider },
  tTitle: { fontFamily: fonts.text, fontSize: 15, fontWeight: "600", color: c.onSurface },
  tNote: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  tTime: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  delBtn: { width: 36, height: 44, alignItems: "center", justifyContent: "center" },
  fab: {
    position: "absolute",
    right: spacing.lg,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: c.surfaceInverse,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  retry: { backgroundColor: c.brandPrimary, paddingHorizontal: spacing.xl, minHeight: 44, borderRadius: radius.md, justifyContent: "center" },
  retryText: { color: c.onBrandPrimary, fontFamily: fonts.text, fontWeight: "700" },
}));
