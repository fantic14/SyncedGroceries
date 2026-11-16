import { validateDocument } from './engine.ts';
import type { CacheScope, OfflinePersistence } from './persistence.ts';

export async function quarantineHousehold(
  persistence: OfflinePersistence,
  scope: CacheScope,
) {
  // Fence active AND not-yet-opened leases before awaiting any I/O.
  persistence.invalidateScope(scope);
  const cache = persistence.open<unknown>(scope);
  try {
    const saved = await cache.load();
    if (saved === null) return;
    const document = validateDocument(saved, scope.householdId, scope.userId);
    document.server = null;
    document.access = 'revoked';
    document.nextRetryAt = 0;
    for (const operation of document.queue) {
      operation.status = 'failed';
      operation.message =
        'Household membership changed. This saved edit needs review and will not be sent automatically.';
    }
    await cache.save(document);
  } finally {
    cache.close();
  }
}
