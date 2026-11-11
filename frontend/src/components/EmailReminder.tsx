import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Text } from "react-native";

import { api } from "@/src/api";
import { fonts, makeStyles, spacing } from "@/src/theme";
import { EmailSheet, emailPromptState, NO_EMAIL_WARNING } from "./EmailPrompt";
import { Sheet } from "./Sheet";
import { Button } from "./ui";

/** Once per app start: nudge users without a recovery email to add one. */
export function EmailReminder() {
  const styles = useStyles();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ username: string; email: string | null }>("/auth/me") });
  const [show, setShow] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (me.data && !me.data.email && !emailPromptState.skippedNow) {
      const t = setTimeout(() => setShow(true), 1500);
      return () => clearTimeout(t);
    }
  }, [me.data]);

  if (adding) return <EmailSheet visible current={null} onClose={() => setAdding(false)} />;
  return (
    <Sheet visible={show} onClose={() => setShow(false)} title="Add a recovery email" testID="email-reminder-sheet">
      <Text style={styles.body}>{NO_EMAIL_WARNING}</Text>
      <Button
        title="Add email"
        onPress={() => {
          setShow(false);
          setAdding(true);
        }}
        testID="email-reminder-add-button"
        style={{ marginTop: spacing.lg }}
      />
      <Button title="Later" kind="secondary" onPress={() => setShow(false)} testID="email-reminder-later-button" style={{ marginTop: spacing.sm }} />
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  body: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceTertiary },
}));
