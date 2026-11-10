import * as Haptics from "expo-haptics";
import { Pressable, ScrollView, Text } from "react-native";

import { fonts, makeStyles, radius, spacing } from "@/src/theme";

type Props<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  testIDPrefix: string;
  padded?: boolean;
};

export function ChipRow<T extends string>({ options, value, onChange, testIDPrefix, padded = true }: Props<T>) {
  const styles = useStyles();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.row}
      contentContainerStyle={[styles.content, padded && { paddingHorizontal: spacing.lg }]}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={`${testIDPrefix}-${o.value}`}
            onPress={() => {
              Haptics.selectionAsync();
              onChange(o.value);
            }}
            style={({ pressed }) => [styles.chip, active && styles.active, pressed && { opacity: 0.7 }]}
          >
            <Text style={[styles.label, active && styles.activeLabel]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexGrow: 0, height: 56 },
  content: { gap: spacing.sm, alignItems: "center" },
  chip: {
    height: 36,
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
    justifyContent: "center",
  },
  active: { backgroundColor: c.surfaceInverse, borderColor: c.surfaceInverse },
  label: { fontFamily: fonts.text, fontSize: 14, fontWeight: "600", color: c.onSurfaceTertiary },
  activeLabel: { color: c.onSurfaceInverse },
}));
