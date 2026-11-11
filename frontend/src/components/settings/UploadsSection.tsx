import type { UseMutationResult } from "@tanstack/react-query";
import { View, Text } from "react-native";

import type { Settings, Status } from "@/src/api";
import { ChipRow } from "@/src/components/ChipRow";
import { Button, Card, Field, Hint, SectionTitle, ToggleRow } from "@/src/components/ui";
import { spacing } from "@/src/theme";
import { SetSetting, useSettingsStyles } from "./styles";

export type SecretKey =
  | "ns_secret"
  | "dexcom_password"
  | "libre_password"
  | "tp_password"
  | "twiist_password"
  | "cl_password"
  | "glooko_password";
type Upload = UseMutationResult<any, Error, void, unknown>;

export function DexcomLoginFields({
  draft,
  set,
  secret,
  onSecret,
  secretPh,
}: {
  draft: Settings;
  set: SetSetting;
  secret: string;
  onSecret: (v: string) => void;
  secretPh: string;
}) {
  const styles = useSettingsStyles();
  return (
    <>
      <Field label="Username" value={draft.dexcom_username} onChangeText={(v) => set("dexcom_username", v)} placeholder="Dexcom account" testID="dexcom-username-input" />
      <Field label="Password" value={secret} onChangeText={onSecret} placeholder={secretPh} secureTextEntry testID="dexcom-password-input" />
      <View style={styles.inlineChips}>
        <Text style={styles.inlineLabel}>Region</Text>
        <ChipRow
          options={[
            { value: "us", label: "USA" },
            { value: "ous", label: "Outside USA" },
            { value: "jp", label: "Japan" },
          ]}
          value={draft.dexcom_region}
          onChange={(v) => set("dexcom_region", v)}
          testIDPrefix="dexcom-region"
          padded={false}
        />
      </View>
    </>
  );
}

export function UploadsSection({
  draft,
  set,
  mode,
  secrets,
  setSecret,
  secretPh,
  status,
  nsUpload,
  tpUpload,
  dxUpload,
}: {
  draft: Settings;
  set: SetSetting;
  mode: "follower" | "master";
  secrets: Record<SecretKey, string>;
  setSecret: (k: SecretKey, v: string) => void;
  secretPh: (k: SecretKey) => string;
  status?: Status;
  nsUpload: Upload;
  tpUpload: Upload;
  dxUpload: Upload;
}) {
  const styles = useSettingsStyles();
  const showNs = draft.ns_upload || draft.source === "nightscout";
  const err = (k: string) => (status?.upload_errors?.[k] ? <Text style={styles.err}>{status.upload_errors[k]}</Text> : null);

  return (
    <>
      <SectionTitle>Nightscout</SectionTitle>
      <Card style={{ paddingVertical: spacing.xs }}>
        <ToggleRow
          label="Upload to Nightscout"
          sub="Readings and entries, every minute"
          value={draft.ns_upload}
          onChange={(v) => set("ns_upload", v)}
          testID="nightscout-upload-toggle"
          last={!showNs}
        />
        {showNs && (
          <>
            <Field label="Site URL" value={draft.ns_url} onChangeText={(v) => set("ns_url", v.trim())} placeholder="https://mysite.herokuapp.com" keyboardType="url" testID="nightscout-url-input" />
            <Field
              label="API secret"
              value={secrets.ns_secret}
              onChangeText={(v) => setSecret("ns_secret", v)}
              placeholder={secretPh("ns_secret")}
              secureTextEntry
              testID="nightscout-secret-input"
              last
            />
          </>
        )}
      </Card>
      {draft.source === "nightscout" && !draft.ns_upload && <Hint>Your Nightscout site is also your data source, so its address is needed here.</Hint>}
      {err("nightscout")}
      {draft.ns_upload && (
        <Button title="Upload now" kind="secondary" onPress={() => nsUpload.mutate()} loading={nsUpload.isPending} testID="nightscout-upload-button" style={{ marginTop: spacing.sm }} />
      )}

      <SectionTitle>Tidepool</SectionTitle>
      <Card style={{ paddingVertical: spacing.xs }}>
        <ToggleRow label="Upload to Tidepool" sub="Every 15 minutes" value={draft.tp_upload} onChange={(v) => set("tp_upload", v)} testID="tidepool-upload-toggle" last={!draft.tp_upload} />
        {draft.tp_upload && (
          <>
            <Field label="Email" value={draft.tp_email} onChangeText={(v) => set("tp_email", v.trim())} placeholder="Tidepool email" keyboardType="email-address" testID="tidepool-email-input" />
            <Field
              label="Password"
              value={secrets.tp_password}
              onChangeText={(v) => setSecret("tp_password", v)}
              placeholder={secretPh("tp_password")}
              secureTextEntry
              testID="tidepool-password-input"
              last
            />
          </>
        )}
      </Card>
      {err("tidepool")}
      {draft.tp_upload && (
        <Button title="Upload now" kind="secondary" onPress={() => tpUpload.mutate()} loading={tpUpload.isPending} testID="tidepool-upload-button" style={{ marginTop: spacing.sm }} />
      )}

      {mode === "master" && (
        <>
          <SectionTitle>Dexcom Share</SectionTitle>
          <Card style={{ paddingVertical: spacing.xs }}>
            <ToggleRow
              label="Upload to Dexcom Share"
              sub="Your followers see readings in the Dexcom Follow app"
              value={draft.dx_upload}
              onChange={(v) => set("dx_upload", v)}
              testID="dexcom-upload-toggle"
              last={!draft.dx_upload}
            />
            {draft.dx_upload && (
              <>
                <DexcomLoginFields
                  draft={draft}
                  set={set}
                  secret={secrets.dexcom_password}
                  onSecret={(v) => setSecret("dexcom_password", v)}
                  secretPh={secretPh("dexcom_password")}
                />
                <Field
                  label="Receiver serial"
                  value={draft.dx_serial}
                  onChangeText={(v) => set("dx_serial", v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16))}
                  placeholder="SM00000000"
                  autoCapitalize="characters"
                  testID="dexcom-serial-input"
                  last
                />
              </>
            )}
          </Card>
          {draft.dx_upload && (
            <Hint>
              Uses your own Dexcom account, the way xDrip+ does it. Leave the serial as SM00000000 unless you have a Dexcom receiver. Dexcom
              doesn&apos;t officially support this, so it may stop working if Dexcom changes their service. Don&apos;t turn it on while the
              official Dexcom app is also uploading.
            </Hint>
          )}
          {err("dexcom")}
          {draft.dx_upload && (
            <Button title="Upload now" kind="secondary" onPress={() => dxUpload.mutate()} loading={dxUpload.isPending} testID="dexcom-upload-button" style={{ marginTop: spacing.sm }} />
          )}
        </>
      )}
    </>
  );
}
