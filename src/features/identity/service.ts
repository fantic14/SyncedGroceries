import { supabase } from '../../lib/supabase';
import type {
  CreatedInvite,
  Household,
  HouseholdSnapshot,
  Invite,
  Member,
} from './types';

function client() {
  if (!supabase) throw new Error('Sharing is not connected yet.');
  return supabase;
}

export async function loadIdentity(userId: string): Promise<HouseholdSnapshot> {
  const { data, error } = await client().rpc('get_my_household');
  if (error) throw error;
  const household = (data as Household[] | null)?.[0] ?? null;
  if (!household) return { household: null, members: [], invites: [] };
  const [members, invites] = await Promise.all([
    client().rpc('get_household_members'),
    household.owner_id === userId
      ? client().rpc('get_household_invites')
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (members.error) throw members.error;
  if (invites.error) throw invites.error;
  return {
    household,
    members: (members.data ?? []) as Member[],
    invites: (invites.data ?? []) as Invite[],
  };
}

export async function createHousehold(name: string, displayName: string) {
  const { error } = await client().rpc('create_household', {
    household_name: name.trim(),
    display_name: displayName.trim(),
  });
  if (error) throw error;
}

export async function joinHousehold(token: string, displayName: string) {
  const { data, error } = await client().rpc('redeem_household_invite', {
    invite_token: token.trim().toLowerCase(),
    display_name: displayName.trim(),
  });
  if (error) throw error;
  if (!data)
    throw new Error(
      'This invite is unavailable. Check the code or ask for a new invite. Too many attempts? Try again in 15 minutes.',
    );
}

export async function createInvite(): Promise<CreatedInvite> {
  const { data, error } = await client().rpc('create_household_invite');
  if (error) throw error;
  const invite = (data as CreatedInvite[] | null)?.[0];
  if (!invite) throw new Error('Couldn’t create an invite. Please try again.');
  return invite;
}

export async function membershipAction(
  action:
    | 'revoke_household_invite'
    | 'remove_household_member'
    | 'leave_household'
    | 'transfer_household_ownership'
    | 'delete_my_account',
  args: Record<string, string> = {},
) {
  const { error } = await client().rpc(action, args);
  if (error) throw error;
}
