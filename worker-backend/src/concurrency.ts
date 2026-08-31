export async function mapWithConcurrency<T, U>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/** ms만큼 쉰다. 스크래퍼가 원본 서버에 간격을 두거나 재시도를 미룰 때 쓴다. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
