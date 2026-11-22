import 'react-native-url-polyfill/auto';

import { createClient, type Session } from '@supabase/supabase-js';
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
export const backendId = config?.url ?? '';

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

const authStorage = Platform.OS === 'web' ? webStorage : nativeStorage;
// Include the full normalized endpoint, including port/path, rather than only
// the hostname prefix. Two development projects must not share an auth cache.
const authStorageKey = `synced-groceries.auth.${Array.from(backendId)
  .map((character) => character.charCodeAt(0).toString(16).padStart(4, '0'))
  .join('')}`;

export async function readCachedAuthSession(): Promise<Session | null> {
  if (!config) return null;
  const raw = await authStorage.getItem(authStorageKey);
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object')
    throw new Error('The saved sign-in session could not be read.');
  const session = value as Partial<Session>;
  if (
    typeof session.access_token !== 'string' ||
    typeof session.refresh_token !== 'string' ||
    !session.access_token ||
    !session.refresh_token ||
    typeof session.expires_at !== 'number' ||
    !Number.isFinite(session.expires_at) ||
    !session.user ||
    typeof session.user.id !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(session.user.id)
  )
    throw new Error('The saved sign-in session could not be read.');
  // This is a locally stored session, potentially expired. Callers may use it
  // only to scope cached data after a retryable Auth failure, never as proof of
  // current remote authorization. The SDK still authorizes every remote write.
  return session as Session;
}

export const supabase = config
  ? createClient(config.url, config.publicKey, {
      auth: {
        storage: authStorage,
        storageKey: authStorageKey,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;
