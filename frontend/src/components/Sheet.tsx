import { ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, makeStyles, radius, spacing } from "@/src/theme";

export function Sheet({ visible, onClose, title, children, testID }: { visible: boolean; onClose: () => void; title: string; children: ReactNode; testID: string }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID={`${testID}-backdrop`} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.kav} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} testID={testID}>
          <View style={styles.handle} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>{title}</Text>
            {children}
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
}));
