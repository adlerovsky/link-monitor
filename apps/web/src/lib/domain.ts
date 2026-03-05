import "server-only";

function stripWww(hostname: string) {
  return hostname.replace(/^www\./i, "");
}

function cleanHostname(hostname: string) {
  return stripWww(hostname.trim().toLowerCase().replace(/\.$/, ""));
}

function looksLikeHostname(hostname: string) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hostname);
}

export function normalizeProjectBaseDomain(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }

  const hostname = cleanHostname(parsed.hostname);
  if (!looksLikeHostname(hostname)) return null;

  return hostname;
}

export function normalizeUrlHostname(inputUrl: string) {
  const raw = String(inputUrl ?? "").trim();
  if (!raw) return null;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const parsed = new URL(withProtocol);
    const hostname = cleanHostname(parsed.hostname);
    if (!looksLikeHostname(hostname)) return null;
    return hostname;
  } catch {
    return null;
  }
}

export function hostMatchesBaseDomain(hostname: string, baseDomain: string) {
  const host = cleanHostname(hostname);
  const base = cleanHostname(baseDomain);
  return host === base || host.endsWith(`.${base}`);
}
