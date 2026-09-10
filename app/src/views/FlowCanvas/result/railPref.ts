// 流程节点轨道的折叠偏好（0819 N1-10）。
// 两个数据视图共用一个 key：用户折叠轨道是为了"这次要专心看数据"，这个意图不该因为
// 从具体源结果视图切到网站数据视图就被重置，也不该每进一次页面就要重新折一次。
// 存储失败（隐私模式 / 配额满）一律当"没有偏好"处理，不影响功能。
//
// 2026-09-10 起只剩网站汇总视图用它：具体源视图的轨道改为默认收起（会议 §2-2），
// 偏好挪进了 resultLayoutPref.ts。**两边不能再共用**——具体源那边把节点选择搬上了主干行，
// 收起轨道仍能换节点；网站汇总没有那个入口，轨道是唯一的节点选择器，跟着默认收起就卡住了。
const KEY = 'rc.dataview.railOpen'

export function readRailOpen(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

export function writeRailOpen(open: boolean): void {
  try {
    window.localStorage.setItem(KEY, open ? '1' : '0')
  } catch {
    /* 存不下就算了，折叠状态不值得为它报错 */
  }
}
