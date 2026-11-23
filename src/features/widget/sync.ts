import { backendId, supabase } from '../../lib/supabase';
import { needsIdentityReauthentication } from '../identity/identityCache';
import { createSharedRepository } from '../shared/repository';
import type { ItemMutationRequest } from '../shared/types';
import { widget, widgetIdentity, widgetRow } from './bridge';

async function synchronize() {
  const identity = widgetIdentity();
  if (!widget || !identity || identity.suspended) return;
  const { scope, userId, householdId, joinedAt } = identity;
  if (!supabase || backendId !== identity.backend) {
    widget.clear(scope);
    return;
  }
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      widget.suspendScope(scope);
      return;
    }
    if (data.session.user.id !== userId) {
      widget.clear(scope);
      return;
    }

    // Pin every request to the account verified for this job, even when an
    // activity changes the live SDK session while a remote read is in flight.
    const client = supabase;
    const bearer = `Bearer ${data.session.access_token}`;
    const rpc = (name: string, args: Record<string, unknown> = {}) =>
      client.rpc(name, args).setHeader('Authorization', bearer);
    const membership = await rpc('get_household_members');
    if (membership.error) throw membership.error;
    const member = (
      membership.data as { user_id: string; joined_at: string }[] | null
    )?.find((row) => row.user_id === userId);
    // joined_at is also the membership generation used by the app's offline cache.
    const mine = await rpc('get_my_household');
    if (mine.error) throw mine.error;
    const house = (mine.data as { id: string; name: string }[] | null)?.[0];
    if (member?.joined_at !== joinedAt || house?.id !== householdId) {
      widget.clear(scope);
      return;
    }

    const repository = createSharedRepository({ rpc });
    // next() and finish() are scoped. A late task cannot read or acknowledge an
    // operation for a replacement membership.
    for (let next = widget.next(scope); next; next = widget.next(scope)) {
      const operation = JSON.parse(next) as Omit<
        ItemMutationRequest,
        'householdId'
      >;
      const result = await repository.mutate({ ...operation, householdId });
      await widget.finish(
        scope,
        operation.operationId,
        JSON.stringify({
          status: result.status,
          item: result.item && widgetRow(result.item),
        }),
      );
    }
    const snapshot = await repository.load(householdId);
    await widget.mergeRows(
      scope,
      JSON.stringify(snapshot.items.map(widgetRow)),
      true,
    );
  } catch (error) {
    if ((error as { code?: string } | null)?.code === '42501')
      widget.clear(scope);
    else if (needsIdentityReauthentication(error)) widget.suspendScope(scope);
    // Pending operations survive transport failures. JobScheduler backs off.
  }
}

let running: Promise<void> | null = null;
export function syncWidget() {
  running ??= synchronize().finally(() => {
    running = null;
  });
  return running;
}
