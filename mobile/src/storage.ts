import AsyncStorage from '@react-native-async-storage/async-storage';

import type { FullTargets } from './report';
import type { Cached } from './types';

// Read by both the app and the widget's headless task. The Claude tokens are not here: they
// live in the secure store (src/claude.ts).
const KEYS = {
  cache: 'tm.cache.v2',
  targets: 'tm.targets',
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

export const loadCache = () => read<Cached>(KEYS.cache);
export const saveCache = (c: Cached) => write(KEYS.cache, c);

/** The objectives, set on the phone. null until changed once (or carried over from the PC). */
export const loadTargets = () => read<FullTargets>(KEYS.targets);
export const saveTargets = (t: FullTargets) => write(KEYS.targets, t);

/** What the old version stored to reach the PC. */
export const forgetPcConnection = () => AsyncStorage.removeItem('tm.connection').catch(() => undefined);
