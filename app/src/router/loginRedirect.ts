/** Recover the business route from old, recursively nested login redirects. */
export function loginRedirect(value: unknown): string {
  const seen = new Set<string>()
  for (let depth = 0; depth < 10; depth++) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\r\n\0]/.test(value)) return '/overview'
    const path = value.split(/[?#]/, 1)[0]!
    if (path.includes('\\')) return '/overview'
    if (path !== '/user/login' && path !== '/user/login/') return value
    if (seen.has(value)) return '/overview'
    seen.add(value)
    value = new URLSearchParams(value.includes('?') ? value.slice(value.indexOf('?') + 1) : '').get('redirect')
  }
  return '/overview'
}
