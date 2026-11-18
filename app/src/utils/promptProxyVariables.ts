import type { NodeProxySettings } from '@/api/runnerManagement'

const proxyPlaceholder = /\{\{\s*(use_proxy|proxy_url|proxy_ip|proxy_port|proxy_account|proxy_password)\s*\}\}|\$\{(use_proxy|proxy_url|proxy_ip|proxy_port|proxy_account|proxy_password)\}/g
export function hasProxyPromptVariables(text: string) {
  return new RegExp(proxyPlaceholder.source).test(text)
}
export function renderProxyPrompt(text: string, settings: NodeProxySettings) {
  const enabled = settings.useProxy, detail = enabled ? settings.proxyDetail || {} : {}
  const host = detail.ip || '', port = detail.port == null ? '' : String(detail.port)
  const account = detail.account || '', password = detail.password || ''
  const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase())
  const address = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  const auth = account || password ? `${encode(account)}:${encode(password)}@` : ''
  const values: Record<string, string> = { use_proxy: enabled ? 'true' : 'false', proxy_ip: host, proxy_port: port,
    proxy_account: account, proxy_password: password, proxy_url: enabled && host && port ? `http://${auth}${address}:${port}` : '' }
  return text.replace(proxyPlaceholder, (_match, primary: string | undefined, alternate: string | undefined) => values[primary || alternate || ''] ?? _match)
}
