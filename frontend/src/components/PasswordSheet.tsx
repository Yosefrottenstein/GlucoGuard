import { useState } from "react";

import { api } from "@/src/api";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { Button, Field } from "./ui";
import { spacing } from "@/src/theme";

export function PasswordSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const toast = useToast();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    setCur("");
    setNext("");
    setAgain("");
    onClose();
  };

  const submit = async () => {
    if (!cur || !next) return toast("Enter your current and new password", "error");
    if (next.length < 8) return toast("New password needs at least 8 characters", "error");
    if (next !== again) return toast("The new passwords don't match", "error");
    setBusy(true);
    try {
      await api("/auth/change-password", { method: "POST", body: { current_password: cur, new_password: next } });
      toast("Password changed", "success");
      close();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={close} title="Change password" testID="password-sheet">
      <Field label="Current" value={cur} onChangeText={setCur} secureTextEntry placeholder="Current password" testID="password-current-input" />
      <Field label="New" value={next} onChangeText={setNext} secureTextEntry placeholder="At least 8 characters" testID="password-new-input" />
      <Field label="Repeat" value={again} onChangeText={setAgain} secureTextEntry placeholder="New password again" testID="password-repeat-input" last />
      <Button title="Change password" onPress={submit} loading={busy} testID="password-save-button" style={{ marginTop: spacing.lg }} />
    </Sheet>
  );
}
