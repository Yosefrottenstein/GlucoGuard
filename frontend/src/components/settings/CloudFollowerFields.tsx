import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";

import { api, Settings } from "@/src/api";
import { ChipRow } from "@/src/components/ChipRow";
import { useToast } from "@/src/components/Toast";
import { Button, Card, Field, Hint } from "@/src/components/ui";
import { spacing } from "@/src/theme";
import { CareLinkLogin } from "./CareLinkLogin";
import { SetSetting, useSettingsStyles } from "./styles";
import type { SecretKey } from "./UploadsSection";

type Props = {
  draft: Settings;
  set: SetSetting;
  secrets: Record<SecretKey, string>;
  setSecret: (k: SecretKey, v: string) => void;
  secretPh: (k: SecretKey) => string;
  beforeSignIn: () => Promise<void>;
  onSignedIn: () => void;
};

export function CloudFollowerFields({ draft, set, secrets, setSecret, secretPh, beforeSignIn, onSignedIn }: Props) {
  const styles = useSettingsStyles();
  const toast = useToast();
  const [login, setLogin] = useState<{ url: string; redirect_uri: string; state: string } | null>(null);

  const start = useMutation({
    mutationFn: async () => {
      await beforeSignIn();
      return api<{ url: string; redirect_uri: string; state: string }>("/carelink/start", {
        method: "POST",
        body: { server: draft.cl_server },
      });
    },
    onSuccess: setLogin,
    onError: (e: Error) => toast(e.message, "error"),
  });
  const signOut = useMutation({
    mutationFn: () => api("/carelink", { method: "DELETE" }),
    onSuccess: () => (toast("Signed out of CareLink", "success"), onSignedIn()),
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (draft.source === "twiist") {
    return (
      <>
        <Card style={styles.subCard} testID="twiist-card">
          <Field label="Follower email" value={draft.twiist_username} onChangeText={(v) => set("twiist_username", v.trim())} placeholder="Email" keyboardType="email-address" testID="twiist-username-input" />
          <Field label="Password" last value={secrets.twiist_password} onChangeText={(v) => setSecret("twiist_password", v)} placeholder={secretPh("twiist_password")} secureTextEntry testID="twiist-password-input" />
        </Card>
        <Hint>
          Use the same follower login as Nightscout Pro: create it at mytwiistportal.com, invite it from the twiist app, then sign in here. The pump
          owner&apos;s own login won&apos;t work. Readings arrive about 5 minutes late.
        </Hint>
      </>
    );
  }

  if (draft.source === "glooko") {
    return (
      <>
        <Card style={styles.subCard} testID="glooko-card">
          <Field label="Email" value={draft.glooko_email} onChangeText={(v) => set("glooko_email", v.trim())} placeholder="Glooko / Omnipod DISCOVER email" keyboardType="email-address" testID="glooko-email-input" />
          <Field label="Password" value={secrets.glooko_password} onChangeText={(v) => setSecret("glooko_password", v)} placeholder={secretPh("glooko_password")} secureTextEntry testID="glooko-password-input" />
          <View style={styles.inlineChips}>
            <Text style={styles.inlineLabel}>Region</Text>
            <ChipRow
              options={[
                { value: "US", label: "USA" },
                { value: "EU", label: "Europe" },
                { value: "DE-FR", label: "DE / FR" },
                { value: "CA", label: "Canada" },
              ]}
              value={draft.glooko_region}
              onChange={(v) => set("glooko_region", v)}
              testIDPrefix="glooko-region"
              padded={false}
            />
          </View>
        </Card>
        <Hint>
          Omnipod 5 uploads to Glooko (Omnipod DISCOVER runs on it). Glooko only gets new readings when the pump app syncs, so data can be an hour or more
          behind. Turn off two-step sign-in on the account.
        </Hint>
      </>
    );
  }

  if (draft.source !== "carelink") return null;
  const signedIn = draft.cl_refresh_token_set;
  return (
    <>
      <Card style={styles.subCard} testID="carelink-card">
        <View style={styles.inlineChips}>
          <Text style={styles.inlineLabel}>Region</Text>
          <ChipRow
            options={[
              { value: "EU", label: "Europe / rest of world" },
              { value: "US", label: "USA" },
            ]}
            value={draft.cl_server}
            onChange={(v) => set("cl_server", v)}
            testIDPrefix="carelink-region"
            padded={false}
          />
        </View>
        <Field label="Username" value={draft.cl_username} onChangeText={(v) => set("cl_username", v.trim())} placeholder="CareLink username" testID="carelink-username-input" />
        <Field label="Password" value={secrets.cl_password} onChangeText={(v) => setSecret("cl_password", v)} placeholder={secretPh("cl_password")} secureTextEntry testID="carelink-password-input" />
        <Field
          label="Country"
          value={draft.cl_country}
          onChangeText={(v) => set("cl_country", v.toLowerCase().replace(/[^a-z]/g, "").slice(0, 2))}
          placeholder="gb, de, us…"
          testID="carelink-country-input"
        />
        <Field label="Patient" last value={draft.cl_patient} onChangeText={(v) => set("cl_patient", v.trim())} placeholder="Optional" testID="carelink-patient-input" />
        <View style={styles.syncRow}>
          <Text style={styles.syncText} testID="carelink-signin-status">
            {signedIn ? `Signed in${draft.cl_username ? ` as ${draft.cl_username}` : ""}` : "Not signed in on the Medtronic page yet"}
          </Text>
        </View>
        <Button
          title={signedIn ? "Sign in again on Medtronic page" : "Sign in on Medtronic page"}
          kind="secondary"
          onPress={() => start.mutate()}
          loading={start.isPending}
          testID="carelink-signin-button"
          style={{ marginBottom: spacing.sm }}
        />
        {signedIn && (
          <Button title="Sign out of CareLink" kind="danger" onPress={() => signOut.mutate()} loading={signOut.isPending} testID="carelink-signout-button" style={{ marginBottom: spacing.sm }} />
        )}
      </Card>
      <Hint>
        Works with a care partner account or your own. Save your username and password, or, if Medtronic asks for a &quot;not a robot&quot; check, tap
        &quot;Sign in on Medtronic page&quot;. GlucoGuard then stays signed in.
      </Hint>
      <CareLinkLogin
        flow={login}
        onClose={() => setLogin(null)}
        onDone={(username) => {
          setLogin(null);
          toast(username ? `Signed in to CareLink as ${username}` : "Signed in to CareLink", "success");
          onSignedIn();
        }}
      />
    </>
  );
}
