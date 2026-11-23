import { registerRootComponent } from 'expo';
import { AppRegistry, Platform } from 'react-native';

import App from '../App';

if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask('SyncGroceryWidget', () => async () => {
    const { syncWidget } = await import('./features/widget/sync');
    await syncWidget();
  });
}
registerRootComponent(App);
