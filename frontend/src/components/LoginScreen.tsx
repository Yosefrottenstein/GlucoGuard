import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { queryClient } from "@/src/query-client";
import { useAuth } from "@/src/auth";
import { Button } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export function LoginScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    if (username.trim().length < 3) return setError("Username needs at least 3 characters.");
    if (password.length < 8) return setError("Password needs at least 8 characters.");
    if (mode === "register" && password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      const r = await api<{ access_token: string; username: string }>(`/auth/${mode}`, {
        method: "POST",
        body: { username: username.trim(), password },
      });
      await signIn(r.access_token, r.username);
      // fill the graph right away for a new account instead of waiting for the next background sync
      api("/sync", { method: "POST" })
        .then(() => queryClient.invalidateQueries())
        .catch(() => {});
    } catch (e) {
      setError((e as Error).message.replace(/^Invalid settings: /, ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + spacing.xxxl, paddingBottom: insets.bottom + spacing.xl, paddingHorizontal: spacing.xl }}
      >
        <Text style={styles.brand}>xDrip</Text>
        <Text style={styles.sub}>{mode === "login" ? "Sign in to see your glucose." : "Create your private account."}</Text>
        <View style={styles.card}>
          <TextInput
            testID="auth-username-input"
            value={username}
            onChangeText={setUsername}
            placeholder="Username"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <TextInput
            testID="auth-password-input"
            value={password}
            onChangeText={setPassword}
            placeholder="Password (8+ characters)"
            placeholderTextColor={colors.muted}
            secureTextEntry
            style={styles.input}
          />
          {mode === "register" && (
            <TextInput
              testID="auth-confirm-input"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Repeat password"
              placeholderTextColor={colors.muted}
              secureTextEntry
              style={styles.input}
            />
          )}
          {error ? (
            <Text style={styles.error} testID="auth-error">
              {error}
            </Text>
          ) : null}
          <Button title={mode === "login" ? "Sign in" : "Create account"} onPress={submit} loading={busy} testID="auth-submit-button" />
        </View>
        <Pressable
          testID="auth-switch-mode"
          onPress={() => (setMode(mode === "login" ? "register" : "login"), setError(""))}
          style={styles.switch}
        >
          <Text style={styles.switchText}>{mode === "login" ? "New here? Create an account" : "Have an account? Sign in"}</Text>
        </Pressable>
        <Text style={styles.note}>There&apos;s no email reset, so keep your password somewhere safe.</Text>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  brand: { fontFamily: fonts.display, fontSize: 44, fontWeight: "700", color: c.onSurface },
  sub: { fontFamily: fonts.text, fontSize: 16, color: c.onSurfaceTertiary, marginTop: spacing.xs, marginBottom: spacing.xl },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  input: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: c.surface,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.text,
    fontSize: 16,
    color: c.onSurface,
  },
  error: { fontFamily: fonts.text, fontSize: 14, color: c.error },
  switch: { alignSelf: "center", minHeight: 44, justifyContent: "center", marginTop: spacing.lg },
  switchText: { fontFamily: fonts.text, fontSize: 15, fontWeight: "700", color: c.onBrandTertiary },
  note: { fontFamily: fonts.text, fontSize: 12, color: c.muted, textAlign: "center", marginTop: spacing.sm },
}));
