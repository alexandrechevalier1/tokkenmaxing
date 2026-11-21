import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Cached, Connection } from './types';

// Read by both the app and the widget's headless task.
const KEYS = {
  connection: 'tm.connection',
  cache: 'tm.cache.v2',
} as const;

async function read<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function write(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: the app still works, it just forgets.
  }
}

export const loadConnection = () => read<Connection>(KEYS.connection);
export const saveConnection = (c: Connection) => write(KEYS.connection, c);

export const loadCache = () => read<Cached>(KEYS.cache);
export const saveCache = (c: Cached) => write(KEYS.cache, c);
