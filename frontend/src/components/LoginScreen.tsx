import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { queryClient } from "@/src/query-client";
import { useAuth } from "@/src/auth";
import { Button } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Mode = "login" | "register" | "forgot" | "reset";

export function LoginScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const go = (m: Mode) => {
    setMode(m);
    setError("");
    setInfo("");
    setPassword("");
    setConfirm("");
    setCode("");
  };

  const finish = async (r: { access_token: string; username: string }, askEmail = false) => {
    await signIn(r.access_token, r.username, { askEmail });
    // fill the graph right away instead of waiting for the next background sync
    api("/sync", { method: "POST" })
      .then(() => queryClient.invalidateQueries())
      .catch(() => {});
  };

  const run = async (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message.replace(/^Invalid settings: /, ""));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const u = username.trim();
    if (mode === "register") {
      if (/\s/.test(username)) return setError("Username can't contain spaces.");
      if (u.length < 5) return setError("Username needs at least 5 characters.");
      if (!/^[A-Za-z0-9_.]+$/.test(u)) return setError("Username can use letters, numbers, dots and underscores.");
      if (name.replace(/\s+/g, " ").trim().length < 3) return setError("Enter your name (at least 3 characters).");
    } else if (!u) return setError("Enter your username.");
    if (mode === "forgot") {
      return run(async () => {
        const r = await api<{ message: string }>("/auth/forgot", { method: "POST", body: { username: u } });
        setMode("reset");
        setInfo(`${r.message} If no email was added to this account, the password can't be recovered.`);
      });
    }
    if (mode === "reset" && !/^\d{6}$/.test(code)) return setError("Enter the 6-digit code from the email.");
    if (mode !== "login" && password.length < 8) return setError("Password needs at least 8 characters.");
    if (mode === "login" && !password) return setError("Enter your password.");
    if (mode !== "login" && password !== confirm) return setError("Passwords don't match.");
    run(async () => {
      if (mode === "reset") {
        await finish(await api("/auth/reset", { method: "POST", body: { username: u, code, new_password: password } }));
      } else {
        await finish(
          await api(`/auth/${mode}`, {
            method: "POST",
            body: mode === "register" ? { username: u, password, name: name.replace(/\s+/g, " ").trim() } : { username: u, password },
          }),
          mode === "register",
        );
      }
    });
  };

  const titles: Record<Mode, string> = {
    login: "Sign in to see your glucose.",
    register: "Create your private account.",
    forgot: "Forgot your password? We'll email a code to the address on your account.",
    reset: "Enter the code and choose a new password.",
  };
  const button: Record<Mode, string> = { login: "Sign in", register: "Create account", forgot: "Send code", reset: "Set new password" };

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + spacing.xxxl, paddingBottom: insets.bottom + spacing.xl, paddingHorizontal: spacing.xl }}
      >
        <Text style={styles.brand}>GlucoGuard</Text>
        <Text style={styles.sub}>{titles[mode]}</Text>
        <View style={styles.card}>
          <TextInput
            testID="auth-username-input"
            value={username}
            onChangeText={setUsername}
            placeholder={mode === "register" ? "Username (5+ characters, no spaces)" : "Username"}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            editable={mode !== "reset"}
            style={styles.input}
          />
          {mode === "register" && <Text style={styles.hint}>At least 5 characters. Letters, numbers, dots or underscores, no spaces.</Text>}
          {mode === "register" && (
            <>
              <TextInput
                testID="auth-name-input"
                value={name}
                onChangeText={setName}
                placeholder="Your name (3+ characters)"
                placeholderTextColor={colors.muted}
                autoCapitalize="words"
                style={styles.input}
              />
              <Text style={styles.hint}>{`Used in emergency messages: "${name.trim() || "Name"}'s glucose is…"`}</Text>
            </>
          )}
          {info ? (
            <Text style={styles.info} testID="auth-info">
              {info}
            </Text>
          ) : null}
          {mode === "reset" && (
            <TextInput
              testID="auth-code-input"
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
              placeholder="6-digit code"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              style={[styles.input, styles.code]}
            />
          )}
          {mode !== "forgot" && (
            <TextInput
              testID="auth-password-input"
              value={password}
              onChangeText={setPassword}
              placeholder={mode === "reset" ? "New password (8+ characters)" : "Password (8+ characters)"}
              placeholderTextColor={colors.muted}
              secureTextEntry
              style={styles.input}
            />
          )}
          {(mode === "register" || mode === "reset") && (
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
          <Button title={button[mode]} onPress={submit} loading={busy} testID="auth-submit-button" />
          {mode === "login" && (
            <Pressable testID="auth-forgot-link" onPress={() => go("forgot")} style={styles.forgot}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </Pressable>
          )}
          {mode === "reset" && (
            <Pressable testID="auth-resend-link" onPress={() => go("forgot")} style={styles.forgot}>
              <Text style={styles.forgotText}>Didn&apos;t get it? Send a new code</Text>
            </Pressable>
          )}
        </View>
        <Pressable testID="auth-switch-mode" onPress={() => go(mode === "register" ? "login" : mode === "login" ? "register" : "login")} style={styles.switch}>
          <Text style={styles.switchText}>
            {mode === "login" ? "New here? Create an account" : mode === "register" ? "Have an account? Sign in" : "Back to sign in"}
          </Text>
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  brand: { fontFamily: fonts.display, fontSize: 44, fontWeight: "700", color: c.onSurface },
  sub: { fontFamily: fonts.text, fontSize: 16, lineHeight: 23, color: c.onSurfaceTertiary, marginTop: spacing.xs, marginBottom: spacing.xl },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  input: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.text,
    fontSize: 16,
    color: c.onSurface,
  },
  code: { fontFamily: fonts.display, fontSize: 24, letterSpacing: 8, textAlign: "center" },
  hint: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceTertiary, marginTop: -spacing.xs },
  info: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceTertiary },
  error: { fontFamily: fonts.text, fontSize: 14, color: c.error },
  forgot: { alignSelf: "center", minHeight: 44, justifyContent: "center" },
  forgotText: { fontFamily: fonts.text, fontSize: 14, fontWeight: "600", color: c.onSurfaceTertiary },
  switch: { alignSelf: "center", minHeight: 44, justifyContent: "center", marginTop: spacing.lg },
  switchText: { fontFamily: fonts.text, fontSize: 15, fontWeight: "700", color: c.onBrandTertiary },
}));
