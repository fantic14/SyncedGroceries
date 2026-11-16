import { randomUUID } from 'expo-crypto';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { supabase } from '../../lib/supabase';
import { createSharedRepository } from './repository';
import { createSharedStore } from './store';

export function useSharedHousehold(householdId: string, userId: string) {
  const store = useMemo(
    () =>
      createSharedStore({
        householdId,
        repository: createSharedRepository({
          rpc: (name, args) => {
            if (!supabase) throw new Error('Sharing is not connected yet.');
            return supabase.rpc(name, args);
          },
        }),
        newId: randomUUID,
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
    if (!supabase) return;
    const client = supabase;
    let cancelled = false;
    let eventTimer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(eventTimer);
      eventTimer = setTimeout(() => {
        if (!cancelled) void store.actions.refresh();
      }, 100);
    };
    // Fetch immediately, then reconcile again after subscription acknowledgement.
    // Events are hints to reload authorized snapshots, never trusted record writes.
    void store.actions.refresh();
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
    // Periodic reconciliation also detects membership removal, which may stop
    // authorized Realtime events without sending a final event to that member.
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void store.actions.refresh();
    }, 15000);
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') void store.actions.refresh();
    });
    return () => {
      cancelled = true;
      clearTimeout(eventTimer);
      clearInterval(timer);
      appState.remove();
      void client.removeChannel(channel);
      store.dispose();
    };
  }, [store, householdId]);

  return { ...state, ...store.actions };
}

export type SharedController = ReturnType<typeof useSharedHousehold>;
