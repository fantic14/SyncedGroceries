import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { backendId } from '../../lib/supabase';
import type { HouseholdSnapshot } from '../identity/types';
import type { SharedItem } from '../shared/types';

export type WidgetIdentity = {
  scope: string;
  backend: string;
  userId: string;
  householdId: string;
  joinedAt: string;
  householdName: string;
  suspended?: boolean;
  bound?: boolean;
  pendingCount?: number;
};

type WidgetModule = {
  identity(): string | null;
  setIdentity(value: string): void;
  clear(expectedScope: string | null): void;
  suspendScope(scope: string): void;
  next(scope: string): string | null;
  mergeRows(scope: string, rows: string, fullList: boolean): Promise<void>;
  finish(scope: string, operationId: string, result: string): Promise<void>;
};

export const widget =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<WidgetModule>('GroceryWidget')
    : null;

export function widgetIdentity(): WidgetIdentity | null {
  const raw = widget?.identity();
  return raw ? (JSON.parse(raw) as WidgetIdentity) : null;
}

export function acceptWidgetAccount(backend: string, userId: string | null) {
  const stored = widgetIdentity();
  if (!stored) return;
  if (stored.backend !== backend || (userId && stored.userId !== userId))
    widget?.clear(stored.scope);
  else if (!userId) widget?.suspendScope(stored.scope);
}

export function hasWidgetEdits(userId: string) {
  const stored = widgetIdentity();
  return (
    stored?.backend === backendId &&
    stored.userId === userId &&
    (stored.pendingCount ?? 0) > 0
  );
}

export function forgetWidgetAccount(backend: string, userId: string) {
  const stored = widgetIdentity();
  if (stored?.backend === backend && stored.userId === userId)
    widget?.clear(stored.scope);
}

export function confirmWidgetMembership(
  backend: string,
  userId: string,
  { household, members }: HouseholdSnapshot,
) {
  if (!widget) return;
  const member = members.find((entry) => entry.user_id === userId);
  if (!household || !member) {
    forgetWidgetAccount(backend, userId);
    return;
  }
  const identity: WidgetIdentity = {
    scope: JSON.stringify([backend, userId, household.id, member.joined_at]),
    backend,
    userId,
    householdId: household.id,
    householdName: household.name,
    joinedAt: member.joined_at,
  };
  try {
    widget.setIdentity(JSON.stringify(identity));
  } catch {
    // The next membership refresh retries widget setup. The household remains usable.
    console.warn('Could not prepare the Android household widget.');
  }
}

export function widgetRow(item: SharedItem) {
  if (item.deleted_at)
    return { id: item.id, revision: item.revision, deleted: true };
  return {
    id: item.id,
    title: item.title,
    quantity: item.quantity,
    completed: item.completed,
    revision: item.revision,
  };
}

/** Mirror confirmed RPC results. The app's pending edits stay in its offline
 * store until the server assigns their revisions. */
export function mirrorWidgetItems(
  repository: ReturnType<
    typeof import('../shared/repository').createSharedRepository
  >,
  backend: string,
  userId: string,
  householdId: string,
): typeof repository {
  if (!widget) return repository;
  const scope = () => {
    try {
      const stored = widgetIdentity();
      return stored?.backend === backend &&
        stored.userId === userId &&
        stored.householdId === householdId &&
        stored.bound &&
        !stored.suspended
        ? stored.scope
        : null;
    } catch {
      return null;
    }
  };
  const publish = (
    expected: string | null,
    rows: SharedItem[],
    fullList: boolean,
  ) => {
    if (expected)
      void widget
        .mergeRows(expected, JSON.stringify(rows.map(widgetRow)), fullList)
        .catch(() => {
          // The next snapshot retries. A launcher update cannot fail a committed app edit.
        });
  };
  return {
    ...repository,
    async load(id) {
      const expected = scope();
      const snapshot = await repository.load(id);
      publish(expected, snapshot.items, true);
      return snapshot;
    },
    async mutate(request) {
      const expected = scope();
      const result = await repository.mutate(request);
      if (result.item) publish(expected, [result.item], false);
      return result;
    },
  };
}
