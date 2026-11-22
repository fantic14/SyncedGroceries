import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { IconFontProvider } from './src/components/Ionicons';
import { HouseholdScreen } from './src/features/household/HouseholdScreen';
import { IdentityScreen } from './src/features/identity/IdentityScreen';

export default function App() {
  const [identityOpen, setIdentityOpen] = useState(false);
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <IconFontProvider>
        <View style={{ flex: 1, display: identityOpen ? 'none' : 'flex' }}>
          <HouseholdScreen onOpenIdentity={() => setIdentityOpen(true)} />
        </View>
        {identityOpen && (
          <IdentityScreen onClose={() => setIdentityOpen(false)} />
        )}
      </IconFontProvider>
    </SafeAreaProvider>
  );
}
