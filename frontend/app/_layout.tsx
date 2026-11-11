import { useFonts } from "expo-font";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { LogBox, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { AuthProvider, useAuth } from "@/src/auth";
import { AlarmWatcher } from "@/src/components/AlarmWatcher";
import { LoginScreen } from "@/src/components/LoginScreen";
import { EmailPromptScreen } from "@/src/components/EmailPrompt";
import { ErrorBoundary } from "@/src/components/error-boundary";
import { SensorCollector } from "@/src/components/SensorCollector";
import { ToastProvider } from "@/src/components/Toast";
import { queryClient } from "@/src/query-client";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true)

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceGrotesk: require("../assets/fonts/SpaceGrotesk.ttf"),
    PlusJakartaSans: require("../assets/fonts/PlusJakartaSans.ttf"),
  });
  if (!loaded && !error) return null;

  // One app level ErrorBoundary; a render crash shows a reload screen
  // instead of a blank app. GestureHandlerRootView must wrap the whole tree
  // or any gesture/swipe/drawer screen crashes in Expo Go.
  return (
    <GestureHandlerRootView style={styles.root}>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <KeyboardProvider>
            <ToastProvider>
              <AuthProvider>
                <AuthGate />
              </AuthProvider>
            </ToastProvider>
          </KeyboardProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

function AuthGate() {
  const { ready, signedIn, needsEmail } = useAuth();
  if (!ready) return null;
  if (!signedIn) return <LoginScreen />;
  if (needsEmail) return <EmailPromptScreen />;
  return (
    <>
      <SensorCollector />
      <AlarmWatcher />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
