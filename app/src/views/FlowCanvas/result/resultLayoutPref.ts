// 具体源数据视图的布局折叠偏好（0910 会议 §2-2「点数据视图时自动收起上方流程配置区域」+
// §2-3「把『展开流程』及下方查询表折叠至单行」）。两个开关都默认**收起**：会上要的就是
// 把中间那块地方让出来，进来先能多看几行数据；要流程图或要筛选时点一下展开。
//
// 轨道偏好为什么不复用 railPref：那个 key 是两个数据视图共用的，而两边现在的默认值必须不同。
// 具体源这边把节点选择搬到了主干行上（带节点名的开合入口），收起轨道仍然能换节点；
// 网站汇总视图没有那个入口，轨道是**唯一**的节点选择器（0819 N1-2），跟着收起就没法切节点了。
// 共用一个 key 会让"在具体源收起轨道"顺带把网站汇总也卡住。
//
// 手动调过就记住，跨节点、跨源沿用：这是"我这段时间在干什么"的偏好（连着筛几十次 vs 只是翻数据）。
// 存储失败（隐私模式 / 配额满）一律当"没有偏好"处理，即回到默认的收起态。
const RAIL_KEY = 'rc.dataview.result.railOpen'
const FILTER_KEY = 'rc.dataview.result.filterBarOpen'

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

export const readResultRailOpen = () => read(RAIL_KEY)
export const writeResultRailOpen = (open: boolean) => write(RAIL_KEY, open)
export const readFilterBarOpen = () => read(FILTER_KEY)
export const writeFilterBarOpen = (open: boolean) => write(FILTER_KEY, open)
