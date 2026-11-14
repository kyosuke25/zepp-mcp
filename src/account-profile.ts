/** Minimal identity hints from the existing login response; no extra API calls.
 * Legacy Huami auth documents thirdparty_info.nickname as form-URL-encoded.
 * Current Zepp responses may omit profiles; absence is not an account mismatch.
 */
export interface AccountProfile {
  display_name: string | null;
  display_name_source: string | null;
  status: 'available' | 'not_returned' | 'withheld';
  authentication_method: 'email_password';
}
export function emptyAccountProfile(): AccountProfile {
  return { display_name: null, display_name_source: null, status: 'not_returned', authentication_method: 'email_password' };
}
export function accountProfile(result: Record<string, unknown>, sanitize: (name: string) => string): AccountProfile {
  const profile = emptyAccountProfile();
  // Exact paths only. Never copy token_info, email, third_id, avatar URLs or objects.
  const containers = ['user_info', 'profile', 'regist_info', 'thirdparty_info'] as const;
  const fields = ['display_name', 'displayName', 'nickname', 'nick_name', 'nickName'] as const;
  let withheld = false;
  for (const container of containers) {
    const raw = result[container];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    for (const field of fields) {
      const value = (raw as Record<string, unknown>)[field];
      if (typeof value !== 'string' || !value.trim()) continue;
      let name = value;
      if (container === 'thirdparty_info' && field === 'nickname') {
        try { name = decodeURIComponent(name.replaceAll('+', ' ')); }
        catch { withheld = true; continue; }
      }
      name = name.trim();
      // Do not turn name slots into a route for credential/URL/contact disclosure.
      if (!name || name.length > 160 || /[\p{C}@]|:\/\//u.test(name) || sanitize(name) !== name) {
        withheld = true; continue;
      }
      return { ...profile, display_name: name, display_name_source: `${container}.${field}`, status: 'available' };
    }
  }
  return { ...profile, status: withheld ? 'withheld' : 'not_returned' };
}
