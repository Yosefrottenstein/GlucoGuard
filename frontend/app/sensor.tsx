import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Settings } from "@/src/api";
import { bleSupported, FoundDevice, requestAndroidBluetooth, scan, SENSORS, waitForState } from "@/src/ble";
import { useToast } from "@/src/components/Toast";
import { useG7Status } from "@/src/g7";
import { loadLibre2, useLibre2Status } from "@/src/libre2";
import { LibreScanError, nfcAvailable, scanLibre2 } from "@/src/libreNfc";
import { Button, Card, Hint } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Phase = "intro" | "scanning" | "done" | "blocked" | "off";

export default function SensorScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings") });
  const g7 = useG7Status();
  const libre = useLibre2Status();
  const [phase, setPhase] = useState<Phase>("intro");
  const [devices, setDevices] = useState<FoundDevice[]>([]);
  const [libreSerial, setLibreSerial] = useState<string | null>(null);
  const [hasNfc, setHasNfc] = useState(false);
  const stopRef = useRef<null | (() => void)>(null);

  useEffect(() => () => stopRef.current?.(), []);
  useEffect(() => {
    nfcAvailable().then(setHasNfc);
    loadLibre2().then((s) => setLibreSerial(s?.serial ?? null)).catch(() => {});
  }, []);

  const sensor = settings.data?.bt_sensor ?? "dexcom_g6";
  const info = SENSORS[sensor];

  const nfcScan = useMutation({
    mutationFn: async () => {
      const s = await scanLibre2();
      return api<Settings>("/settings", {
        method: "PUT",
        body: { source: "bluetooth", bt_sensor: "libre2", bt_device_id: "", bt_device_name: `Libre 2 ${s.serial}`, sensor_days: 14 },
      }).then((data) => ({ data, serial: s.serial }));
    },
    onSuccess: ({ data, serial }) => {
      setLibreSerial(serial);
      qc.setQueryData(["settings"], data);
      qc.invalidateQueries();
      toast("Libre 2 ready. Readings start in about a minute.", "success");
    },
    onError: (e: Error) => toast(e instanceof LibreScanError ? e.message : "Scan didn't finish. Hold the phone still on the sensor and try again.", "error"),
  });

  const startScan = async () => {
    if (Platform.OS === "android") {
      const p = await requestAndroidBluetooth();
      if (p !== "granted") return setPhase(p === "blocked" ? "blocked" : "intro");
    }
    const state = await waitForState(); // first call shows the iOS Bluetooth prompt
    if (state === "Unauthorized") return setPhase("blocked");
    if (state !== "PoweredOn") return setPhase("off");
    setDevices([]);
    setPhase("scanning");
    stopRef.current = scan(
      sensor,
      settings.data?.bt_transmitter_id ?? "",
      (d) => setDevices((list) => (list.some((x) => x.id === d.id) ? list : [...list, d])),
      (msg) => {
        toast(msg, "error");
        setPhase("done");
      },
    );
    setTimeout(() => {
      stopRef.current?.();
      setPhase((p) => (p === "scanning" ? "done" : p));
    }, 30000);
  };

  const pair = useMutation({
    mutationFn: (d: FoundDevice) =>
      api<Settings>("/settings", { method: "PUT", body: { source: "bluetooth", bt_device_id: d.id, bt_device_name: d.name } }),
    onSuccess: (data) => {
      stopRef.current?.();
      qc.setQueryData(["settings"], data);
      qc.invalidateQueries();
      toast("Sensor paired", "success");
      if (router.canGoBack()) router.back();
      else router.replace("/settings");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="sensor-back-button" onPress={() => (router.canGoBack() ? router.back() : router.replace("/settings"))} style={styles.back} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Pair sensor</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.lg }}>
        <Card>
          <Text style={styles.sensorLabel} testID="sensor-type-label">
            {info.label}
          </Text>
          <Text style={styles.body}>{info.hint}</Text>
          {settings.data?.bt_device_name ? (
            <Text style={styles.paired} testID="sensor-paired-name">
              Paired: {settings.data.bt_device_name}
            </Text>
          ) : null}
          {sensor === "dexcom_g7" && settings.data?.source === "bluetooth" && bleSupported ? (
            <Text style={styles.body} testID="sensor-live-status">
              Status: {g7.message}
              {g7.sensorState ? ` · Sensor: ${g7.sensorState}` : ""}
              {g7.lastValue ? ` · Last value ${g7.lastValue} mg/dL` : ""}
            </Text>
          ) : null}
          {sensor === "libre2" && settings.data?.source === "bluetooth" && bleSupported ? (
            <Text style={styles.body} testID="sensor-live-status">
              Status: {libre.message}
              {libre.lastValue ? ` · Last value ${libre.lastValue} mg/dL` : ""}
            </Text>
          ) : null}
        </Card>

        {sensor === "libre3" ? (
          <Card testID="sensor-libre3-card">
            <Ionicons name="lock-closed" size={28} color={colors.brandPrimary} />
            <Text style={styles.cardTitle}>Libre 3 can&apos;t be read directly</Text>
            <Text style={styles.body}>
              Abbott protects Libre 3 with strong encryption. No open-source app, including xDrip+, can read it by Bluetooth. Use Follower
              mode with LibreLinkUp: your Libre 3 app uploads and this app shows the readings, alarms and emergency messages.
            </Text>
            <Button
              title="Switch to LibreLinkUp"
              onPress={async () => {
                const data = await api<Settings>("/settings", { method: "PUT", body: { source: "libre" } }).catch(() => null);
                if (data) {
                  qc.setQueryData(["settings"], data);
                  if (router.canGoBack()) router.back();
                  else router.replace("/settings");
                }
              }}
              testID="sensor-libre3-follower-button"
              style={{ marginTop: spacing.md }}
            />
          </Card>
        ) : sensor === "libre2" && bleSupported ? (
          <Card testID="sensor-libre2-card">
            <Ionicons name="scan" size={28} color={colors.brandPrimary} />
            <Text style={styles.cardTitle}>{libreSerial ? `Sensor ${libreSerial}` : "Scan your Libre 2"}</Text>
            <Text style={styles.body}>
              {hasNfc
                ? "Hold the top of your phone on the sensor. This reads its calibration and turns on Bluetooth. Scan again after putting on a new sensor."
                : "This phone has no NFC (or it's turned off). NFC is needed once per sensor to switch on Bluetooth."}
            </Text>
            <Button
              title={libreSerial ? "Scan again" : "Scan sensor"}
              onPress={() => nfcScan.mutate()}
              loading={nfcScan.isPending}
              disabled={!hasNfc}
              testID="sensor-libre2-scan-button"
              style={{ marginTop: spacing.md }}
            />
          </Card>
        ) : !bleSupported ? (
          <Card testID="sensor-needs-build-card">
            <Ionicons name="phone-portrait-outline" size={28} color={colors.brandPrimary} />
            <Text style={styles.cardTitle}>Needs the installed app</Text>
            <Text style={styles.body}>
              Direct Bluetooth only works in the real iPhone app, not in this preview or Expo Go. Publish the app and install it through
              TestFlight, then pair your sensor here.
            </Text>
          </Card>
        ) : phase === "blocked" ? (
          <Card testID="sensor-blocked-card">
            <Text style={styles.cardTitle}>Bluetooth is turned off for GlucoGuard</Text>
            <Text style={styles.body}>Allow Bluetooth in Settings so the app can talk to your sensor.</Text>
            <Button title="Open Settings" onPress={() => Linking.openSettings()} testID="sensor-open-settings-button" style={{ marginTop: spacing.md }} />
          </Card>
        ) : phase === "off" ? (
          <Card>
            <Text style={styles.cardTitle}>Bluetooth is off</Text>
            <Text style={styles.body}>Turn on Bluetooth in Control Center, then try again.</Text>
            <Button title="Try again" onPress={startScan} testID="sensor-retry-button" style={{ marginTop: spacing.md }} />
          </Card>
        ) : (
          <>
            {phase === "intro" && (
              <Card>
                <Ionicons name="bluetooth" size={28} color={colors.brandPrimary} />
                <Text style={styles.cardTitle}>Find your sensor</Text>
                <Text style={styles.body}>
                  The app uses Bluetooth to read your sensor directly. Your phone will ask for permission next.
                </Text>
              </Card>
            )}
            <Button
              title={phase === "scanning" ? "Searching…" : phase === "done" ? "Search again" : "Allow Bluetooth and search"}
              onPress={startScan}
              loading={phase === "scanning"}
              testID="sensor-scan-button"
            />
            {devices.map((d) => (
              <Pressable
                key={d.id}
                testID={`sensor-device-${d.id}`}
                onPress={() => pair.mutate(d)}
                style={({ pressed }) => [styles.device, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="radio-outline" size={22} color={colors.brandPrimary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.deviceName}>{d.name}</Text>
                  <Text style={styles.deviceSub}>Signal {d.rssi ?? "?"} dBm · tap to pair</Text>
                </View>
                {pair.isPending ? <ActivityIndicator color={colors.brandPrimary} /> : null}
              </Pressable>
            ))}
            {phase === "done" && devices.length === 0 && (
              <Text style={styles.empty} testID="sensor-none-found">
                No sensor found. Dexcom transmitters only wake up every 5 minutes, so try again in a moment.
              </Text>
            )}
          </>
        )}
        <Hint>
          {sensor === "dexcom_g7"
            ? "Live G7 readings work while the official Dexcom G7 app keeps running. Starting a new sensor is still done in the Dexcom app."
            : sensor === "libre2"
              ? "Libre 2 readings use Abbott's factory calibration, worked out the same way as xDrip+ and DiaBLE. Values can differ slightly from the Libre app. Check with a meter before treating."
              : sensor === "libre3"
                ? "Libre 2 and European Libre 2 Plus can be read directly; pick Libre 2 in Settings if you have one."
                : `Pairing saves your sensor. Reading glucose straight from ${info.label} isn't built yet. Until then, use Follower mode or manual entry.`}
        </Hint>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, backgroundColor: c.surface },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.display, fontSize: 24, fontWeight: "700", color: c.onSurface },
  sensorLabel: { fontFamily: fonts.display, fontSize: 20, fontWeight: "700", color: c.onSurface },
  cardTitle: { fontFamily: fonts.display, fontSize: 18, fontWeight: "700", color: c.onSurface, marginTop: spacing.sm },
  body: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceTertiary, marginTop: spacing.xs },
  paired: { fontFamily: fonts.text, fontSize: 14, fontWeight: "700", color: c.brandPrimary, marginTop: spacing.sm },
  device: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 56,
  },
  deviceName: { fontFamily: fonts.text, fontSize: 16, fontWeight: "700", color: c.onSurface },
  deviceSub: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  empty: { fontFamily: fonts.text, fontSize: 14, color: c.muted, textAlign: "center" },
}));
