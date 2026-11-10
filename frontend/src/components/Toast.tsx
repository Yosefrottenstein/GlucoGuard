import { createContext, ReactNode, useCallback, useContext, useRef, useState } from "react";
import { Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, makeStyles, radius, spacing } from "@/src/theme";

type Kind = "success" | "error" | "info";
type ToastState = { id: number; message: string; kind: Kind } | null;

const ToastContext = createContext<(message: string, kind?: Kind) => void>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const styles = useStyles();

  const show = useCallback((message: string, kind: Kind = "info") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), message, kind });
    timer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <View pointerEvents="none" style={[styles.wrap, { top: insets.top + spacing.sm }]}>
          <Animated.View
            key={toast.id}
            entering={FadeInUp}
            exiting={FadeOutUp}
            testID="toast-message"
            style={[styles.toast, toast.kind === "error" && styles.error, toast.kind === "success" && styles.success]}
          >
            <Text style={styles.text}>{toast.message}</Text>
          </Animated.View>
        </View>
      )}
    </ToastContext.Provider>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { position: "absolute", left: spacing.lg, right: spacing.lg, alignItems: "center" },
  toast: {
    backgroundColor: c.surfaceInverse,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    maxWidth: 480,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  error: { backgroundColor: c.error },
  success: { backgroundColor: c.success },
  text: { color: c.onSurfaceInverse, fontFamily: fonts.text, fontSize: 14, fontWeight: "600" },
}));
