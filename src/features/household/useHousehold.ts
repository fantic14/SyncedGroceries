import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createItem,
  householdReducer,
  type HouseholdAction,
  type HouseholdState,
} from './state';
import { loadHousehold, saveHousehold } from './storage';

export type SaveStatus = 'saving' | 'saved' | 'error';

export function useHousehold() {
  const [state, setState] = useState<HouseholdState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saving');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);

    loadHousehold()
      .then((saved) => {
        if (!cancelled) setState(saved);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  useEffect(() => {
    // Wait for hydration so opening the app cannot overwrite an existing list.
    if (state === null) return;

    let cancelled = false;
    setSaveStatus('saving');

    // Debounce note typing and serialize writes so an old save cannot finish last.
    const timer = setTimeout(() => {
      saveQueue.current = saveQueue.current
        .catch(() => undefined)
        .then(() => saveHousehold(state));

      saveQueue.current
        .then(() => {
          if (!cancelled) setSaveStatus('saved');
        })
        .catch(() => {
          if (!cancelled) setSaveStatus('error');
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state, saveAttempt]);

  const dispatch = useCallback((action: HouseholdAction) => {
    setState((current) =>
      current ? householdReducer(current, action) : current,
    );
  }, []);

  return {
    state,
    loadError,
    saveStatus,
    retryLoad: () => setLoadAttempt((attempt) => attempt + 1),
    retrySave: () => setSaveAttempt((attempt) => attempt + 1),
    addItem: (title: string, quantity: string) =>
      dispatch({
        type: 'add',
        item: createItem(
          randomUUID(),
          title,
          quantity,
          new Date().toISOString(),
        ),
      }),
    toggleItem: (id: string) =>
      dispatch({ type: 'toggle', id, updatedAt: new Date().toISOString() }),
    removeItem: (id: string) => dispatch({ type: 'remove', id }),
    clearCompleted: () => dispatch({ type: 'clear-completed' }),
    updateNote: (note: string) => dispatch({ type: 'update-note', note }),
  };
}
