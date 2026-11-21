// 模板 → 节点类型编号的「实时字典纠偏」。
//
// 背景（2026-11-19，186 实测）：`cfg_source_type` 会按后端的迁移重排编号——186 的 1105
// 迁移后「规则处理」是 910，600 已经没有这一行。前端 `TEMPLATE_CONFIG_TYPE` / `TEMPLATE_TO_SNATCH`
// 是编译期快照，规则节点保存时仍写 600：后端按未知类型回退成 `dev_web_snatch_<user>` 队列，
// 任务就落到没人消费的 dev_web_snatch_admin（配置 1910016 保存后实测）。
//
// 口径：**不把编号写死成某个环境的值**（217/133 可能还是 600），由 dict store 拉到实时字典后
// 调 `setLiveConfigTypes()` 注册，解析顺序：
//   1) 快照编号仍在实时字典里 → 原样使用（老环境行为完全不变）；
//   2) 快照编号不在、但字典里有同名类型 → 用同名类型的编号（新编号环境，如 186 的 910）；
//   3) 字典为空/没拉到/同名也不在 → 用快照编号（离线时保持旧行为，不猜）。
//
// 只在真实运行期由 dict store 注册；单测里没有注册，默认走快照，不受影响。

export interface LiveConfigType {
  /** 后端 cfg_source_type.SOURCE_TYPE，展示为字符串 */
  code: string
  /** 后端 cfg_source_type.TYPE_NAME */
  name: string
}

/**
 * 模板 → 实时字典里的类型名。只登记**名字稳定**的类型；名字对不上就退回快照编号，
 * 宁可保持旧行为，也不按猜测的名字乱配（如 610 数据监控在 186 字典里根本没有行）。
 */
export const TEMPLATE_LIVE_TYPE_NAME: Record<string, string> = {
  rule: '规则处理',
}

let liveTypes: LiveConfigType[] | null = null

/** dict store 拉到 `config/sourceTypes` 后注册；传 null 清空（测试/重置用）。 */
export function setLiveConfigTypes(rows: LiveConfigType[] | null): void {
  liveTypes = rows && rows.length ? rows : null
}

/**
 * 把快照编号解析成当前环境可用的编号。
 * @param fallback 编译期快照里的编号（字符串，如 `'600'`）
 * @param template 节点模板 key（如 `'rule'`），用于按名字纠偏
 */
export function resolveLiveConfigCode(fallback: string, template?: string): string {
  const code = (fallback || '').trim()
  if (!code || !liveTypes) return code
  if (liveTypes.some((row) => row.code === code)) return code
  const name = template ? TEMPLATE_LIVE_TYPE_NAME[template] : undefined
  if (!name) return code
  const hit = liveTypes.find((row) => row.name === name)
  return hit ? hit.code : code
}

/** 当前是否已注册实时字典（调试/测试断言用）。 */
export function hasLiveConfigTypes(): boolean {
  return liveTypes !== null
}