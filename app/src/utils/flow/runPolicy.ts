export const RUNTIME_POLICY_FIELDS = [
  { key: 'retryCnt', label: '出错重试次数' },
  { key: 'timeout', label: '超时时间（秒）' },
  { key: 'maxError', label: '单机允许错误量' },
  { key: 'errorKeep', label: '单机错误计算时长' },
  { key: 'perDomain', label: '相同域并行数' },
  { key: 'perConfig', label: '相同配置并行数' },
  { key: 'cntRun', label: '单机最大任务数' },
  { key: 'interval', label: '单机任务间隔（秒）' },
  { key: 'toHost', label: '是否派发到主机' },
] as const

export type RuntimePolicyKey = typeof RUNTIME_POLICY_FIELDS[number]['key']
export type RuntimePolicyValue = string | number | boolean

export interface ParsedRuntimePolicy {
  state: 'empty' | 'parsed' | 'invalid'
  values: Partial<Record<RuntimePolicyKey, RuntimePolicyValue>>
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * 旧平台的 runPolicy 允许 `{snatch:{retryCnt:3}}` 这类非严格 JSON。这里仅补引号后重试，
 * 不使用 eval，也只向 UI 暴露白名单中的九个标量字段。
 */
function parseJsonLikeObject(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim().replace(/^\((.*)\)$/s, '$1')
  if (!trimmed) return undefined
  for (const candidate of [
    trimmed,
    trimmed
      .replace(/'/g, '"')
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":'),
  ]) {
    try {
      const parsed = JSON.parse(candidate)
      const record = asRecord(parsed)
      if (record) return record
    } catch {
      // 继续尝试受限的兼容格式；任何失败都只进入只读的“无法识别”状态。
    }
  }
  return undefined
}

export function parseRunPolicy(raw: unknown): ParsedRuntimePolicy {
  if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) {
    return { state: 'empty', values: {} }
  }

  const root = typeof raw === 'string' ? parseJsonLikeObject(raw) : asRecord(raw)
  if (!root) return { state: 'invalid', values: {} }

  const nested = typeof root.snatch === 'string' ? parseJsonLikeObject(root.snatch) : asRecord(root.snatch)
  const policy = nested ?? root
  const values: Partial<Record<RuntimePolicyKey, RuntimePolicyValue>> = {}
  RUNTIME_POLICY_FIELDS.forEach(({ key }) => {
    const value = policy[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') values[key] = value
  })
  return { state: 'parsed', values }
}

export function formatRunPolicyValue(key: RuntimePolicyKey, value: RuntimePolicyValue | undefined): string {
  if (value === undefined || value === '') return '—'
  if (key === 'toHost') {
    if (value === true || value === 1 || value === '1' || value === 'true') return '是'
    if (value === false || value === 0 || value === '0' || value === 'false') return '否'
  }
  return String(value)
}
