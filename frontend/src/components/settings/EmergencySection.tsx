import Ionicons from "@react-native-vector-icons/ionicons";
import type { UseMutationResult } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";

import type { ChannelSchedule, Settings } from "@/src/api";
import { MultiChipRow } from "@/src/components/ChipRow";
import { describeSchedule } from "@/src/components/ScheduleEditor";
import { Button, Card, Field, Hint, SectionTitle, ToggleRow } from "@/src/components/ui";
import { agoText } from "@/src/glucose";
import { spacing, useTheme } from "@/src/theme";
import { SetSetting, useSettingsStyles } from "./styles";

type Log = { id: string; ts: string; test: boolean; results: string[] };

const channelText = (ch: ChannelSchedule) => (ch.enabled ? `${describeSchedule(ch)}, every ${ch.repeat_minutes} min` : "off");

export function EmergencySection({
  draft,
  set,
  setNum,
  ensureLocation,
  onEditContact,
  emTest,
  log,
}: {
  draft: Settings;
  set: SetSetting;
  setNum: (key: keyof Settings, text: string) => void;
  ensureLocation: () => void;
  onEditContact: (i: number) => void;
  emTest: UseMutationResult<any, Error, void, unknown>;
  log: Log[];
}) {
  const styles = useSettingsStyles();
  const { colors } = useTheme();

  return (
    <>
      <SectionTitle>Emergency messages</SectionTitle>
      <Card style={{ paddingVertical: spacing.xs }}>
        <ToggleRow
          label="Emergency messages"
          sub="Alert contacts when an alarm isn't snoozed in time"
          value={draft.em_enabled}
          onChange={(v) => {
            set("em_enabled", v);
            if (v && draft.em_location) ensureLocation();
          }}
          testID="emergency-enabled-toggle"
        />
        <Field label="Your name" value={draft.em_name} onChangeText={(v) => set("em_name", v)} placeholder="Used in the message" autoCapitalize="words" testID="emergency-name-input" />
        <ToggleRow
          label="Include my location"
          sub="Adds a map link to the text"
          value={draft.em_location}
          onChange={(v) => {
            set("em_location", v);
            if (v) ensureLocation();
          }}
          testID="emergency-location-toggle"
        />
        <View style={[styles.inlineChips, styles.bottomBorder]}>
          <Text style={styles.inlineLabel}>Send for these alarms</Text>
          <MultiChipRow
            options={[
              { value: "urgent_low", label: "Urgent low" },
              { value: "low", label: "Low" },
              { value: "high", label: "High" },
              { value: "urgent_high", label: "Urgent high" },
            ]}
            values={draft.em_triggers}
            onChange={(v) => set("em_triggers", v)}
            testIDPrefix="emergency-trigger"
          />
        </View>
        <Field label="Wait before" last value={String(draft.em_delay_minutes)} onChangeText={(v) => setNum("em_delay_minutes", v)} keyboardType="number-pad" suffix="min" testID="emergency-delay-input" />
      </Card>

      <Text style={styles.subTitle}>Contacts</Text>
      <Card style={{ paddingVertical: spacing.xs }}>
        {draft.em_contacts.length === 0 && (
          <Text style={[styles.radioSub, { paddingVertical: spacing.md }]}>No contacts yet. Each contact gets their own texts, calls, days and hours.</Text>
        )}
        {draft.em_contacts.map((c, i) => (
          <Pressable
            key={`${c.phone}-${i}`}
            onPress={() => onEditContact(i)}
            style={[styles.contactRow, i < draft.em_contacts.length - 1 && styles.bottomBorder]}
            testID={`emergency-contact-${i}`}
          >
            <Ionicons name="person-circle" size={28} color={colors.muted} />
            <View style={{ flex: 1, paddingVertical: spacing.sm }}>
              <Text style={styles.radioTitle}>{c.name}</Text>
              <Text style={styles.radioSub}>{c.phone}</Text>
              <Text style={styles.radioSub}>Text: {channelText(c.sms)}</Text>
              <Text style={styles.radioSub}>Call: {channelText(c.call)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ))}
      </Card>
      <Button title="Add contact" kind="secondary" onPress={() => onEditContact(-1)} testID="emergency-add-contact-button" style={{ marginTop: spacing.sm }} />
      <Button title="Send test message" kind="danger" onPress={() => emTest.mutate()} loading={emTest.isPending} testID="emergency-test-button" style={{ marginTop: spacing.sm }} />
      <Hint>
        While glucose stays at the same alarm level, each contact&apos;s texts and calls repeat at their own interval until you snooze. Messages
        aren&apos;t sent while the demo sensor is selected. Calls and cloud texts go through Twilio, which charges per message.
      </Hint>
      {log.slice(0, 3).map((l) => (
        <Text key={l.id} style={styles.logLine} testID="emergency-log-line">
          {l.test ? "Test" : "Alert"} · {agoText(l.ts)} · {l.results.join(", ")}
        </Text>
      ))}
    </>
  );
}
