import Ionicons from "@react-native-vector-icons/ionicons";
import { useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { api } from "@/src/api";
import { Button } from "@/src/components/ui";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

type Flow = { url: string; redirect_uri: string; state: string };

const codeFrom = (url: string) => /[?&]code=([^&#]+)/.exec(url)?.[1];

export function CareLinkLogin({ flow, onClose, onDone }: { flow: Flow | null; onClose: () => void; onDone: (username: string) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  const finish = async (code: string) => {
    if (!flow || handled.current) return;
    handled.current = true;
    setBusy(true);
    try {
      const r = await api<{ username: string }>("/carelink/finish", { method: "POST", body: { code: decodeURIComponent(code), state: flow.state } });
      onDone(r.username);
    } catch (e) {
      setError((e as Error).message);
      handled.current = false;
    } finally {
      setBusy(false);
    }
  };

  // Medtronic only returns the code to its own app address, so the page is caught right before that jump.
  const intercept = (url: string) => {
    if (flow && url.startsWith(flow.redirect_uri)) {
      const code = codeFrom(url);
      if (code) finish(code);
      else setError("Medtronic didn't finish the sign-in. Please try again.");
      return false;
    }
    return true;
  };

  return (
    <Modal visible={!!flow} animationType="slide" onRequestClose={onClose} onShow={() => ((handled.current = false), setError(null))}>
      <View style={[styles.root, { paddingTop: insets.top }]} testID="carelink-login-modal">
        <View style={styles.header}>
          <Text style={styles.title}>Medtronic sign-in</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.close} testID="carelink-login-close">
            <Ionicons name="close" size={24} color={colors.onSurface} />
          </Pressable>
        </View>
        {error && (
          <Text style={styles.error} testID="carelink-login-error">
            {error}
          </Text>
        )}
        {busy && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brandPrimary} />
            <Text style={styles.note}>Finishing sign-in…</Text>
          </View>
        )}
        {!busy && flow && Platform.OS === "web" && (
          <View style={[styles.center, { padding: spacing.lg }]}>
            <Text style={styles.note}>The Medtronic sign-in page opens inside the GlucoGuard phone app. Open GlucoGuard on your phone to finish.</Text>
            <Button title="Open page in browser" kind="secondary" onPress={() => Linking.openURL(flow.url)} testID="carelink-open-browser" />
          </View>
        )}
        {!busy && flow && Platform.OS !== "web" && (
          <WebView
            source={{ uri: flow.url }}
            originWhitelist={["*"]}
            onShouldStartLoadWithRequest={(req) => intercept(req.url)}
            onNavigationStateChange={(nav) => intercept(nav.url)}
            onError={(e) => {
              if (!intercept(e.nativeEvent.url)) return;
              setError("Couldn't load the Medtronic page. Check your connection.");
            }}
            startInLoadingState
            sharedCookiesEnabled
            style={{ flex: 1, paddingBottom: insets.bottom }}
            testID="carelink-webview"
          />
        )}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.border },
  title: { flex: 1, fontFamily: fonts.display, fontSize: 20, fontWeight: "700", color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  note: { color: c.muted, textAlign: "center", fontSize: 15 },
  error: { color: c.error, padding: spacing.md, fontSize: 14 },
}));
