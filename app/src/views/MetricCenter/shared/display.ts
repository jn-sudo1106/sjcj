// 共享层的展示口径：旧平台全局过滤器 `stateFilter` / `enableFilter` 的等价实现。
//
// 旧平台在 `core/lazy_use.js` 里注册了两个全局过滤器，详情类弹层（BaseDetail.vue）按
// `dataIndex === 'state'` / `'isDelete'` 分支套用。1014 迁移时把它们抽成纯函数放在这里，
// 供 ColumnDetailDrawer 与各页的详情弹层共用（indicatorDataset/DatasetDetailDrawer 里
// 已有一份同口径的实现，属于上一轮已交付代码，本轮不动它）。
//
// ⚠️ 旧的「状态」列表格列**没有**套过滤器（显示原始 C/E/W），只有详情抽屉转中文——
// 别把这两个函数用到表格上（核对过 dataset 页才没加，沿用同一结论）。

/** 旧全局过滤器 stateFilter：C→正常 / E→出错 / L→处理中 / AC→已审核 / W→待处理 / 其余原样 */
export function stateText(value: unknown): string {
  const key = String(value ?? '')
  const map: Record<string, string> = {
    C: '正常',
    E: '出错',
    L: '处理中',
    AC: '已审核',
    W: '待处理',
  }
  return map[key] ?? key
}

/** 旧全局过滤器 enableFilter：1→是[1] / 0→否[0] / 其余原值（空值给 '—'） */
export function enableText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Number(value) === 1) return '是[1]'
  if (Number(value) === 0) return '否[0]'
  return String(value)
}

/** 详情类展示的空值兜底：旧版默认分支是「一片空白」，新平台统一 '—' */
export function dash(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}
