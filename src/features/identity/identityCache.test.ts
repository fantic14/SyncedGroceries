import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDocumentPersistence,
  cacheScopeKey,
} from '../offline/persistence.ts';
import {
  createIdentityCache,
  isRetryableIdentityFailure,
  needsIdentityReauthentication,
  validateIdentitySnapshot,
} from './identityCache.ts';
import type { HouseholdSnapshot } from './types.ts';

const alice = '00000000-0000-4000-8000-000000000001';
const bob = '00000000-0000-4000-8000-000000000002';
const houseA = '00000000-0000-4000-8000-000000000010';
const houseB = '00000000-0000-4000-8000-000000000020';
const timestamp = '2026-11-16T10:00:00.000Z';
const backend = 'https://example.supabase.co/';
const empty: HouseholdSnapshot = { household: null, members: [], invites: [] };

function snapshot(house = houseA): HouseholdSnapshot {
  return {
    household: {
      id: house,
      name: 'Our place',
      owner_id: alice,
      created_at: timestamp,
    },
    members: [
      {
        user_id: alice,
        display_name: 'Alice',
        role: 'owner',
        joined_at: timestamp,
      },
      {
        user_id: bob,
        display_name: 'Bob',
        role: 'member',
        joined_at: timestamp,
      },
    ],
    invites: [
      {
        id: '00000000-0000-4000-8000-000000000030',
        expires_at: timestamp,
        revoked_at: null,
        redeemed_at: null,
      },
    ],
  };
}

function fixture() {
  const documents = new Map<string, string>();
  const owner = new Map<string, { backend: string; userId: string }>();
  const persistence = createDocumentPersistence({
    read: async (key) => documents.get(key) ?? null,
    write: async (scope, key, payload) => {
      documents.set(key, payload);
      owner.set(key, scope);
    },
    remove: async (key) => {
      documents.delete(key);
      owner.delete(key);
    },
    removeUser: async (project, userId) => {
      for (const [key, scope] of owner)
        if (scope.backend === project && scope.userId === userId) {
          documents.delete(key);
          owner.delete(key);
        }
    },
  });
  return {
    persistence,
    documents,
    cache: createIdentityCache(persistence, backend, alice),
  };
}

test('cached membership restores display data without storing tokens or extra server fields', async () => {
  const { cache, documents } = fixture();
  const data = snapshot();
  Object.assign(data.invites[0]!, { token: 'private-invitation-token' });
  Object.assign(data, { access_token: 'never-cache-a-session-here' });
  await cache.save(data);
  const restored = await cache.load();
  assert.equal(restored?.household?.id, houseA);
  assert.deepEqual(
    restored?.members.map((member) => member.display_name),
    ['Alice', 'Bob'],
  );
  const payload = [...documents.values()][0]!;
  assert.ok(!payload.includes('private-invitation-token'));
  assert.ok(!payload.includes('never-cache-a-session-here'));
});

test('identity data is isolated by backend and user, and forged document scope fails closed', async () => {
  const { cache, persistence, documents } = fixture();
  await cache.save(snapshot());
  assert.equal(
    await createIdentityCache(
      persistence,
      'https://other.supabase.co/',
      alice,
    ).load(),
    null,
  );
  assert.equal(
    await createIdentityCache(persistence, backend, bob).load(),
    null,
  );
  const key = cacheScopeKey({
    backend,
    userId: alice,
    householdId: '__identity__',
  });
  const wrong = JSON.parse(documents.get(key)!);
  wrong.userId = bob;
  documents.set(key, JSON.stringify(wrong));
  await assert.rejects(cache.load(), /saved household/);
});

test('confirmed removal survives restart without restoring stale authority while retaining recovery scope', async () => {
  const { cache, persistence } = fixture();
  await cache.save(snapshot());
  await cache.save(empty);
  cache.close();
  const reopened = createIdentityCache(persistence, backend, alice);
  assert.deepEqual(await reopened.load(), empty);
  assert.equal(await reopened.loadRecoveryHouseholdId(), houseA);
});

test('joining another household retains only the former scope as a recovery hint', async () => {
  const { cache } = fixture();
  await cache.save(snapshot());
  await cache.save(empty);
  await cache.save(snapshot(houseB));
  assert.equal((await cache.load())?.household?.id, houseB);
  assert.equal(await cache.loadRecoveryHouseholdId(), houseA);
  await cache.save(snapshot(houseA));
  assert.equal(await cache.loadRecoveryHouseholdId(), houseB);
});

test('corruption is reported without replacement until a fresh checked snapshot is explicitly saved', async () => {
  const { cache, documents } = fixture();
  const key = cacheScopeKey({
    backend,
    userId: alice,
    householdId: '__identity__',
  });
  documents.set(key, '{broken');
  await assert.rejects(cache.load());
  assert.equal(documents.get(key), '{broken');
  await cache.save(snapshot());
  assert.equal((await cache.load())?.household?.id, houseA);
});

test('invalid membership and owner claims are rejected instead of authorizing cached screens', () => {
  const wrong = snapshot();
  wrong.members = wrong.members.filter((member) => member.user_id !== alice);
  assert.throws(() => validateIdentitySnapshot(wrong, alice));
  const duplicate = snapshot();
  duplicate.members.push(duplicate.members[0]!);
  assert.throws(() => validateIdentitySnapshot(duplicate, alice));
  const mismatch = snapshot();
  mismatch.household!.owner_id = bob;
  assert.throws(() => validateIdentitySnapshot(mismatch, alice));
  const forgedEmpty = { ...empty, members: snapshot().members };
  assert.throws(() => validateIdentitySnapshot(forgedEmpty, alice));
});

test('purging an account closes identity leases and removes its cached membership', async () => {
  const { cache, persistence } = fixture();
  await cache.save(snapshot());
  await persistence.clearUser(backend, alice);
  await assert.rejects(cache.load(), /session has ended/);
  assert.equal(
    await createIdentityCache(persistence, backend, alice).load(),
    null,
  );
});

test('offline recovery distinguishes transport failure from rejected credentials and membership', () => {
  assert.equal(
    isRetryableIdentityFailure(new TypeError('Failed to fetch')),
    true,
  );
  assert.equal(
    isRetryableIdentityFailure({ name: 'AuthRetryableFetchError', status: 0 }),
    true,
  );
  assert.equal(
    isRetryableIdentityFailure({
      code: '',
      message: 'TypeError: Network request failed',
    }),
    true,
  );
  assert.equal(
    isRetryableIdentityFailure({ code: '42501', message: 'permission denied' }),
    false,
  );
  assert.equal(
    isRetryableIdentityFailure({
      code: 'refresh_token_not_found',
      status: 400,
    }),
    false,
  );
  assert.equal(
    needsIdentityReauthentication({
      code: 'refresh_token_not_found',
      status: 400,
    }),
    true,
  );
  assert.equal(needsIdentityReauthentication({ code: 'PGRST301' }), true);
  assert.equal(needsIdentityReauthentication({ code: '42501' }), false);
});
