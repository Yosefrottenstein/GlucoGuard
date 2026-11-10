import { useQuery } from "@tanstack/react-query";
import { fetch as expoFetch } from "expo/fetch";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { api, apiUrl } from "@/src/api";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const BG =
  "https://images.unsplash.com/photo-1635776062360-af423602aff3?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=900";

export function AISummaryCard({ start, end, label }: { start: Date; end: Date; label: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const saved = useQuery({
    queryKey: ["summary", label],
    queryFn: () => api<{ text: string | null }>(`/ai/summary?label=${encodeURIComponent(label)}`),
  });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (saved.data?.text && !busy) setText(saved.data.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.data?.text]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setText("");
    try {
      const res = await expoFetch(apiUrl("/ai/summary"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: start.toISOString(), end: end.toISOString(), label }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.detail ?? "The summary could not be written right now.");
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          const line = p.replace(/^data: /, "").trim();
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.delta) setText((t) => t + ev.delta);
          if (ev.error) throw new Error(ev.error);
        }
      }
      saved.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card} testID="ai-summary-card">
      <Image source={{ uri: BG }} style={styles.bg} contentFit="cover" />
      <LinearGradient colors={["rgba(0,0,0,0.25)", "rgba(0,0,0,0.78)"]} style={styles.bg} />
      <View style={styles.inner}>
        <View style={styles.header}>
          <Ionicons name="sparkles" size={16} color={colors.onSurfaceInverse} />
          <Text style={styles.title}>Daily recap</Text>
        </View>
        {text ? (
          <Text style={styles.body} testID="ai-summary-text">
            {text}
          </Text>
        ) : (
          <Text style={styles.body}>{busy ? "Reading your day…" : "Get a short written recap of your glucose today."}</Text>
        )}
        {error ? (
          <Text style={styles.error} testID="ai-summary-error">
            {error}
          </Text>
        ) : null}
        <Pressable
          testID="ai-summary-generate-button"
          onPress={generate}
          disabled={busy}
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}
        >
          {busy ? (
            <ActivityIndicator color={colors.onSurface} />
          ) : (
            <Text style={styles.btnText}>{text ? "Refresh recap" : "Write my recap"}</Text>
          )}
        </Pressable>
        <Text style={styles.disclaimer}>Written by AI. Not medical advice.</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { borderRadius: radius.lg, overflow: "hidden", minHeight: 180 },
  bg: { ...({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const) },
  inner: { padding: spacing.lg, gap: spacing.md },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { color: c.onSurfaceInverse, fontFamily: fonts.display, fontSize: 18, fontWeight: "700" },
  body: { color: c.onSurfaceInverse, fontFamily: fonts.text, fontSize: 15, lineHeight: 22 },
  error: { color: c.onSurfaceInverse, fontFamily: fonts.text, fontSize: 13, backgroundColor: c.error, padding: spacing.sm, borderRadius: radius.sm },
  btn: {
    alignSelf: "flex-start",
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    minWidth: 140,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { color: c.onSurface, fontFamily: fonts.text, fontSize: 14, fontWeight: "700" },
  disclaimer: { color: c.onSurfaceInverse, opacity: 0.7, fontFamily: fonts.text, fontSize: 11 },
}));
