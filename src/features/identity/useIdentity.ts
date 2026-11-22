import type { Session } from '@supabase/supabase-js';
import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import {
  backendConfigured,
  backendId,
  readCachedAuthSession,
  supabase,
} from '../../lib/supabase';
import { getOfflinePersistence } from '../offline/platformPersistence';
import type { OfflinePersistence } from '../offline/persistence';
import { quarantineHousehold } from '../offline/quarantine';
import {
  createIdentityCache,
  isRetryableIdentityFailure,
  needsIdentityReauthentication,
  validateIdentitySnapshot,
} from './identityCache';
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
  const [identityOffline, setIdentityOffline] = useState(false);
  const [authRecoveryRequired, setAuthRecoveryRequired] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [pendingCleanup, setPendingCleanup] = useState(false);
  const [recoveryHouseholdId, setRecoveryHouseholdId] = useState<string | null>(
    null,
  );
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
  const sessionRef = useRef<Session | null>(null);
  const knownMembership = useRef<{
    householdId: string;
    joinedAt: string;
  } | null>(null);
  const recoveryUser = useRef<string | null>(null);
  const explicitSignOut = useRef(false);
  const persistence = useRef<OfflinePersistence | null>(null);
  const cache = useRef<{
    userId: string;
    value: ReturnType<typeof createIdentityCache>;
    hydrated: boolean;
    blocked: boolean;
  } | null>(null);
  const cleanup = useRef<Promise<unknown>>(Promise.resolve());
  const failedCleanup = useRef(new Set<string>());
  const pendingRefresh = useRef<{
    userId: string | null;
    version: number;
    promise: Promise<boolean>;
  } | null>(null);

  const purgeUser = useCallback((userId: string) => {
    if (user.current === userId) {
      request.current++;
      if (mounted.current) setLoading(false);
    }
    if (cache.current?.userId === userId) {
      cache.current.value.close();
      cache.current = null;
    }
    failedCleanup.current.add(userId);
    const remove = persistence.current
      ? persistence.current.clearUser(backendId, userId)
      : getOfflinePersistence().then((opened) => {
          persistence.current = opened;
          return opened.clearUser(backendId, userId);
        });
    const completed = remove
      .then(() => {
        failedCleanup.current.delete(userId);
        if (mounted.current) setPendingCleanup(failedCleanup.current.size > 0);
      })
      .catch((cause: unknown) => {
        failedCleanup.current.add(userId);
        if (mounted.current) setPendingCleanup(true);
        throw cause;
      });
    cleanup.current = Promise.allSettled([cleanup.current, completed]);
    return completed;
  }, []);

  const ensureCache = useCallback(async (userId: string) => {
    await cleanup.current;
    if (!mounted.current || user.current !== userId || explicitSignOut.current)
      return null;
    if (failedCleanup.current.has(userId))
      throw new Error(
        'Saved data removal is incomplete. Retry cleanup before opening this account.',
      );
    if (cache.current?.userId === userId) return cache.current;
    const opened = persistence.current ?? (await getOfflinePersistence());
    if (
      !mounted.current ||
      user.current !== userId ||
      explicitSignOut.current ||
      failedCleanup.current.has(userId)
    )
      return null;
    if (cache.current?.userId === userId) return cache.current;
    persistence.current = opened;
    cache.current?.value.close();
    cache.current = {
      userId,
      value: createIdentityCache(opened, backendId, userId),
      hydrated: false,
      blocked: false,
    };
    return cache.current;
  }, []);

  const performRefresh = useCallback(
    async (repairCache = false) => {
      const userId = user.current;
      if (!userId || explicitSignOut.current) return false;
      const attempt = ++request.current;
      setLoading(true);
      setError(null);
      let cached: Awaited<ReturnType<typeof ensureCache>> = null;
      try {
        try {
          cached = await ensureCache(userId);
          if (cached && !cached.hydrated) {
            const saved = await cached.value.load();
            const recoveryHouse = await cached.value.loadRecoveryHouseholdId();
            if (
              saved &&
              mounted.current &&
              request.current === attempt &&
              user.current === userId
            ) {
              cached.hydrated = true;
              setSnapshot(saved);
              const member = saved.members.find(
                (entry) => entry.user_id === userId,
              );
              knownMembership.current =
                saved.household && member
                  ? {
                      householdId: saved.household.id,
                      joinedAt: member.joined_at,
                    }
                  : null;
              setHouseholdLoaded(true);
              setIdentityOffline(true);
              setRecoveryHouseholdId(recoveryHouse);
            }
          }
        } catch {
          if (cache.current?.userId === userId) cache.current.blocked = true;
          if (mounted.current && request.current === attempt)
            setCacheError(
              'The saved household could not be read. Refresh while connected to replace it safely.',
            );
        }
        if (
          !mounted.current ||
          request.current !== attempt ||
          user.current !== userId
        )
          return false;
        const result = validateIdentitySnapshot(
          await service.loadIdentity(userId),
          userId,
        );
        if (
          mounted.current &&
          request.current === attempt &&
          user.current === userId
        ) {
          const member = result.members.find(
            (entry) => entry.user_id === userId,
          );
          const nextMembership =
            result.household && member
              ? { householdId: result.household.id, joinedAt: member.joined_at }
              : null;
          const previous = knownMembership.current;
          let quarantined = true;
          if (
            previous &&
            (previous.householdId !== nextMembership?.householdId ||
              previous.joinedAt !== nextMembership?.joinedAt)
          ) {
            try {
              await quarantineHousehold(
                persistence.current ?? (await getOfflinePersistence()),
                {
                  backend: backendId,
                  userId,
                  householdId: previous.householdId,
                },
              );
            } catch {
              quarantined = false;
              setCacheError(
                'Your household changed, but its saved edits could not be isolated safely. Retry while connected before reopening offline work.',
              );
            }
          }
          if (
            !mounted.current ||
            request.current !== attempt ||
            user.current !== userId
          )
            return false;
          knownMembership.current = quarantined ? nextMembership : previous;
          setSnapshot(result);
          setIdentityOffline(false);
          setAuthRecoveryRequired(false);
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
          if (quarantined && cached && (!cached.blocked || repairCache)) {
            try {
              await cached.value.save(result);
              const recoveryHouse =
                await cached.value.loadRecoveryHouseholdId();
              cached.blocked = false;
              if (mounted.current && request.current === attempt) {
                setCacheError(null);
                setRecoveryHouseholdId(recoveryHouse);
              }
            } catch {
              if (mounted.current && request.current === attempt)
                setCacheError(
                  'Your household is open, but it could not be saved for offline use. Refresh to retry.',
                );
            }
          }
          return true;
        }
      } catch (cause) {
        if (mounted.current && request.current === attempt) {
          // A transient lookup failure must not unmount an active household and
          // discard its in-memory note draft. Confirmed permission loss is different.
          if ((cause as { code?: string } | null)?.code === '42501') {
            const previous = knownMembership.current;
            let quarantined = true;
            if (previous) {
              try {
                await quarantineHousehold(
                  persistence.current ?? (await getOfflinePersistence()),
                  {
                    backend: backendId,
                    userId,
                    householdId: previous.householdId,
                  },
                );
              } catch {
                quarantined = false;
                setCacheError(
                  'Saved edits could not be isolated after your household access changed. Retry local storage recovery.',
                );
              }
            }
            if (
              !mounted.current ||
              request.current !== attempt ||
              user.current !== userId
            )
              return false;
            knownMembership.current = quarantined ? null : previous;
            setSnapshot(empty);
            setHouseholdLoaded(false);
            setIdentityOffline(false);
            if (quarantined && cached && !cached.blocked) {
              try {
                await cached.value.save(empty);
                const recoveryHouse =
                  await cached.value.loadRecoveryHouseholdId();
                if (mounted.current && request.current === attempt)
                  setRecoveryHouseholdId(recoveryHouse);
              } catch {
                /* Keep the access error visible. */
              }
            }
          } else if (
            isRetryableIdentityFailure(cause) ||
            needsIdentityReauthentication(cause)
          ) {
            setIdentityOffline(true);
            if (
              needsIdentityReauthentication(cause) ||
              (sessionRef.current?.expires_at ?? Infinity) * 1000 <= Date.now()
            )
              setAuthRecoveryRequired(true);
          }
          setError(identityError(cause));
        }
      } finally {
        if (mounted.current && request.current === attempt) setLoading(false);
      }
      return false;
    },
    [ensureCache],
  );

  // Polling and reconnect signals share one read instead of repeatedly
  // invalidating a slow connection's in-flight membership response.
  const refreshIdentity = useCallback(
    (repairCache = false): Promise<boolean> => {
      const id = user.current;
      const version = identityVersion.current;
      const running = pendingRefresh.current;
      if (running && running.userId === id && running.version === version) {
        if (!repairCache) return running.promise;
        return running.promise.then(() =>
          user.current === id && identityVersion.current === version
            ? refreshIdentity(true)
            : false,
        );
      }
      const promise = performRefresh(repairCache);
      const task = { userId: id, version, promise };
      pendingRefresh.current = task;
      void promise
        .finally(() => {
          if (pendingRefresh.current === task) pendingRefresh.current = null;
        })
        .catch(() => undefined);
      return promise;
    },
    [performRefresh],
  );

  const refresh = useCallback(() => refreshIdentity(true), [refreshIdentity]);

  useEffect(() => {
    const epoch = ++lifetime.current;
    mounted.current = true;
    if (!supabase)
      return () => {
        mounted.current = false;
      };
    const client = supabase;
    let positiveAuthEvent = false;
    let terminalSignOut = false;
    function acceptSession(next: Session | null, localOnly = false) {
      if (!mounted.current || lifetime.current !== epoch) return;
      const id = next?.user.id ?? null;
      if (user.current !== id) {
        const previous = user.current ?? recoveryUser.current;
        if (previous && id && previous !== id)
          void purgeUser(previous).catch(() => undefined);
        cache.current?.value.close();
        cache.current = null;
        user.current = id;
        knownMembership.current = null;
        identityVersion.current++;
        request.current++;
        setSnapshot(empty);
        setHouseholdLoaded(false);
        setError(null);
        setCacheError(null);
        setRecoveryHouseholdId(null);
        setInviteReceipt(null);
        setLoading(false);
      }
      sessionRef.current = next;
      setSession(next);
      if (id) {
        recoveryUser.current = null;
        setAuthRecoveryRequired(
          localOnly || (next?.expires_at ?? Infinity) * 1000 <= Date.now(),
        );
        if (localOnly) setIdentityOffline(true);
      }
      if (!id) setLoading(false);
    }
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, next) => {
      // Keep this callback synchronous so it can run during an auth refresh.
      if (next) {
        positiveAuthEvent = true;
        terminalSignOut = false;
        acceptSession(next);
      } else if (event === 'SIGNED_OUT') {
        terminalSignOut = true;
        const previous = user.current;
        // Explicit sign-out purges before removing credentials. Automatic
        // credential expiry preserves isolated queued work for reauthentication.
        if (previous && !explicitSignOut.current)
          recoveryUser.current = previous;
        acceptSession(null);
        setAuthRecoveryRequired(
          !explicitSignOut.current && Boolean(recoveryUser.current),
        );
        setIdentityOffline(false);
      }
      // INITIAL_SESSION(null) can represent a retryable failed refresh. Let
      // getSession's actual error decide whether an encrypted local session
      // may be used to scope cached data, instead of treating it as sign-out.
    });

    async function restoreAfterFailure(failure: unknown) {
      if (
        !mounted.current ||
        lifetime.current !== epoch ||
        positiveAuthEvent ||
        terminalSignOut
      )
        return;
      if (isRetryableIdentityFailure(failure)) {
        try {
          const saved = await readCachedAuthSession();
          if (
            saved &&
            mounted.current &&
            lifetime.current === epoch &&
            !positiveAuthEvent &&
            !terminalSignOut
          ) {
            acceptSession(saved, true);
            setError(
              'You’re using saved household data. Sign in again or reconnect before sending queued changes.',
            );
            return;
          }
        } catch {
          /* A malformed/inaccessible secure session never becomes an identity. */
        }
      }
      if (
        mounted.current &&
        lifetime.current === epoch &&
        !positiveAuthEvent &&
        !terminalSignOut
      ) {
        setError(identityError(failure));
        setAuthRecoveryRequired(needsIdentityReauthentication(failure));
        setLoading(false);
      }
    }
    client.auth
      .getSession()
      .then(({ data, error: failure }) => {
        if (
          !mounted.current ||
          lifetime.current !== epoch ||
          positiveAuthEvent ||
          terminalSignOut
        )
          return;
        if (failure) void restoreAfterFailure(failure);
        else acceptSession(data.session);
      })
      .catch((failure: unknown) => {
        void restoreAfterFailure(failure);
      });
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (Platform.OS !== 'web') client.auth.startAutoRefresh();
        if (user.current) void refreshIdentity();
      } else if (Platform.OS !== 'web') client.auth.stopAutoRefresh();
    });
    const network = NetInfo.addEventListener((state) => {
      if (!mounted.current || lifetime.current !== epoch) return;
      if (state.isConnected === false || state.isInternetReachable === false)
        setIdentityOffline(true);
      else if (user.current && !explicitSignOut.current) void refreshIdentity();
    });
    const membershipTimer = setInterval(() => {
      if (
        AppState.currentState === 'active' &&
        user.current &&
        !explicitSignOut.current
      )
        void refreshIdentity();
    }, 15000);
    if (Platform.OS !== 'web' && AppState.currentState === 'active')
      client.auth.startAutoRefresh();
    return () => {
      mounted.current = false;
      lifetime.current++;
      request.current++;
      subscription.unsubscribe();
      listener.remove();
      network();
      clearInterval(membershipTimer);
      cache.current?.value.close();
      cache.current = null;
      if (Platform.OS !== 'web') client.auth.stopAutoRefresh();
    };
  }, [refreshIdentity, purgeUser]);

  const userId = session?.user.id;
  useEffect(() => {
    if (userId) void refreshIdentity();
  }, [userId, refreshIdentity]);

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
        await refreshIdentity(true);
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
      ) {
        setError(identityError(cause));
        if (needsIdentityReauthentication(cause)) setAuthRecoveryRequired(true);
      }
      return null;
    } finally {
      locked.current = false;
      if (mounted.current && lifetime.current === startedIn) setBusy(false);
    }
  }

  async function signOutLocally() {
    const previous = user.current ?? recoveryUser.current;
    explicitSignOut.current = true;
    try {
      if (previous) await purgeUser(previous);
      const { error: failure } = await supabase!.auth.signOut({
        scope: 'local',
      });
      // The installed SDK clears local credentials before attempting server
      // revocation. A failed revoke after SIGNED_OUT is still a local sign-out.
      if (failure && user.current !== null) throw failure;
      recoveryUser.current = null;
      if (mounted.current) {
        setAuthRecoveryRequired(false);
        setIdentityOffline(false);
      }
    } finally {
      explicitSignOut.current = false;
    }
  }

  return {
    configured: backendConfigured,
    loading,
    householdLoaded,
    session,
    ...snapshot,
    error: error ?? cacheError,
    busy,
    identityOffline,
    authRecoveryRequired,
    pendingCleanup,
    recoveryHouseholdId,
    retryCleanup: async () => {
      const results = await Promise.allSettled(
        [...failedCleanup.current].map(purgeUser),
      );
      return results.every((result) => result.status === 'fulfilled');
    },
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
            await signOutLocally();
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
            await signOutLocally();
          },
          false,
          true,
        ),
      ),
  };
}
