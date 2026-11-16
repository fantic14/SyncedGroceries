import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HouseholdScreen } from './src/features/household/HouseholdScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <HouseholdScreen />
    </SafeAreaProvider>
  );
}
