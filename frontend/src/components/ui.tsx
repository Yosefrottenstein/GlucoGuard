import { ReactNode } from "react";
import { ActivityIndicator, Pressable, Switch, Text, TextInput, TextInputProps, View, ViewStyle } from "react-native";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export function Card({ children, style, testID }: { children: ReactNode; style?: ViewStyle; testID?: string }) {
  const styles = useStyles();
  return (
    <View testID={testID} style={[styles.card, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  const styles = useStyles();
  return <Text style={styles.section}>{children.toUpperCase()}</Text>;
}

export function Hint({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <Text style={styles.hint}>{children}</Text>;
}

export function ToggleRow({
  label,
  sub,
  value,
  onChange,
  testID,
  last,
}: {
  label: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID: string;
  last?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      <Switch
        testID={testID}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }}
        thumbColor={colors.surfaceSecondary}
      />
    </View>
  );
}

export function Field({
  label,
  last,
  suffix,
  ...props
}: TextInputProps & { label: string; last?: boolean; suffix?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={[styles.rowLabel, { width: 120 }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
        style={styles.input}
      />
      {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
    </View>
  );
}

export function Button({
  title,
  onPress,
  kind = "primary",
  loading,
  disabled,
  testID,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "danger";
  loading?: boolean;
  disabled?: boolean;
  testID: string;
  style?: ViewStyle;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const bg = kind === "primary" ? styles.primary : kind === "danger" ? styles.danger : styles.secondary;
  const fg = kind === "secondary" ? colors.onBrandSecondary : colors.onBrandPrimary;
  return (
    <Pressable
      testID={testID}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.btn, bg, (pressed || disabled) && { opacity: 0.6 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  card: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  section: {
    fontFamily: fonts.text,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: c.muted,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  hint: { fontFamily: fonts.text, fontSize: 12, color: c.muted, lineHeight: 17, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", minHeight: 48, gap: spacing.md },
  rowBorder: { borderBottomWidth: 0.5, borderBottomColor: c.divider },
  rowLabel: { fontFamily: fonts.text, fontSize: 15, color: c.onSurface, fontWeight: "500" },
  rowSub: { fontFamily: fonts.text, fontSize: 12, color: c.muted, marginTop: 2 },
  input: {
    flex: 1,
    fontFamily: fonts.text,
    fontSize: 15,
    color: c.onSurface,
    paddingVertical: spacing.md,
    textAlign: "right",
  },
  suffix: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  btn: { minHeight: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  primary: { backgroundColor: c.brandPrimary },
  secondary: { backgroundColor: c.brandSecondary },
  danger: { backgroundColor: c.error },
  btnText: { fontFamily: fonts.text, fontSize: 15, fontWeight: "700" },
}));
