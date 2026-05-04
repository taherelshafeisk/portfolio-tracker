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

  // In a web browser, use window.location.hostname so the API URL always
  // matches the host the browser is actually on. This avoids breakage when
  // the Expo dev server is started in --lan mode (EXPO_PUBLIC_DOMAIN is a
  // LAN IP intended for native/phone testing, not browser access).
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const port = domain?.split(':')[1] ?? '3001';
    const hostname = window.location.hostname;
    return isLocalDomain(hostname) ? `http://${hostname}:${port}` : `https://${hostname}:${port}`;
  }

  if (domain) {
    return isLocalDomain(domain) ? `http://${domain}` : `https://${domain}`;
  }

  return '';
}
