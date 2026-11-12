// 菜单配置组件单元测试
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import MenuConfigView from './index.vue'
import * as sysMenuApi from '@/api/sysMenuConfig'

const MOCK_MENU_TREE: sysMenuApi.SysMenuTreeNode[] = [
  {
    id: 1000,
    parentId: 0,
    label: '首页',
    type: 0,
    linkAddress: '',
    modelCode: 'group:home',
    icon: 'HomeFilled',
    order: 1,
    status: 0,
    children: [
      {
        id: 1100,
        parentId: 1000,
        label: '采集资产总览',
        type: 1,
        linkAddress: '/overview',
        modelCode: 'overview',
        icon: 'Odometer',
        order: 1,
        status: 0,
        componentPath: 'views/Overview/index.vue',
        routeName: 'Overview',
        updateTime: '2026-11-05 21:05:37',
        children: [],
      },
    ],
  },
  {
    id: 8000,
    parentId: 0,
    label: '系统管理',
    type: 0,
    linkAddress: '',
    modelCode: 'group:settings',
    icon: 'Setting',
    order: 8,
    status: 0,
    children: [
      {
        id: 8300,
        parentId: 8000,
        label: '菜单配置',
        type: 1,
        linkAddress: '/menu-config',
        modelCode: 'menu-config',
        icon: 'Menu',
        order: 3,
        status: 0,
        children: [
          {
            id: 8301,
            parentId: 8300,
            label: '菜单树查询',
            type: 3,
            linkAddress: '',
            modelCode: 'sys:menu:list',
            icon: '',
            order: 1,
            status: 0,
            children: [],
          },
        ],
      },
    ],
  },
  {
    id: 900,
    parentId: 0,
    label: '用户管理 (老库残留)',
    type: 0,
    linkAddress: '',
    modelCode: 'legacy:users',
    icon: 'Setting',
    order: 9,
    status: 0,
    children: [
      {
        id: 901,
        parentId: 900,
        label: '用户导出',
        type: 1,
        linkAddress: '',
        modelCode: 'sys:user:export',
        icon: '',
        order: 1,
        status: 0,
        componentPath: 'views/Overview/index.vue',
        routeName: 'Overview',
        updateTime: '2026-11-05 21:05:37',
        children: [],
      },
    ],
  },
]

describe('MenuConfigView (菜单配置与资源管理中心)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const pinia = createPinia()
    setActivePinia(pinia)
    vi.spyOn(sysMenuApi, 'getMenuTree').mockResolvedValue(JSON.parse(JSON.stringify(MOCK_MENU_TREE)))
    vi.spyOn(sysMenuApi, 'saveMenu').mockResolvedValue()
    vi.spyOn(sysMenuApi, 'deleteMenu').mockResolvedValue()
    vi.spyOn(sysMenuApi, 'cleanLegacyButtons').mockResolvedValue({ updatedCount: 1, message: '清洗成功' })
    vi.spyOn(sysMenuApi, 'updateMenuSort').mockResolvedValue()
  })

  it('正确加载并渲染资源树与统计卡片', async () => {
    const wrapper = mount(MenuConfigView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('菜单配置与资源管理中心')
    expect(wrapper.text()).toContain('首页')
    expect(wrapper.text()).toContain('采集资产总览')
    expect(wrapper.text()).toContain('菜单配置')
    expect(wrapper.text()).toContain('菜单树查询')

    // 统计胶囊
    expect(wrapper.find('.stat-pill.dir .stat-val').text()).toBe('3') // 1000, 8000, 900
    expect(wrapper.find('.stat-pill.menu .stat-val').text()).toBe('3') // 1100, 8300, 901
    expect(wrapper.find('.stat-pill.button .stat-val').text()).toBe('1') // 8301
  })

  it('展示老库脏数据异常胶囊并能打开自检弹窗', async () => {
    const wrapper = mount(MenuConfigView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    const issueBtn = wrapper.find('.issue-btn')
    expect(issueBtn.exists()).toBe(true)
    expect(issueBtn.text()).toContain('老库脏数据自检')

    await issueBtn.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('受影响的孤立按钮权限记录')
    expect(wrapper.text()).toContain('用户导出')
  })

  it('一键规范化转换老库脏数据', async () => {
    const wrapper = mount(MenuConfigView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    await wrapper.find('.issue-btn').trigger('click')
    await flushPromises()

    const fixBtn = wrapper.findAll('button').find((b) => b.text().includes('一键规范化转换'))
    expect(fixBtn).toBeDefined()
    await fixBtn!.trigger('click')
    await flushPromises()

    expect(sysMenuApi.cleanLegacyButtons).toHaveBeenCalledTimes(1)
    expect(sysMenuApi.getMenuTree).toHaveBeenCalledTimes(2) // 重新拉取
  })

  it('点击「新建顶级目录」打开抽屉并初始化表单', async () => {
    const wrapper = mount(MenuConfigView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    const addRootBtn = wrapper.findAll('button').find((b) => b.text().includes('新建顶级目录'))
    expect(addRootBtn).toBeDefined()
    await addRootBtn!.trigger('click')
    await flushPromises()

    expect(wrapper.find('.menu-edit-drawer').exists()).toBe(true)
    expect(wrapper.text()).toContain('新建顶级分组目录')
  })

  it('点击「实时侧栏预览」打开侧栏模拟抽屉', async () => {
    const wrapper = mount(MenuConfigView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    const previewBtn = wrapper.findAll('button').find((b) => b.text().includes('实时侧栏预览'))
    expect(previewBtn).toBeDefined()
    await previewBtn!.trigger('click')
    await flushPromises()

    expect(wrapper.find('.sidebar-preview-drawer').exists()).toBe(true)
    expect(wrapper.text()).toContain('侧栏导航实时预览')
  })

  it('操作列仅展示纯图标按钮，不展示冗余文字，且带有 aria-label', async () => {
    const wrapper = mount(MenuConfigView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    const opActions = wrapper.find('.meta-actions')
    expect(opActions.exists()).toBe(true)

    // 操作列内仅包含纯图标按钮，按钮内无多余中文字符
    const iconButtons = opActions.findAll('.op-icon-btn')
    expect(iconButtons.length).toBeGreaterThan(0)
    for (const btn of iconButtons) {
      expect(btn.text().trim()).toBe('')
    }
  })

  it('编辑页面中上级节点使用 el-tree-select 树形层级组件呈现', async () => {
    const wrapper = mount(MenuConfigView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    const addRootBtn = wrapper.findAll('button').find((b) => b.text().includes('新建顶级目录'))
    await addRootBtn!.trigger('click')
    await flushPromises()

    // 存在 el-tree-select 组件
    const treeSelect = wrapper.findComponent({ name: 'ElTreeSelect' })
    expect(treeSelect.exists()).toBe(true)

    // 树形数据中包含【顶级根目录】
    const treeData = (treeSelect.props('data') as Array<{ id: number; label: string }>)
    expect(treeData).toBeDefined()
    expect(treeData[0].id).toBe(0)
    expect(treeData[0].label).toContain('顶级根目录')
  })

  it('编辑页面中图标选择器包含 Element Plus 全量官方图标且支持搜索和点选', async () => {
    const wrapper = mount(MenuConfigView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    const addRootBtn = wrapper.findAll('button').find((b) => b.text().includes('新建顶级目录'))
    await addRootBtn!.trigger('click')
    await flushPromises()

    // 包含图标选择面板与全量图标库标题
    expect(wrapper.text()).toContain('Element Plus 全量图标库')
    
    // 渲染了超过 200 个 Element Plus 图标组件
    const iconItems = wrapper.findAll('.icon-grid-item')
    expect(iconItems.length).toBeGreaterThan(200)

    // 点击某图标项能选中
    const firstIcon = iconItems[0]
    await firstIcon.trigger('click')
    await flushPromises()

    // 清空图标
    const clearBtn = wrapper.findAll('button').find((b) => b.text().includes('清空'))
    if (clearBtn) {
      await clearBtn.trigger('click')
      await flushPromises()
    }
  })

  it('编辑页面中图标库支持分组 Tab 页展示且可切换分类', async () => {
    const wrapper = mount(MenuConfigView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    const addRootBtn = wrapper.findAll('button').find((b) => b.text().includes('新建顶级目录'))
    await addRootBtn!.trigger('click')
    await flushPromises()

    // 存在分类 tabs
    const categoryTabs = wrapper.find('.icon-category-tabs')
    expect(categoryTabs.exists()).toBe(true)

    // 包含各类分组名称
    const tabTexts = categoryTabs.text()
    expect(tabTexts).toContain('全部')
    expect(tabTexts).toContain('系统操作')
    expect(tabTexts).toContain('数据图表')
    expect(tabTexts).toContain('文档资产')
    expect(tabTexts).toContain('媒体设备')
    expect(tabTexts).toContain('方向位置')
    expect(tabTexts).toContain('通用生活')

    // 切换到「数据图表」Tab
    const dataTab = categoryTabs.findAll('.el-tabs__item').find((t) => t.text().includes('数据图表'))
    expect(dataTab).toBeDefined()
    await dataTab!.trigger('click')
    await flushPromises()

    // 切换后图标数量精简为该分组下的图标
    const dataIconItems = wrapper.findAll('.icon-grid-item')
    expect(dataIconItems.length).toBeLessThan(50)
    expect(dataIconItems.length).toBeGreaterThan(0)
  })

  it('资源树列表不展示前端组件文件路径，仅展示路由地址与自动更新时间', async () => {
    const wrapper = mount(MenuConfigView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    // 列表保持清爽：树行不再展示组件文件路径（只在详情/编辑抽屉中查看）
    expect(wrapper.find('.path-component').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('views/Overview/index.vue')
    // 路由地址与更新时间仍正常展示
    expect(wrapper.text()).toContain('/overview')
    expect(wrapper.text()).toContain('2026-11-05 21:05:37')
  })

  it('详情抽屉与编辑抽屉仍可查看/配置 component_path 与 route_name', async () => {
    const wrapper = mount(MenuConfigView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    // 点击节点名称（采集资产总览，type === 1）打开详情抽屉
    const nodeLabel = wrapper.findAll('.node-label').find((n) => n.text() === '采集资产总览')
    expect(nodeLabel).toBeDefined()
    await nodeLabel!.trigger('click')
    await flushPromises()

    const detailDrawer = wrapper.find('.menu-detail-drawer')
    expect(detailDrawer.exists()).toBe(true)
    expect(detailDrawer.text()).toContain('前端组件路径')
    expect(detailDrawer.text()).toContain('views/Overview/index.vue')
    expect(detailDrawer.text()).toContain('路由英文名')
    expect(detailDrawer.text()).toContain('Overview')

    // 点击某菜单的「编辑」按钮 (type === 1)，编辑抽屉仍保留组件文件路径与路由英文名配置项
    const editBtn = wrapper.findAll('.op-icon-btn').find((b) => b.attributes('aria-label') === '编辑资源')
    expect(editBtn).toBeDefined()
    await editBtn!.trigger('click')
    await flushPromises()

    const editDrawer = wrapper.find('.menu-edit-drawer')
    expect(editDrawer.exists()).toBe(true)
    expect(editDrawer.text()).toContain('组件文件路径')
    expect(editDrawer.text()).toContain('路由英文名')
  })

  it('全层级严格按照 order 从小到大升序排序展示 (同 order 按 id 排序)', async () => {
    const unorderedData: sysMenuApi.SysMenuTreeNode[] = [
      {
        id: 200,
        parentId: 0,
        label: '后位目录(Order 20)',
        type: 0,
        order: 20,
        status: 0,
        children: [
          { id: 202, parentId: 200, label: '子项2(Order 50)', type: 1, order: 50, status: 0 },
          { id: 201, parentId: 200, label: '子项1(Order 10)', type: 1, order: 10, status: 0 },
        ],
      },
      {
        id: 100,
        parentId: 0,
        label: '先位目录(Order 5)',
        type: 0,
        order: 5,
        status: 0,
        children: [],
      },
    ]
    vi.spyOn(sysMenuApi, 'getMenuTree').mockResolvedValue(unorderedData)
    const wrapper = mount(MenuConfigView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    const text = wrapper.text()
    const firstRootIdx = text.indexOf('先位目录(Order 5)')
    const secondRootIdx = text.indexOf('后位目录(Order 20)')
    expect(firstRootIdx).toBeGreaterThan(-1)
    expect(secondRootIdx).toBeGreaterThan(-1)
    expect(firstRootIdx).toBeLessThan(secondRootIdx)

    const child1Idx = text.indexOf('子项1(Order 10)')
    const child2Idx = text.indexOf('子项2(Order 50)')
    expect(child1Idx).toBeGreaterThan(-1)
    expect(child2Idx).toBeGreaterThan(-1)
    expect(child1Idx).toBeLessThan(child2Idx)
  })

  it('el-tree 支持 draggable 属性，树列表不展示序号（放详情中），并正确配置拖拽规则约束与拖拽抓手', async () => {
    const wrapper = mount(MenuConfigView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    const tree = wrapper.findComponent({ name: 'ElTree' })
    expect(tree.exists()).toBe(true)
    expect(tree.props('draggable')).toBe(true)

    // 列表保持清爽：树节点列表不显示序号徽标（序号放详情中）
    expect(wrapper.find('.order-badge').exists()).toBe(false)

    // 检验拖拽抓手展示
    const dragHandles = wrapper.findAll('.drag-handle')
    expect(dragHandles.length).toBeGreaterThan(0)

    // 验证 allow-drop 规则函数
    const allowDropFn = tree.props('allowDrop') as (
      dragNode: any,
      dropNode: any,
      type: 'prev' | 'inner' | 'next'
    ) => boolean
    expect(allowDropFn).toBeDefined()

    // 1) 按钮(type=3)作为目标节点时，不允许拖入其内部(inner)
    const buttonNode = { data: { id: 8301, type: 3, parentId: 8300 } }
    const menuNode = { data: { id: 8302, type: 1, parentId: 8300 } }
    expect(allowDropFn(menuNode, buttonNode, 'inner')).toBe(false)

    // 2) 顶级目录(type=0)不能作为子级拖入其他节点内部(inner)
    const rootDirNode = { data: { id: 1000, type: 0, parentId: 0 } }
    const otherDirNode = { data: { id: 8000, type: 0, parentId: 0 } }
    expect(allowDropFn(rootDirNode, otherDirNode, 'inner')).toBe(false)

    // 3) 顶级目录(type=0)不能放置在非顶级节点的前后
    const subMenuNode = { data: { id: 1100, type: 1, parentId: 1000 } }
    expect(allowDropFn(rootDirNode, subMenuNode, 'next')).toBe(false)

    // 4) 顶级目录之间允许前后排序
    expect(allowDropFn(rootDirNode, otherDirNode, 'next')).toBe(true)
  })

  it('点击查看详情按钮或点击节点名称，在详情抽屉中展示排序序号与完整属性', async () => {
    const wrapper = mount(MenuConfigView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    // 找到首个「查看详情」图标按钮
    const viewBtn = wrapper.findAll('.op-icon-btn').find((b) => b.attributes('aria-label') === '查看详情')
    expect(viewBtn).toBeDefined()
    await viewBtn!.trigger('click')
    await flushPromises()

    // 详情抽屉展开
    expect(wrapper.find('.menu-detail-drawer').exists()).toBe(true)
    // 详情中明确展示排序序号
    expect(wrapper.text()).toContain('排序序号 (order)')
    const orderDetailTag = wrapper.find('.order-detail-tag')
    expect(orderDetailTag.exists()).toBe(true)
    expect(orderDetailTag.text()).toContain('#1')
  })

  it('快捷上移与下移调序能计算并调用 updateMenuSort 持久化', async () => {
    const wrapper = mount(MenuConfigView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    // 获取所有下移按钮
    const downButtons = wrapper.findAll('.order-btn[aria-label="下移"]')
    expect(downButtons.length).toBeGreaterThan(0)

    // 点击第一个根节点的下移按钮
    await downButtons[0].trigger('click')
    await flushPromises()

    // 校验调用了 updateMenuSort
    expect(sysMenuApi.updateMenuSort).toHaveBeenCalled()
    const callArgs = (sysMenuApi.updateMenuSort as any).mock.calls[0][0]
    expect(callArgs.length).toBeGreaterThan(1)
    expect(callArgs[0]).toHaveProperty('order')
    expect(callArgs[0]).toHaveProperty('id')
  })

  it('拖拽完成 handleNodeDrop 能触发 updateMenuSort 接口并完成重排', async () => {
    const wrapper = mount(MenuConfigView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    const tree = wrapper.findComponent({ name: 'ElTree' })
    const draggingNode = { data: { id: 1000, parentId: 0, order: 1 } }
    const dropNode = {
      data: { id: 8000, parentId: 0, order: 2 },
      parent: {
        childNodes: [
          { data: { id: 8000, parentId: 0, order: 2 } },
          { data: { id: 1000, parentId: 0, order: 1 } },
        ],
      },
    }

    tree.vm.$emit('node-drop', draggingNode, dropNode, 'after', new Event('drop'))
    await flushPromises()

    expect(sysMenuApi.updateMenuSort).toHaveBeenCalled()
  })
})
