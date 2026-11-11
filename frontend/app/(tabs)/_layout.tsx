import Ionicons from "@react-native-vector-icons/ionicons";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { ColorValue, Platform } from "react-native";

import { usesNativeTabs } from "@/src/navigation";
import { fonts, useTheme } from "@/src/theme";

export default function TabsLayout() {
  const { colors } = useTheme();

  if (usesNativeTabs) {
    return (
      <NativeTabs tintColor={colors.onSurface}>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon sf="drop.fill" />
          <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="history">
          <NativeTabs.Trigger.Icon sf="clock.arrow.circlepath" />
          <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="stats">
          <NativeTabs.Trigger.Icon sf="chart.bar.fill" />
          <NativeTabs.Trigger.Label>Stats</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="settings">
          <NativeTabs.Trigger.Icon sf="gearshape.fill" />
          <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="profile">
          <NativeTabs.Trigger.Icon sf="person.crop.circle.fill" />
          <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  const icon =
    (name: "water" | "time" | "stats-chart" | "settings" | "person-circle") =>
    ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} size={size} color={color} />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.onSurface,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surfaceSecondary,
          borderTopColor: colors.border,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarLabelStyle: { fontFamily: fonts.text, fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("water"), tabBarButtonTestID: "tab-home" }} />
      <Tabs.Screen name="history" options={{ title: "History", tabBarIcon: icon("time"), tabBarButtonTestID: "tab-history" }} />
      <Tabs.Screen name="stats" options={{ title: "Stats", tabBarIcon: icon("stats-chart"), tabBarButtonTestID: "tab-stats" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: icon("settings"), tabBarButtonTestID: "tab-settings" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: icon("person-circle"), tabBarButtonTestID: "tab-profile" }} />
    </Tabs>
  );
}
