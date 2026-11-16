import 'react-native-url-polyfill/auto';

import { createClient, processLock } from '@supabase/supabase-js';
import { randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { createChunkedStorage } from './chunkedStorage';
import { readBackendConfig } from './backendConfig';

const config = readBackendConfig(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

// Public client configuration only. Never put a secret/service-role key here.
export const backendConfigured = config !== null;

const nativeStorage = createChunkedStorage(
  {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) =>
      SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    removeItem: (key) => SecureStore.deleteItemAsync(key),
  },
  randomUUID,
);

// Browser preview sessions are intentionally tab-scoped. Native sessions use
// encrypted system storage; neither falls back to plaintext AsyncStorage.
const webStorage = {
  getItem: async (key: string) => globalThis.sessionStorage.getItem(key),
  setItem: async (key: string, value: string) => {
    globalThis.sessionStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    globalThis.sessionStorage.removeItem(key);
  },
};

export const supabase = config
  ? createClient(config.url, config.publicKey, {
      auth: {
        storage: Platform.OS === 'web' ? webStorage : nativeStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        lock: processLock,
      },
    })
  : null;
