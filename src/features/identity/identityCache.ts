import type { OfflinePersistence, ScopeCache } from '../offline/persistence.ts';
import type { HouseholdSnapshot } from './types.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string =>
  typeof value === 'string' && uuid.test(value);
const date = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value));
const nullableDate = (value: unknown): value is string | null =>
  value === null || date(value);
const shortText = (value: unknown, limit: number): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  Array.from(value).length <= limit;

export class IdentityCacheError extends Error {
  constructor() {
    super(
      'The saved household could not be read. Refresh while connected to replace it safely.',
    );
    this.name = 'IdentityCacheError';
  }
}

export function validateIdentitySnapshot(
  value: unknown,
  userId: string,
): HouseholdSnapshot {
  if (
    !record(value) ||
    !Array.isArray(value.members) ||
    !Array.isArray(value.invites)
  )
    throw new IdentityCacheError();
  if (value.household === null) {
    if (value.members.length || value.invites.length)
      throw new IdentityCacheError();
    return { household: null, members: [], invites: [] };
  }
  const house = value.household;
  if (
    !record(house) ||
    !id(house.id) ||
    !shortText(house.name, 80) ||
    !id(house.owner_id) ||
    !date(house.created_at)
  )
    throw new IdentityCacheError();
  const members = value.members.map((member) => {
    if (
      !record(member) ||
      !id(member.user_id) ||
      !shortText(member.display_name, 60) ||
      !['owner', 'member'].includes(String(member.role)) ||
      !date(member.joined_at)
    )
      throw new IdentityCacheError();
    return {
      user_id: member.user_id,
      display_name: member.display_name,
      role: member.role as string,
      joined_at: member.joined_at,
    };
  });
  if (
    !members.some((member) => member.user_id === userId) ||
    new Set(members.map((member) => member.user_id)).size !== members.length ||
    members.filter((member) => member.role === 'owner').length !== 1 ||
    !members.some(
      (member) => member.user_id === house.owner_id && member.role === 'owner',
    )
  )
    throw new IdentityCacheError();
  const invites = value.invites.map((invite) => {
    if (
      !record(invite) ||
      !id(invite.id) ||
      !date(invite.expires_at) ||
      !nullableDate(invite.revoked_at) ||
      !nullableDate(invite.redeemed_at)
    )
      throw new IdentityCacheError();
    return {
      id: invite.id,
      expires_at: invite.expires_at,
      revoked_at: invite.revoked_at,
      redeemed_at: invite.redeemed_at,
    };
  });
  if (
    new Set(invites.map((invite) => invite.id)).size !== invites.length ||
    (house.owner_id !== userId && invites.length > 0)
  )
    throw new IdentityCacheError();
  return {
    household: {
      id: house.id,
      name: house.name,
      owner_id: house.owner_id,
      created_at: house.created_at,
    },
    members,
    invites,
  };
}

export function createIdentityCache(
  persistence: OfflinePersistence,
  backend: string,
  userId: string,
) {
  const cache: ScopeCache<unknown> = persistence.open({
    backend,
    userId,
    householdId: '__identity__',
  });
  async function read() {
    const value = await cache.load();
    if (value === null) return null;
    if (
      !record(value) ||
      value.version !== 1 ||
      value.backend !== backend ||
      value.userId !== userId ||
      (value.lastHouseholdId != null && !id(value.lastHouseholdId)) ||
      (value.recoveryHouseholdId != null && !id(value.recoveryHouseholdId))
    )
      throw new IdentityCacheError();
    return {
      snapshot: validateIdentitySnapshot(value.snapshot, userId),
      lastHouseholdId:
        (value.lastHouseholdId as string | null | undefined) ?? null,
      recoveryHouseholdId:
        (value.recoveryHouseholdId as string | null | undefined) ?? null,
    };
  }
  return {
    load: async (): Promise<HouseholdSnapshot | null> => {
      return (await read())?.snapshot ?? null;
    },
    loadRecoveryHouseholdId: async () => {
      const value = await read();
      return (
        value?.recoveryHouseholdId ??
        (value?.snapshot.household === null ? value.lastHouseholdId : null)
      );
    },
    save: async (snapshot: HouseholdSnapshot) => {
      const checked = validateIdentitySnapshot(snapshot, userId);
      // The hook permits replacing a corrupt document only after an explicit
      // connected refresh. Untrusted old metadata must not survive that repair.
      const previous = await read().catch((cause: unknown) => {
        if (
          cause instanceof IdentityCacheError ||
          (cause as { code?: string } | null)?.code === 'CACHE_CORRUPT'
        )
          return null;
        throw cause;
      });
      const currentHouse = checked.household?.id ?? null;
      const lastHouseholdId =
        currentHouse ??
        previous?.lastHouseholdId ??
        previous?.snapshot.household?.id ??
        null;
      const priorHouse =
        previous?.lastHouseholdId ?? previous?.snapshot.household?.id ?? null;
      const recoveryHouseholdId =
        currentHouse === null
          ? priorHouse
          : priorHouse && priorHouse !== currentHouse
            ? priorHouse
            : previous?.recoveryHouseholdId === currentHouse
              ? null
              : (previous?.recoveryHouseholdId ?? null);
      await cache.save({
        version: 1,
        backend,
        userId,
        snapshot: checked,
        lastHouseholdId,
        recoveryHouseholdId,
      });
    },
    clear: () => cache.clear(),
    close: () => cache.close(),
  };
}

export function isRetryableIdentityFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!record(error)) return false;
  if (error.name === 'AuthRetryableFetchError' || error.name === 'AbortError')
    return true;
  if (
    typeof error.status === 'number' &&
    (error.status === 0 || error.status >= 500)
  )
    return true;
  // postgrest-js returns a transport error object rather than throwing fetch's
  // TypeError. SQL/PostgREST codes and malformed cached data never match this.
  return (
    error.code === '' &&
    typeof error.message === 'string' &&
    /fetch|network|abort/i.test(error.message)
  );
}

export function needsIdentityReauthentication(error: unknown): boolean {
  return (
    record(error) &&
    (error.status === 401 ||
      [
        'PGRST301',
        'PGRST303',
        'bad_jwt',
        'session_expired',
        'refresh_token_not_found',
        'refresh_token_already_used',
      ].includes(String(error.code)))
  );
}
