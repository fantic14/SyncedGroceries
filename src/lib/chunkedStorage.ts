type Driver = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

type Manifest = { version: 1; generation: string; count: number };

// SecureStore can reject values above ~2 KB on some iOS versions. Keep each
// chunk below 1600 UTF-8 bytes, and commit a new generation only after all writes.
export function createChunkedStorage(
  driver: Driver,
  generationId: () => string,
) {
  let queue: Promise<unknown> = Promise.resolve();

  function ordered<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.catch(() => undefined).then(operation);
    queue = result;
    return result;
  }

  async function manifest(key: string): Promise<Manifest | null> {
    const raw = await driver.getItem(`${key}.manifest`);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      parsed.version !== 1 ||
      !('generation' in parsed) ||
      typeof parsed.generation !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(parsed.generation) ||
      !('count' in parsed) ||
      typeof parsed.count !== 'number' ||
      !Number.isInteger(parsed.count) ||
      parsed.count < 1 ||
      parsed.count > 256
    )
      throw new Error('The stored sign-in session could not be read.');
    return parsed as Manifest;
  }

  const chunkKey = (key: string, data: Manifest, index: number) =>
    `${key}.${data.generation}.${index}`;

  async function discard(key: string, data: Manifest) {
    // Cleanup failure must not turn an already-committed login/logout into an error.
    await Promise.allSettled(
      Array.from({ length: data.count }, (_, i) =>
        driver.removeItem(chunkKey(key, data, i)),
      ),
    );
  }

  return {
    getItem: (key: string): Promise<string | null> =>
      ordered(async () => {
        const data = await manifest(key);
        if (data === null) return null;
        const chunks = await Promise.all(
          Array.from({ length: data.count }, (_, i) =>
            driver.getItem(chunkKey(key, data, i)),
          ),
        );
        if (chunks.some((chunk) => chunk === null)) {
          throw new Error('The stored sign-in session is incomplete.');
        }
        return chunks.join('');
      }),
    setItem: (key: string, value: string): Promise<void> =>
      ordered(async () => {
        const previous = await manifest(key);
        const points = Array.from(value);
        const count = Math.max(1, Math.ceil(points.length / 400));
        const generation = generationId();
        if (count > 256 || !/^[a-zA-Z0-9_-]{1,80}$/.test(generation)) {
          throw new Error('The sign-in session is too large to store safely.');
        }
        const next: Manifest = { version: 1, generation, count };
        try {
          for (let i = 0; i < count; i++) {
            await driver.setItem(
              chunkKey(key, next, i),
              points.slice(i * 400, (i + 1) * 400).join(''),
            );
          }
          await driver.setItem(`${key}.manifest`, JSON.stringify(next));
        } catch (error) {
          await discard(key, next);
          throw error;
        }
        if (previous) await discard(key, previous);
      }),
    removeItem: (key: string): Promise<void> =>
      ordered(async () => {
        // Even corrupt metadata must not prevent signing out.
        const previous = await manifest(key).catch(() => null);
        await driver.removeItem(`${key}.manifest`);
        if (previous) await discard(key, previous);
      }),
  };
}
