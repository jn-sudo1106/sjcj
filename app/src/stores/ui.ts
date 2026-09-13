import { ref } from 'vue'
import { defineStore } from 'pinia'

// 模块级动作总线：业务页面注册「模块标题区」按钮的处理函数，AppShell 点击时派发。
// 未注册的动作触发即 no-op，保证各模块解耦、互不影响。
export const useUiStore = defineStore('ui', () => {
  const handlers = ref<Record<string, () => void>>({})

  function registerAction(key: string, fn: () => void) {
    handlers.value[key] = fn
  }
  function fireAction(key: string) {
    handlers.value[key]?.()
  }
  function clearActions() {
    handlers.value = {}
  }

  // 流程画布右侧配置区（优化 0701 问题一）：宽度拖拽调整并持久化；展开态为临时布局，不持久化。
  // inspectorWidth 为 null 表示未自定义，布局按模式默认值（普通 372 / 源详情 480）。
  // 拖拽上限固定为 MAX_INSPECTOR_W（不再随当前窗口宽度浮动）：避免在更宽的窗口里拖出的值持久化后，
  // 到更窄的窗口上把布局撑出横向滚动条；再要更大空间用「展开」（按视口 66vw 实时计算，天然不会溢出）。
  const INSPECTOR_W_KEY = 'rc-canvas-inspector-w'
  const MAX_INSPECTOR_W = 680
  const savedW = Number(localStorage.getItem(INSPECTOR_W_KEY))
  const inspectorWidth = ref<number | null>(
    Number.isFinite(savedW) && savedW >= 372 ? Math.min(savedW, MAX_INSPECTOR_W) : null,
  )
  const inspectorExpanded = ref(false)
  /**
   * 右侧配置区**收起**（0904 I10 / Z3-2）。与 `inspectorExpanded` 是相反的两端：
   *   - `inspectorExpanded` = 中间收起、配置区占满（原有）
   *   - `inspectorCollapsed` = **配置区收起成窄条、中间占满**（本次新增）
   * 两者互斥，由 `toggleInspectorCollapsed` / `toggleInspectorExpanded` 各自互相清掉。
   *
   * 数据视图默认收起配置区（让出表格空间），点窄条「节点配置」可随时展开；
   * 流程视图默认展开配置区。
   * 不持久化：跟 `inspectorExpanded` 一样是临时布局状态。
   */
  const inspectorCollapsed = ref(false)
  // 只在数据视图点右侧窄条「节点配置」主动展开时，ResultView 才按当前节点入参字段收窄列。
  // 点数据视图里的流程节点只是切换查看对象，表格仍应展示完整字段。
  const inspectorFieldFilterActive = ref(false)

  function setInspectorWidth(px: number) {
    inspectorWidth.value = Math.round(Math.min(px, MAX_INSPECTOR_W))
    localStorage.setItem(INSPECTOR_W_KEY, String(inspectorWidth.value))
  }
  function toggleInspectorExpanded() {
    inspectorExpanded.value = !inspectorExpanded.value
    if (inspectorExpanded.value) inspectorCollapsed.value = false
    inspectorFieldFilterActive.value = false
  }
  function toggleInspectorCollapsed() {
    const openingInspector = inspectorCollapsed.value
    inspectorCollapsed.value = !inspectorCollapsed.value
    if (inspectorCollapsed.value) inspectorExpanded.value = false
    inspectorFieldFilterActive.value = openingInspector
  }
  function clearInspectorFieldFilter() {
    inspectorFieldFilterActive.value = false
  }
  /** 复位成"两边都展开"。给独立工作区（如流程中心抽屉）开场时用——
   *  那是另一块界面，不该继承画布页上次留下的收起态。 */
  function resetInspectorLayout() {
    inspectorExpanded.value = false
    inspectorCollapsed.value = false
    inspectorFieldFilterActive.value = false
  }
  /** 切视图时套用默认布局：数据视图默认收起配置区（让出表格空间），流程视图默认展开配置区。 */
  function applyViewLayoutDefault(view: string) {
    inspectorExpanded.value = false
    inspectorCollapsed.value = view === 'data'
    inspectorFieldFilterActive.value = false
  }

  // 采集资产视图偏好（0707 优化·Phase3）：卡片（默认，网站粒度浏览）/ 表格（树形展开源，批量运维）
  const ASSET_VIEW_KEY = 'rc-asset-view'
  const savedAssetView = localStorage.getItem(ASSET_VIEW_KEY)
  const assetView = ref<'card' | 'table'>(savedAssetView === 'table' ? 'table' : 'card')
  function setAssetView(v: 'card' | 'table') {
    assetView.value = v
    localStorage.setItem(ASSET_VIEW_KEY, v)
  }

  // 左侧主导航「收起侧栏」：收起后只留图标窄条，中间区域让出更多宽度。持久化（属于用户长期偏好，跟 assetView 一类）。
  const NAV_COLLAPSED_KEY = 'rc-nav-collapsed'
  const navCollapsed = ref(localStorage.getItem(NAV_COLLAPSED_KEY) === '1')
  function toggleNavCollapsed() {
    navCollapsed.value = !navCollapsed.value
    localStorage.setItem(NAV_COLLAPSED_KEY, navCollapsed.value ? '1' : '0')
  }

  return {
    registerAction, fireAction, clearActions,
    inspectorWidth, inspectorExpanded, inspectorCollapsed, setInspectorWidth,
    inspectorFieldFilterActive, toggleInspectorExpanded, toggleInspectorCollapsed, clearInspectorFieldFilter,
    applyViewLayoutDefault, resetInspectorLayout,
    assetView, setAssetView,
    navCollapsed, toggleNavCollapsed,
  }
})
