import type { Paged, Param, ParamInput } from '../types'

const PARAMS: Param[] = [
  { paramId: 'p-date', name: '采集日期', kind: 'date', dateExpr: '$CUR_DATE,-1,yyyy-MM-dd', usedBy: 4, owner: 'dev_zhonghe', updatedAt: '2026-06-18' },
  { paramId: 'p-fundcode', name: '基金代码列表', kind: 'list', values: ['161725', '005827', '110022', '004432'], usedBy: 7, owner: 'dev_liang', updatedAt: '2026-06-15' },
  { paramId: 'p-keyword', name: '舆情关键词', kind: 'list', values: ['基金', '白酒', '医药', '新能源'], usedBy: 2, owner: 'data_wang', updatedAt: '2026-06-17' },
  { paramId: 'p-page', name: '分页序列', kind: 'sequence', seq: { start: 1, end: 50, step: 1 }, usedBy: 3, owner: 'ops_chen', updatedAt: '2026-06-10' },
  { paramId: 'p-month', name: '月份序列', kind: 'date', dateExpr: '$CUR_MONTH,-1,yyyy-MM', usedBy: 1, owner: 'data_wang', updatedAt: '2026-06-01' },
  // 0711 R9 演示数据：懂车帝二手车 URL 参数场景（$PARAM$_1035~1039），id 与截图口径对齐
  { paramId: '1035', name: '懂车帝-价格区间', kind: 'list', values: ['5万以下', '5-10万', '10-15万', '15-20万', '20万以上'], usedBy: 1, owner: 'dev_zhonghe', updatedAt: '2026-07-11' },
  { paramId: '1036', name: '懂车帝-级别参数(series_type)', kind: 'list', values: ['紧凑型', '中型', '中大型', 'SUV', 'MPV'], usedBy: 1, owner: 'dev_zhonghe', updatedAt: '2026-07-11' },
  { paramId: '1037', name: '懂车帝-能源参数(fuel_form)', kind: 'list', values: ['汽油', '柴油', '混动', '纯电'], usedBy: 1, owner: 'dev_zhonghe', updatedAt: '2026-07-11' },
  { paramId: '1038', name: '懂车帝-年限参数(age_range)', kind: 'list', values: ['1年以内', '1-3年', '3-5年', '5年以上'], usedBy: 1, owner: 'dev_zhonghe', updatedAt: '2026-07-11' },
  { paramId: '1039', name: '懂车帝-其他条件(expanded_origin)', kind: 'list', values: ['同城', '全国'], usedBy: 1, owner: 'dev_zhonghe', updatedAt: '2026-07-11' },
]

// 新建参数本地持久化（同 sources.ts/sites.ts 的 created 思路）：mock 无真实后端，刷新页面需可恢复。
const CREATED_KEY = 'sjcj.params.created'
const UPDATED_KEY = 'sjcj.params.updated'
function readCreatedParams(): Param[] {
  try {
    return JSON.parse(localStorage.getItem(CREATED_KEY) || '[]') as Param[]
  } catch {
    return []
  }
}
function persistCreatedParams(list: Param[]) {
  localStorage.setItem(CREATED_KEY, JSON.stringify(list))
}
function readUpdatedParams(): Record<string, Param> {
  try {
    return JSON.parse(localStorage.getItem(UPDATED_KEY) || '{}') as Record<string, Param>
  } catch {
    return {}
  }
}
function persistUpdatedParams(params: Record<string, Param>) {
  localStorage.setItem(UPDATED_KEY, JSON.stringify(params))
}
function allParams(): Param[] {
  const updated = readUpdatedParams()
  return [...readCreatedParams(), ...PARAMS].map((param) => updated[param.paramId] ?? param)
}

function matches(p: Param, q?: Record<string, unknown>): boolean {
  if (!q) return true
  const kw = String(q.keyword ?? '').trim().toLowerCase()
  if (kw && ![p.paramId, p.name].some((f) => f.toLowerCase().includes(kw))) return false
  const kind = String(q.kind ?? '')
  if (kind && kind !== 'all' && p.kind !== kind) return false
  return true
}

export function mockParamPaged(params?: Record<string, unknown>): Paged<Param> {
  const filtered = allParams().filter((p) => matches(p, params))
  const page = Number(params?.page ?? 1)
  const size = Number(params?.size ?? 20)
  const start = (page - 1) * size
  return { total: filtered.length, list: filtered.slice(start, start + size) }
}

// 0711 R9：找不到时返回 null，不做"静默回退第一条"——上游（URL 参数编辑器）要靠这个区分
// "参数确实不存在，请先创建" vs "查到了但是别的参数"，这两种情况 UI 表现完全不同，不能混为一谈。
export function mockParamDetail(params?: Record<string, unknown>): Param | null {
  return allParams().find((p) => p.paramId === String(params?.paramId)) ?? null
}

function nextParamId(): string {
  const numericIds = allParams().map((p) => Number(p.paramId)).filter(Number.isFinite)
  return `param-${Math.max(1000, ...numericIds) + 1}`
}

// 新建参数：参数列表与节点内“新建参数”共用。原系统由服务端分配 ID，mock 使用稳定前缀模拟。
export function mockParamCreate(params?: Record<string, unknown>): { ok: boolean; message?: string; param?: Param } {
  const input = params?.param as ParamInput | undefined
  if (!input?.name?.trim()) return { ok: false, message: '缺少参数名称' }
  const paramId = input.paramId || nextParamId()
  if (allParams().some((p) => p.paramId === paramId)) {
    return { ok: false, message: `参数 ID「${paramId}」已存在，请更换` }
  }
  const param: Param = { ...input, paramId, name: input.name.trim(), usedBy: 0, updatedAt: new Date().toISOString().slice(0, 10) }
  persistCreatedParams([param, ...readCreatedParams()])
  return { ok: true, message: '参数已创建（本地演示）', param }
}

export function mockParamUpdate(params?: Record<string, unknown>): { ok: boolean; message?: string; param?: Param } {
  const input = params?.param as Param | undefined
  if (!input?.paramId || !input.name?.trim()) return { ok: false, message: '缺少参数 ID / 名称' }
  const previous = allParams().find((param) => param.paramId === input.paramId)
  if (!previous) return { ok: false, message: `参数 ID「${input.paramId}」不存在` }

  const param: Param = { ...previous, ...input, paramId: previous.paramId, name: input.name.trim(), updatedAt: new Date().toISOString().slice(0, 10) }
  persistUpdatedParams({ ...readUpdatedParams(), [param.paramId]: param })
  return { ok: true, message: '参数已更新（本地演示）', param }
}

// 生成值预览（genValues）— 演示：列表回显、序列展开、动态日期推算最近 5 个
export function mockGenValues(params?: Record<string, unknown>): string[] {
  const p = allParams().find((x) => x.paramId === String(params?.paramId))
  if (!p) return []
  if (p.kind === 'list') return p.values ?? []
  if (p.kind === 'sequence' && p.seq) {
    const out: string[] = []
    for (let i = p.seq.start; i <= p.seq.end && out.length < 20; i += p.seq.step) out.push(String(i))
    return out
  }
  if (p.kind === 'date' || p.kind === 'date_sequence') {
    const out: string[] = []
    const base = new Date('2026-06-19')
    const monthly = (p.dateExpr ?? '').includes('MONTH')
    const count = p.kind === 'date_sequence' ? Math.min(20, p.seq?.end ?? 5) : 5
    const start = p.kind === 'date_sequence' ? p.seq?.start ?? 1 : 1
    const step = p.kind === 'date_sequence' ? p.seq?.step ?? 1 : 1
    for (let i = start; out.length < count; i += step) {
      const d = new Date(base)
      if (monthly) {
        d.setMonth(d.getMonth() - i)
        out.push(d.toISOString().slice(0, 7))
      } else {
        d.setDate(d.getDate() - i)
        out.push(d.toISOString().slice(0, 10))
      }
    }
    return out
  }
  if (p.kind === 'database') return p.values ?? []
  return []
}
