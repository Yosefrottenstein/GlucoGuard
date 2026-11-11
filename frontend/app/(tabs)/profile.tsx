import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Settings } from "@/src/api";
import { useAuth } from "@/src/auth";
import { EmailSheet, NO_EMAIL_WARNING } from "@/src/components/EmailPrompt";
import { PasswordSheet } from "@/src/components/PasswordSheet";
import { useToast } from "@/src/components/Toast";
import { Button, Card, Field, Hint, SectionTitle } from "@/src/components/ui";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

export default function ProfileScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const { username, signOut } = useAuth();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ username: string; email: string | null }>("/auth/me") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings") });
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  useEffect(() => {
    if (settings.data) setName(settings.data.em_name);
  }, [settings.data?.em_name]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (settings.data?.em_name || username || "?").trim();
  const nameDirty = settings.data && name.trim() !== settings.data.em_name;

  const saveName = async () => {
    const n = name.replace(/\s+/g, " ").trim();
    if (n.length < 3) return toast("Name needs at least 3 characters", "error");
    setSavingName(true);
    try {
      const data = await api<Settings>("/settings", { method: "PUT", body: { em_name: n } });
      qc.setQueryData(["settings"], data);
      toast("Name saved", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSavingName(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.xl, paddingHorizontal: spacing.lg, paddingBottom: (usesNativeTabs ? insets.bottom : 0) + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <View style={styles.avatar} testID="profile-avatar">
            <Text style={styles.avatarText}>{shown.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.name} testID="profile-name">
            {shown}
          </Text>
          <Text style={styles.username} testID="profile-username">
            @{me.data?.username ?? username}
          </Text>
        </View>

        <SectionTitle>Your name</SectionTitle>
        <Card style={{ paddingVertical: spacing.xs }}>
          <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Anna" autoCapitalize="words" testID="profile-name-input" last />
        </Card>
        <Hint>{`Used in emergency texts and calls: "${name.trim() || "Name"}'s glucose is…"`}</Hint>
        {nameDirty && <Button title="Save name" onPress={saveName} loading={savingName} testID="profile-name-save-button" style={{ marginTop: spacing.sm }} />}

        <SectionTitle>Account</SectionTitle>
        <Card style={{ paddingVertical: spacing.xs }}>
          <View style={[styles.row, styles.border]}>
            <Ionicons name="at" size={22} color={colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Username</Text>
              <Text style={styles.rowSub}>{me.data?.username ?? username}</Text>
            </View>
          </View>
          <Pressable testID="profile-email-row" onPress={() => setEmailOpen(true)} style={[styles.row, styles.border]}>
            <Ionicons name="mail" size={22} color={me.data?.email ? colors.brandPrimary : colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Recovery email</Text>
              <Text style={styles.rowSub} testID="profile-email-text">
                {me.data?.email ?? NO_EMAIL_WARNING}
              </Text>
            </View>
            <Text style={styles.action}>{me.data?.email ? "Change" : "Add"}</Text>
          </Pressable>
          <Pressable testID="profile-password-row" onPress={() => setPwOpen(true)} style={styles.row}>
            <Ionicons name="key" size={22} color={colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Password</Text>
              <Text style={styles.rowSub}>••••••••</Text>
            </View>
            <Text style={styles.action}>Change</Text>
          </Pressable>
        </Card>

        <Button title="Sign out" kind="secondary" onPress={signOut} testID="profile-signout-button" style={{ marginTop: spacing.xl }} />
      </ScrollView>
      <PasswordSheet visible={pwOpen} onClose={() => setPwOpen(false)} />
      {emailOpen && <EmailSheet visible current={me.data?.email} onClose={() => setEmailOpen(false)} />}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  hero: { alignItems: "center", gap: spacing.xs, marginBottom: spacing.md },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  avatarText: { fontFamily: fonts.display, fontSize: 44, fontWeight: "700", color: c.onBrandPrimary },
  name: { fontFamily: fonts.display, fontSize: 26, fontWeight: "700", color: c.onSurface },
  username: { fontFamily: fonts.text, fontSize: 14, color: c.muted },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 60, paddingVertical: spacing.sm },
  border: { borderBottomWidth: 0.5, borderBottomColor: c.divider },
  rowTitle: { fontFamily: fonts.text, fontSize: 15, fontWeight: "600", color: c.onSurface },
  rowSub: { fontFamily: fonts.text, fontSize: 12, color: c.muted, marginTop: 2 },
  action: { fontFamily: fonts.text, fontSize: 15, fontWeight: "600", color: c.brandPrimary },
}));
