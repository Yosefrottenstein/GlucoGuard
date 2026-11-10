import Ionicons from "@react-native-vector-icons/ionicons";
import { Contact as PhoneContact } from "expo-contacts";
import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ChannelSchedule, Contact } from "@/src/api";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { describeSchedule, ScheduleEditor, validTime } from "./ScheduleEditor";
import { useToast } from "./Toast";
import { Button, Field, ToggleRow } from "./ui";

const fresh = (): Contact => ({
  name: "",
  phone: "",
  sms: { enabled: true, mode: "default", start: "00:00", end: "07:00" },
  call: { enabled: true, mode: "default", start: "00:00", end: "07:00" },
});

export function ContactSheet({
  visible,
  contact,
  smsDefault,
  callDefault,
  onSave,
  onDelete,
  onClose,
}: {
  visible: boolean;
  contact: Contact | null;
  smsDefault: ChannelSchedule;
  callDefault: ChannelSchedule;
  onSave: (c: Contact) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [c, setC] = useState<Contact>(fresh());

  useEffect(() => {
    if (visible) setC(contact ? { ...fresh(), ...contact } : fresh());
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

  const save = () => {
    const phone = c.phone.replace(/[\s()-]/g, "");
    if (!c.name.trim()) return toast("Enter a nickname", "error");
    if (!/^\+\d{7,15}$/.test(phone)) return toast("Phone must start with + and country code, e.g. +15551234567", "error");
    for (const s of [c.sms, c.call]) {
      if (s.mode === "hours" && !(validTime(s.start) && validTime(s.end))) return toast("Enter hours as HH:MM", "error");
    }
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
            <ToggleRow label="Send texts to this contact" value={c.sms.enabled} onChange={(v) => setC({ ...c, sms: { ...c.sms, enabled: v } })} testID="contact-sms-toggle" last />
            {c.sms.enabled && (
              <ScheduleEditor
                value={c.sms}
                onChange={(v) => setC({ ...c, sms: v })}
                allowDefault
                defaultText={`Uses your default text hours (${describeSchedule(smsDefault)})`}
                testIDPrefix="contact-sms-schedule"
              />
            )}

            <Text style={styles.section}>Voice calls</Text>
            <ToggleRow label="Call this contact" value={c.call.enabled} onChange={(v) => setC({ ...c, call: { ...c.call, enabled: v } })} testID="contact-call-toggle" last />
            {c.call.enabled && (
              <ScheduleEditor
                value={c.call}
                onChange={(v) => setC({ ...c, call: v })}
                allowDefault
                defaultText={`Uses your default call hours (${describeSchedule(callDefault)})`}
                testIDPrefix="contact-call-schedule"
              />
            )}

            <Button title="Save contact" onPress={save} testID="contact-save-button" style={{ marginTop: spacing.lg }} />
            {onDelete && (
              <Button title="Remove contact" kind="secondary" onPress={onDelete} testID="contact-delete-button" style={{ marginTop: spacing.sm }} />
            )}
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
    maxHeight: "90%",
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
    marginTop: spacing.lg,
    textTransform: "uppercase",
  },
}));
