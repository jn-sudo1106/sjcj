// 具体源数据视图的布局折叠偏好（0910 会议 §2-2「点数据视图时自动收起上方流程配置区域」+
// §2-3「把『展开流程』及下方查询表折叠至单行」）。两个开关都默认**收起**：会上要的就是
// 把中间那块地方让出来，进来先能多看几行数据；要流程图或要筛选时点一下展开。
//
// 0930-02 起轨道开合**不再记住**（每次进来都收起，状态放在各视图组件里），这里只剩筛选栏和轨道高度。
//
// 手动调过就记住，跨节点、跨源沿用：这是"我这段时间在干什么"的偏好（连着筛几十次 vs 只是翻数据）。
// 存储失败（隐私模式 / 配额满）一律当"没有偏好"处理，即回到默认的收起态。
const FILTER_KEY = 'rc.dataview.result.filterBarOpen'

/** 流程节点轨道进来时是否展开（0930-02：恒收起、不记住）。四个视图共用，单测借它换默认值。 */
export function initialRailOpen(): boolean {
  return false
}

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
function write(key: string, open: boolean): void {
  try {
    window.localStorage.setItem(key, open ? '1' : '0')
  } catch {
    /* 存不下就算了，下次进来退回默认的收起态 */
  }
}

export const readFilterBarOpen = () => read(FILTER_KEY)
export const writeFilterBarOpen = (open: boolean) => write(FILTER_KEY, open)

// 流程图区高度（0928）：分支多的流程图能有好几百像素高，展开后把下面的数据表整个顶出视口。
// 给一个默认最大高度，超出在区内滚动；底边分隔条可拖拽调整，调过就记住（同上，跨节点/跨源沿用）。
const RAIL_HEIGHT_KEY = 'rc.dataview.result.railHeight'
export const RAIL_HEIGHT_DEFAULT = 220
export const RAIL_HEIGHT_MIN = 80

export function readResultRailHeight(): number {
  try {
    const value = Number(window.localStorage.getItem(RAIL_HEIGHT_KEY))
    return Number.isFinite(value) && value >= RAIL_HEIGHT_MIN ? value : RAIL_HEIGHT_DEFAULT
  } catch {
    return RAIL_HEIGHT_DEFAULT
  }
}
export function writeResultRailHeight(height: number): void {
  try {
    window.localStorage.setItem(RAIL_HEIGHT_KEY, String(Math.round(height)))
  } catch {
    /* 存不下就算了，下次进来退回默认高度 */
  }
}

export type DataBrowseMode = 'table' | 'step'
const DATA_BROWSE_KEY = 'rc.dataview.result.browseMode'
export function readDataBrowseMode(): DataBrowseMode {
  try { return localStorage.getItem(DATA_BROWSE_KEY) === 'step' ? 'step' : 'table' }
  catch { return 'table' }
}
export function writeDataBrowseMode(mode: DataBrowseMode): void {
  try { localStorage.setItem(DATA_BROWSE_KEY, mode) } catch { /* 保留本次选择 */ }
}
