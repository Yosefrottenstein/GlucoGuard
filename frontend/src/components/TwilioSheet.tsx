import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Linking, Pressable, Text } from "react-native";

import { api, Settings } from "@/src/api";
import { fonts, makeStyles, spacing } from "@/src/theme";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { Button, Field } from "./ui";

/** The user's own Twilio account: used for iPhone texts and calls, and Android calls. */
export function TwilioSheet({
  visible,
  settings,
  onClose,
  onSaved,
  why,
}: {
  visible: boolean;
  settings: Settings;
  onClose: () => void;
  onSaved: (s: Settings) => void;
  why: string;
}) {
  const styles = useStyles();
  const toast = useToast();
  const qc = useQueryClient();
  const [sid, setSid] = useState(settings.twilio_sid);
  const [token, setToken] = useState("");
  const [from, setFrom] = useState(settings.twilio_from);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const s = sid.trim();
    const f = from.replace(/[\s()-]/g, "");
    if (!/^AC[0-9a-fA-F]{32}$/.test(s)) return toast("Account SID starts with AC and has 34 characters", "error");
    if (!token && !settings.twilio_token_set) return toast("Enter your Auth Token", "error");
    if (!/^\+\d{7,15}$/.test(f)) return toast("Twilio number must start with + and country code", "error");
    setBusy(true);
    try {
      const data = await api<Settings>("/settings", { method: "PUT", body: { twilio_sid: s, twilio_token: token.trim(), twilio_from: f } });
      qc.setQueryData(["settings"], data);
      onSaved(data);
      toast("Twilio account saved", "success");
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Your Twilio account" testID="twilio-sheet">
      <Text style={styles.body}>{why}</Text>
      <Text style={styles.body}>Find these in your Twilio Console under Account Info. Twilio charges your account per text and call.</Text>
      <Pressable onPress={() => Linking.openURL("https://console.twilio.com")} testID="twilio-console-link" style={styles.link}>
        <Text style={styles.linkText}>Open Twilio Console</Text>
      </Pressable>
      <Field label="Account SID" value={sid} onChangeText={setSid} placeholder="AC…" autoCapitalize="none" testID="twilio-sid-input" />
      <Field
        label="Auth Token"
        value={token}
        onChangeText={setToken}
        placeholder={settings.twilio_token_set ? "Saved · type to replace" : "Auth Token"}
        secureTextEntry
        testID="twilio-token-input"
      />
      <Field label="Twilio number" value={from} onChangeText={setFrom} placeholder="+15551234567" keyboardType="phone-pad" testID="twilio-from-input" last />
      <Button title="Save Twilio account" onPress={save} loading={busy} testID="twilio-save-button" style={{ marginTop: spacing.lg }} />
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  body: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceTertiary, marginBottom: spacing.sm },
  link: { minHeight: 44, justifyContent: "center" },
  linkText: { fontFamily: fonts.text, fontSize: 14, fontWeight: "700", color: c.brandPrimary },
}));
