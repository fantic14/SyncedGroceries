export function readBackendConfig(url?: string, key?: string) {
  if (!url?.trim() || !key?.trim()) return null;
  try {
    const endpoint = new URL(url.trim());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(
      endpoint.hostname,
    );
    if (
      endpoint.protocol !== 'https:' &&
      !(local && endpoint.protocol === 'http:')
    )
      return null;
    if (
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      return null;
    const publicKey = key.trim();
    if (!publicKey.startsWith('sb_publishable_')) {
      // Support the local Supabase stack's legacy anon JWT without accepting a
      // service-role JWT in an EXPO_PUBLIC variable shipped inside the app.
      const payload = publicKey.split('.')[1];
      if (
        !payload ||
        JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).role !==
          'anon'
      )
        return null;
    }
    return { url: endpoint.toString(), publicKey };
  } catch {
    return null;
  }
}
