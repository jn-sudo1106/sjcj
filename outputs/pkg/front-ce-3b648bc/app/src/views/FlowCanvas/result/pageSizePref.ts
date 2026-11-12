// 数据视图「每次加载条数」偏好（0910 会议 §1-2）。
// 会上原话是"改成可配置的分页加载，用户可选择单次加载条数（如 20 或 100 条）"，
// 确认过语义：调的是**表格每次追加多少行**，不是每个源向后端要多少条。
// 后者（SOURCE_PAGE_SIZE）保持固定——把用户选的 100 透传成"每源每页取 100 条"，
// 在源多的网站上请求体积和内存直接翻五倍，反而更卡，而用户想要的只是"一屏多看点"。
//
// 和 railPref 一样跨视图共用一个 key：这是"我习惯一次看多少"的偏好，不该因为换了
// 一个网站或换了张表就重置。存储失败（隐私模式 / 配额满）一律当"没有偏好"处理。
const KEY = 'rc.dataview.appendSize'

/** 可选项（0910 会上定 20/100/200）。20 是原先写死的值，保持为默认。 */
export const APPEND_SIZE_OPTIONS = [20, 100, 200] as const

export const DEFAULT_APPEND_SIZE = 20

export function readAppendSize(): number {
  try {
    const n = Number(window.localStorage.getItem(KEY))
    // 认不出来的值（老版本写的、被手改的）一律退回默认，不要拿它去发请求
    return (APPEND_SIZE_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_APPEND_SIZE
  } catch {
    return DEFAULT_APPEND_SIZE
  }
}

export function writeAppendSize(size: number): void {
  try {
    window.localStorage.setItem(KEY, String(size))
  } catch {
    /* 存不下就算了，下次进来退回默认值即可 */
  }
}
