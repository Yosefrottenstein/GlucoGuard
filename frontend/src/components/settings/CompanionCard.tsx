import Ionicons from "@react-native-vector-icons/ionicons";
import { useEffect, useState } from "react";
import { AppState, Text, View } from "react-native";

import { companionHasAccess, companionSourceName, companionSupported, openCompanionAccess } from "@/src/companion";
import { Button, Card } from "@/src/components/ui";
import { spacing, useTheme } from "@/src/theme";
import { useSettingsStyles } from "./styles";

/** Companion app setup: Android notification access + which app is being read. */
export function CompanionCard() {
  const styles = useSettingsStyles();
  const { colors } = useTheme();
  const [access, setAccess] = useState(companionHasAccess());
  const [from, setFrom] = useState(companionSourceName());

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") return;
      setAccess(companionHasAccess());
      setFrom(companionSourceName());
    });
    return () => sub.remove();
  }, []);

  return (
    <Card style={styles.subCard} testID="companion-card">
      <View style={styles.syncRow}>
        <Ionicons name={access ? "checkmark-circle" : "alert-circle"} size={22} color={access ? colors.inRange : colors.warning} />
        <Text style={styles.syncText} testID="companion-status">
          {!companionSupported
            ? "Companion mode works in the installed Android app, not in Expo Go or the preview."
            : access
              ? from
                ? `Reading glucose from ${from}`
                : "Notification access on. Waiting for a glucose notification…"
              : "Allow notification access so GlucoGuard can read the glucose your CGM or pump app shows."}
        </Text>
      </View>
      {companionSupported && !access && (
        <Button title="Open notification access" onPress={openCompanionAccess} testID="companion-access-button" style={{ marginVertical: spacing.sm }} />
      )}
      <Text style={[styles.radioSub, { marginBottom: spacing.sm }]}>
        Works with apps that show glucose in their notification: Dexcom G6/G7/ONE+, FreeStyle Libre 2/3, Omnipod 5, CamAPS FX, Eversense,
        Medtrum, Beta Bionics, twiist and more. Keep that app&apos;s glucose notification turned on. GlucoGuard only reads notifications from
        these apps. Readings are uploaded straight from the background, so alarms on the server and emergency messages keep working while
        GlucoGuard is closed.
      </Text>
    </Card>
  );
}
