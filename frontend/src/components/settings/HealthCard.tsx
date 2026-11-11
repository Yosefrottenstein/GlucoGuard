import { useEffect, useState } from "react";

import { Card, Hint, SectionTitle, ToggleRow } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";
import { disableHealthUpload, enableHealthUpload, healthUploadOn } from "@/src/health";
import { spacing } from "@/src/theme";

/** iPhone: copy readings to Apple Health. */
export function HealthCard() {
  const toast = useToast();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    healthUploadOn().then(setOn);
  }, []);

  const toggle = async (v: boolean) => {
    if (!v) {
      await disableHealthUpload();
      return setOn(false);
    }
    setBusy(true);
    try {
      await enableHealthUpload();
      setOn(true);
      toast("Readings are now copied to Apple Health", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle>Apple Health</SectionTitle>
      <Card style={{ paddingVertical: spacing.xs }}>
        <ToggleRow
          label="Upload to Apple Health"
          sub={busy ? "Asking for permission…" : "Saves each glucose reading as Blood Glucose"}
          value={on}
          onChange={toggle}
          testID="health-upload-toggle"
          last
        />
      </Card>
      <Hint>
        iPhone will ask which data GlucoGuard may write. Readings from the last 24 hours are copied first, then new ones every few minutes while the
        app runs. Demo readings are never copied. You can change access anytime in the Health app under Sharing.
      </Hint>
    </>
  );
}
