import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Unit } from "@/src/api";
import { fromDisplay, unitLabel } from "@/src/glucose";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { ChipRow } from "./ChipRow";
import { Button } from "./ui";
import { useToast } from "./Toast";

type Kind = "insulin" | "carbs" | "note" | "reading";

export function TreatmentSheet({
  visible,
  onClose,
  allowReading,
  unit,
}: {
  visible: boolean;
  onClose: () => void;
  allowReading: boolean;
  unit: Unit;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>(allowReading ? "reading" : "insulin");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [ago, setAgo] = useState<"0" | "15" | "30" | "60">("0");

  useEffect(() => {
    if (visible) {
      setKind(allowReading ? "reading" : "insulin");
      setAmount("");
      setNote("");
      setAgo("0");
    }
  }, [visible, allowReading]);

  const save = useMutation({
    mutationFn: async () => {
      const ts = new Date(Date.now() - Number(ago) * 60000).toISOString();
      if (kind === "reading") {
        const mg = fromDisplay(amount, unit);
        if (!mg) throw new Error("Enter a glucose value.");
        return api("/readings", { method: "POST", body: { sgv: mg, ts } });
      }
      const n = parseFloat(amount.replace(",", "."));
      return api("/treatments", {
        method: "POST",
        body: {
          kind,
          ts,
          insulin: kind === "insulin" ? n || null : null,
          carbs: kind === "carbs" ? n || null : null,
          note: note.trim() || null,
        },
      });
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries();
      toast("Saved", "success");
      onClose();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const kinds = [
    ...(allowReading ? [{ value: "reading" as Kind, label: "Glucose" }] : []),
    { value: "insulin" as Kind, label: "Insulin" },
    { value: "carbs" as Kind, label: "Carbs" },
    { value: "note" as Kind, label: "Note" },
  ];
  const suffix = kind === "insulin" ? "units" : kind === "carbs" ? "grams" : unitLabel(unit);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="treatment-sheet-backdrop" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.kav} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg, maxHeight: "85%" }]} testID="treatment-sheet">
          <View style={styles.handle} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Add entry</Text>
          <ChipRow options={kinds} value={kind} onChange={setKind} testIDPrefix="treatment-kind" padded={false} />
          {kind !== "note" && (
            <View style={styles.amountRow}>
              <TextInput
                testID="treatment-amount-input"
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={colors.muted}
                style={styles.amount}
                autoFocus
              />
              <Text style={styles.suffix}>{suffix}</Text>
            </View>
          )}
          <TextInput
            testID="treatment-note-input"
            value={note}
            onChangeText={setNote}
            placeholder={kind === "note" ? "What happened? (exercise, sick, sensor change…)" : "Note (optional)"}
            placeholderTextColor={colors.muted}
            style={styles.note}
            multiline
          />
          <Text style={styles.label}>When</Text>
          <ChipRow
            options={[
              { value: "0", label: "Now" },
              { value: "15", label: "15 min ago" },
              { value: "30", label: "30 min ago" },
              { value: "60", label: "1 hour ago" },
            ]}
            value={ago}
            onChange={setAgo}
            testIDPrefix="treatment-time"
            padded={false}
          />
          <Button title="Save" onPress={() => save.mutate()} loading={save.isPending} testID="treatment-save-button" style={{ marginTop: spacing.md }} />
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
  },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: c.borderStrong, marginBottom: spacing.md },
  title: { fontFamily: fonts.display, fontSize: 22, fontWeight: "700", color: c.onSurface },
  amountRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm, marginVertical: spacing.xs },
  amount: { fontFamily: fonts.display, fontSize: 40, fontWeight: "700", color: c.onSurface, minWidth: 80, paddingVertical: 0 },
  suffix: { fontFamily: fonts.text, fontSize: 16, color: c.muted },
  note: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 48,
    fontFamily: fonts.text,
    fontSize: 15,
    color: c.onSurface,
    marginTop: spacing.sm,
  },
  label: { fontFamily: fonts.text, fontSize: 13, color: c.muted, marginTop: spacing.md },
}));
