type FetchFn = typeof fetch;

/** GET a JSON endpoint and turn HTTP failures into a message that names the source. */
export async function getJson(
  fetchFn: FetchFn,
  url: string,
  label: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetchFn(url, { signal });
  if (res.status === 403 || res.status === 429) throw new Error(`${label} rate limit reached. Try again in a minute.`);
  if (!res.ok) throw new Error(`${label} search failed (HTTP ${res.status}).`);
  return res.json();
}

export function sinceDate(days: number, now = Date.now()): Date {
  return new Date(now - days * 86400 * 1000);
}
