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

  function setInspectorWidth(px: number) {
    inspectorWidth.value = Math.round(Math.min(px, MAX_INSPECTOR_W))
    localStorage.setItem(INSPECTOR_W_KEY, String(inspectorWidth.value))
  }
  function toggleInspectorExpanded() {
    inspectorExpanded.value = !inspectorExpanded.value
  }

  // 采集资产视图偏好（0707 优化·Phase3）：卡片（默认，网站粒度浏览）/ 表格（树形展开源，批量运维）
  const ASSET_VIEW_KEY = 'rc-asset-view'
  const savedAssetView = localStorage.getItem(ASSET_VIEW_KEY)
  const assetView = ref<'card' | 'table'>(savedAssetView === 'table' ? 'table' : 'card')
  function setAssetView(v: 'card' | 'table') {
    assetView.value = v
    localStorage.setItem(ASSET_VIEW_KEY, v)
  }

  return {
    registerAction, fireAction, clearActions,
    inspectorWidth, inspectorExpanded, setInspectorWidth, toggleInspectorExpanded,
    assetView, setAssetView,
  }
})
