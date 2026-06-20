import type { Paged, Param } from '../types'

const PARAMS: Param[] = [
  { paramId: 'p-date', name: '采集日期', kind: 'date', dateExpr: '$CUR_DATE,-1,yyyy-MM-dd', usedBy: 4, owner: 'dev_zhonghe', updatedAt: '2026-06-18' },
  { paramId: 'p-fundcode', name: '基金代码列表', kind: 'list', values: ['161725', '005827', '110022', '004432'], usedBy: 7, owner: 'dev_liang', updatedAt: '2026-06-15' },
  { paramId: 'p-keyword', name: '舆情关键词', kind: 'list', values: ['基金', '白酒', '医药', '新能源'], usedBy: 2, owner: 'data_wang', updatedAt: '2026-06-17' },
  { paramId: 'p-page', name: '分页序列', kind: 'sequence', seq: { start: 1, end: 50, step: 1 }, usedBy: 3, owner: 'ops_chen', updatedAt: '2026-06-10' },
  { paramId: 'p-month', name: '月份序列', kind: 'date', dateExpr: '$CUR_MONTH,-1,yyyy-MM', usedBy: 1, owner: 'data_wang', updatedAt: '2026-06-01' },
]

function matches(p: Param, q?: Record<string, unknown>): boolean {
  if (!q) return true
  const kw = String(q.keyword ?? '').trim().toLowerCase()
  if (kw && ![p.paramId, p.name].some((f) => f.toLowerCase().includes(kw))) return false
  const kind = String(q.kind ?? '')
  if (kind && kind !== 'all' && p.kind !== kind) return false
  return true
}

export function mockParamPaged(params?: Record<string, unknown>): Paged<Param> {
  const filtered = PARAMS.filter((p) => matches(p, params))
  const page = Number(params?.page ?? 1)
  const size = Number(params?.size ?? 20)
  const start = (page - 1) * size
  return { total: filtered.length, list: filtered.slice(start, start + size) }
}

export function mockParamDetail(params?: Record<string, unknown>): Param {
  return PARAMS.find((p) => p.paramId === String(params?.paramId)) ?? PARAMS[0]
}

// 生成值预览（genValues）— 演示：列表回显、序列展开、动态日期推算最近 5 个
export function mockGenValues(params?: Record<string, unknown>): string[] {
  const p = PARAMS.find((x) => x.paramId === String(params?.paramId))
  if (!p) return []
  if (p.kind === 'list') return p.values ?? []
  if (p.kind === 'sequence' && p.seq) {
    const out: string[] = []
    for (let i = p.seq.start; i <= p.seq.end && out.length < 20; i += p.seq.step) out.push(String(i))
    return out
  }
  if (p.kind === 'date') {
    const out: string[] = []
    const base = new Date('2026-06-19')
    const monthly = (p.dateExpr ?? '').includes('MONTH')
    for (let i = 1; i <= 5; i++) {
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
  return []
}
