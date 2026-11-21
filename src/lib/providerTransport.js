/* URL normalizes IPv4 and IPv6 literals before the range checks. */
export function localHost(host) {
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".ts.net")) return true;
  if (host.startsWith("[")) return host === "[::1]" || /^\[(?:f[cd][\da-f]{2}|fe[89ab][\da-f]):/i.test(host);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  const [a, b] = host.split(".").map(Number);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}

export class ProviderAddressError extends Error {}

export function checkProviderUrl(address) {
  let url;
  try { url = new URL(address); } catch {}
  if (!url || url.username || url.password || !(url.protocol === "https:" || (url.protocol === "http:" && localHost(url.hostname)))) {
    throw new ProviderAddressError("Use HTTPS for remote providers. HTTP is available for localhost and private network addresses.");
  }
}

export async function providerFetch(url, options) {
  checkProviderUrl(url);
  return fetch(url, { ...options, redirect: "error" });
}
