import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { IconFontProvider } from './src/components/Ionicons';
import type { ListScope } from './src/components/ListNavigation';
import { HouseholdScreen } from './src/features/household/HouseholdScreen';
import { IdentityScreen } from './src/features/identity/IdentityScreen';
import { colors } from './src/theme';

const scopeKey = '@synced-groceries/last-list';

export default function App() {
  const [scope, setScope] = useState<ListScope | null>(null);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(scopeKey)
      .catch(() => null)
      .then((saved) => {
        if (active) setScope(saved === 'household' ? 'household' : 'phone');
      });
    return () => {
      active = false;
    };
  }, []);

  function select(next: ListScope) {
    setScope(next);
    void AsyncStorage.setItem(scopeKey, next).catch(() => undefined);
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <IconFontProvider>
        {scope === null ? (
          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              backgroundColor: colors.background,
            }}
          >
            <ActivityIndicator color={colors.green} />
          </View>
        ) : (
          <>
            <View
              style={{ flex: 1, display: scope === 'phone' ? 'flex' : 'none' }}
            >
              <HouseholdScreen onOpenIdentity={() => select('household')} />
            </View>
            {scope === 'household' && (
              <IdentityScreen onClose={() => select('phone')} />
            )}
          </>
        )}
      </IconFontProvider>
    </SafeAreaProvider>
  );
}
