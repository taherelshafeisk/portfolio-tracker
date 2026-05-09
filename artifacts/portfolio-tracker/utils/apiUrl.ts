/**
 * Resolves the API base URL from EXPO_PUBLIC_DOMAIN.
 * Uses http for local/LAN addresses, https for everything else.
 */
function isLocalDomain(domain: string): boolean {
  return (
    domain.startsWith('localhost') ||
    domain.startsWith('192.168.') ||
    domain.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(domain)
  );
}

export function resolveApiBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;

  // In a web browser, use same-origin so API calls go through the
  // proxy server — no CORS issues on Cloudflare tunnel.
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return window.location.origin;
  }

  // For native apps: use the domain from env var
  if (!domain) return '';
  if (!isLocalDomain(domain)) return `https://${domain}`;
  return `http://${domain}`;
}
