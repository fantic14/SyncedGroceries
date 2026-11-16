import {
  CacheClosedError,
  userCacheGeneration,
  scopeCacheGeneration,
  type CacheScope,
  type OfflinePersistence,
  type ScopeCache,
} from './persistence.ts';

// A store may retry initialization. Its factory must keep the generation from
// store creation, rather than acquiring a new identity after logout/removal.
export function createLazyCacheFactory<T>(
  provider: () => Promise<OfflinePersistence>,
  input: CacheScope,
): () => ScopeCache<T> {
  const scope = Object.freeze({ ...input });
  const userGeneration = userCacheGeneration(scope.backend, scope.userId);
  const scopeGeneration = scopeCacheGeneration(scope);
  return () => {
    if (
      userGeneration !== userCacheGeneration(scope.backend, scope.userId) ||
      scopeGeneration !== scopeCacheGeneration(scope)
    )
      throw new CacheClosedError();
    return openLazyCache<T>(provider, scope);
  };
}

export function openLazyCache<T>(
  provider: () => Promise<OfflinePersistence>,
  scope: CacheScope,
): ScopeCache<T> {
  scope = Object.freeze({ ...scope });
  let closed = false;
  let opened: ScopeCache<T> | null = null;
  const generation = userCacheGeneration(scope.backend, scope.userId);
  const scopeGeneration = scopeCacheGeneration(scope);
  const check = () => {
    if (
      closed ||
      userCacheGeneration(scope.backend, scope.userId) !== generation ||
      scopeCacheGeneration(scope) !== scopeGeneration
    )
      throw new CacheClosedError();
  };
  const ready = provider().then((persistence) => {
    check();
    opened = persistence.open<T>(scope);
    return opened;
  });
  void ready.catch(() => undefined);
  return {
    load: async () => {
      check();
      const lease = await ready;
      check();
      return lease.load();
    },
    save: async (value) => {
      check();
      const captured = JSON.parse(JSON.stringify(value)) as T;
      const lease = await ready;
      check();
      await lease.save(captured);
    },
    clear: async () => {
      check();
      const lease = await ready;
      check();
      await lease.clear();
    },
    close: () => {
      closed = true;
      opened?.close();
    },
  };
}
