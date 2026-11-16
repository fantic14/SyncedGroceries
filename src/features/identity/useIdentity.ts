import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { backendConfigured, supabase } from '../../lib/supabase';
import * as service from './service';
import type { CreatedInvite, HouseholdSnapshot } from './types';
import { identityError, normalizeEmail, validateCode } from './validation';

const empty: HouseholdSnapshot = { household: null, members: [], invites: [] };

export function useIdentity() {
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<HouseholdSnapshot>(empty);
  const [loading, setLoading] = useState(backendConfigured);
  const [householdLoaded, setHouseholdLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteReceipt, setInviteReceipt] = useState<{
    userId: string;
    householdId: string;
    invite: CreatedInvite;
  } | null>(null);
  const mounted = useRef(false);
  const locked = useRef(false);
  const user = useRef<string | null>(null);
  const request = useRef(0);
  const lifetime = useRef(0);
  const identityVersion = useRef(0);

  const refresh = useCallback(async () => {
    const userId = user.current;
    if (!userId) return false;
    const attempt = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const result = await service.loadIdentity(userId);
      if (
        mounted.current &&
        request.current === attempt &&
        user.current === userId
      ) {
        setSnapshot(result);
        setInviteReceipt((receipt) =>
          receipt &&
          result.household?.id === receipt.householdId &&
          result.household.owner_id === userId &&
          result.invites.some(
            (invite) =>
              invite.id === receipt.invite.id &&
              !invite.revoked_at &&
              !invite.redeemed_at,
          )
            ? receipt
            : null,
        );
        setHouseholdLoaded(true);
        return true;
      }
    } catch (cause) {
      if (mounted.current && request.current === attempt) {
        setSnapshot(empty);
        setHouseholdLoaded(false);
        setError(identityError(cause));
      }
    } finally {
      if (mounted.current && request.current === attempt) setLoading(false);
    }
    return false;
  }, []);

  useEffect(() => {
    const epoch = ++lifetime.current;
    mounted.current = true;
    if (!supabase)
      return () => {
        mounted.current = false;
      };
    const client = supabase;
    let authEventReceived = false;
    function acceptSession(next: Session | null) {
      if (!mounted.current || lifetime.current !== epoch) return;
      const id = next?.user.id ?? null;
      if (user.current !== id) {
        user.current = id;
        identityVersion.current++;
        request.current++;
        setSnapshot(empty);
        setHouseholdLoaded(false);
        setError(null);
        setInviteReceipt(null);
        setLoading(false);
      }
      setSession(next);
      if (!id) setLoading(false);
    }
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, next) => {
      authEventReceived = true;
      // Never await another auth call inside this callback: the SDK holds a lock.
      acceptSession(next);
    });
    client.auth
      .getSession()
      .then(({ data, error: failure }) => {
        if (!mounted.current || lifetime.current !== epoch || authEventReceived)
          return;
        if (failure) {
          setError(identityError(failure));
          setLoading(false);
        } else acceptSession(data.session);
      })
      .catch(() => {
        if (mounted.current && lifetime.current === epoch) {
          setError('Couldn’t restore your sign-in. Try signing in again.');
          setLoading(false);
        }
      });
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (Platform.OS !== 'web') client.auth.startAutoRefresh();
        if (user.current) void refresh();
      } else if (Platform.OS !== 'web') client.auth.stopAutoRefresh();
    });
    if (Platform.OS !== 'web' && AppState.currentState === 'active')
      client.auth.startAutoRefresh();
    return () => {
      mounted.current = false;
      lifetime.current++;
      request.current++;
      subscription.unsubscribe();
      listener.remove();
      if (Platform.OS !== 'web') client.auth.stopAutoRefresh();
    };
  }, [refresh]);

  const userId = session?.user.id;
  useEffect(() => {
    if (userId) void refresh();
  }, [userId, refresh]);

  async function perform<T>(
    operation: () => Promise<T>,
    reload = false,
    allowSessionChange = false,
  ): Promise<{ value: T } | null> {
    if (locked.current) return null;
    locked.current = true;
    setBusy(true);
    setError(null);
    const startedAs = user.current;
    const startedIn = lifetime.current;
    const startedVersion = identityVersion.current;
    try {
      if (!supabase) throw new Error('Sharing is not connected yet.');
      const value = await operation();
      if (
        !mounted.current ||
        lifetime.current !== startedIn ||
        (!allowSessionChange &&
          (user.current !== startedAs ||
            identityVersion.current !== startedVersion))
      )
        return null;
      if (reload && mounted.current && user.current === startedAs)
        await refresh();
      if (
        !mounted.current ||
        lifetime.current !== startedIn ||
        (!allowSessionChange &&
          (user.current !== startedAs ||
            identityVersion.current !== startedVersion))
      )
        return null;
      return { value };
    } catch (cause) {
      if (
        mounted.current &&
        lifetime.current === startedIn &&
        user.current === startedAs &&
        identityVersion.current === startedVersion
      )
        setError(identityError(cause));
      return null;
    } finally {
      locked.current = false;
      if (mounted.current && lifetime.current === startedIn) setBusy(false);
    }
  }

  return {
    configured: backendConfigured,
    loading,
    householdLoaded,
    session,
    ...snapshot,
    error,
    busy,
    refresh,
    generatedInvite:
      inviteReceipt &&
      inviteReceipt.userId === userId &&
      inviteReceipt.householdId === snapshot.household?.id
        ? inviteReceipt.invite
        : null,
    dismissGeneratedInvite: () => setInviteReceipt(null),
    sendCode: async (email: string) =>
      Boolean(
        await perform(async () => {
          const { error } = await supabase!.auth.signInWithOtp({
            email: normalizeEmail(email),
            options: { shouldCreateUser: true },
          });
          if (error) throw error;
        }),
      ),
    verifyCode: async (email: string, code: string) =>
      Boolean(
        await perform(
          async () => {
            const { error } = await supabase!.auth.verifyOtp({
              email: normalizeEmail(email),
              token: validateCode(code),
              type: 'email',
            });
            if (error) throw error;
          },
          false,
          true,
        ),
      ),
    signOut: async () =>
      Boolean(
        await perform(
          async () => {
            const { error } = await supabase!.auth.signOut({ scope: 'local' });
            if (error) throw error;
          },
          false,
          true,
        ),
      ),
    createHousehold: async (name: string, displayName: string) =>
      Boolean(
        await perform(() => service.createHousehold(name, displayName), true),
      ),
    joinHousehold: async (token: string, displayName: string) =>
      Boolean(
        await perform(() => service.joinHousehold(token, displayName), true),
      ),
    createInvite: async () => {
      const household = snapshot.household;
      if (!household || household.owner_id !== user.current) return null;
      const result = await perform(service.createInvite);
      if (!result || !user.current) return null;
      // The RPC already acknowledged creation. An optional metadata refresh must
      // not discard the only copy of the secret, nor can an older read hide it.
      request.current++;
      setLoading(false);
      setSnapshot((current) =>
        current.household?.id === household.id
          ? {
              ...current,
              invites: [
                {
                  id: result.value.id,
                  expires_at: result.value.expires_at,
                  revoked_at: null,
                  redeemed_at: null,
                },
                ...current.invites.filter(
                  (invite) => invite.id !== result.value.id,
                ),
              ],
            }
          : current,
      );
      setInviteReceipt({
        userId: user.current,
        householdId: household.id,
        invite: result.value,
      });
      return result.value;
    },
    revokeInvite: async (id: string) =>
      Boolean(
        await perform(
          () =>
            service.membershipAction('revoke_household_invite', {
              invite_id: id,
            }),
          true,
        ),
      ),
    removeMember: async (id: string) =>
      Boolean(
        await perform(
          () =>
            service.membershipAction('remove_household_member', {
              member_id: id,
            }),
          true,
        ),
      ),
    leaveHousehold: async () =>
      Boolean(
        await perform(() => service.membershipAction('leave_household'), true),
      ),
    transferOwnership: async (id: string) =>
      Boolean(
        await perform(
          () =>
            service.membershipAction('transfer_household_ownership', {
              member_id: id,
            }),
          true,
        ),
      ),
    deleteAccount: async () =>
      Boolean(
        await perform(
          async () => {
            await service.membershipAction('delete_my_account');
            const { error } = await supabase!.auth.signOut({ scope: 'local' });
            if (error) throw error;
          },
          false,
          true,
        ),
      ),
  };
}
