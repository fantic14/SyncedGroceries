import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  createInitialState,
  parseHouseholdState,
  type HouseholdState,
} from './state';

const STORAGE_KEY = '@synced-groceries/household/v1';

// This adapter is local storage only. Remote sharing is a separate milestone.
export async function loadHousehold(): Promise<HouseholdState> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw === null ? createInitialState() : parseHouseholdState(raw);
}

export async function saveHousehold(state: HouseholdState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
