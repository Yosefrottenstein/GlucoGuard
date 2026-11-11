import Ionicons from "@react-native-vector-icons/ionicons";
import { Contact as PhoneContact } from "expo-contacts";
import { useEffect, useState } from "react";
import { Linking, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ChannelSchedule, Contact } from "@/src/api";
import { isAndroid, phoneSmsSupported, requestSmsPermission, smsPermission } from "@/src/phoneSms";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { ScheduleEditor } from "./ScheduleEditor";
import { useToast } from "./Toast";
import { Button, Field, ToggleRow } from "./ui";

const channel = (enabled: boolean): ChannelSchedule => ({ enabled, mode: "always", windows: [], repeat_minutes: 5 });
const SMS_VIA: Contact["sms_via"] = isAndroid ? "phone" : "cloud"; // Android texts from its own number, iPhone via Twilio
const fresh = (): Contact => ({ name: "", phone: "", sms: channel(true), call: channel(false), sms_via: SMS_VIA });
const minutes = (t: string) => Math.min(720, parseInt(t.replace(/\D/g, ""), 10) || 0);
// older saves may still say "default"; show them as "any time"
const clean = (s: ChannelSchedule): ChannelSchedule => ({ ...channel(s.enabled), ...s, mode: s.mode === "hours" ? "hours" : "always" });

export function ContactSheet({
  visible,
  contact,
  onSave,
  onTest,
  onDelete,
  onClose,
}: {
  visible: boolean;
  contact: Contact | null;
  onSave: (c: Contact) => void;
  onTest: (c: Contact, channel: "sms" | "call") => Promise<string>;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [c, setC] = useState<Contact>(fresh());
  const [smsPerm, setSmsPerm] = useState<null | "ask" | "settings">(null);
  const [testing, setTesting] = useState<null | "sms" | "call">(null);

  const runTest = async (channel: "sms" | "call") => {
    const phone = c.phone.replace(/[\s()-]/g, "");
    if (!c.name.trim() || !/^\+\d{7,15}$/.test(phone)) return toast("Enter a nickname and a phone with country code first", "error");
    setTesting(channel);
    try {
      toast(await onTest({ ...c, name: c.name.trim(), phone }, channel), "info");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setTesting(null);
    }
  };

  useEffect(() => {
    if (!visible) return;
    const base = contact ? { ...fresh(), ...contact, sms_via: isAndroid ? SMS_VIA : contact.sms_via } : fresh();
    setC({ ...base, sms: clean(base.sms), call: clean(base.call) });
    setSmsPerm(null);
    if (isAndroid && phoneSmsSupported) smsPermission().then((ok) => !ok && base.sms.enabled && setSmsPerm("ask"));
  }, [visible, contact]);

  const pickFromPhone = async () => {
    try {
      const picked = await PhoneContact.presentPicker();
      if (!picked) return;
      const name = (await picked.getFullName().catch(() => "")) || c.name;
      const phones = await picked.getPhones().catch(() => []);
      const phone = (phones[0]?.number ?? "").replace(/[^\d+]/g, "").replace(/^00/, "+");
      setC((x) => ({ ...x, name, phone }));
      if (phone && !phone.startsWith("+")) toast("Add the country code at the start, e.g. +1", "info");
    } catch {
      toast("Couldn't open your contacts. Type the details instead.", "error");
    }
  };

  const askSms = async () => setSmsPerm((await requestSmsPermission()) === "granted" ? null : "settings");

  const save = () => {
    const phone = c.phone.replace(/[\s()-]/g, "");
    if (!c.name.trim()) return toast("Enter a nickname", "error");
    if (!/^\+\d{7,15}$/.test(phone)) return toast("Phone must start with + and country code, e.g. +15551234567", "error");
    if (c.sms.repeat_minutes < 1 || c.call.repeat_minutes < 1) return toast("Resend time must be at least 1 minute", "error");
    onSave({ ...c, name: c.name.trim(), phone });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="contact-sheet-backdrop" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.kav} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} testID="contact-sheet">
          <View style={styles.handle} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>{contact ? "Edit contact" : "Add contact"}</Text>
            {Platform.OS !== "web" && (
              <Pressable testID="contact-pick-from-phone" onPress={pickFromPhone} style={styles.pick}>
                <Ionicons name="people" size={18} color={colors.onBrandTertiary} />
                <Text style={styles.pickText}>Pick from phone contacts</Text>
              </Pressable>
            )}
            <Field label="Nickname" value={c.name} onChangeText={(v) => setC({ ...c, name: v })} placeholder="e.g. Mom" autoCapitalize="words" testID="contact-name-input" />
            <Field label="Phone" value={c.phone} onChangeText={(v) => setC({ ...c, phone: v })} placeholder="+15551234567" keyboardType="phone-pad" testID="contact-phone-input" last />

            <Text style={styles.section}>Text messages</Text>
            <ToggleRow label="Send texts to this contact" value={c.sms.enabled} onChange={(v) => setC({ ...c, sms: { ...c.sms, enabled: v } })} testID="contact-sms-toggle" last={!c.sms.enabled} />
            {c.sms.enabled && (
              <>
                <Text style={styles.radioSub}>
                  {isAndroid
                    ? "Sent from this phone's own number (needs signal and GlucoGuard running)."
                    : "Sent through your Twilio account (iPhone can't text by itself)."}
                </Text>
                {smsPerm && (
                  <View style={styles.permBox} testID="contact-sms-permission">
                    <Text style={styles.radioSub}>
                      {smsPerm === "settings"
                        ? "SMS permission is off for this app. Turn it on in Settings so emergency texts can go out from your SIM card."
                        : "If a severe low isn't snoozed, the app texts this contact straight from your phone, even while you can't."}
                    </Text>
                    <Button
                      title={smsPerm === "settings" ? "Open Settings" : "Allow sending texts"}
                      onPress={smsPerm === "settings" ? () => Linking.openSettings() : askSms}
                      testID="contact-sms-permission-button"
                      style={{ marginTop: spacing.sm }}
                    />
                  </View>
                )}
                {isAndroid && !phoneSmsSupported && (
                  <Text style={styles.radioSub}>Texts from the SIM card work in the installed Android app, not in Expo Go.</Text>
                )}
                <Text style={styles.label}>When to text</Text>
                <ScheduleEditor value={c.sms} onChange={(v) => setC({ ...c, sms: v })} testIDPrefix="contact-sms-schedule" />
                <Field
                  label="Text again every"
                  value={String(c.sms.repeat_minutes)}
                  onChangeText={(t) => setC({ ...c, sms: { ...c.sms, repeat_minutes: minutes(t) } })}
                  keyboardType="number-pad"
                  suffix="min"
                  testID="contact-sms-repeat-input"
                  last
                />
                <Button title="Send test text" kind="secondary" onPress={() => runTest("sms")} loading={testing === "sms"} testID="contact-test-sms-button" style={{ marginTop: spacing.sm }} />
              </>
            )}

            <Text style={styles.section}>Voice calls</Text>
            <ToggleRow
              label="Call this contact"
              sub="A voice reads the alert and location aloud (your Twilio account)"
              value={c.call.enabled}
              onChange={(v) => setC({ ...c, call: { ...c.call, enabled: v } })}
              testID="contact-call-toggle"
              last={!c.call.enabled}
            />
            {c.call.enabled && (
              <>
                <Text style={styles.label}>When to call</Text>
                <ScheduleEditor value={c.call} onChange={(v) => setC({ ...c, call: v })} testIDPrefix="contact-call-schedule" />
                <Field
                  label="Call again every"
                  value={String(c.call.repeat_minutes)}
                  onChangeText={(t) => setC({ ...c, call: { ...c.call, repeat_minutes: minutes(t) } })}
                  keyboardType="number-pad"
                  suffix="min"
                  testID="contact-call-repeat-input"
                  last
                />
                <Button title="Make test call" kind="secondary" onPress={() => runTest("call")} loading={testing === "call"} testID="contact-test-call-button" style={{ marginTop: spacing.sm }} />
              </>
            )}

            <Button title="Save contact" onPress={save} testID="contact-save-button" style={{ marginTop: spacing.lg }} />
            {onDelete && <Button title="Remove contact" kind="secondary" onPress={onDelete} testID="contact-delete-button" style={{ marginTop: spacing.sm }} />}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { ...({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const), backgroundColor: c.scrim },
  kav: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: c.surfaceSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: "92%",
  },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: c.borderStrong, marginBottom: spacing.md },
  title: { fontFamily: fonts.display, fontSize: 22, fontWeight: "700", color: c.onSurface, marginBottom: spacing.sm },
  pick: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.brandTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    marginBottom: spacing.sm,
  },
  pickText: { fontFamily: fonts.text, fontSize: 14, fontWeight: "700", color: c.onBrandTertiary },
  section: {
    fontFamily: fonts.text,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: c.muted,
    marginTop: spacing.xl,
    textTransform: "uppercase",
  },
  label: { fontFamily: fonts.text, fontSize: 13, color: c.muted, marginTop: spacing.md, marginBottom: spacing.xs },
  viaBox: { backgroundColor: c.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, marginTop: spacing.sm },
  radioRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, minHeight: 48 },
  radioTitle: { fontFamily: fonts.text, fontSize: 15, fontWeight: "600", color: c.onSurface },
  radioSub: { fontFamily: fonts.text, fontSize: 12, color: c.muted, marginTop: 2 },
  permBox: { backgroundColor: c.surface, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
}));
