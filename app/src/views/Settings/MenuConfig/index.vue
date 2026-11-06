<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  ElMessage,
  ElMessageBox,
} from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import {
  CaretBottom,
  CaretTop,
  Check,
  Close,
  Delete,
  Edit,
  Menu as MenuIcon,
  Plus,
  Rank,
  Refresh,
  Search,
  Sort,
  View,
  WarningFilled,
} from '@element-plus/icons-vue'
import {
  cleanLegacyButtons,
  deleteMenu,
  getMenuTree,
  saveMenu,
  updateMenuSort,
  type SysMenuForm,
  type SysMenuSortItem,
  type SysMenuTreeNode,
} from '@/api/sysMenuConfig'

// 树数据与加载状态
const loading = ref(false)
const rawTreeData = ref<SysMenuTreeNode[]>([])
const searchKeyword = ref('')
const filterType = ref<string>('ALL')
const filterStatus = ref<string>('ALL')
const treeRef = ref()

// 抽屉与弹窗状态
const drawerVisible = ref(false)
const drawerTitle = ref('新增资源')
const isEditing = ref(false)
const currentEditId = ref<number | null>(null)
const diagnosticsVisible = ref(false)
const detailDrawerVisible = ref(false)
const detailItem = ref<SysMenuTreeNode | null>(null)

function handleViewDetail(row: SysMenuTreeNode) {
  detailItem.value = row
  detailDrawerVisible.value = true
}

// 表单数据
const form = ref<SysMenuForm>({
  id: undefined,
  parentId: 0,
  name: '',
  type: 1,
  linkAddress: '',
  modelCode: '',
  icon: 'Setting',
  order: 1,
  status: 0,
  remark: '',
  componentPath: '',
  routeName: '',
})

// 常见图标的中文对照表（提升常用业务图标的直观度与检索命中率）
const ICON_LABEL_MAP: Record<string, string> = {
  Odometer: '资产总览',
  Box: '源管理',
  Connection: '流程中心',
  Document: '规则资产',
  Histogram: '指标中心',
  DataAnalysis: '数据中心',
  Files: '文件中心',
  Clock: '任务中心',
  Monitor: '监控中心',
  ChatDotRound: 'AI智能问数',
  Grid: '基础配置',
  Tickets: '模板配置',
  SetUp: '问数系统配置',
  Tools: '辅助工具',
  Setting: '系统设置',
  UserFilled: '用户权限设置',
  Menu: '菜单配置',
  HomeFilled: '首页分组',
  Folder: '资产分组',
  DataBoard: '全局看板',
  Cpu: '计算处理机',
  Management: '管理中心',
  Operation: '操作管理',
  Share: '数据流转',
  Bell: '告警通知',
  Lock: '安全权限',
  Key: '口令秘钥',
  TrendCharts: '趋势报表',
  PieChart: '分布统计',
  List: '列表明细',
  Collection: '集合视图',
  User: '用户',
  Search: '搜索',
  Plus: '添加',
  Edit: '编辑',
  Delete: '删除',
  Check: '勾选',
  Close: '关闭',
  Download: '下载',
  Upload: '上传',
  Link: '链接',
  Location: '位置',
  Calendar: '日历',
  Compass: '指南针',
  Coordinate: '坐标',
  Sunny: '明亮',
  Moon: '暗色',
  Star: '收藏',
  Message: '消息',
  ChatLineRound: '对话',
  Phone: '电话',
  Service: '客服',
  Wallet: '钱包',
  ShoppingCart: '购物车',
  Discount: '折扣',
  PriceTag: '标签',
  Money: '金额',
  Coin: '金币',
  Rank: '排行',
  Finished: '已完成',
  Loading: '加载中',
  Warning: '警告',
  QuestionFilled: '帮助',
  InfoFilled: '信息',
  SuccessFilled: '成功',
  CirclePlus: '圆加',
  Remove: '移除',
  Refresh: '刷新',
}

export interface SystemIconMeta {
  name: string
  label: string
  comp: unknown
}

// 全量 Element Plus 图标列表 (包含官方全量 293 款图标)
const allElementIcons: SystemIconMeta[] = Object.keys(ElementPlusIconsVue)
  .sort()
  .map((name) => ({
    name,
    label: ICON_LABEL_MAP[name] ? `${name} (${ICON_LABEL_MAP[name]})` : name,
    comp: (ElementPlusIconsVue as Record<string, unknown>)[name],
  }))

// 图标分组定义集合 (官方 293 款图标全量覆盖)
const ICON_CATEGORIES_SETS: Record<string, Set<string>> = {
  system: new Set([
    'Setting', 'SetUp', 'Tools', 'Management', 'Operation', 'User', 'UserFilled', 'Avatar', 'Key', 'Lock', 'Unlock',
    'Search', 'Edit', 'EditPen', 'Delete', 'DeleteFilled', 'Plus', 'Minus', 'Check', 'Checked', 'Close', 'CloseBold',
    'CircleCheck', 'CircleCheckFilled', 'CircleClose', 'CircleCloseFilled', 'CirclePlus', 'CirclePlusFilled', 'Remove',
    'RemoveFilled', 'Refresh', 'RefreshLeft', 'RefreshRight', 'Switch', 'SwitchButton', 'SwitchFilled', 'View', 'Hide',
    'Share', 'Link', 'Connection', 'Service', 'Bell', 'BellFilled', 'MuteNotification', 'Notification', 'Loading',
    'Warning', 'WarningFilled', 'WarnTriangleFilled', 'InfoFilled', 'Help', 'HelpFilled', 'QuestionFilled', 'Finished',
    'Failed', 'Select', 'SemiSelect', 'Open', 'TurnOff', 'Magnet', 'MagicStick', 'Pointer', 'Flag', 'Filter', 'Crop',
    'Scissor', 'ScaleToOriginal', 'ZoomIn', 'ZoomOut', 'FullScreen', 'ElementPlus', 'Eleme', 'ElemeFilled', 'More', 'MoreFilled',
    'Download', 'Upload', 'UploadFilled', 'SuccessFilled',
  ]),
  data: new Set([
    'DataAnalysis', 'DataBoard', 'DataLine', 'Histogram', 'PieChart', 'TrendCharts', 'Odometer', 'Rank', 'Sort', 'SortDown', 'SortUp', 'Compass', 'Coordinate', 'Aim',
  ]),
  document: new Set([
    'Document', 'DocumentAdd', 'DocumentChecked', 'DocumentCopy', 'DocumentDelete', 'DocumentRemove', 'CopyDocument',
    'Files', 'Folder', 'FolderAdd', 'FolderChecked', 'FolderDelete', 'FolderOpened', 'FolderRemove', 'Box', 'Collection',
    'CollectionTag', 'Tickets', 'Ticket', 'List', 'Grid', 'Memo', 'Notebook', 'Reading', 'ReadingLamp', 'Postcard',
    'Paperclip', 'Stamp', 'Briefcase', 'Suitcase', 'SuitcaseLine', 'Menu',
  ]),
  media: new Set([
    'Monitor', 'Platform', 'Cpu', 'Cellphone', 'Iphone', 'Phone', 'PhoneFilled', 'Camera', 'CameraFilled', 'VideoCamera',
    'VideoCameraFilled', 'VideoPlay', 'VideoPause', 'Film', 'Picture', 'PictureFilled', 'PictureRounded', 'Headset',
    'Microphone', 'Mic', 'Mute', 'Printer', 'Mouse', 'ChromeFilled',
  ]),
  direction: new Set([
    'ArrowDown', 'ArrowDownBold', 'ArrowLeft', 'ArrowLeftBold', 'ArrowRight', 'ArrowRightBold', 'ArrowUp', 'ArrowUpBold',
    'Back', 'Right', 'Top', 'Bottom', 'TopLeft', 'TopRight', 'BottomLeft', 'BottomRight', 'DArrowLeft', 'DArrowRight',
    'DCaret', 'CaretBottom', 'CaretLeft', 'CaretRight', 'CaretTop', 'Expand', 'Fold', 'Guide', 'Position', 'Promotion',
    'Location', 'LocationFilled', 'LocationInformation', 'AddLocation', 'DeleteLocation', 'MapLocation', 'Place',
    'Van', 'Bicycle', 'Ship',
  ]),
  commerce: new Set([
    'ShoppingCart', 'ShoppingCartFull', 'ShoppingBag', 'ShoppingTrolley', 'Shop', 'Goods', 'GoodsFilled', 'Present',
    'Discount', 'PriceTag', 'Wallet', 'WalletFilled', 'Coin', 'Money', 'CreditCard', 'Sell', 'SoldOut', 'House',
    'HomeFilled', 'OfficeBuilding', 'School', 'FirstAidKit', 'Trophy', 'TrophyBase', 'Medal', 'GoldMedal', 'Clock',
    'AlarmClock', 'Stopwatch', 'Timer', 'Watch', 'QuartzWatch', 'Calendar', 'Message', 'MessageBox', 'Comment',
    'ChatDotRound', 'ChatDotSquare', 'ChatLineRound', 'ChatLineSquare', 'ChatRound', 'ChatSquare', 'Star', 'StarFilled',
    'Opportunity', 'Sunny', 'Sunrise', 'Sunset', 'Moon', 'MoonNight', 'Cloudy', 'MostlyCloudy', 'PartlyCloudy',
    'Pouring', 'Drizzling', 'Lightning', 'WindPower', 'Umbrella', 'Food', 'ForkSpoon', 'KnifeFork', 'Bowl', 'Dish',
    'DishDot', 'Fries', 'Burger', 'HotWater', 'Coffee', 'CoffeeCup', 'ColdDrink', 'IceDrink', 'IceTea', 'MilkTea',
    'Mug', 'Sugar', 'Lollipop', 'IceCream', 'IceCreamRound', 'IceCreamSquare', 'Dessert', 'Apple', 'Pear', 'Orange',
    'Cherry', 'Grape', 'Watermelon', 'Chicken', 'Refrigerator', 'ToiletPaper', 'TakeawayBox', 'NoSmoking', 'Smoking',
    'Baseball', 'Basketball', 'Football', 'Soccer', 'Male', 'Female', 'Brush', 'BrushFilled',
    'Goblet', 'GobletFull', 'GobletSquare', 'GobletSquareFull', 'Handbag',
  ]),
}

// 当前激活的图标 Tab
const activeIconTab = ref('all')

// 图标搜索与交互
const iconSearchKey = ref('')

// 分组 Tab 选项卡（含实时搜索命中统计）
const iconCategories = computed(() => {
  const kw = iconSearchKey.value.trim().toLowerCase()
  const matchFn = (item: SystemIconMeta) =>
    !kw || item.name.toLowerCase().includes(kw) || item.label.toLowerCase().includes(kw)

  const allCount = allElementIcons.filter(matchFn).length
  const systemCount = allElementIcons.filter((i) => ICON_CATEGORIES_SETS.system.has(i.name) && matchFn(i)).length
  const dataCount = allElementIcons.filter((i) => ICON_CATEGORIES_SETS.data.has(i.name) && matchFn(i)).length
  const docCount = allElementIcons.filter((i) => ICON_CATEGORIES_SETS.document.has(i.name) && matchFn(i)).length
  const mediaCount = allElementIcons.filter((i) => ICON_CATEGORIES_SETS.media.has(i.name) && matchFn(i)).length
  const dirCount = allElementIcons.filter((i) => ICON_CATEGORIES_SETS.direction.has(i.name) && matchFn(i)).length
  const comCount = allElementIcons.filter((i) => ICON_CATEGORIES_SETS.commerce.has(i.name) && matchFn(i)).length

  return [
    { key: 'all', label: '全部', count: allCount },
    { key: 'system', label: '系统操作', count: systemCount },
    { key: 'data', label: '数据图表', count: dataCount },
    { key: 'document', label: '文档资产', count: docCount },
    { key: 'media', label: '媒体设备', count: mediaCount },
    { key: 'direction', label: '方向位置', count: dirCount },
    { key: 'commerce', label: '通用生活', count: comCount },
  ]
})

// 当前 Tab 下的图标集合
const currentTabIcons = computed(() => {
  const tab = activeIconTab.value
  const kw = iconSearchKey.value.trim().toLowerCase()
  const baseList =
    tab === 'all'
      ? allElementIcons
      : allElementIcons.filter((i) => ICON_CATEGORIES_SETS[tab]?.has(i.name))

  if (!kw) return baseList
  return baseList.filter(
    (item) => item.name.toLowerCase().includes(kw) || item.label.toLowerCase().includes(kw)
  )
})

function selectIcon(iconName: string) {
  if (form.value.icon === iconName) {
    form.value.icon = ''
  } else {
    form.value.icon = iconName
  }
}

function clearIcon() {
  form.value.icon = ''
}

function getIconComponent(name?: string) {
  if (!name) return null
  return (ElementPlusIconsVue as Record<string, unknown>)[name] || null
}

function getNodeTypeTag(type?: number) {
  switch (type) {
    case 0:
      return { label: '目录', type: 'primary' as const }
    case 1:
      return { label: '菜单', type: 'success' as const }
    case 2:
      return { label: '页内Tab', type: 'warning' as const }
    case 3:
      return { label: '按钮', type: 'info' as const }
    default:
      return { label: '资源', type: 'info' as const }
  }
}

// 扁平化数据供统计与父节点选择
function flattenTree(nodes: SysMenuTreeNode[]): SysMenuTreeNode[] {
  let list: SysMenuTreeNode[] = []
  nodes.forEach((n) => {
    list.push(n)
    if (n.children && n.children.length > 0) {
      list = list.concat(flattenTree(n.children))
    }
  })
  return list
}

const allFlatList = computed(() => flattenTree(rawTreeData.value))

// 统计数量
const stats = computed(() => {
  const list = allFlatList.value
  return {
    dir: list.filter((i) => i.type === 0).length,
    menu: list.filter((i) => i.type === 1).length,
    tab: list.filter((i) => i.type === 2).length,
    button: list.filter((i) => i.type === 3).length,
    total: list.length,
  }
})

// 检测老库异常按钮 (type=1 且路由为空或非 / 开头，或者 id 为 900-906)
const legacyIssues = computed(() => {
  const list = allFlatList.value
  return list.filter((i) => {
    if (i.id >= 901 && i.id <= 906) return true
    if (i.parentId === 900) return true
    if (i.type === 1 && (!i.linkAddress || !i.linkAddress.startsWith('/'))) {
      return (
        i.label.includes('新增') ||
        i.label.includes('修改') ||
        i.label.includes('失效') ||
        i.label.includes('导出') ||
        i.label.includes('分配')
      )
    }
    return false
  })
})

// 递归对菜单树节点严格按照 order 升序排序 (同 order 按 id 排序)
function sortTreeData(nodes: SysMenuTreeNode[]): SysMenuTreeNode[] {
  if (!nodes || nodes.length === 0) return []
  return [...nodes]
    .map((node) => ({
      ...node,
      children: node.children ? sortTreeData(node.children) : [],
    }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id)
}

// 过滤后的树形表格数据 (严格保证所有层级按照排序大小升序展示)
const filteredTreeData = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  const typeF = filterType.value
  const statusF = filterStatus.value

  function filterNodes(nodes: SysMenuTreeNode[]): SysMenuTreeNode[] {
    const res: SysMenuTreeNode[] = []
    for (const node of nodes) {
      const matchKw =
        !kw ||
        node.label.toLowerCase().includes(kw) ||
        (node.linkAddress && node.linkAddress.toLowerCase().includes(kw)) ||
        (node.modelCode && node.modelCode.toLowerCase().includes(kw))
      const matchType = !typeF || typeF === 'ALL' || String(node.type) === typeF
      const matchStatus = !statusF || statusF === 'ALL' || String(node.status) === statusF

      const filteredChildren = node.children ? filterNodes(node.children) : []
      const selfMatch = matchKw && matchType && matchStatus

      if (selfMatch || filteredChildren.length > 0) {
        res.push({
          ...node,
          children: filteredChildren.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id),
        })
      }
    }
    return res.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id)
  }

  return filterNodes(rawTreeData.value)
})

export interface ParentTreeNode {
  id: number
  label: string
  type: number
  icon?: string
  children?: ParentTreeNode[]
}

// 收集自身及所有后代节点 ID (编辑时用于防止循环依赖)
function getDescendantIds(nodeId: number, flatList: SysMenuTreeNode[]): Set<number> {
  const ids = new Set<number>([nodeId])
  let added = true
  while (added) {
    added = false
    for (const item of flatList) {
      if (item.parentId != null && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id)
        added = true
      }
    }
  }
  return ids
}

// 供新增/编辑抽屉中父级节点选择器使用的树形结构数据
const parentTreeData = computed<ParentTreeNode[]>(() => {
  const excludeIds = currentEditId.value
    ? getDescendantIds(currentEditId.value, allFlatList.value)
    : new Set<number>()

  function filterTree(nodes: SysMenuTreeNode[]): ParentTreeNode[] {
    const res: ParentTreeNode[] = []
    for (const n of nodes) {
      // 排除自身及后代、排除按钮 (type=3 按钮不能作为父节点)
      if (excludeIds.has(n.id) || n.type === 3) {
        continue
      }
      const children = n.children ? filterTree(n.children) : []
      res.push({
        id: n.id,
        label: n.label,
        type: n.type,
        icon: n.icon,
        children: children.length > 0 ? children : undefined,
      })
    }
    return res
  }

  const validTrees = filterTree(rawTreeData.value)

  return [
    {
      id: 0,
      label: '【顶级根目录】(无父级)',
      type: -1,
    },
    ...validTrees,
  ]
})

// 加载菜单树
async function loadTree() {
  loading.value = true
  try {
    const tree = await getMenuTree()
    rawTreeData.value = sortTreeData(tree || [])
  } catch (e: unknown) {
    ElMessage.error(`加载菜单数据失败: ${(e as Error)?.message || String(e)}`)
  } finally {
    loading.value = false
  }
}

// 拖拽判断：所有节点均允许拖拽
function handleAllowDrag() {
  return true
}

// 拖拽放置规则约束
function handleAllowDrop(
  draggingNode: { data: SysMenuTreeNode },
  dropNode: { data: SysMenuTreeNode; level: number },
  type: 'prev' | 'inner' | 'next'
): boolean {
  if (!dropNode || !draggingNode) return false
  const dragData = draggingNode.data
  const dropData = dropNode.data

  // 按钮类型 (type === 3) 不允许作为父节点容纳子级
  if (type === 'inner' && dropData.type === 3) {
    return false
  }

  // 顶级目录 (type === 0) 只能在根层级进行平级排序，不允许拖入成为下级
  if (dragData.type === 0) {
    if (type === 'inner') return false
    if ((dropData.parentId ?? 0) !== 0) return false
  }

  return true
}

// 拖拽完成后的同级重排与持久化
async function handleNodeDrop(
  draggingNode: { data: SysMenuTreeNode },
  dropNode: { data: SysMenuTreeNode; parent?: { childNodes?: Array<{ data: SysMenuTreeNode }> }; childNodes?: Array<{ data: SysMenuTreeNode }> },
  dropType: 'before' | 'after' | 'inner' | 'none'
) {
  if (dropType === 'none' || !dropNode || !draggingNode) return

  try {
    let newParentId = 0
    let siblings: SysMenuTreeNode[] = []

    if (dropType === 'inner') {
      newParentId = dropNode.data.id
      siblings = (dropNode.childNodes || []).map((cn) => cn.data)
    } else {
      newParentId = dropNode.data.parentId ?? 0
      const parentNode = dropNode.parent
      if (parentNode && parentNode.childNodes) {
        siblings = parentNode.childNodes.map((cn) => cn.data)
      } else {
        siblings = rawTreeData.value.filter((n) => (n.parentId ?? 0) === 0)
      }
    }

    if (siblings.length === 0) return

    const sortItems: SysMenuSortItem[] = siblings.map((item, idx) => ({
      id: item.id,
      parentId: newParentId,
      order: idx + 1,
    }))

    await updateMenuSort(sortItems)
    ElMessage.success('菜单排序调整已保存')
    await loadTree()
  } catch (e: unknown) {
    ElMessage.error(`更新排序失败: ${(e as Error)?.message || String(e)}`)
    await loadTree()
  }
}

// 快捷上移 / 下移调整排序
async function handleMoveQuick(data: SysMenuTreeNode, direction: 'up' | 'down') {
  try {
    const parentId = data.parentId ?? 0
    let siblings: SysMenuTreeNode[] = []

    if (parentId === 0) {
      siblings = rawTreeData.value.filter((n) => (n.parentId ?? 0) === 0)
    } else {
      const parent = allFlatList.value.find((n) => n.id === parentId)
      if (parent && parent.children) {
        siblings = [...parent.children]
      }
    }

    siblings = [...siblings].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id)

    const currIdx = siblings.findIndex((item) => item.id === data.id)
    if (currIdx === -1) return

    if (direction === 'up') {
      if (currIdx === 0) {
        ElMessage.info('已经是当前层级第一位')
        return
      }
      const temp = siblings[currIdx]
      siblings[currIdx] = siblings[currIdx - 1]
      siblings[currIdx - 1] = temp
    } else {
      if (currIdx === siblings.length - 1) {
        ElMessage.info('已经是当前层级最后一位')
        return
      }
      const temp = siblings[currIdx]
      siblings[currIdx] = siblings[currIdx + 1]
      siblings[currIdx + 1] = temp
    }

    const sortItems: SysMenuSortItem[] = siblings.map((item, idx) => ({
      id: item.id,
      parentId,
      order: idx + 1,
    }))

    await updateMenuSort(sortItems)
    ElMessage.success(`「${data.label}」排序调整成功`)
    await loadTree()
  } catch (e: unknown) {
    ElMessage.error(`排序调整失败: ${(e as Error)?.message || String(e)}`)
  }
}

// 全部展开 / 折叠
const isAllExpanded = ref(false)
function toggleExpandAll() {
  isAllExpanded.value = !isAllExpanded.value
  if (!treeRef.value) return
  interface TreeNodeInternal {
    expanded: boolean
  }
  const nodes = (treeRef.value.store?._getAllNodes?.() as TreeNodeInternal[]) || []
  for (const node of nodes) {
    node.expanded = isAllExpanded.value
  }
}

// 默认展开策略：只展开「目录」这一层，菜单行可见但默认收起 —— 和真实侧栏同形
// （侧栏本来就只到 目录 -> 菜单，页内 Tab 与按钮不在侧栏上）。
// 一旦有搜索或类型/状态筛选就全展开，否则筛出来的菜单/Tab/按钮会藏在收起的父节点里看不见。
const hasTreeFilter = computed(
  () => !!searchKeyword.value.trim() || filterType.value !== 'ALL' || filterStatus.value !== 'ALL',
)

const defaultExpandedKeys = computed<number[]>(() => {
  const keys: number[] = []
  const walk = (nodes: SysMenuTreeNode[]) => {
    for (const node of nodes) {
      if (hasTreeFilter.value || node.type === 0) keys.push(node.id)
      if (node.children?.length) walk(node.children)
    }
  }
  walk(filteredTreeData.value)
  return keys
})

// el-tree 只在重建节点时读 default-expanded-keys，筛选变化后按同一口径补一次
watch(
  defaultExpandedKeys,
  (keys) => {
    if (!treeRef.value) return
    interface TreeNodeInternal {
      expanded: boolean
      data?: { id?: number }
    }
    const expanded = new Set(keys)
    const nodes = (treeRef.value.store?._getAllNodes?.() as TreeNodeInternal[]) || []
    for (const node of nodes) {
      node.expanded = node.data?.id !== undefined && expanded.has(node.data.id)
    }
    isAllExpanded.value = nodes.length > 0 && nodes.every((node) => node.expanded)
  },
  { flush: 'post' },
)

// 打开新增抽屉
function handleAdd(parentId = 0, defaultType = 1) {
  isEditing.value = false
  currentEditId.value = null
  drawerTitle.value = parentId === 0 ? '新建顶级分组目录' : '添加子级资源'
  form.value = {
    id: undefined,
    parentId,
    name: '',
    type: defaultType,
    linkAddress: defaultType === 1 ? '/' : '',
    modelCode: '',
    icon: defaultType === 0 ? 'Folder' : defaultType === 1 ? 'Setting' : '',
    order: 1,
    status: 0,
    remark: '',
    componentPath: defaultType === 1 ? 'views/' : '',
    routeName: '',
  }
  drawerVisible.value = true
}

// 打开编辑抽屉
function handleEdit(row: SysMenuTreeNode) {
  isEditing.value = true
  currentEditId.value = row.id
  drawerTitle.value = `编辑: ${row.label}`
  form.value = {
    id: row.id,
    parentId: row.parentId,
    name: row.label,
    type: row.type,
    linkAddress: row.linkAddress || '',
    modelCode: row.modelCode || '',
    icon: row.icon || '',
    order: row.order ?? 1,
    status: row.status ?? 0,
    remark: row.remark || '',
    componentPath: row.componentPath || '',
    routeName: row.routeName || '',
  }
  drawerVisible.value = true
}

// 快速切换启用/禁用状态
async function handleToggleStatus(row: SysMenuTreeNode) {
  const newStatus = row.status === 0 ? 1 : 0
  try {
    await saveMenu({
      id: row.id,
      parentId: row.parentId,
      name: row.label,
      type: row.type,
      linkAddress: row.linkAddress,
      modelCode: row.modelCode,
      icon: row.icon,
      order: row.order,
      status: newStatus,
      remark: row.remark,
      componentPath: row.componentPath,
      routeName: row.routeName,
    })
    row.status = newStatus
    ElMessage.success(`已${newStatus === 0 ? '启用' : '禁用'}「${row.label}」`)
  } catch (e: unknown) {
    ElMessage.error(`操作失败: ${(e as Error)?.message || String(e)}`)
  }
}

// 提交表单
async function handleSubmit() {
  if (!form.value.name.trim()) {
    ElMessage.warning('请输入菜单或资源名称')
    return
  }
  // 页内 Tab 的 key 就是前端 componentMap 的键名与地址栏 ?tab= 的值，留空会让页签点了没反应
  // （useDynamicTabs 只能按 id 兜底补成 tab-N，切过去的地址也就不再稳定可读）
  if (form.value.type === 2 && !form.value.linkAddress?.trim()) {
    ElMessage.warning('请填写页内 Tab 标识 Key（例如 users），留空会导致该页签点了没反应')
    return
  }
  try {
    await saveMenu(form.value)
    ElMessage.success(isEditing.value ? '更新成功' : '新增成功')
    drawerVisible.value = false
    await loadTree()
  } catch (e: unknown) {
    ElMessage.error(`保存失败: ${(e as Error)?.message || String(e)}`)
  }
}

// 删除菜单
async function handleDelete(row: SysMenuTreeNode) {
  const hasKids = row.children && row.children.length > 0
  const confirmText = hasKids
    ? `【${row.label}】含有 ${row.children!.length} 个子节点，删除将级联清理全部下级资源，确定删除吗？`
    : `确定要删除「${row.label}」吗？`

  try {
    await ElMessageBox.confirm(confirmText, '删除确认', {
      type: 'warning',
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
    })
    await deleteMenu(row.id)
    ElMessage.success('删除成功')
    await loadTree()
  } catch (e: unknown) {
    if (e !== 'cancel') {
      ElMessage.error(`删除失败: ${(e as Error)?.message || String(e)}`)
    }
  }
}

// 一键清洗老库历史残留按钮
async function handleCleanLegacy() {
  try {
    const res = await cleanLegacyButtons()
    ElMessage.success(res.message || `已成功清洗 ${res.updatedCount} 条历史残留数据`)
    diagnosticsVisible.value = false
    await loadTree()
  } catch (e: unknown) {
    ElMessage.error(`清洗失败: ${(e as Error)?.message || String(e)}`)
  }
}

onMounted(() => {
  void loadTree()
})
</script>

<template>
  <div class="menu-config-page">
    <!-- 顶部工作台卡片 -->
    <el-card shadow="never" class="header-card">
      <div class="header-container">
        <div class="title-area">
          <div class="icon-badge">
            <el-icon><MenuIcon /></el-icon>
          </div>
          <div>
            <div class="title-row">
              <span class="main-title">菜单配置</span>
            </div>
            <div class="sub-title">
              统一编排维护系统目录分组 (DIR)、一级功能页面 (MENU)、页内标签 (TAB) 与操作按钮权限 (BUTTON)
            </div>
          </div>
        </div>

        <!-- 顶部功能按钮 -->
        <div class="actions-area">
          <el-button
            v-if="legacyIssues.length > 0"
            type="warning"
            plain
            class="issue-btn"
            @click="diagnosticsVisible = true"
          >
            <el-icon class="mr-1"><WarningFilled /></el-icon>
            老库脏数据自检 ({{ legacyIssues.length }}项异常)
          </el-button>

          <el-button type="primary" @click="handleAdd(0, 0)">
            <el-icon class="mr-1"><Plus /></el-icon>
            新建顶级目录
          </el-button>

          <el-button :loading="loading" @click="loadTree">
            <el-icon><Refresh /></el-icon>
          </el-button>
        </div>
      </div>

      <!-- 统计指标胶囊 -->
      <div class="stats-row">
        <div class="stat-pill dir">
          <span class="stat-dot"></span>
          <span class="stat-name">目录</span>
          <span class="stat-val">{{ stats.dir }}</span>
        </div>
        <div class="stat-pill menu">
          <span class="stat-dot"></span>
          <span class="stat-name">菜单</span>
          <span class="stat-val">{{ stats.menu }}</span>
        </div>
        <div class="stat-pill tab">
          <span class="stat-dot"></span>
          <span class="stat-name">页内Tab</span>
          <span class="stat-val">{{ stats.tab }}</span>
        </div>
        <div class="stat-pill button">
          <span class="stat-dot"></span>
          <span class="stat-name">按钮</span>
          <span class="stat-val">{{ stats.button }}</span>
        </div>
        <div class="stat-total">
          已纳管资源总计: <b>{{ stats.total }}</b> 个
        </div>
      </div>
    </el-card>

    <!-- 工具栏与树形数据表格卡片 -->
    <el-card shadow="never" class="table-card">
      <div class="toolbar-row">
        <div class="filter-controls">
          <el-input
            v-model="searchKeyword"
            placeholder="搜索菜单名、路由路径..."
            clearable
            style="width: 320px"
            :prefix-icon="Search"
          />

          <el-select
            v-model="filterType"
            placeholder="全部类型"
            clearable
            style="width: 130px"
            @clear="filterType = 'ALL'"
          >
            <el-option label="全部类型" value="ALL" />
            <el-option label="目录" value="0" />
            <el-option label="菜单" value="1" />
            <el-option label="页内Tab" value="2" />
            <el-option label="按钮" value="3" />
          </el-select>

          <el-select
            v-model="filterStatus"
            placeholder="全部状态"
            clearable
            style="width: 120px"
            @clear="filterStatus = 'ALL'"
          >
            <el-option label="全部状态" value="ALL" />
            <el-option label="正常启用" value="0" />
            <el-option label="已停用" value="1" />
          </el-select>

          <div class="sort-tip-pill">
            <el-icon class="mr-1 text-primary"><Sort /></el-icon>
            <span>支持全级拖拽与上下快捷调序，按排序值升序编排</span>
          </div>
        </div>

        <div class="table-actions">
          <el-button size="small" plain @click="toggleExpandAll">
            {{ isAllExpanded ? '全部折叠' : '全部展开' }}
          </el-button>
        </div>
      </div>

      <!-- 树形数据组件 (直接展示清晰树形结构，不展示 res_model_code) -->
      <div class="tree-table-wrapper">
        <div class="tree-header-bar">
          <div class="header-name">菜单名称</div>
          <div class="header-meta">
            <span class="meta-col col-path">路由地址</span>
            <span class="meta-col col-order">排序</span>
            <span class="meta-col col-status">状态</span>
            <span class="meta-col col-time">更新时间</span>
            <span class="meta-col col-ops">操作</span>
          </div>
        </div>

        <div v-loading="loading" class="tree-body-wrapper">
          <el-tree
            ref="treeRef"
            :data="filteredTreeData"
            node-key="id"
            :default-expand-all="false"
            :default-expanded-keys="defaultExpandedKeys"
            :expand-on-click-node="false"
            :props="{ label: 'label', children: 'children' }"
            draggable
            :allow-drag="handleAllowDrag"
            :allow-drop="handleAllowDrop"
            @node-drop="handleNodeDrop"
            class="menu-tree-container"
          >
            <template #default="{ data }">
              <div class="custom-tree-row">
                <!-- 左侧：类型徽标 + 图标 + 名称 + 老库标签 -->
                <div class="node-main">
                  <el-tag
                    size="small"
                    :type="getNodeTypeTag(data.type).type"
                    effect="light"
                    class="type-tag"
                  >
                    {{ getNodeTypeTag(data.type).label }}
                  </el-tag>
                  <el-icon v-if="data.icon && getIconComponent(data.icon)" class="node-icon">
                    <component :is="getIconComponent(data.icon)" />
                  </el-icon>
                  <span
                    class="node-label"
                    :class="`level-${data.type}`"
                    title="点击查看详情"
                    @click="handleViewDetail(data)"
                  >
                    {{ data.label }}
                  </span>
                </div>

                <!-- 右侧：路由 + 排序 + 启停 + 操作按钮（组件文件路径只在详情/编辑抽屉中查看，列表不展示） -->
                <div class="node-meta" @click.stop>
                  <div class="meta-path">
                    <span v-if="data.linkAddress" class="path-code" :title="'路由地址: ' + data.linkAddress">
                      {{ data.linkAddress }}
                    </span>
                    <span v-else class="path-none">-</span>
                  </div>

                  <div class="meta-order">
                    <el-tooltip content="按住可拖拽调整排序" placement="top" :show-after="400">
                      <span class="drag-handle" title="按住拖拽排序">
                        <el-icon><Rank /></el-icon>
                      </span>
                    </el-tooltip>
                    <div class="order-quick-actions">
                      <el-button
                        link
                        size="small"
                        class="order-btn"
                        title="上移"
                        aria-label="上移"
                        @click="handleMoveQuick(data, 'up')"
                      >
                        <el-icon><CaretTop /></el-icon>
                      </el-button>
                      <el-button
                        link
                        size="small"
                        class="order-btn"
                        title="下移"
                        aria-label="下移"
                        @click="handleMoveQuick(data, 'down')"
                      >
                        <el-icon><CaretBottom /></el-icon>
                      </el-button>
                    </div>
                  </div>

                  <div class="meta-status">
                    <el-switch
                      :model-value="data.status === 0"
                      size="small"
                      active-text="启用"
                      inactive-text="停用"
                      inline-prompt
                      @change="handleToggleStatus(data)"
                    />
                  </div>

                  <div class="meta-time">
                    <span v-if="data.updateTime" class="time-code" :title="'最后更新时间: ' + data.updateTime">
                      {{ data.updateTime }}
                    </span>
                    <span v-else class="path-none">-</span>
                  </div>

                  <div class="meta-actions">
                    <el-tooltip
                      v-if="data.type < 3"
                      content="添加子项"
                      placement="top"
                      :show-after="200"
                    >
                      <el-button
                        type="primary"
                        link
                        size="small"
                        :icon="Plus"
                        class="op-icon-btn"
                        aria-label="添加子项"
                        @click="handleAdd(data.id, data.type + 1)"
                      />
                    </el-tooltip>
                    <el-tooltip
                      content="查看详情"
                      placement="top"
                      :show-after="200"
                    >
                      <el-button
                        type="info"
                        link
                        size="small"
                        :icon="View"
                        class="op-icon-btn"
                        aria-label="查看详情"
                        @click="handleViewDetail(data)"
                      />
                    </el-tooltip>
                    <el-tooltip
                      content="编辑"
                      placement="top"
                      :show-after="200"
                    >
                      <el-button
                        type="primary"
                        link
                        size="small"
                        :icon="Edit"
                        class="op-icon-btn"
                        aria-label="编辑资源"
                        @click="handleEdit(data)"
                      />
                    </el-tooltip>
                    <el-tooltip
                      content="删除节点"
                      placement="top"
                      :show-after="200"
                    >
                      <el-button
                        type="danger"
                        link
                        size="small"
                        :icon="Delete"
                        class="op-icon-btn op-del-btn"
                        aria-label="删除节点"
                        @click="handleDelete(data)"
                      />
                    </el-tooltip>
                  </div>
                </div>
              </div>
            </template>
          </el-tree>

          <el-empty
            v-if="!loading && filteredTreeData.length === 0"
            description="未查询到匹配的菜单与资源"
            :image-size="60"
          />
        </div>
      </div>
    </el-card>

    <!-- ==================== 新增 / 编辑抽屉 ==================== -->
    <el-drawer
      v-model="drawerVisible"
      :title="drawerTitle"
      size="520px"
      destroy-on-close
      class="menu-edit-drawer"
    >
      <el-form label-position="top" class="edit-form">
        <!-- 资源类型 (下拉选择) -->
        <el-form-item label="资源类型" required>
          <el-select v-model="form.type" placeholder="请选择菜单类型" style="width: 100%">
            <el-option :value="0" label="目录">
              <div class="type-option-item">
                <el-tag size="small" type="primary" effect="light" class="mr-2">目录</el-tag>
                <span class="type-option-desc">用于侧栏顶级分组标题</span>
              </div>
            </el-option>
            <el-option :value="1" label="菜单">
              <div class="type-option-item">
                <el-tag size="small" type="success" effect="light" class="mr-2">菜单</el-tag>
                <span class="type-option-desc">具备独立路由的前端业务页面</span>
              </div>
            </el-option>
            <el-option :value="2" label="页内Tab">
              <div class="type-option-item">
                <el-tag size="small" type="warning" effect="light" class="mr-2">页内Tab</el-tag>
                <span class="type-option-desc">页面内的二级选项卡</span>
              </div>
            </el-option>
            <el-option :value="3" label="按钮">
              <div class="type-option-item">
                <el-tag size="small" type="info" effect="light" class="mr-2">按钮</el-tag>
                <span class="type-option-desc">操作按钮与接口权限点</span>
              </div>
            </el-option>
          </el-select>
        </el-form-item>

        <!-- 父级节点 (树形层级选择器) -->
        <el-form-item label="上级节点" required>
          <el-tree-select
            v-model="form.parentId"
            :data="parentTreeData"
            :props="{ label: 'label', value: 'id', children: 'children' }"
            node-key="id"
            placeholder="请选择上级节点（支持搜索与层级树展开）"
            check-strictly
            default-expand-all
            filterable
            style="width: 100%"
          >
            <template #default="{ data }">
              <div class="tree-select-node-item">
                <el-tag
                  v-if="data.type >= 0"
                  size="small"
                  :type="getNodeTypeTag(data.type).type"
                  effect="light"
                  class="mr-2"
                >
                  {{ getNodeTypeTag(data.type).label }}
                </el-tag>
                <el-tag
                  v-else
                  size="small"
                  type="primary"
                  effect="plain"
                  class="mr-2"
                >
                  根
                </el-tag>
                <el-icon v-if="data.icon && getIconComponent(data.icon)" class="mr-1 select-icon">
                  <component :is="getIconComponent(data.icon)" />
                </el-icon>
                <span class="select-text">{{ data.label }}</span>
              </div>
            </template>
          </el-tree-select>
        </el-form-item>

        <!-- 菜单名称 -->
        <el-form-item label="名称" required>
          <el-input v-model="form.name" />
        </el-form-item>

        <!-- 路由路径 -->
        <el-form-item :required="form.type === 2">
          <template #label>
            <span>
              {{
                form.type === 0
                  ? '分组编码 (选填，例如 group:template)'
                  : form.type === 1
                  ? '页面路由地址 (以 / 开头)'
                  : form.type === 2
                  ? '页内 Tab 标识 Key (必填，例如 users)'
                  : '触发行为/动作路径 (可选)'
              }}
            </span>
          </template>
          <el-input
            v-model="form.linkAddress"
            :placeholder="form.type === 1 ? '/ai-chat' : 'key'"
          />
        </el-form-item>

        <!-- 页面组件文件路径 (动态路由核心 - 解决痛点) -->
        <el-form-item v-if="form.type !== 3">
          <template #label>
            <div class="field-label-box">
              <span>组件文件路径</span>
              <span class="field-sub-tip">前端 Vue 页面真实文件地址，动态路由按它装配页面组件</span>
            </div>
          </template>
          <el-input
            v-model="form.componentPath"
            placeholder="例如: views/Overview/index.vue"
            clearable
          />
        </el-form-item>

        <!-- 路由唯一英文名 (Vue Router name 与 KeepAlive 缓存) -->
        <el-form-item v-if="form.type <= 1">
          <template #label>
            <div class="field-label-box">
              <span>路由英文名</span>
              <span class="field-sub-tip">作为 Vue Router 的 name，留空自动用 Route_&lt;菜单标识&gt;</span>
            </div>
          </template>
          <el-input
            v-model="form.routeName"
            placeholder="例如: Overview 或 MenuConfig"
            clearable
          />
        </el-form-item>

        <!-- 权限标识码 -->
        <el-form-item label="权限标识码">
          <el-input v-model="form.modelCode" placeholder="例如: sys:menu:list 或 template:ai-chat" />
        </el-form-item>

        <!-- 菜单图标选择（系统支持样式图标可视化点选） -->
        <el-form-item label="菜单图标">
          <div class="icon-selector-card">
            <!-- 顶部选中状态与预览 -->
            <div class="icon-current-preview">
              <div class="preview-box" :class="{ 'has-icon': !!form.icon }">
                <el-icon v-if="form.icon && getIconComponent(form.icon)" :size="24">
                  <component :is="getIconComponent(form.icon)" />
                </el-icon>
                <span v-else class="preview-empty">无图标</span>
              </div>
              <div class="preview-info">
                <div v-if="form.icon" class="preview-title">
                  <span class="icon-name">{{ form.icon }}</span>
                  <span v-if="ICON_LABEL_MAP[form.icon]" class="icon-desc">
                    ({{ ICON_LABEL_MAP[form.icon] }})
                  </span>
                </div>
                <div v-else class="preview-none">未选择图标（页面将以纯文字展示）</div>
                <div class="preview-tip">请在下方选择 Element Plus 官方标准图标</div>
              </div>
              <el-button
                v-if="form.icon"
                size="small"
                link
                type="danger"
                :icon="Close"
                @click="clearIcon"
              >
                清空
              </el-button>
            </div>

            <!-- 图标检索与网格点选面板 -->
            <div class="icon-picker-panel">
              <div class="panel-header">
                <span class="panel-title">Element Plus 全量图标库 (共 {{ allElementIcons.length }} 款)</span>
                <el-input
                  v-model="iconSearchKey"
                  placeholder="搜索图标名称或含义..."
                  size="small"
                  clearable
                  :prefix-icon="Search"
                  style="width: 180px"
                />
              </div>

              <!-- 分组 Tab 选项卡展示 -->
              <el-tabs v-model="activeIconTab" class="icon-category-tabs">
                <el-tab-pane
                  v-for="cat in iconCategories"
                  :key="cat.key"
                  :name="cat.key"
                >
                  <template #label>
                    <span class="cat-tab-label">
                      {{ cat.label }}
                      <span class="cat-count">({{ cat.count }})</span>
                    </span>
                  </template>
                </el-tab-pane>
              </el-tabs>

              <div class="icon-grid-scroll">
                <div class="icon-grid">
                  <div
                    v-for="item in currentTabIcons"
                    :key="item.name"
                    class="icon-grid-item"
                    :class="{ 'is-selected': form.icon === item.name }"
                    :title="item.label"
                    @click="selectIcon(item.name)"
                  >
                    <el-icon :size="20" class="item-icon">
                      <component :is="item.comp" />
                    </el-icon>
                    <span class="item-name">{{ item.name }}</span>
                    <span v-if="ICON_LABEL_MAP[item.name]" class="item-cn-sub">
                      {{ ICON_LABEL_MAP[item.name] }}
                    </span>
                    <div v-if="form.icon === item.name" class="check-corner">
                      <el-icon :size="10"><Check /></el-icon>
                    </div>
                  </div>
                </div>

                <div v-if="currentTabIcons.length === 0" class="icon-empty">
                  未找到匹配图标
                </div>
              </div>
            </div>
          </div>
        </el-form-item>

        <!-- 排序与状态 -->
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="排序序号">
              <el-input-number
                v-model="form.order"
                :min="0"
                :max="999"
                style="width: 100%"
                placeholder="请输入排序序号"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-select v-model="form.status" style="width: 100%">
                <el-option label="启用" :value="0" />
                <el-option label="禁用" :value="1" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 备注 -->
        <el-form-item label="备注">
          <el-input v-model="form.remark" />
        </el-form-item>
      </el-form>

      <template #footer>
        <div class="drawer-footer">
          <el-button @click="drawerVisible = false">取消</el-button>
          <el-button type="primary" @click="handleSubmit">保存配置</el-button>
        </div>
      </template>
    </el-drawer>

    <!-- ==================== 资源详情抽屉（查看完整属性与排序序号） ==================== -->
    <el-drawer
      v-model="detailDrawerVisible"
      :title="detailItem ? `资源详情 · ${detailItem.label}` : '资源详情'"
      size="480px"
      destroy-on-close
      class="menu-detail-drawer"
    >
      <div v-if="detailItem" class="detail-container">
        <!-- 头部节点概览 -->
        <div class="detail-header-card">
          <div class="detail-icon-box">
            <el-icon v-if="detailItem.icon && getIconComponent(detailItem.icon)" :size="26">
              <component :is="getIconComponent(detailItem.icon)" />
            </el-icon>
            <el-icon v-else :size="26"><MenuIcon /></el-icon>
          </div>
          <div class="detail-title-info">
            <div class="detail-name">{{ detailItem.label }}</div>
            <div class="detail-tags">
              <el-tag size="small" :type="getNodeTypeTag(detailItem.type).type" effect="light">
                {{ getNodeTypeTag(detailItem.type).label }}
              </el-tag>
              <el-tag size="small" :type="detailItem.status === 0 ? 'success' : 'info'" effect="plain">
                {{ detailItem.status === 0 ? '启用' : '停用' }}
              </el-tag>
            </div>
          </div>
        </div>

        <el-descriptions :column="1" border class="mt-4 detail-descriptions">
          <el-descriptions-item label="排序序号 (order)">
            <el-tag type="primary" effect="dark" class="order-detail-tag">
              #{{ detailItem.order ?? 0 }}
            </el-tag>
            <span class="order-detail-tip text-muted ml-2">（按此序号大小升序排序展示）</span>
          </el-descriptions-item>
          <el-descriptions-item label="ID">
            <code>{{ detailItem.id }}</code>
          </el-descriptions-item>
          <el-descriptions-item label="上级父节点">
            <!-- <code>{{ detailItem.parentId ?? 0 }}</code> -->
            <span class="text-muted ml-2">
              {{ detailItem.parentId === 0 ? '【顶级根目录】' : (allFlatList.find((n) => n.id === detailItem?.parentId)?.label || '') }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="路由地址">
            <code>{{ detailItem.linkAddress || '—' }}</code>
          </el-descriptions-item>
          <el-descriptions-item label="前端组件路径">
            <code>{{ detailItem.componentPath || '—' }}</code>
          </el-descriptions-item>
          <el-descriptions-item label="路由英文名">
            <code>{{ detailItem.routeName || '—' }}</code>
          </el-descriptions-item>
          <el-descriptions-item label="权限标识码">
            <code>{{ detailItem.modelCode || '—' }}</code>
          </el-descriptions-item>
          <el-descriptions-item label="图标名称">
            <code>{{ detailItem.icon || '—' }}</code>
          </el-descriptions-item>
          <el-descriptions-item label="最后更新时间">
            {{ detailItem.updateTime || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="备注说明">
            {{ detailItem.remark || '—' }}
          </el-descriptions-item>
        </el-descriptions>
      </div>

      <template #footer>
        <div class="drawer-footer">
          <el-button @click="detailDrawerVisible = false">关闭</el-button>
          <el-button
            type="primary"
            :icon="Edit"
            @click="detailItem && (handleEdit(detailItem), detailDrawerVisible = false)"
          >
            编辑此资源
          </el-button>
        </div>
      </template>
    </el-drawer>

    <!-- ==================== 老库历史数据诊断对话框 ==================== -->
    <el-dialog
      v-model="diagnosticsVisible"
      title="老库历史遗留数据诊断与清洗"
      width="640px"
      destroy-on-close
    >
      <div class="diag-body">
        <el-alert
          title="检测到历史遗留操作按钮因 res_type=1 导致误上侧栏"
          type="warning"
          :closable="false"
          show-icon
        >
          <template #default>
            系统老版本常量定义中 1 代表按钮，缺少合法的前端路由路径（以 <code>/</code> 开头），被动态菜单服务误当成了一级页面菜单，并在侧栏呈现为齿轮 ⚙️。
          </template>
        </el-alert>

        <div class="diag-list-box">
          <div class="diag-list-header">
            <span>受影响的孤立按钮权限记录 ({{ legacyIssues.length }} 项):</span>
            <span class="text-muted text-xs">建议规范化为 res_type=3 并转移至「用户管理」</span>
          </div>
          <div class="diag-list-items">
            <div v-for="item in legacyIssues" :key="item.id" class="diag-item">
              <span class="diag-item-name">⚙️ {{ item.label }} (ID: {{ item.id }})</span>
              <el-tag size="small" type="warning">res_type: 1 ➔ 应为 3-按钮</el-tag>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="diagnosticsVisible = false">关闭</el-button>
          <el-button type="success" @click="handleCleanLegacy">
            一键规范化转换
          </el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.menu-config-page {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.header-card {
  border-radius: 12px;
}

.header-container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.title-area {
  display: flex;
  align-items: center;
  gap: 12px;
}

.icon-badge {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.main-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.sub-title {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}

.actions-area {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stats-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--el-border-color-lighter);
  flex-wrap: wrap;
}

.stat-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-light);
}

.stat-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.stat-pill.dir .stat-dot { background: #2563eb; }
.stat-pill.menu .stat-dot { background: #16a34a; }
.stat-pill.tab .stat-dot { background: #d97706; }
.stat-pill.button .stat-dot { background: #7c3aed; }

.stat-name {
  color: var(--el-text-color-secondary);
}

.stat-val {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.stat-total {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.table-card {
  border-radius: 12px;
}

.toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}

.filter-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.tree-table-wrapper {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  background: #ffffff;
}

.tree-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  font-size: 13px;
  font-weight: 600;
  color: #475569;
}

.header-name {
  flex: 1;
  min-width: 0;
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}

.meta-col {
  font-size: 13px;
  color: #475569;
}

.col-path {
  flex: 0 0 250px;
  width: 250px;
  text-align: left;
}

.col-order {
  flex: 0 0 60px;
  width: 60px;
  text-align: center;
}

.col-status {
  flex: 0 0 70px;
  width: 70px;
  text-align: center;
}

.col-time {
  flex: 0 0 150px;
  width: 150px;
  text-align: left;
}

.col-ops {
  flex: 0 0 120px;
  width: 120px;
  text-align: center;
}

.tree-body-wrapper {
  min-height: 200px;
  padding: 6px 16px 12px;
}

.menu-tree-container {
  background: transparent;
}

.menu-tree-container :deep(.el-tree-node__content) {
  min-height: 44px;
  height: auto;
  border-radius: 6px;
  margin: 1px 0;
  padding-top: 3px;
  padding-bottom: 3px;
  padding-right: 0 !important;
  transition: all 0.15s ease;
}

.menu-tree-container :deep(.el-tree-node__content:hover) {
  background-color: #f1f5f9;
}

.menu-tree-container :deep(.el-tree-node:focus > .el-tree-node__content) {
  background-color: #f8fafc;
}

.custom-tree-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-right: 0;
}

.node-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.type-tag {
  font-size: 11px;
  padding: 0 6px;
  height: 20px;
  line-height: 18px;
  border-radius: 4px;
  flex-shrink: 0;
}

.node-icon {
  font-size: 15px;
  color: #64748b;
  flex-shrink: 0;
}

.node-label {
  font-size: 13.5px;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: color 0.15s ease;
}

.node-label:hover {
  color: #0284c7;
  text-decoration: underline;
}

.node-label.level-0 {
  font-weight: 700;
  color: #0f172a;
}

.node-label.level-1 {
  font-weight: 600;
  color: #1e293b;
}

.node-label.level-2 {
  font-weight: 500;
  color: #334155;
}

.node-label.level-3 {
  font-weight: 400;
  color: #64748b;
}

.legacy-tag {
  flex-shrink: 0;
}

.node-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}

.meta-path {
  flex: 0 0 250px;
  width: 250px;
  overflow: hidden;
  text-align: left;
  line-height: 1.3;
}

.path-code {
  font-size: 12px;
  font-family: monospace;
  color: #0284c7;
  background: #f0f9ff;
  border: 1px solid #e0f2fe;
  padding: 1px 6px;
  border-radius: 4px;
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-label-box {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.field-sub-tip {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  font-weight: normal;
}

.path-none {
  color: #cbd5e1;
  font-size: 12px;
  padding-left: 2px;
}

.sort-tip-pill {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  color: #0369a1;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  padding: 4px 10px;
  border-radius: 14px;
}

.meta-order {
  flex: 0 0 60px;
  width: 60px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.drag-handle {
  cursor: grab;
  color: #94a3b8;
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border-radius: 4px;
  transition: all 0.2s;
}

.drag-handle:hover {
  color: #0284c7;
  background: #e0f2fe;
}

.drag-handle:active {
  cursor: grabbing;
}

.order-quick-actions {
  display: inline-flex;
  flex-direction: column;
  margin-left: 2px;
}

.order-btn {
  padding: 0 !important;
  height: 12px !important;
  line-height: 12px !important;
  font-size: 12px !important;
  color: #94a3b8 !important;
  border-radius: 2px;
}

.order-btn:hover {
  color: #0284c7 !important;
  background-color: #f0f9ff;
}

.menu-tree-container :deep(.el-tree-node__drop-indicator) {
  height: 2px;
  background-color: #0284c7;
}

.meta-status {
  flex: 0 0 70px;
  width: 70px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.meta-time {
  flex: 0 0 150px;
  width: 150px;
  display: flex;
  align-items: center;
  overflow: hidden;
}

.time-code {
  font-size: 11px;
  color: #94a3b8;
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta-actions {
  flex: 0 0 120px;
  width: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.detail-container {
  padding: 4px 0;
}

.detail-header-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.detail-icon-box {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: #e0f2fe;
  color: #0284c7;
  display: flex;
  align-items: center;
  justify-content: center;
}

.detail-title-info {
  flex: 1;
  min-width: 0;
}

.detail-name {
  font-size: 16px;
  font-weight: 600;
  color: #0f172a;
}

.detail-tags {
  margin-top: 4px;
  display: flex;
  gap: 6px;
}

.order-detail-tag {
  font-size: 13px;
  font-weight: 700;
  font-family: monospace;
}

.order-detail-tip {
  font-size: 12px;
}

.meta-actions :deep(.el-button) {
  margin: 0 !important;
}

.meta-actions :deep(.el-button + .el-button) {
  margin-left: 0 !important;
}

.op-icon-btn {
  padding: 4px !important;
  font-size: 15px !important;
  margin: 0 !important;
  height: 26px !important;
  width: 26px !important;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.op-icon-btn:hover {
  background-color: #e0f2fe;
}

.op-del-btn:hover {
  background-color: #fee2e2 !important;
}

.text-muted {
  color: var(--el-text-color-placeholder);
}

.type-option-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.type-option-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.tree-select-node-item {
  display: flex;
  align-items: center;
  font-size: 13px;
  line-height: 24px;
}

.tree-select-node-item .select-icon {
  font-size: 14px;
  color: #64748b;
  margin-right: 4px;
}

.tree-select-node-item .select-text {
  color: #1e293b;
}

/* 菜单图标选择器样式 */
.icon-selector-card {
  width: 100%;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
  overflow: hidden;
}

.icon-current-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.preview-box {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  border: 1px dashed var(--el-border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-placeholder);
  flex-shrink: 0;
}

.preview-box.has-icon {
  border-style: solid;
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.preview-empty {
  font-size: 11px;
}

.preview-info {
  flex: 1;
  min-width: 0;
}

.preview-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-color-primary);
}

.icon-name {
  font-family: monospace;
}

.icon-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-weight: normal;
}

.preview-none {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.preview-tip {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}

.icon-picker-panel {
  padding: 12px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.panel-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-regular);
}

.icon-category-tabs {
  margin-bottom: 6px;
}

.icon-category-tabs :deep(.el-tabs__header) {
  margin: 0 0 8px 0;
}

.icon-category-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
}

.icon-category-tabs :deep(.el-tabs__item) {
  padding: 0 8px;
  font-size: 12px;
  height: 30px;
  line-height: 30px;
}

.cat-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.cat-count {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  font-weight: normal;
}

.icon-category-tabs :deep(.el-tabs__item.is-active) .cat-count {
  color: var(--el-color-primary);
  font-weight: 600;
}

.icon-grid-scroll {
  max-height: 260px;
  overflow-y: auto;
  padding-right: 4px;
}

.icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
  gap: 8px;
}

.icon-grid-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8px 4px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  cursor: pointer;
  background: var(--el-fill-color-blank);
  transition: all 0.2s ease;
  min-height: 58px;
}

.icon-grid-item:hover {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-fill-color-light);
  transform: translateY(-1px);
}

.icon-grid-item.is-selected {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 500;
}

.item-icon {
  margin-bottom: 4px;
  color: var(--el-text-color-primary);
}

.icon-grid-item.is-selected .item-icon {
  color: var(--el-color-primary);
}

.item-name {
  font-size: 11px;
  color: var(--el-text-color-regular);
  text-align: center;
  line-height: 1.2;
  word-break: break-all;
  max-width: 100%;
}

.item-cn-sub {
  font-size: 10px;
  color: var(--el-text-color-secondary);
  margin-top: 1px;
  text-align: center;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.icon-grid-item.is-selected .item-name,
.icon-grid-item.is-selected .item-cn-sub {
  color: var(--el-color-primary);
}

.check-corner {
  position: absolute;
  top: 0;
  right: 0;
  width: 16px;
  height: 16px;
  background: var(--el-color-primary);
  color: #fff;
  border-bottom-left-radius: 6px;
  border-top-right-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-empty {
  text-align: center;
  padding: 24px 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.diag-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.diag-list-box {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  overflow: hidden;
}

.diag-list-header {
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  font-size: 12px;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.diag-list-items {
  max-height: 240px;
  overflow-y: auto;
  divide-y: 1px solid var(--el-border-color-lighter);
}

.diag-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.diag-item:last-child {
  border-bottom: none;
}

.preview-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 16px;
  line-height: 1.5;
}
</style>
