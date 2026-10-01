/**
 * SWR fetcher that rejects on a non-2xx response.
 *
 * SWR keeps the last good `data` when the fetcher throws, so a blip of the AI
 * backend (restart, overload, 503 from the proxy) leaves the camera wall on
 * its last known streams instead of replacing them with an error body.
 */
export async function apiFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}
