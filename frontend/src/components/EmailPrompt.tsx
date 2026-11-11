import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { Button } from "./ui";

export const NO_EMAIL_WARNING = "Without an email there is no way to get back into your account if you forget your password.";
const validEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v.trim());

async function saveEmail(email: string) {
  return api<{ username: string; email: string }>("/auth/email", { method: "PUT", body: { email: email.trim() } });
}

/** Shown once right after creating an account. */
export function EmailPromptScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { emailDone } = useAuth();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);

  const submit = async () => {
    if (!validEmail(email)) return setError("Enter a valid email address.");
    setBusy(true);
    try {
      await saveEmail(email);
      qc.invalidateQueries({ queryKey: ["me"] });
      emailDone();
    } catch (e) {
      setError((e as Error).message);
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
        <Text style={styles.title}>Add a recovery email</Text>
        <Text style={styles.sub}>If you ever forget your password, we&apos;ll email you a 6-digit code to set a new one.</Text>
        <View style={styles.card}>
          <TextInput
            testID="email-prompt-input"
            value={email}
            onChangeText={(v) => (setEmail(v), setError(""))}
            placeholder="you@example.com"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            style={styles.input}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title="Save email" onPress={submit} loading={busy} testID="email-prompt-save-button" />
        </View>
        {confirmSkip ? (
          <View style={styles.warnBox} testID="email-skip-warning">
            <Text style={styles.warnTitle}>Are you sure?</Text>
            <Text style={styles.warnText}>{NO_EMAIL_WARNING} You can add one later in Settings.</Text>
            <Button title="Skip anyway" kind="secondary" onPress={emailDone} testID="email-skip-confirm-button" style={{ marginTop: spacing.md }} />
          </View>
        ) : (
          <Pressable testID="email-prompt-skip" onPress={() => setConfirmSkip(true)} style={styles.skip}>
            <Text style={styles.skipText}>Skip for now</Text>
          </Pressable>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

/** Add or change the recovery email from Settings. */
export function EmailSheet({ visible, current, onClose }: { visible: boolean; current?: string | null; onClose: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const [email, setEmail] = useState(current ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!validEmail(email)) return toast("Enter a valid email address", "error");
    setBusy(true);
    try {
      const me = await saveEmail(email);
      qc.setQueryData(["me"], me);
      toast("Recovery email saved", "success");
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={current ? "Change recovery email" : "Add recovery email"} testID="email-sheet">
      <Text style={styles.warnText}>Used only to send you a code if you forget your password.</Text>
      <TextInput
        testID="email-sheet-input"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        style={[styles.input, { marginTop: spacing.md }]}
      />
      <Button title="Save email" onPress={submit} loading={busy} testID="email-sheet-save-button" style={{ marginTop: spacing.lg }} />
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  title: { fontFamily: fonts.display, fontSize: 32, fontWeight: "700", color: c.onSurface },
  sub: { fontFamily: fonts.text, fontSize: 16, lineHeight: 23, color: c.onSurfaceTertiary, marginTop: spacing.sm, marginBottom: spacing.xl },
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
  error: { fontFamily: fonts.text, fontSize: 14, color: c.error },
  skip: { alignSelf: "center", minHeight: 44, justifyContent: "center", marginTop: spacing.lg },
  skipText: { fontFamily: fonts.text, fontSize: 15, fontWeight: "700", color: c.onSurfaceTertiary },
  warnBox: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.lg, borderWidth: 1, borderColor: c.warning },
  warnTitle: { fontFamily: fonts.text, fontSize: 16, fontWeight: "700", color: c.onSurface },
  warnText: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceTertiary, marginTop: spacing.xs },
}));
