import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { SupportedStorage } from '@supabase/supabase-js';

/**
 * Native: prefer SecureStore for session tokens.
 * Values larger than SecureStore limits fall back to AsyncStorage.
 * Web: AsyncStorage (localStorage under the hood via RN Web).
 */
const CHUNK = 1800;

async function setSecure(key: string, value: string): Promise<void> {
  if (value.length <= CHUNK) {
    await SecureStore.setItemAsync(key, value);
    await AsyncStorage.removeItem(`${key}_chunks`);
    return;
  }
  const parts = Math.ceil(value.length / CHUNK);
  await SecureStore.setItemAsync(`${key}_chunks`, String(parts));
  for (let i = 0; i < parts; i += 1) {
    await SecureStore.setItemAsync(`${key}_${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
  }
}

async function getSecure(key: string): Promise<string | null> {
  const chunksRaw = await SecureStore.getItemAsync(`${key}_chunks`);
  if (!chunksRaw) return SecureStore.getItemAsync(key);
  const parts = Number(chunksRaw);
  if (!Number.isFinite(parts) || parts < 1) return null;
  let out = '';
  for (let i = 0; i < parts; i += 1) {
    const piece = await SecureStore.getItemAsync(`${key}_${i}`);
    if (piece == null) return null;
    out += piece;
  }
  return out;
}

async function removeSecure(key: string): Promise<void> {
  const chunksRaw = await SecureStore.getItemAsync(`${key}_chunks`);
  await SecureStore.deleteItemAsync(key);
  if (chunksRaw) {
    const parts = Number(chunksRaw);
    await SecureStore.deleteItemAsync(`${key}_chunks`);
    for (let i = 0; i < parts; i += 1) {
      await SecureStore.deleteItemAsync(`${key}_${i}`);
    }
  }
}

const memoryStorage: SupportedStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

export function createAuthStorage(): SupportedStorage {
  const isWebServer = Platform.OS === 'web' && typeof window === 'undefined';
  if (isWebServer) return memoryStorage;
  if (Platform.OS === 'web') return AsyncStorage;

  return {
    getItem: (key) => getSecure(key),
    setItem: (key, value) => setSecure(key, value),
    removeItem: (key) => removeSecure(key),
  };
}
