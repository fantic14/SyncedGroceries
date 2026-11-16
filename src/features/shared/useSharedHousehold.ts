import NetInfo from '@react-native-community/netinfo';
import { randomUUID } from 'expo-crypto';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { backendId, supabase } from '../../lib/supabase';
import { createOfflineStore } from '../offline/engine';
import { createLazyCacheFactory } from '../offline/lazyCache';
import { getOfflinePersistence } from '../offline/platformPersistence';
import type { OfflineDocument } from '../offline/types';
import { createSharedRepository } from './repository';

export function useSharedHousehold(
  householdId: string,
  userId: string,
  authReady = true,
  authToken?: string,
) {
  const store = useMemo(
    () =>
      createOfflineStore({
        householdId,
        userId,
        repository: createSharedRepository({
          rpc: (name, args) => {
            if (!supabase) throw new Error('Sharing is not connected yet.');
            return supabase.rpc(name, args);
          },
        }),
        newId: randomUUID,
        cacheFactory: createLazyCacheFactory<OfflineDocument>(
          getOfflinePersistence,
          {
            backend: backendId,
            userId,
            householdId,
          },
        ),
      }),
    [householdId, userId],
  );
  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState,
  );

  useEffect(() => {
    store.activate();
    let cancelled = false;
    let hydrated = false;
    let connected = false;
    const foreground = () =>
      AppState.currentState !== 'background' &&
      AppState.currentState !== 'inactive';
    const updateNetwork = (network: {
      isConnected: boolean | null;
      isInternetReachable: boolean | null;
    }) => {
      connected =
        network.isConnected !== false && network.isInternetReachable !== false;
      if (!cancelled && hydrated) store.setOnline(connected && foreground());
    };
    const unsubscribe = NetInfo.addEventListener(updateNetwork);
    void store.hydrate().then(() => {
      if (cancelled) return;
      hydrated = true;
      store.setOnline(connected && foreground());
      void NetInfo.fetch()
        .then(updateNetwork)
        .catch(() => {
          if (!cancelled) store.setOnline(false);
        });
    });
    const timer = setInterval(() => {
      if (foreground() && connected) void store.actions.refresh();
    }, 15000);
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void NetInfo.fetch()
          .then((network) => {
            if (cancelled) return;
            updateNetwork(network);
            if (connected) void store.actions.refresh();
          })
          .catch(() => {
            if (!cancelled) store.setOnline(false);
          });
      } else store.setOnline(false);
    });
    return () => {
      cancelled = true;
      unsubscribe();
      clearInterval(timer);
      appState.remove();
      store.dispose();
    };
  }, [store]);

  useEffect(() => {
    void store.setAuthReady(authReady);
  }, [store, authReady, authToken]);

  useEffect(() => {
    if (!state.online || !authReady || !supabase) return;
    const client = supabase;
    let cancelled = false;
    let eventTimer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(eventTimer);
      eventTimer = setTimeout(() => {
        if (!cancelled) void store.actions.refresh();
      }, 100);
    };
    const channel = client
      .channel(`household-${householdId}-${randomUUID()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'grocery_items',
          filter: `household_id=eq.${householdId}`,
        },
        changed,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'household_notes',
          filter: `household_id=eq.${householdId}`,
        },
        changed,
      )
      .subscribe((status) => {
        if (cancelled) return;
        if (status === 'SUBSCRIBED') {
          store.setConnection('live');
          void store.actions.refresh();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
          store.setConnection('reconnecting');
        else if (status === 'CLOSED') store.setConnection('error');
      });
    return () => {
      cancelled = true;
      clearTimeout(eventTimer);
      void client.removeChannel(channel);
    };
  }, [store, householdId, state.online, authReady, authToken]);

  useEffect(() => {
    if (
      !state.online ||
      !authReady ||
      !state.nextRetryAt ||
      state.syncStatus === 'reauth'
    )
      return;
    const timer = setTimeout(
      () => {
        if (
          AppState.currentState !== 'background' &&
          AppState.currentState !== 'inactive'
        )
          void store.actions.refresh();
      },
      Math.max(0, state.nextRetryAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [store, state.online, state.nextRetryAt, state.syncStatus, authReady]);

  return { ...state, ...store.actions };
}

export type SharedController = ReturnType<typeof useSharedHousehold>;
