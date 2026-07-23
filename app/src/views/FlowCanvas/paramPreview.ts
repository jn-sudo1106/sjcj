// 参数取值数 / 预览文案（0721 会议·参数源）：paramApi.genValues 是"预览"接口，sequence/date_sequence
// 会截到 20 条演示（见 mock/params.ts 注释），但参数源面板的"共 N 个 URL"要展示真实取值数，不能用截断后的
// 预览长度——这两个数在 list 类型下相等（list 从不截断），但在 sequence/date_sequence 下不相等，故单独算。
import type { Param } from '../../api/types'

export function paramValueCount(param: Pick<Param, 'kind' | 'values' | 'seq'>): number {
  switch (param.kind) {
    case 'list':
    case 'database':
      return param.values?.length ?? 0
    case 'sequence': {
      const seq = param.seq
      if (!seq || seq.step <= 0 || seq.end < seq.start) return 0
      return Math.floor((seq.end - seq.start) / seq.step) + 1
    }
    // date_sequence 的 seq.end 语义是"最近 N 天/月"里的 N（mockGenValues 同口径），不是 start~end 区间
    case 'date_sequence':
      return param.seq?.end ?? 5
    // date 是单点动态值（如"昨天"），genValues 展示的是候选日期供选择其一，参数本身只贡献 1 个取值
    case 'date':
      return 1
    default:
      return 0
  }
}

/** 取值预览文案：如「1~100」「a~z（26 个）」「最近 10 天」；sample 传 genValues 结果（用于取列表类首尾值） */
export function paramValuePreviewLabel(param: Pick<Param, 'kind' | 'seq' | 'values'>, sample: string[]): string {
  const count = paramValueCount(param)
  if (!sample.length) return count ? `共 ${count} 个` : '—'
  if (count <= 1) return sample[0]
  if (param.kind === 'sequence' && param.seq) {
    return `${param.seq.start}~${param.seq.end}${param.seq.step > 1 ? `（步长 ${param.seq.step}）` : ''}`
  }
  if (param.kind === 'date_sequence') return `最近 ${count} 天`
  return `${sample[0]}~${sample[Math.min(count, sample.length) - 1]}（${count} 个）`
}
