import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProvider } from '@/state/AppProvider';
import { colors } from '@/ui/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.ink,
            headerTitleStyle: { fontWeight: '600' },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="setup" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="calendar" options={{ title: 'Calendar' }} />
          <Stack.Screen name="event/[id]" options={{ title: 'Event' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="review" options={{ title: 'Review queue' }} />
        </Stack>
      </AppProvider>
    </SafeAreaProvider>
  );
}
