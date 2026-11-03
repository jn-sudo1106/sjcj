// @vitest-environment jsdom
// 流程中心（0828 W6）。核心口径 §2.11：**节点就是配置**——
// 配置只作为搜索的输入，结果永远是流程列表；不出现「配置列表」这一屏。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import FlowCenter from './index.vue'
import { configApi, entryApi, flowCenterApi, flowVersionApi, itemApi, paramApi, sourceApi, workflowBindingApi, type FlowRecord, type SourceCategory } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { useNodeStore } from '@/stores/node'
import { useUiStore } from '@/stores/ui'
import { makeStructureTemplate } from '@/utils/flow/flowTemplates'

const FLOWS: FlowRecord[] = [
  {
    id: 'flow-10086', name: '新闻采集标准流程', version: 1, updatedAt: '2026-08-28 14:32',
    definition: {
      main: ['start', 'web-list', 'web-detail', 'end'], branches: [],
      configs: {
        'web-list': { title: '列表页', sub: '[90] 网页抓取', status: '', planned: false, base: [], fields: [], inmap: [], params: [], output: [], configId: '1400774', collectCfg: { snatchType: '[90] - 网页抓取', url: '', outputTable: '2103330', inputTable: '', inputParams: [] }, taskCfg: { queue: 'q-list', urlRule: '' } },
        'web-detail': { title: '详情页', sub: '[90] 网页抓取', status: '', planned: false, base: [], fields: [], inmap: [], params: [], output: [], configId: '1400765', collectCfg: { snatchType: '[90] - 网页抓取', url: '', outputTable: '2103331', inputTable: '2103330', inputParams: [] }, taskCfg: { queue: '', urlRule: '' } },
      },
    },
  } as unknown as FlowRecord,
  {
    id: 'flow-10012', name: '微信文章清洗流程', version: 2, updatedAt: '2026-08-20 15:03',
    definition: { main: ['start', 'web-list', 'end'], branches: [], configs: { 'web-list': { title: '公众号解析', sub: '[90] 网页抓取', status: '', planned: false, base: [], fields: [], inmap: [], params: [], output: [], configId: '1400321', collectCfg: { snatchType: '[90] - 网页抓取', url: '', outputTable: '', inputTable: '', inputParams: [] } } } },
  } as unknown as FlowRecord,
]

// 用例结束要**把组件卸掉**（2026-09-12）。原先只清 mock，48 个用例挂出来的实例全留在
// document 上越堆越多；弹层走 teleport 挂到 body，实例一多就互相干扰——全量跑时
// 「名称为空不发请求」（靠后的用例）等 5 秒都等不到新建表单，而单跑这个文件 48/48 全过。
// 同一套清理 SqlConditionEditor.test.ts 里早就有了。
const mountedWrappers: { unmount: () => void }[] = []
afterEach(() => {
  mountedWrappers.splice(0).forEach((w) => w.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/**
 * 打开「新建流程」小表单，并**等它真的挂上**。
 *
 * fireAction 之后只 flushPromises 是不够的：那只刷微任务，而表单在弹层里由 Element Plus
 * 异步渲染。单跑这个文件通常已经挂好，全量跑（多 worker 抢 CPU）就会扑空，
 * 报 `Unable to get [data-testid="create-flow-name"]`——看着像组件坏了，其实只是没等够
 * （2026-09-12 实测：单跑 48/48 全过，全量跑偶发这一条）。
 */
async function openCreateForm(w: { find: (s: string) => { exists: () => boolean } }) {
  useUiStore().fireAction('新建流程')
  await flushPromises()
  await vi.waitFor(() => {
    if (!w.find('[data-testid="create-flow-name"]').exists()) throw new Error('新建流程表单还没挂上')
  }, { timeout: 5000, interval: 20 })
  await (w as Awaited<ReturnType<typeof mountCenter>>).get('[data-testid="create-flow-template"]').setValue('template-1')
}

async function mountCenter(flows: FlowRecord[] = FLOWS, total = flows.length, query?: Record<string, string>, realBoard = false) {
  vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total, list: flows })
  if (!vi.isMockFunction(flowCenterApi.templateGroups)) vi.spyOn(flowCenterApi, 'templateGroups').mockResolvedValue([
    { id: 'template-1', name: '单节点采集', flowCount: total, structure: '采集', disabled: false },
    { id: 'unassigned', name: '未归类', flowCount: 0, structure: '尚未选择流程模板', disabled: false },
  ])
  if (!vi.isMockFunction(flowCenterApi.templates)) vi.spyOn(flowCenterApi, 'templates').mockResolvedValue([{ id: 'template-1', name: '单节点采集', isTemplate: true, definition: makeStructureTemplate(['web-list']), updatedAt: '' }])
  if (!vi.isMockFunction(workflowBindingApi.ensureDraft)) {
    vi.spyOn(workflowBindingApi, 'ensureDraft').mockImplementation(async (workflowId) => ({
      id: `binding-${workflowId}`, bindType: 'SOURCE', bindId: '', workflowId,
      workflowCode: `LEGACY-${workflowId}`, workflowName: '流程', publishedVersionNo: 1,
      publishedFlowId: workflowId, draftVersionNo: 2, draftFlowId: workflowId,
      versionStatus: 'DRAFT', workflowStatus: 'ACTIVE', followsCurrentVersion: true,
      role: 'MAIN', primary: true, priority: 0, status: 'ACTIVE', inherited: false,
    }))
  }
  // 分类目录在测试里必须可预期：sourceCategories 走 live 端点（category/categoryPaged），
  // 测试环境下 fetch 失败会把分类吞成空列表。这里给一棵两级树覆盖（按 parentId 查任意层级的子级）。
  vi.spyOn(sourceApi, 'sourceCategories').mockImplementation(async (parentId?: string) => {
    const tree: SourceCategory[] = [
      { id: 'c1', name: '财经', children: [{ id: 'c1-1', name: '公告' }, { id: 'c1-2', name: '行情' }] },
      { id: 'c2', name: '舆情', children: [{ id: 'c2-1', name: '微博' }] },
    ]
    if (!parentId) return tree
    const findChildren = (nodes: SourceCategory[]): SourceCategory[] =>
      nodes.flatMap((n) => (n.id === parentId ? (n.children ?? []) : findChildren(n.children ?? [])))
    return findChildren(tree)
  })
  // 0927：抽屉**常驻**（FlowDetailDrawer 一直挂着，:flow="activeFlow"）——「新建流程保存」
  // 「列表整页换掉」等场景会 via replaceFlow 改 activeFlow，抽屉随之打开并拉详情+步骤快照。
  // 不 mock 的话这条链走真实 120ms mock 通道，在**下一个用例**里才落地：晚到的快照会重建
  // 画布甚至触发重渲染，把新建表单弹层的挂载窗口搅乱（历史 flake「名称为空不发请求」同源，
  // 0927 实测把细节/步骤补成即时 resolve 后该组用例稳定）。需要特殊行为的用例
  // （详情取不到 / 快照失败 / 自定义步骤）在自身用例里**先 spyOn 覆盖**——这里用
  // isMockFunction 让路，不覆盖用例自己已装的桩（vi.spyOn 后到者胜）。
  if (!vi.isMockFunction(flowCenterApi.detail)) {
    vi.spyOn(flowCenterApi, 'detail').mockImplementation(async id => id === 'template-1' ? ({ id, name: '单节点采集', isTemplate: true, definition: makeStructureTemplate(['web-list']), updatedAt: '' }) : FLOWS[0])
  }
  if (!vi.isMockFunction(flowCenterApi.steps)) {
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
  }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/flows', component: { template: '<div/>' } }, { path: '/rules', component: { template: '<div/>' } }, { path: '/canvas', component: { template: '<div/>' } }] })
  await router.push({ path: '/flows', query }); await router.isReady()
  const pinia = createPinia(); setActivePinia(pinia)
  const wrapper = mount(FlowCenter, {
    global: {
      plugins: [pinia, router, ElementPlus],
      directives: { loading: {} },
      stubs: {
        FlowBoard: realBoard ? false : { props: ['embedded'], template: '<div data-testid="embedded-flow-board">流程画布</div>' },
        NodeInspector: realBoard ? false : { props: ['hideAi'], template: '<div data-testid="embedded-node-inspector">节点配置 表配置 编排配置 任务配置</div>' },
        // 选源弹窗：真组件在 FlowSourcePickerDialog.test.ts 单独测。这里只关心 confirmApply
        // 的分批 / changeFlowBatch / 错误处理，stub 出「设 modelValue + 触发 confirm」两个口子。
        FlowSourcePickerDialog: {
          props: { flow: { default: null }, modelValue: { type: Array, default: () => [] }, submitting: Boolean, progress: String },
          emits: ['update:modelValue', 'confirm', 'close'],
          template: '<div v-if="flow">'
            + '<input data-testid="source-select-stub" :value="modelValue.join(\',\')" @input="$emit(\'update:modelValue\', $event.target.value.split(\',\').filter(Boolean))" />'
            + '<button data-testid="flow-apply-confirm" @click="$emit(\'confirm\')">确认关联</button>'
            + '</div>',
        },
        'el-dialog': { props: ['modelValue'], template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>' },
        // 装了 ElementPlus 插件后 el-pagination 解析成真组件，prop 不再以 attribute 落在
        // DOM 上（「绑定后端总数与页大小」那条用 attributes() 断言）。stub 成透明元素保持原断言。
        'el-pagination': {
          props: ['total', 'pageSize', 'pageSizes'],
          template: '<div data-testid="flow-center-pagination" :total="total" :page-size="pageSize" :page-sizes="(pageSizes || []).join(\',\')" />',
        },
      },
    },
  })
  await flushPromises()
  mountedWrappers.push(wrapper)
  return wrapper
}
const rows = (w: Awaited<ReturnType<typeof mountCenter>>) => w.findAll('[data-testid="flow-center-row"]')
const search = (w: Awaited<ReturnType<typeof mountCenter>>) => w.get('[data-testid="flow-center-search"]')

describe('流程中心 · 列表', () => {
  it('列出流程', async () => {
    const w = await mountCenter()
    expect(rows(w).length).toBe(2)
    expect(rows(w)[0].text()).toContain('新闻采集标准流程')
  })

  it('使用源数取后端计算列 sourceCnt；缺这个字段才显示 —', async () => {
    const w = await mountCenter([
      { ...FLOWS[0], sourceCnt: 12 },
      { ...FLOWS[1], sourceCnt: undefined },
    ])
    const cells = w.findAll('[data-testid="flow-source-cnt"]')
    expect(cells[0].text()).toBe('12 个')
    expect(cells[1].text()).toBe('—')
  })

  // 1030 会议议题 2：节点数按流程逐条读步骤计数（svg 视图），失败显示 —
  it('节点数列：按流程读步骤计数，读取失败显示 —', async () => {
    vi.spyOn(flowCenterApi, 'steps').mockImplementation(async (flowId: string) => {
      if (flowId === FLOWS[1].id) throw new Error('超时')
      return [{}, {}, {}] as never
    })
    const w = await mountCenter()
    await flushPromises()
    const cells = w.findAll('[data-testid="flow-node-cnt"]')
    expect(cells[0].text()).toBe('3')
    expect(cells[1].text()).toBe('—')
    expect(cells[1].attributes('title')).toContain('读取失败')
  })

  it('结构模板的节点数来自画布定义，完整流程模板仍按实际步骤计数', async () => {
    const structure = { ...FLOWS[0]!, id: 'structure-template', isTemplate: true, definition: makeStructureTemplate(['web-list', 'web-detail', 'file-download']) }
    const full = { ...FLOWS[1]!, isTemplate: true }
    const detail = vi.spyOn(flowCenterApi, 'detail').mockImplementation(async id => id === structure.id ? structure : full)
    const steps = vi.spyOn(flowCenterApi, 'steps').mockImplementation(async id =>
      id === structure.id ? [{ isRoot: true }] as never : [{ isRoot: true, configId: '100' }, {}] as never)
    const emptyDefinition = { main: [], branches: [], configs: {} }
    const w = await mountCenter([
      { ...structure, definition: emptyDefinition },
      { ...full, definition: emptyDefinition },
    ])
    await flushPromises()
    expect(w.findAll('[data-testid="flow-node-cnt"]').map(cell => cell.text())).toEqual(['3', '2'])
    expect(detail.mock.calls.map(([id]) => id)).toEqual([structure.id])
    expect(steps.mock.calls.map(([id]) => id)).toEqual([structure.id, full.id])
  })

  it('有 IntersectionObserver 时节点数只读进入视口的行', async () => {
    let callback!: IntersectionObserverCallback
    const observed: Element[] = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: IntersectionObserverCallback) { callback = cb }
      observe(el: Element) { observed.push(el) }
      unobserve() {}
      disconnect() {}
    })
    try {
      const steps = vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([{}, {}] as never)
      const w = await mountCenter()
      await flushPromises()
      expect(steps).not.toHaveBeenCalled()
      callback([{ target: observed[1], isIntersecting: true }] as never, {} as IntersectionObserver)
      await flushPromises()
      expect(steps.mock.calls.map((c) => c[0])).toEqual([FLOWS[1].id])
      const cells = w.findAll('[data-testid="flow-node-cnt"]')
      expect(cells[0].text()).toBe('…')
      expect(cells[1].text()).toBe('2')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // 1030 会议议题 8：节点配置 ID 反查流程，再按流程 ID 查列表；查不到给出说明
  it('按节点配置 ID 筛选：反查到的流程 ID 交给 flowPaged；没有命中时不查列表并提示', async () => {
    const byConfig = vi.spyOn(flowCenterApi, 'flowIdsByConfig').mockResolvedValueOnce([FLOWS[0].id]).mockResolvedValueOnce([])
    const w = await mountCenter()
    const paged = vi.mocked(flowCenterApi.paged)
    await w.get('[data-testid="flow-center-config"]').setValue('1401069')
    await w.get('[data-testid="flow-center-query"]').trigger('click')
    await flushPromises()
    expect(byConfig).toHaveBeenCalledWith('1401069')
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ flowIds: [FLOWS[0].id] }))

    paged.mockClear()
    await w.get('[data-testid="flow-center-config"]').setValue('999')
    await w.get('[data-testid="flow-center-query"]').trigger('click')
    await flushPromises()
    expect(paged).not.toHaveBeenCalled()
    expect(w.text()).toContain('没有已发布的流程用到配置 999')
  })

  // flowPaged 收到空 flowIds 会退回不限：交集为空必须直接给空表
  it('配置反查结果与搜索框流程 ID 没有交集时不查列表', async () => {
    const byConfig = vi.spyOn(flowCenterApi, 'flowIdsByConfig').mockResolvedValue(['10086'])
    const w = await mountCenter()
    const paged = vi.mocked(flowCenterApi.paged)
    paged.mockClear()
    await w.get('[data-testid="flow-center-config"]').setValue('1401069')
    await w.get('input[placeholder^="流程 ID"]').setValue('10012')
    await w.get('[data-testid="flow-center-query"]').trigger('click')
    await flushPromises()
    expect(paged).not.toHaveBeenCalled()
    expect(w.findAll('[data-testid="flow-node-cnt"]')).toHaveLength(0)

    await w.get('input[placeholder^="流程 ID"]').setValue('')
    await w.get('[data-testid="flow-center-query"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ flowIds: ['10086'] }))
    // 点查询会重新反查（流程可能刚发布）
    expect(byConfig).toHaveBeenCalledTimes(2)
  })

  it('配置 ID 只改输入框不点查询时，翻页仍按上次条件，不反查', async () => {
    const byConfig = vi.spyOn(flowCenterApi, 'flowIdsByConfig').mockResolvedValue(['10086'])
    const w = await mountCenter()
    const paged = vi.mocked(flowCenterApi.paged)
    paged.mockClear()
    await w.get('[data-testid="flow-center-config"]').setValue('1401069')
    // 测试里 el-pagination 没注册成组件，@current-change 落在元素的原生事件上
    await w.get('[data-testid="flow-center-pagination"]').trigger('current-change')
    await flushPromises()
    expect(byConfig).not.toHaveBeenCalled()
    expect(paged).toHaveBeenLastCalledWith(expect.not.objectContaining({ flowIds: expect.anything() }))
  })

  // 0 个 / 字段缺失都不做成可点：点开必然是空表
  it('只有源数大于 0 才可点下钻', async () => {
    const w = await mountCenter([
      { ...FLOWS[0], sourceCnt: 12 },
      { ...FLOWS[1], sourceCnt: 0 },
    ])
    const cells = w.findAll('[data-testid="flow-source-cnt"]')
    expect(cells[0].find('[data-testid="flow-source-cnt-link"]').exists()).toBe(true)
    expect(cells[1].find('[data-testid="flow-source-cnt-link"]').exists()).toBe(false)
    expect(cells[1].text()).toBe('0 个')
  })

  it('点使用源数按 flowId 拉该流程的源，且不会顺带打开工作区', async () => {
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 1,
      list: [{ sourceId: 'src-1', name: '关联源', url: '', configId: '', mainTable: '', owner: '', state: 'C' }],
    })
    const w = await mountCenter([{ ...FLOWS[0], sourceCnt: 12 }])
    await w.get('[data-testid="flow-source-cnt-link"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ flowId: 'flow-10086' }))
    expect(w.get('[data-testid="flow-source-row"]').text()).toContain('关联源')
    // 单元格上的 @click.stop：点数字不应该同时触发整行的"打开工作区"
    expect(w.find('.fd-drawer').exists()).toBe(false)
    w.unmount()
  })

  // 1016 评审：关联源弹窗只做「查看 + 关联 + 解绑」——启停只读展示（切的是整个源，容易误解成只停本流程），
  // 「详情」与点源名重复，都去掉
  it('关联源弹窗：操作列只有解绑，启停只读显示「已停用」', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 1,
      list: [{ sourceId: 'src-1', name: '关联源', url: '', configId: '', mainTable: '', owner: '', state: 'C', disabled: true }],
    })
    const w = await mountCenter([{ ...FLOWS[0], sourceCnt: 12 }])
    await w.get('[data-testid="flow-source-cnt-link"]').trigger('click')
    await flushPromises()
    const row = w.get('[data-testid="flow-source-row"]')
    expect(row.find('[data-testid="flow-source-unbind"]').exists()).toBe(true)
    expect(row.find('[data-testid="flow-source-toggle-enable"]').exists()).toBe(false)
    expect(row.find('[data-testid="flow-source-detail"]').exists()).toBe(false)
    expect(row.get('[data-testid="flow-source-enable-tag"]').text()).toBe('已停用')
    w.unmount()
  })

  // 0902：服务端分页，且分页控件与数据中心统一成同一个 el-pagination
  // （DataQueryPanel 的 .dqp-pager 同款 layout / page-sizes / background+small）。
  // 项目没有全局装 Element Plus 插件（vitest.config.ts 无 setupFiles），测试环境里
  // <el-pagination> 是未识别的自定义元素、拿不到组件实例，所以这里跟 ResultView.test.ts
  // 同一口径：只断言"绑进去的 props 对不对"，不做点击交互。
  it('分页用与数据中心同款 el-pagination，绑定后端总数与页大小', async () => {
    const w = await mountCenter(FLOWS, 640)
    const pagination = w.get('[data-testid="flow-center-pagination"]')
    expect(pagination.attributes('total')).toBe('640')
    expect(pagination.attributes('page-size')).toBe('20')
    expect(pagination.attributes('page-sizes')).toBe('20,40,100,200')
    expect(pagination.attributes('layout')).toBe('total, sizes, prev, pager, next, jumper')
  })

  // 0902：检索条对齐数据中心/文件中心，改成显式「查询」「清空」按钮（回车仍可用）
  it('点查询按钮把关键字发给服务端', async () => {
    const w = await mountCenter()
    const paged = vi.mocked(flowCenterApi.paged)
    await search(w).setValue('微信')
    paged.mockClear()
    await w.get('[data-testid="flow-center-query"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ page: 1, keywords: '微信' }))
  })

  it('点清空把条件、排序、页码一起复位并重查', async () => {
    const w = await mountCenter(FLOWS, 640)
    await search(w).setValue('微信')
    await w.get('[data-testid="flow-center-query"]').trigger('click')
    await flushPromises()
    const paged = vi.mocked(flowCenterApi.paged)
    paged.mockClear()
    await w.get('[data-testid="flow-center-reset"]').trigger('click')
    await flushPromises()
    expect((search(w).element as HTMLInputElement).value).toBe('')
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ page: 1, field: 'createDt', order: 'desc' }))
    expect(paged.mock.calls[0][0]?.keywords).toBeUndefined()
    expect(paged.mock.calls[0][0]?.flowIds).toBeUndefined()
  })

  // 对齐旧平台 FlowList 的「流程ID」框：纯数字（单个或逗号/空格分隔多个）按 ID 精确查
  it('纯数字按流程 ID 查，不当关键字', async () => {
    const w = await mountCenter()
    const paged = vi.mocked(flowCenterApi.paged)
    await search(w).setValue('14010130， 1400976 1400991')
    paged.mockClear()
    await w.get('[data-testid="flow-center-query"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ page: 1, flowIds: ['14010130', '1400976', '1400991'] }))
    expect(paged.mock.calls[0][0]?.keywords).toBeUndefined()
  })

  it('数字夹杂文字仍按关键字查', async () => {
    const w = await mountCenter()
    const paged = vi.mocked(flowCenterApi.paged)
    await search(w).setValue('2024 年报')
    paged.mockClear()
    await w.get('[data-testid="flow-center-query"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ keywords: '2024 年报' }))
    expect(paged.mock.calls[0][0]?.flowIds).toBeUndefined()
  })

  it('默认按创建时间倒序', async () => {
    await mountCenter()
    expect(flowCenterApi.paged).toHaveBeenCalledWith(expect.objectContaining({ field: 'createDt', order: 'desc' }))
  })

  it('表头点创建/更新时间切换正序倒序，下拉框同步', async () => {
    const w = await mountCenter()
    const paged = vi.mocked(flowCenterApi.paged)
    const sortSelect = () => (w.get('[data-testid="flow-center-sort"]').element as HTMLSelectElement).value

    await w.get('[data-testid="flow-sort-create"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, field: 'createDt', order: 'asc' }))
    expect(sortSelect()).toBe('createDt-asc')

    await w.get('[data-testid="flow-sort-update"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ field: 'updateDt', order: 'desc' }))

    await w.get('[data-testid="flow-sort-update"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ field: 'updateDt', order: 'asc' }))
    expect(sortSelect()).toBe('updateDt-asc')
  })

  // 2026-10-21：「使用源数」表头也能点正序 / 倒序，下拉里多一项「使用源数最少」
  it('表头点使用源数切换倒序 / 正序，下拉框同步', async () => {
    const w = await mountCenter()
    const paged = vi.mocked(flowCenterApi.paged)
    await w.get('[data-testid="flow-sort-source-cnt"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, field: 'sourceCnt', order: 'desc' }))
    await w.get('[data-testid="flow-sort-source-cnt"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ field: 'sourceCnt', order: 'asc' }))
    expect((w.get('[data-testid="flow-center-sort"]').element as HTMLSelectElement).value).toBe('sourceCnt-asc')
  })

  // cs_flow 没有版本列，读回来 version 就是 undefined——不能渲染成 vundefined
  it('没有版本号时只显示流程 ID', async () => {
    const w = await mountCenter([{ ...FLOWS[0], version: undefined }])
    expect(rows(w)[0].text()).toContain('flow-10086')
    expect(rows(w)[0].text()).not.toContain('vundefined')
  })

  // 0902：搜索改走服务端 flowPaged.keywords（命中 flow_name/flow_code/flow_desc/remark/
  // flow_tags/biz_type），回车触发。原来的本地过滤只能筛已加载的那一页，覆盖不到全量。
  it('回车把关键字发给服务端，不在本地筛', async () => {
    const w = await mountCenter()
    const paged = vi.mocked(flowCenterApi.paged)
    paged.mockClear()
    await search(w).setValue('微信')
    // 只输入不查询：不发请求，列表不动
    expect(paged).not.toHaveBeenCalled()
    expect(rows(w).length).toBe(2)

    paged.mockResolvedValue({ total: 1, list: [FLOWS[1]] })
    await search(w).trigger('keyup.enter')
    await flushPromises()
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ keywords: '微信' }))
    expect(rows(w).length).toBe(1)
  })

  it('搜不到时提示带上关键字', async () => {
    const w = await mountCenter()
    vi.mocked(flowCenterApi.paged).mockResolvedValue({ total: 0, list: [] })
    await search(w).setValue('不存在的流程')
    await search(w).trigger('keyup.enter')
    await flushPromises()
    expect(w.text()).toContain('没有找到匹配「不存在的流程」的流程')
  })

})

// 0902：增删改之后列表自动重查，不再让用户去点「刷新」（那个按钮也删了）。
describe('流程中心 · 自动刷新', () => {
  it('工具条没有刷新按钮', async () => {
    const w = await mountCenter()
    const labels = w.get('.fc-toolbar').findAll('button').map((b) => b.text())
    expect(labels).toEqual(['新建模板', '归集到模板', '查询', '清空'])
  })

  // 0904 I17（Z7-5）：新建从 prompt 单输入框换成小表单（名称/分类/标签/描述），
  // 所以不再 mock ElMessageBox.prompt，改成填表单再点提交。
  it('新建流程后自动重查列表', async () => {
    const created = { ...FLOWS[1], id: 'flow-new', name: '新流程' } as FlowRecord
    vi.spyOn(flowCenterApi, 'save').mockResolvedValue(created)
    const w = await mountCenter()
    const paged = vi.mocked(flowCenterApi.paged)
    paged.mockClear()
    await openCreateForm(w)
    await w.get('[data-testid="create-flow-name"]').setValue('新流程')
    await w.get('[data-testid="create-flow-submit"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenCalled()
    // 重查回来的列表里没有这条新流程也不能把工作区关掉
    expect(w.find('.fd-name').exists()).toBe(true)
    w.unmount()
  })

  it('删除后自动重查列表', async () => {
    const w = await mountCenter()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(flowCenterApi, 'remove').mockResolvedValue({ ok: true })
    const paged = vi.mocked(flowCenterApi.paged)
    paged.mockClear()
    await w.get('[data-testid="flow-delete"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenCalled()
  })

  // 列表随时会被整页换掉（自动重查 / 翻页 / 搜索）。工作区若从列表派生，只要当前流程
  // 不在新的这一页，正在编辑的面板就会自己消失。用搜索换掉结果集来验，等价且不依赖分页控件。
  it('列表被整页换掉后工作区不关', async () => {
    const w = await mountCenter(FLOWS, 640)
    // 同为 0926 串行拉步骤快照的口径：不 mock 会走真实 120ms 通道，快照晚到并重建画布，
    // 把后续用例的渲染时序搅乱（本文件注释「名称为空不发请求」那条历史 flake 同源）。
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
    await rows(w)[0].trigger('click')
    expect(w.find('.fd-drawer').exists()).toBe(true)
    vi.mocked(flowCenterApi.paged).mockResolvedValue({ total: 640, list: [FLOWS[1]] })
    await w.get('[data-testid="flow-center-query"]').trigger('click')
    await flushPromises()
    expect(rows(w).length).toBe(1)
    expect(w.find('.fd-drawer').exists()).toBe(true)
    w.unmount()
  })
})

// 0902 会议口径：操作列只保留 编辑 / 关联到源 / 删除流程，去掉「复制」。
// 0903 H24（Y8-D）：加回「标记为模板 / 取消模板」——模板是流程的一个**属性**，
// 就该在流程行上切换，不是另开一个模板中心页。
// 0929 F6：加回「禁用 / 启用」（changeFlowEnable 置 cs_flow.is_delete），排在模板与删除之间；
// 0929 F1：有源流程的「删除」不再直接弹确认（后端拒绝），改开「更换/解绑源」前置对话框。
describe('流程中心 · 操作列', () => {
  // 0904 I16（Z7-1）：操作列是**图标按钮**，文案在 title/aria-label 上，按钮体内没有文字。
  const actions = (w: Awaited<ReturnType<typeof mountCenter>>) =>
    rows(w)[0].findAll('.fc-actions button').map((b) => b.attributes('title'))

  it('操作列：编辑 / 复制流程 / 关联到源 / 标记为模板 / 禁用流程 / 删除流程', async () => {
    const w = await mountCenter()
    expect(actions(w)).toEqual(['编辑流程', '复制流程', '关联到源', '标记为模板', '禁用流程', '删除流程'])
  })

  it('模板行使用「编辑模板」和「取消模板标记」', async () => {
    const w = await mountCenter([{ ...FLOWS[0], isTemplate: true }])
    expect(actions(w)).toEqual(['编辑模板', '复制流程', '关联到源', '取消模板标记', '禁用流程', '删除流程'])
  })

  it('已禁用的行：按钮变「启用流程」、行带禁用徽标', async () => {
    const w = await mountCenter([{ ...FLOWS[0], disabled: true }])
    expect(actions(w)).toEqual(['编辑流程', '复制流程', '关联到源', '标记为模板', '启用流程', '删除流程'])
    expect(w.get('[data-testid="flow-disabled-badge"]').text()).toContain('已禁用')
  })

  it('启用/禁用走 changeFlowEnable（0 启用 / 1 禁用）', async () => {
    const w = await mountCenter([{ ...FLOWS[0], disabled: true }])
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const enable = vi.spyOn(flowCenterApi, 'changeFlowEnable').mockResolvedValue({ ok: true })
    await w.get('[data-testid="flow-toggle-enable"]').trigger('click')
    await flushPromises()
    expect(enable).toHaveBeenCalledWith(['flow-10086'], 0)
  })

  it('无源流程：删除直接二次确认后调用 remove', async () => {
    const w = await mountCenter()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const remove = vi.spyOn(flowCenterApi, 'remove').mockResolvedValue({ ok: true })
    await w.get('[data-testid="flow-delete"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('删除后不可恢复'), '删除流程', expect.anything())
    expect(remove).toHaveBeenCalledWith(['flow-10086'])
  })

  // 2026-10-21「删除就是删除」：有源时只提示先解除关联，带去「关联到源」的「已关联」页签；
  // 删除对话框里的「更换到流程 / 仅解绑并删除 / 更换并删除」（changeFlowAndDelete）已去掉
  it('有源流程（sourceCnt>0）：不删，提示先解除关联；点「去关联到源」打开「已关联」页签', async () => {
    const w = await mountCenter([{ ...FLOWS[0], sourceCnt: 7 }])
    const remove = vi.spyOn(flowCenterApi, 'remove').mockResolvedValue({ ok: true })
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 7, list: [{ sourceId: '1', name: '源一' }] } as never)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    await w.get('[data-testid="flow-delete"]').trigger('click')
    await flushPromises()

    expect(remove).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('仍被 7 个源使用，不能删除'), '不能删除流程', expect.objectContaining({ confirmButtonText: '去关联到源' }))
    expect(w.get('[data-testid="fsm-tab-bound"]').attributes('aria-selected')).toBe('true')
    expect(w.get('[data-testid="flow-source-row"]').text()).toContain('源一')
    expect(w.find('[data-testid="rebind-target-flow"]').exists()).toBe(false)
    w.unmount()
  })

  it('有源流程：提示里点取消，什么都不做', async () => {
    const w = await mountCenter([{ ...FLOWS[0], sourceCnt: 3 }])
    const remove = vi.spyOn(flowCenterApi, 'remove').mockResolvedValue({ ok: true })
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    await w.get('[data-testid="flow-delete"]').trigger('click')
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()
    expect(w.find('[data-testid="flow-sources-manager"]').exists()).toBe(false)
  })

  // 186 的 flowPaged 不返回 sourceCnt：照常删，被后端以「有源挂载」拒绝后走同一个提示，不报原文
  it('源数缺失时删除被后端以有源拒绝：改为提示先解除关联', async () => {
    const w = await mountCenter([{ ...FLOWS[0], sourceCnt: undefined }])
    vi.spyOn(flowCenterApi, 'remove').mockResolvedValue({ ok: false, message: '有源挂载的流程不能删除，请先解绑源' })
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce('confirm' as never).mockRejectedValueOnce('cancel')
    await w.get('[data-testid="flow-delete"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('仍被源使用，不能删除'), '不能删除流程', expect.anything())
    expect(error).not.toHaveBeenCalled()
  })

  it('「关联到源」：有源先开「已关联」，没源直接「添加关联」', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const w = await mountCenter([{ ...FLOWS[0], sourceCnt: 2 }, { ...FLOWS[1], sourceCnt: 0 }])
    const btns = w.findAll('button[aria-label="关联到源"]')
    await btns[0].trigger('click')
    await flushPromises()
    expect(w.get('[data-testid="fsm-tab-bound"]').attributes('aria-selected')).toBe('true')
    await w.get('[data-testid="fsm-tab-add"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="flow-apply-confirm"]').exists()).toBe(true)
    w.unmount()
  })
})

describe('流程中心 · 可编辑工作区', () => {
  // 流程版本（2026-10-10）：按未启用处理；不桩的话走 mock 120ms 延迟，抽屉停在加载态
  beforeEach(() => {
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ enabled: false, curVer: null, nextVer: null, publishId: null, draftId: null, versions: [] })
  })
  // 0902 联调修：列表走 flowPaged，不返回 flowConf，行上的 definition 恒为空流程。
  // 工作区必须自己去 flowDetail 取完整定义，否则点开任何已有流程都是空画布，
  // 一保存还会把真实 flowConf 覆盖成空。这两条用例的 detail 桩就是在锁这件事。
  it('点行打开工作区：去 flowDetail 取完整定义载入画布，而不是用列表行的空 definition', async () => {
    const detail = vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(FLOWS[0])
    // 0926 起打开流程串行拉步骤快照（详情→steps→工作区渲染），测试不 mock steps 会走
    // 真实 120ms 网络通道，loadingDetail 停在 true、画布 stub 不渲染。快照与本文断言无关，
    // 空数组即可（LOAD 画布用 definition，不依赖快照）。
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
    // 列表行只有空 definition，模拟真实 flowPaged 的返回
    const w = await mountCenter([{ ...FLOWS[0], definition: { main: [], branches: [], configs: {} } }])
    await rows(w)[0].trigger('click')
    await flushPromises()
    expect(detail).toHaveBeenCalledWith('flow-10086')
    expect(w.find('.fd-drawer').exists()).toBe(true)
    expect(w.find('[data-testid="embedded-flow-board"]').exists()).toBe(true)
    expect(useFlowStore().main).toEqual(['start', 'web-list', 'web-detail', 'end'])
    w.unmount()
  })

  // 存量流程（后端从 cs_config 灌进来的 735 条）flowConf 全是 null，但它们不是空流程——
  // 真实结构在 cs_item_config 里，起点节点则来自这个流程自己的 config/configDetail（flowId===configId）。
  // 空定义时按这份配置+子步骤还原，并明确标注"尚未落库"。0902 改造：不再依赖任何关联源。
  it('flowConf 为空时按这个流程自己的配置还原画布，并提示这份定义还没写进流程', async () => {
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue({
      ...FLOWS[0], sourceCnt: 0, definition: { main: [], branches: [], configs: {} },
    })
    const detail = vi.spyOn(configApi, 'configDetail').mockResolvedValue({
      configId: 'flow-10086', name: '这个流程自己的配置', url: 'https://example.com/list', entryTypeId: '2103330', enabled: true,
    })
    const steps = vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
    const w = await mountCenter([{ ...FLOWS[0], sourceCnt: 0 }])
    await rows(w)[0].trigger('click')
    await flushPromises()
    expect(detail).toHaveBeenCalledWith('flow-10086')
    expect(steps).toHaveBeenCalledWith('flow-10086')
    const note = w.get('[data-testid="flow-derived-note"]').text()
    expect(note).toContain('#flow-10086')
    expect(note).toContain('尚未保存画布定义')
    // 提示条不能把工作区顶掉——两者要并存
    expect(w.find('[data-testid="embedded-flow-board"]').exists()).toBe(true)
    // loadFromSource 用的 stub 源 sourceId 是空串，会把 FlowDef.id 带成空——流程 XML 导出要用
    // 真实 flowId（导入导出场景），这里必须纠正回来，不能是空串或 stub 源的 sourceId
    expect(useFlowStore().flowId).toBe('flow-10086')
    w.unmount()
  })

  // 2026-09-02 真机对比 zqrb 流程 #1400832 的流程中心视图与它关联源的流程视图发现：有真实
  // 子步骤时起点节点整个消失了——buildSourceSeed 的 rootStepForSource 兜底只在 steps 为空时
  // 触发，flowId 模式的 steps 又天生不含起点行，两条真实子步骤存在时正好落进这个空子。
  it('flowConf 为空、但这个流程有真实子步骤时，起点节点也要跟子步骤一起还原，不能被子步骤顶掉', async () => {
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue({
      ...FLOWS[0], sourceCnt: 1, definition: { main: [], branches: [], configs: {} },
    })
    vi.spyOn(configApi, 'configDetail').mockResolvedValue({
      configId: 'flow-10086', name: 'zqrb-证券日报网', url: 'http://www.zqrb.cn/jrjg/quanshang/index.html', entryTypeId: '900', enabled: true,
    })
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([
      { stepId: '40353', sourceId: '-1', name: '浏览器下载源码', outputTable: '900', configId: '1400764', enabled: false },
      { stepId: '40354', sourceId: '-1', name: '1400759-详情', outputTable: '900', configId: '1400765', enabled: false },
    ])
    const w = await mountCenter([{ ...FLOWS[0], sourceCnt: 1 }])
    await rows(w)[0].trigger('click')
    await flushPromises()
    // 4 个真实节点：起点（配置现拼的列表抓取）+ 2 个真实子步骤 + start/end 之外的这些才算，
    // main 应为 [start, 起点, 40353, 40354, end]，不能是 [start, 40353, 40354, end]
    expect(useFlowStore().main.length).toBe(5)
    expect(useFlowStore().main).toContain('40353')
    expect(useFlowStore().main).toContain('40354')
    expect(useFlowStore().main.indexOf('40353')).toBeGreaterThan(1) // 起点节点排在 40353 前面
    w.unmount()
  })

  it('配置和步骤都没有内容时不去还原，就是一张空白画布且不显示还原提示', async () => {
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue({
      ...FLOWS[0], sourceCnt: 0, definition: { main: [], branches: [], configs: {} },
    })
    const detail = vi.spyOn(configApi, 'configDetail').mockResolvedValue(null)
    const steps = vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
    const w = await mountCenter([{ ...FLOWS[0], sourceCnt: 0 }])
    await rows(w)[0].trigger('click')
    await flushPromises()
    expect(detail).toHaveBeenCalledWith('flow-10086')
    expect(steps).toHaveBeenCalledWith('flow-10086')
    expect(w.find('[data-testid="flow-derived-note"]').exists()).toBe(false)
    expect(w.find('[data-testid="embedded-flow-board"]').exists()).toBe(true)
    w.unmount()
  })

  it('详情取不到时关掉工作区并报错，不拿空画布糊弄', async () => {
    vi.spyOn(flowCenterApi, 'detail').mockRejectedValue(new Error('请求失败 500'))
    const error = vi.spyOn(ElMessage, 'error')
    const w = await mountCenter()
    await rows(w)[0].trigger('click')
    await flushPromises()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('请求失败 500'))
    expect(w.find('.fd-drawer').exists()).toBe(false)
    w.unmount()
  })

  it('右侧直接复用节点设置，且流程中心不展示 AI 对话', async () => {
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(FLOWS[0])
    // 同上：打开流程串行拉步骤快照，不 mock 会卡 loadingDetail
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
    const w = await mountCenter()
    await rows(w)[0].trigger('click')
    await flushPromises()
    const inspector = w.get('[data-testid="embedded-node-inspector"]')
    expect(inspector.text()).toContain('节点配置')
    expect(inspector.text()).toContain('任务配置')
    expect(w.find('.fd-drawer').text()).not.toContain('AI 对话')
    w.unmount()
  })

  it('不再展示节点数/使用源/状态摘要块和只读节点摘要', async () => {
    const w = await mountCenter()
    await rows(w)[0].trigger('click')
    const drawer = w.get('.fd-drawer').text()
    expect(drawer).not.toContain('使用源 20')
    expect(drawer).not.toContain('本页只读')
    expect(w.find('.fd-detail').exists()).toBe(false)
  })

  it('工作区提供保存流程和应用到源两个主操作', async () => {
    const w = await mountCenter()
    await rows(w)[0].trigger('click')
    expect(w.find('[data-testid="flow-save"]').exists()).toBe(true)
    expect(w.find('[data-testid="flow-apply-to-source"]').exists()).toBe(true)
    expect(w.find('.fd-name').exists()).toBe(true)
  })

  // 0902 改口径：关联 = changeFlowBatch 写 cs_source.FLOW_ID 这一个字段。
  // 原来那版走 sourceUpdate + flowApi.flowSave，是 mock 时代"全量替换节点"的语义；
  // 真实后端下 sourceUpdate 根本不发 templateId（sourceToLegacyParams 里没这个字段），
  // 等于假绑定。这条用例同时锁住「不许再去动源本身」。
  it('关联到源走 changeFlowBatch，且不改动源本身', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({
      sourceId: 'source-1', name: '目标源', url: 'https://example.com', configId: '', mainTable: '', owner: '', state: 'C',
    })
    const sourceUpdate = vi.spyOn(sourceApi, 'sourceUpdate').mockResolvedValue({ ok: true })
    const bind = vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValue({ ok: true })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const w = await mountCenter()
    const apply = rows(w)[0].findAll('button').find((button) => button.attributes('title') === '关联到源')!
    await apply.trigger('click')
    await w.get('[data-testid="source-select-stub"]').setValue('source-1')
    await w.get('[data-testid="flow-apply-confirm"]').trigger('click')
    await flushPromises()
    expect(bind).toHaveBeenCalledWith(['source-1'], 'flow-10086')
    expect(sourceUpdate).not.toHaveBeenCalled()
  })

  it('关联失败时把后端原文抛给用户，不谎报成功', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({
      sourceId: 'source-1', name: '目标源', url: '', configId: '', mainTable: '', owner: '', state: 'C',
    })
    vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValue({ ok: false, message: '目标流程不存在或已删除：flowId=10086' })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const error = vi.spyOn(ElMessage, 'error')
    const w = await mountCenter()
    const apply = rows(w)[0].findAll('button').find((button) => button.attributes('title') === '关联到源')!
    await apply.trigger('click')
    await w.get('[data-testid="source-select-stub"]').setValue('source-1')
    await w.get('[data-testid="flow-apply-confirm"]').trigger('click')
    await flushPromises()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('目标流程不存在或已删除'))
  })
})

// 0903 Y8-B：关联到源改多选 + 分批提交。
// changeFlowBatch 单次上限 5000（endpoints.ts），前端按 500 一批串行。
describe('流程中心 · 关联到源（Y8-B 多选与分批）', () => {
  async function openApplyDialog(w: Awaited<ReturnType<typeof mountCenter>>) {
    const apply = rows(w)[0].findAll('button').find((b) => b.attributes('title') === '关联到源')!
    await apply.trigger('click')
  }

  it('一次关联多个源，一批就够时只发一次请求', async () => {
    const bind = vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValue({ ok: true })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const w = await mountCenter()
    await openApplyDialog(w)
    await w.get('[data-testid="source-select-stub"]').setValue('s1,s2,s3')
    await w.get('[data-testid="flow-apply-confirm"]').trigger('click')
    await flushPromises()

    expect(bind).toHaveBeenCalledTimes(1)
    expect(bind).toHaveBeenCalledWith(['s1', 's2', 's3'], 'flow-10086')
  })

  it('确认文案写明影响的源数与「共用配置」，不再说「不改动源现有配置」', async () => {
    vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValue({ ok: true })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const w = await mountCenter()
    await openApplyDialog(w)
    await w.get('[data-testid="source-select-stub"]').setValue('s1,s2')
    await w.get('[data-testid="flow-apply-confirm"]').trigger('click')
    await flushPromises()

    const text = String(confirm.mock.calls[0][0])
    expect(text).toContain('2 个源')
    expect(text).toContain('共用')
    expect(text).not.toContain('不改动源现有的采集配置')
  })

  it('超过 500 个按 500 一批切分，串行提交', async () => {
    const bind = vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValue({ ok: true })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const ids = Array.from({ length: 1200 }, (_, i) => `s${i}`)
    const w = await mountCenter()
    await openApplyDialog(w)
    await w.get('[data-testid="source-select-stub"]').setValue(ids.join(','))
    await w.get('[data-testid="flow-apply-confirm"]').trigger('click')
    await flushPromises()

    expect(bind).toHaveBeenCalledTimes(3)
    expect(bind.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([500, 500, 200])
  })

  it('中途某批失败：停下不再发后续批次，并如实说明已成功多少个', async () => {
    const bind = vi.spyOn(flowCenterApi, 'bindSources')
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, message: '目标流程不存在' })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
    const ids = Array.from({ length: 1200 }, (_, i) => `s${i}`)
    const w = await mountCenter()
    await openApplyDialog(w)
    await w.get('[data-testid="source-select-stub"]').setValue(ids.join(','))
    await w.get('[data-testid="flow-apply-confirm"]').trigger('click')
    await flushPromises()

    expect(bind).toHaveBeenCalledTimes(2) // 第三批不再发
    expect(error).toHaveBeenCalledWith(expect.stringContaining('前 500 个已关联成功'))
  })

  it('一个源都没选时不发请求', async () => {
    const bind = vi.spyOn(flowCenterApi, 'bindSources')
    const w = await mountCenter()
    await openApplyDialog(w)
    await w.get('[data-testid="flow-apply-confirm"]').trigger('click')
    await flushPromises()
    expect(bind).not.toHaveBeenCalled()
  })
})

// 0904 I17（Z7-5）：新建流程的小表单。
describe('流程中心 · 新建流程表单（Z7-5）', () => {
  it('分类/标签/描述都提交上去，标签统一成逗号串（中英文逗号、空格都收，去重去空）', async () => {
    const save = vi.spyOn(flowCenterApi, 'save').mockResolvedValue(FLOWS[0])
    const w = await mountCenter()
    await openCreateForm(w)
    await w.get('[data-testid="create-flow-name"]').setValue('带分类的流程')
    await w.get('[data-testid="create-flow-tags"]').setValue('新闻， 财经  新闻')
    await w.get('[data-testid="create-flow-desc"]').setValue('说明文字')
    await w.get('[data-testid="create-flow-submit"]').trigger('click')
    await flushPromises()

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      name: '带分类的流程',
      flowTags: '新闻,财经',
      description: '说明文字',
    }))
  })

  it('没填的项**不进 payload**：saveFlow 是全量保存，传空串是"清空"而不是"不管"', async () => {
    const save = vi.spyOn(flowCenterApi, 'save').mockResolvedValue(FLOWS[0])
    const w = await mountCenter()
    await openCreateForm(w)
    await w.get('[data-testid="create-flow-name"]').setValue('只有名字')
    await w.get('[data-testid="create-flow-submit"]').trigger('click')
    await flushPromises()

    const payload = save.mock.calls[0][0] as unknown as Record<string, unknown>
    expect('categoryId' in payload).toBe(false)
    expect('flowTags' in payload).toBe(false)
    expect('description' in payload).toBe(false)
  })

  it('名称为空不发请求', async () => {
    const save = vi.spyOn(flowCenterApi, 'save')
    const w = await mountCenter()
    await openCreateForm(w)
    await w.get('[data-testid="create-flow-name"]').setValue('   ')
    await w.get('[data-testid="create-flow-submit"]').trigger('click')
    await flushPromises()
    expect(save).not.toHaveBeenCalled()
  })
})

// 0903 Y8-D 流程模板管理（H24）。模板是流程的一个**属性**（cs_flow.templateFlag），
// 不是另一类对象——不复活 FlowTemplate 那个死页面，模板和普通流程同一张表用筛选区分。
describe('流程中心 · 流程模板（Y8-D）', () => {
  // 1016：复制后去共享会先查草稿（overview）；不桩的话走 mock 120ms 延迟，flushPromises 等不到
  beforeEach(() => {
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ enabled: true, curVer: 1, nextVer: 2, publishId: '1', draftId: null, versions: [] })
  })
  it('范围下拉走服务端过滤（flowPaged.onlyTemplate），不是本地筛', async () => {
    const w = await mountCenter()
    const paged = vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })

    await w.get('[data-testid="flow-center-scope"]').setValue('template')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ onlyTemplate: true }))

    await w.get('[data-testid="flow-center-scope"]').setValue('normal')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ onlyTemplate: false }))

    // 「全部」不传这个字段，而不是传 undefined 以外的什么值
    await w.get('[data-testid="flow-center-scope"]').setValue('all')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ onlyTemplate: undefined }))
  })

  it('模板行有角标；由模板复制而来的行显示来源', async () => {
    const w = await mountCenter([
      { ...FLOWS[0], isTemplate: true },
      { ...FLOWS[1], fromTemplateId: 'flow-10086' },
    ])
    expect(w.findAll('[data-testid="flow-template-badge"]')).toHaveLength(1)
    expect(w.get('[data-testid="flow-from-template"]').text()).toContain('flow-10086')
  })

  it('标记为模板：先取全量详情再 saveFlow，且必须带 id（否则会静默新建一条同名流程）', async () => {
    const w = await mountCenter()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const detail = vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(FLOWS[0])
    const save = vi.spyOn(flowCenterApi, 'save').mockResolvedValue({ ...FLOWS[0], isTemplate: true })

    await w.get('[data-testid="flow-toggle-template"]').trigger('click')
    await flushPromises()

    // 列表行的 definition 是空的（flowPaged 不返回 flowConf），不先取详情就会把画布存空
    expect(detail).toHaveBeenCalledWith('flow-10086')
    expect(save).toHaveBeenCalledWith({
      id: 'flow-10086',
      name: FLOWS[0].name,
      definition: FLOWS[0].definition,
      isTemplate: true,
    })
  })

  it('取消确认时不发保存请求', async () => {
    const w = await mountCenter()
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))
    const save = vi.spyOn(flowCenterApi, 'save')
    await w.get('[data-testid="flow-toggle-template"]').trigger('click')
    await flushPromises()
    expect(save).not.toHaveBeenCalled()
  })

  it('详情读不回来时不保存，避免把 definition 存成空', async () => {
    const w = await mountCenter()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(null)
    const save = vi.spyOn(flowCenterApi, 'save')
    const err = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)

    await w.get('[data-testid="flow-toggle-template"]').trigger('click')
    await flushPromises()

    expect(save).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalledWith(expect.stringContaining('未做任何修改'))
  })

  it('「从模板新建」走 copyFlow，不是自己拼 saveFlow（后者只会建出空流程）', async () => {
    const w = await mountCenter()
    vi.spyOn(flowCenterApi, 'templates').mockResolvedValue([{ ...FLOWS[0], isTemplate: true }])
    const copy = vi.spyOn(flowCenterApi, 'copy').mockResolvedValue('flow-99')
    vi.spyOn(flowCenterApi, 'detail').mockImplementation(async id => id === 'flow-10086' ? { ...FLOWS[0], isTemplate: true } : { ...FLOWS[0], id: 'flow-99' })
    const save = vi.spyOn(flowCenterApi, 'save')

    // 0929 F9：不再手输 ID，走「下拉选择模板」弹窗（openTemplateCreate 拉取模板后直接创建）。
    // ui.fireAction 依赖注册顺序，直接调 setupState 更稳（同文件既有惯例）。
    await (w.vm.$ as unknown as { setupState: { openTemplateCreate: () => Promise<void> } }).setupState.openTemplateCreate()
    await flushPromises()
    expect(w.find('[data-testid="template-create-pick"]').exists()).toBe(true)

    await (w.vm.$ as unknown as { setupState: { createFromTemplate: () => Promise<void> } }).setupState.createFromTemplate()
    await flushPromises()

    expect(copy).toHaveBeenCalledWith('flow-10086', expect.stringContaining('_copy'))
    expect(save).not.toHaveBeenCalled()
  })

  // 迁自旧平台「更多 → 复制流程」：确认后走 copyFlow（名为原名_copy），新流程直接打开
  it('行内复制流程：确认后走 copyFlow 并打开新流程', async () => {
    const w = await mountCenter()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const copy = vi.spyOn(flowCenterApi, 'copy').mockResolvedValue('flow-99')
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue({ ...FLOWS[0], id: 'flow-99', name: '新闻采集标准流程_copy' })

    await w.findAll('[data-testid="flow-copy"]')[0].trigger('click')
    await w.get('[data-testid="flow-copy-continue"]').trigger('click')
    await flushPromises()

    expect(copy).toHaveBeenCalledWith('flow-10086', '新闻采集标准流程_copy')
    expect((w.vm.$ as unknown as { setupState: { activeId: string } }).setupState.activeId).toBe('flow-99')
  })

  it.each([false, true])('复制流程（模板=%s）选复用原配置时不逐节点复制配置', async (isTemplate) => {
    const w = await mountCenter([{ ...FLOWS[0], isTemplate }])
    // confirmCopyFlow 的 message 是渲染函数：找到单选组，切到 reuse 再确认
    vi.spyOn(ElMessageBox, 'confirm').mockImplementation((async (msg: unknown) => {
      type N = { children?: unknown; props?: Record<string, unknown> | null }
      const find = (n: unknown): N | undefined => {
        if (!n || typeof n !== 'object') return undefined
        if (Array.isArray(n)) return n.map(find).find(Boolean)
        const v = n as N
        if (typeof v.props?.['onUpdate:modelValue'] === 'function') return v
        const c = v.children
        if (c && typeof c === 'object' && !Array.isArray(c) && 'default' in c) return find((c as { default: () => unknown }).default())
        return find(c)
      }
      ;(find((msg as (p: unknown) => unknown)({}))!.props!['onUpdate:modelValue'] as (v: string) => void)('reuse')
      return 'confirm'
    }) as never)
    const copy = vi.spyOn(flowCenterApi, 'copy').mockResolvedValue('flow-99')
    vi.spyOn(flowCenterApi, 'detail').mockImplementation(async id => id === 'flow-10086' ? { ...FLOWS[0], isTemplate } : { ...FLOWS[0], id: 'flow-99', name: '新闻采集标准流程_copy' })
    const copyConfig = vi.spyOn(configApi, 'copyConfigAndLocate')
    const steps = vi.mocked(flowCenterApi.steps)
    steps.mockClear()

    await w.findAll('[data-testid="flow-copy"]')[0].trigger('click')
    await w.get('[data-testid="flow-copy-continue"]').trigger('click')
    await flushPromises()

    expect(copy).toHaveBeenCalledWith('flow-10086', '新闻采集标准流程_copy')
    expect(steps).not.toHaveBeenCalledWith('flow-99', expect.anything())
    expect(copyConfig).not.toHaveBeenCalled()
  })

  it('行内复制流程：取消确认不发请求', async () => {
    const w = await mountCenter()
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const copy = vi.spyOn(flowCenterApi, 'copy')

    await w.findAll('[data-testid="flow-copy"]')[0].trigger('click')
    await w.get('[data-testid="flow-copy-continue"]').trigger('click')
    await flushPromises()

    expect(copy).not.toHaveBeenCalled()
  })

  it('一个模板都没有时给出提示，不弹选择框', async () => {
    const w = await mountCenter()
    vi.spyOn(flowCenterApi, 'templates').mockResolvedValue([])
    const info = vi.spyOn(ElMessage, 'info').mockImplementation(() => undefined as never)

    // 不走 ui.fireAction：那条路依赖"哪个组件实例最后注册了这个动作"，
    // 多份 wrapper 未卸载时结果取决于挂载顺序，会随测试文件增减而飘。
    await (w.vm.$ as unknown as { setupState: { openTemplateCreate: () => Promise<void> } }).setupState.openTemplateCreate()
    await flushPromises()

    expect(info).toHaveBeenCalledWith(expect.stringContaining('还没有流程被标记为模板'))
  })
})

// 分类筛选：多级目录树 + 多选。单选/不选走服务端 categoryId 单值契约（flow_api.md 实测归档）；
// 多选（≥2）由前端拉全量本地筛（flowPaged 的 categoryId 是 Integer 精确匹配，没有多值契约）。
describe('流程中心 · 分类树多选', () => {
  it('分类筛选是树形多选下拉：多级数据进树 + 懒加载 + check-strictly', async () => {
    const w = await mountCenter()
    const treeSelect = w.findComponent({ name: 'ElTreeSelect' })
    expect(treeSelect.exists()).toBe(true)
    expect(treeSelect.props('multiple')).toBe(true)
    expect(treeSelect.props('checkStrictly')).toBe(true)
    expect(typeof treeSelect.props('load')).toBe('function')
    // 首屏两级数据进树（loadCategories 预取了一层子级）
    const data = treeSelect.props('data') as { id: string; children?: unknown[] }[]
    expect(data.length).toBeGreaterThan(0)
    expect(data.some((c) => (c.children ?? []).length > 0)).toBe(true)
    // 样式契约：fc-category 的 28px 高/12px 字覆盖必须命中 .el-select__wrapper（EP 2.5+ 的
    // select 结构；写成 .el-input__wrapper 会整段静默失效，视觉退回 EP 默认 32px/14px）。
    // EP 升级若改结构，这条断言先红，避免样式漂移无人发现。
    expect(treeSelect.element.classList.contains('fc-category')).toBe(true)
    expect(treeSelect.element.querySelector(':scope > .el-select__wrapper')).toBeTruthy()
  })

  it('单个分类仍走服务端 categoryId 单值契约', async () => {
    const w = await mountCenter()
    const paged = vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })
    const setup = (w.vm.$ as unknown as { setupState: { onFilterCategoryChange: (v: unknown) => void } }).setupState

    setup.onFilterCategoryChange(['/基金类'])
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ categoryId: '/基金类' }))
  })

  it('多选（≥2）改为前端拉全量本地筛：逐页请求不带 categoryId，命中分类的流程保留', async () => {
    // 三条流程分属三个分类；多选其中两个分类时，第三条被滤掉
    const flows = [
      { ...FLOWS[0], id: 'f1', categoryId: 'c1', createdAt: '2026-09-01 10:00' },
      { ...FLOWS[0], id: 'f2', categoryId: 'c2', createdAt: '2026-09-02 10:00' },
      { ...FLOWS[0], id: 'f3', categoryId: 'c3', createdAt: '2026-09-03 10:00' },
    ] as FlowRecord[]
    const paged = vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 3, list: flows })
    const w = await mountCenter(flows)
    const setup = (w.vm.$ as unknown as { setupState: { onFilterCategoryChange: (v: unknown) => void } }).setupState

    setup.onFilterCategoryChange(['c1', 'c2'])
    await flushPromises()

    // 逐页全量请求：不带 categoryId（服务端没有多值契约）
    const lastCall = paged.mock.lastCall?.[0] as Record<string, unknown> | undefined
    expect(lastCall).toBeTruthy()
    expect('categoryId' in (lastCall ?? {})).toBe(false)
    expect(lastCall).toMatchObject({ page: 1, size: 100 })
    const rowIds = w.findAll('[data-testid="flow-center-row"]').map((r) => r.text())
    expect(rowIds.length).toBe(2)
    expect(rowIds[0]).toContain('f2') // 默认 createDt 倒序：c2 比 c1 新
    expect(rowIds.some((t) => t.includes('f3'))).toBe(false)
  })

  it('多选翻页走本地分页：total 是过滤后的口径', async () => {
    const flows = Array.from({ length: 25 }, (_, i) => ({
      ...FLOWS[0], id: `f${i}`, categoryId: i % 2 ? 'c1' : 'c2', updatedAt: `2026-09-01 10:${String(i).padStart(2, '0')}`,
    })) as FlowRecord[]
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 25, list: flows })
    const w = await mountCenter(flows)
    const setup = (w.vm.$ as unknown as { setupState: { onFilterCategoryChange: (v: unknown) => void; load: () => Promise<void> } }).setupState

    setup.onFilterCategoryChange(['c1', 'c2'])
    await flushPromises()
    // 25 条全命中两个分类，total = 25；当前页 20 条
    expect(w.text()).toContain('流程 25')
    expect(w.findAll('[data-testid="flow-center-row"]').length).toBe(20)
  })
})

// 0917-09：`/flows` 是主导航页，不挂源页签条，从源画布点「所属流程」进来之后
// 本来没有任何入口能回去——会上原话「你别让他忙了半天回不去了」。
describe('流程中心 · 从源画布来的返回条（0917-09）', () => {
  const FROM_CANVAS = { from: 'canvas', sourceId: '430016397', siteId: '12', view: 'data', fromName: '*ST东智', q: '上市公司-配置' }

  it('带 from=canvas 时渲染返回条，显示源名', async () => {
    const w = await mountCenter(FLOWS, FLOWS.length, FROM_CANVAS)
    expect(w.get('[data-testid="flow-center-back"]').text()).toBe('← 返回源「*ST东智」')
  })

  it('点返回条回到原来那个源，且落在**离开时的那个视图**，不是写死的流程视图', async () => {
    const w = await mountCenter(FLOWS, FLOWS.length, FROM_CANVAS)
    await w.get('[data-testid="flow-center-back"]').trigger('click')
    await flushPromises()
    const r = (w.vm as unknown as { $router: { currentRoute: { value: { path: string; query: Record<string, string> } } } }).$router
    expect(r.currentRoute.value.path).toBe('/canvas')
    expect(r.currentRoute.value.query).toMatchObject({ sourceId: '430016397', siteId: '12', view: 'data' })
  })

  it('没有 fromName 时退回显示源 ID，不显示空的「返回源「」」', async () => {
    const w = await mountCenter(FLOWS, FLOWS.length, { from: 'canvas', sourceId: '430016397' })
    expect(w.get('[data-testid="flow-center-back"]').text()).toBe('← 返回源「430016397」')
  })

  it('直接进流程中心（没有 from）不显示返回条', async () => {
    const w = await mountCenter()
    expect(w.find('[data-testid="flow-center-back"]').exists()).toBe(false)
  })

  // 游离源或手改的 URL：没有源也没有网站就没地方可回，宁可不给按钮，也不给一个点了报错的按钮
  it('from=canvas 但既没有 sourceId 也没有 siteId 时不显示返回条', async () => {
    const w = await mountCenter(FLOWS, FLOWS.length, { from: 'canvas', fromName: '某个源' })
    expect(w.find('[data-testid="flow-center-back"]').exists()).toBe(false)
  })

  it('返回条只认进来那一刻的 query：在本页搜索改了地址栏也不跟着变', async () => {
    const w = await mountCenter(FLOWS, FLOWS.length, FROM_CANVAS)
    const r = (w.vm as unknown as { $router: { push: (to: unknown) => Promise<void> } }).$router
    await r.push({ path: '/flows', query: { q: '别的关键字' } })
    await flushPromises()
    expect(w.get('[data-testid="flow-center-back"]').text()).toBe('← 返回源「*ST东智」')
  })
})

describe('流程模板结构与归集', () => {
  it('流程节点配置尚未保存时，取消切换会保留原工作区', async () => {
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ enabled: false, curVer: null, nextVer: null, publishId: null, draftId: null, versions: [] })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel')
    const w = await mountCenter()
    await rows(w)[0]!.trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="embedded-flow-board"]').exists()).toBe(true)
    const canvas = useFlowStore()
    useNodeStore().touchConfig('web-list')

    await w.get('[data-testid="new-structure-template"]').trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('配置还没保存'), '配置未保存', expect.anything())
    expect(canvas.flowId).toBe(FLOWS[0]!.id)
    expect(canvas.dirtyConfigNodes).toContain('web-list')
    expect(w.find('[data-testid="structure-template-save"]').exists()).toBe(false)
  })

  it('当前流程的步骤写入完成后才切换到新建模板', async () => {
    const flow = { ...FLOWS[0]!, id: '1400987' }
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(flow)
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ enabled: false, curVer: null, nextVer: null, publishId: null, draftId: null, versions: [] })
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([
      { stepId: '405100', sourceId: '-1', name: '流程入口', nodeType: 'entry', configId: '1400774', mainConfig: '1400774', flowId: flow.id, enabled: true, isRoot: true },
      { stepId: '405101', sourceId: '-1', name: '列表页', configId: '1400774', mainConfig: '1400774', flowId: flow.id, enabled: true, outputTable: '900' },
    ])
    let finishWrite!: (result: Awaited<ReturnType<typeof itemApi.stepModify>>) => void
    const modify = vi.spyOn(itemApi, 'stepModify').mockReturnValue(new Promise(resolve => { finishWrite = resolve }))
    const w = await mountCenter([flow])
    await rows(w)[0]!.trigger('click')
    await flushPromises()
    useFlowStore().setTitle('405101', '保存后再切换')

    await w.get('[data-testid="new-structure-template"]').trigger('click')
    await flushPromises()
    expect(modify).toHaveBeenCalledWith(expect.objectContaining({ stepId: '405101', name: '保存后再切换' }))
    expect(w.find('[data-testid="structure-template-save"]').exists()).toBe(false)

    finishWrite({ ok: true })
    await flushPromises()
    expect(w.find('[data-testid="structure-template-save"]').exists()).toBe(true)
  })

  it('切换到模板后，旧流程迟到的配置响应不会覆盖模板画布', async () => {
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ enabled: false, curVer: null, nextVer: null, publishId: null, draftId: null, versions: [] })
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([
      { stepId: '40353', sourceId: '-1', name: '旧流程节点', configId: '1400774', enabled: true, outputTable: '900' },
    ])
    let finishLoad!: (result: Awaited<ReturnType<typeof configApi.configDetail>>) => void
    const config = vi.spyOn(configApi, 'configDetail').mockReturnValue(new Promise(resolve => { finishLoad = resolve }))
    const w = await mountCenter()
    await rows(w)[0]!.trigger('click')
    await flushPromises()
    expect(config).toHaveBeenCalledWith(FLOWS[0]!.id)

    await w.get('[data-testid="new-structure-template"]').trigger('click')
    await flushPromises()
    finishLoad({ configId: FLOWS[0]!.id, name: '旧流程', url: 'https://example.com/list', entryTypeId: '900', enabled: true })
    await flushPromises()

    expect(useFlowStore().main).toEqual(['start', 'node-1', 'end'])
    expect(useFlowStore().flowIdMode).toBe(false)
    expect(w.get('[aria-label="模板名称"]').element).toHaveProperty('value', '单节点采集')
  })

  it('在流程工作区的节点库添加下载并调整顺序，只保存模板结构', async () => {
    class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({ list: [], total: 0 })
    const addConfig = vi.spyOn(configApi, 'addConfig')
    const save = vi.spyOn(flowCenterApi, 'save').mockResolvedValue({ ...FLOWS[0], isTemplate: true })
    try {
      const w = await mountCenter(FLOWS, FLOWS.length, undefined, true)
      vi.mocked(flowCenterApi.steps).mockClear()
      await w.get('[data-testid="new-structure-template"]').trigger('click')
      const workspace = w.get('[aria-label="流程工作区"]')
      await workspace.get('input[aria-label="URL"]').setValue('https://example.com/list?page=1')
      expect(workspace.get('[aria-label="节点设置"]').findAll('.rc-top-tab').map(tab => tab.text()))
        .toEqual(['节点配置', '表配置', '编排配置', '任务配置'])
      await workspace.get('[data-testid="node-library-toggle"]').trigger('click')
      const download = workspace.findAll('.anp-item').find(item => item.text().includes('文件下载'))
      expect(download).toBeDefined()
      await download!.trigger('click')
      const moveUp = workspace.findAll('button').find(button => button.text() === '上移')
      await moveUp!.trigger('click')
      expect(workspace.findAll('.rc-node-title').map(node => node.text())).toEqual(['文件下载', '采集'])
      expect(workspace.find('[data-testid="node-config-save"]').exists()).toBe(false)
      expect(workspace.find('[data-testid="flow-publish"]').exists()).toBe(false)
      expect(useFlowStore().flowIdMode).toBe(false)
      expect(flowCenterApi.detail).not.toHaveBeenCalled()
      expect(flowCenterApi.steps).not.toHaveBeenCalled()
      expect(workflowBindingApi.ensureDraft).not.toHaveBeenCalled()
      await workspace.get('[data-testid="structure-template-save"]').trigger('click')
      await flushPromises()
      const payload = save.mock.calls[0]![0]
      expect(payload).not.toHaveProperty('id')
      expect(payload).toMatchObject({ isTemplate: true, name: '单节点采集', seq: 0 })
      const definition = payload.definition
      expect(definition.structureOnly).toBe(true)
      const nodes = definition.main.slice(1, -1).map(id => definition.configs[id]!)
      expect(nodes.map(node => node.configType)).toEqual(['95', '90'])
      expect(nodes[0]?.collectCfg).toMatchObject({ collectorKind: 'file_download', url: '', inputTable: '', outputTable: '' })
      expect(nodes[0]).not.toHaveProperty('taskCfg')
      expect(nodes[1]).toMatchObject({ templateDefaults: true, configUrl: 'https://example.com/list?page=1' })
      expect(addConfig).not.toHaveBeenCalled()
      expect(w.find('[aria-label="流程工作区"]').exists()).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('所属模板筛选和待归集筛选都发到服务端', async () => {
    const w = await mountCenter()
    await w.get('[data-testid="flow-template-filter"]').setValue('template-1')
    expect(flowCenterApi.paged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, onlyTemplate: false, templateId: 'template-1', unassignedTemplate: false }))
    await w.get('[data-testid="flow-template-filter"]').setValue('unassigned')
    expect(flowCenterApi.paged).toHaveBeenLastCalledWith(expect.objectContaining({ unassignedTemplate: true, templateId: undefined }))
  })
  it('勾选后整批归集，只提交流程ID和模板ID', async () => {
    const assign = vi.spyOn(flowCenterApi, 'assignTemplate').mockResolvedValue({ ok: true })
    const save = vi.spyOn(flowCenterApi, 'save')
    const w = await mountCenter()
    await w.get('[data-testid="flow-select-page"]').setValue(true)
    await w.get('[data-testid="assign-selected-flows"]').trigger('click')
    await flushPromises()
    await w.get('[data-testid="assign-template-pick"]').setValue('template-1')
    await w.get('[data-testid="assign-template-submit"]').trigger('click')
    await flushPromises()
    expect(assign).toHaveBeenCalledWith(FLOWS.map(t => t.id), 'template-1')
    expect(save).not.toHaveBeenCalled()
    expect(w.get('[data-testid="assign-selected-flows"]').attributes('disabled')).toBeDefined()
  })
  it('新建流程未选择模板时不提交，模板不作为归集成员被勾选', async () => {
    const save = vi.spyOn(flowCenterApi, 'save')
    const w = await mountCenter([{ ...FLOWS[0], isTemplate: true }, FLOWS[1]!])
    expect(w.findAll('[data-testid="flow-select"]')).toHaveLength(1)
    await openCreateForm(w)
    await w.get('[data-testid="create-flow-template"]').setValue('')
    await w.get('[data-testid="create-flow-submit"]').trigger('click')
    await flushPromises()
    expect(save).not.toHaveBeenCalled()
  })
})

describe('按模板分组展示', () => {
  it('进入页面默认选中有流程的模板，分组数量取全局统计', async () => {
    vi.spyOn(flowCenterApi, 'templateGroups').mockResolvedValue([
      { id: 'single', name: '单节点采集', structure: '采集', flowCount: 120, disabled: false },
      { id: 'detail', name: '列表 + 详情', structure: '列表采集 → 详情采集', flowCount: 40, disabled: false },
      { id: 'unassigned', name: '未归类', structure: '尚未选择流程模板', flowCount: 9, disabled: false },
    ])
    const w=await mountCenter(FLOWS,120)
    expect(w.get('[data-testid="flow-template-group-single"]').attributes('aria-pressed')).toBe('true')
    expect(w.get('[data-testid="flow-template-group-single"]').text()).toContain('120')
    expect(w.get('[data-testid="flow-group-heading"]').text()).toContain('单节点采集')
    expect(flowCenterApi.paged).toHaveBeenLastCalledWith(expect.objectContaining({ page:1,templateId:'single',onlyTemplate:false }))
    await w.get('[data-testid="flow-template-group-detail"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-testid="flow-group-heading"]').text()).toContain('列表采集 → 详情采集')
    expect(flowCenterApi.paged).toHaveBeenLastCalledWith(expect.objectContaining({ page:1,templateId:'detail' }))
    await w.get('[data-testid="flow-template-group-unassigned"]').trigger('click')
    expect(flowCenterApi.paged).toHaveBeenLastCalledWith(expect.objectContaining({ page:1,templateId:undefined,unassignedTemplate:true }))
  })
  it('模板为空或没有已归类流程时优先显示未归类，零数量分组仍保留', async () => {
    vi.spyOn(flowCenterApi, 'templateGroups').mockResolvedValue([
      { id:'empty',name:'空模板',structure:'采集',flowCount:0,disabled:false },
      { id:'unassigned',name:'未归类',structure:'尚未选择流程模板',flowCount:21,disabled:false },
    ])
    const w=await mountCenter()
    expect(w.get('[data-testid="flow-template-group-empty"]').text()).toContain('0')
    expect(w.get('[data-testid="flow-template-group-unassigned"]').attributes('aria-pressed')).toBe('true')
    expect(flowCenterApi.paged).toHaveBeenLastCalledWith(expect.objectContaining({ unassignedTemplate:true }))
    expect(w.find('[data-testid="flow-group-edit"]').exists()).toBe(false)
  })
  it('没有归集流程的模板也可以从分组直接打开编辑器', async () => {
    const template = {
      id: 'empty', name: '列表详情模板', seq: 12, isTemplate: true, updatedAt: '',
      definition: makeStructureTemplate(['web-list', 'web-detail']),
    }
    const detail = vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(template)
    vi.spyOn(flowCenterApi, 'templateGroups').mockResolvedValue([
      { id: template.id, name: template.name, structure: '列表采集 → 详情采集', flowCount: 0, disabled: false },
    ])
    const w = await mountCenter([])
    await w.get('[data-testid="flow-group-edit"]').trigger('click')
    await flushPromises()

    expect(detail).toHaveBeenCalledWith(template.id)
    expect(w.get('input[aria-label="模板名称"]').element).toHaveProperty('value', template.name)
    expect(w.get('[data-testid="flow-meta-seq"]').element).toHaveProperty('value', '12')
    expect(w.get('[data-testid="structure-template-save"]').text()).toBe('保存模板')
    expect(useFlowStore().main).toEqual(['start', 'node-1', 'node-2', 'end'])
    expect(flowCenterApi.steps).not.toHaveBeenCalled()
  })
  it('模板有未保存改动时确认再切换，保存后可以直接编辑另一模板', async () => {
    const first = { id: 't1', name: '第一个模板', seq: 0, isTemplate: true, updatedAt: '', definition: makeStructureTemplate(['web-list']) }
    const second = { ...first, id: 't2', name: '第二个模板' }
    vi.spyOn(flowCenterApi, 'detail').mockImplementation(async id => id === first.id ? first : second)
    vi.spyOn(flowCenterApi, 'templateGroups').mockResolvedValue([first, second].map(({ id, name }) => ({
      id, name, flowCount: 0, structure: '采集', disabled: false,
    })))
    vi.spyOn(flowCenterApi, 'save').mockResolvedValue({ ...first, seq: 7 })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel')
    const w = await mountCenter([])
    const editGroup = () => w.get('[data-testid="flow-group-edit"]').trigger('click')
    await editGroup()
    await flushPromises()
    await w.get('[data-testid="flow-meta-seq"]').setValue('7')
    await w.get('[data-testid="flow-template-group-t2"]').trigger('click')
    await editGroup()
    await flushPromises()

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(w.get('input[aria-label="模板名称"]').element).toHaveProperty('value', first.name)
    await w.get('[data-testid="structure-template-save"]').trigger('click')
    await flushPromises()
    await editGroup()
    await flushPromises()
    expect(w.get('input[aria-label="模板名称"]').element).toHaveProperty('value', second.name)
    expect(confirm).toHaveBeenCalledTimes(1)
  })
  it('停用模板仍可查看成员，不能直接从它新建流程', async () => {
    vi.spyOn(flowCenterApi,'templateGroups').mockResolvedValue([
      { id:'old',name:'停用模板',structure:'列表 → 详情',flowCount:50,disabled:true },
      { id:'unassigned',name:'未归类',structure:'尚未选择流程模板',flowCount:0,disabled:false },
    ])
    const w=await mountCenter()
    await w.get('[data-testid="flow-template-group-old"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-testid="flow-group-heading"]').text()).toContain('停用模板')
    expect(w.find('[data-testid="flow-group-create"]').exists()).toBe(false)
    expect(w.find('[data-testid="flow-group-edit"]').exists()).toBe(true)
  })
  it('列表详情预置生成两个网页节点，详情节点保留详情身份', async () => {
    const save=vi.spyOn(flowCenterApi,'save').mockResolvedValue({ ...FLOWS[0],isTemplate:true })
    const w=await mountCenter()
    await w.get('[data-testid="new-structure-template"]').trigger('click')
    await w.get('[data-testid="structure-preset-detail"]').trigger('click')
    await w.get('[data-testid="structure-template-save"]').trigger('click')
    await flushPromises()
    const definition=save.mock.calls[0]![0].definition
    expect(definition.configs['node-1']!.title).toBe('列表采集')
    expect(definition.configs['node-2']!.title).toBe('详情采集')
    expect(definition.configs['node-2']!.configType).toBe('90')
    expect(definition.configs['node-2']!.collectCfg?.isDetail).toBe(true)
  })
  it('分组加载失败时显示真实错误并允许重试', async () => {
    vi.spyOn(flowCenterApi,'templateGroups').mockRejectedValueOnce(new Error('分组接口未就绪')).mockResolvedValue([
      { id:'unassigned',name:'未归类',structure:'尚未选择流程模板',flowCount:0,disabled:false },
    ])
    const w=await mountCenter()
    expect(w.get('[role="alert"]').text()).toContain('分组接口未就绪')
    await w.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(false)
    expect(w.find('[data-testid="flow-template-group-unassigned"]').exists()).toBe(true)
  })
})

describe('模板SEQ排序',()=>{
  it('编辑模板回填SEQ，保存零值不丢失', async()=>{
    const template={...FLOWS[0],id:'template-1',seq:30,isTemplate:true,definition:makeStructureTemplate(['web-list'])}
    vi.spyOn(flowCenterApi,'detail').mockResolvedValue(template)
    const save=vi.spyOn(flowCenterApi,'save').mockResolvedValue({...template,seq:0})
    const w=await mountCenter([template])
    vi.mocked(flowCenterApi.steps).mockClear()
    await w.get('[data-testid="flow-center-row"]').trigger('click')
    await flushPromises()
    expect((w.get('[data-testid="flow-meta-seq"]').element as HTMLInputElement).value).toBe('30')
    expect(flowCenterApi.steps).not.toHaveBeenCalled()
    expect(workflowBindingApi.ensureDraft).not.toHaveBeenCalled()
    await w.get('[data-testid="flow-meta-seq"]').setValue('0')
    await w.get('[data-testid="structure-template-save"]').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({id:'template-1',seq:0,isTemplate:true}))
  })
  it('无效模板SEQ不提交', async()=>{
    const save=vi.spyOn(flowCenterApi,'save')
    const w=await mountCenter()
    await w.get('[data-testid="new-structure-template"]').trigger('click')
    await w.get('[data-testid="flow-meta-seq"]').setValue('-1')
    await w.get('[data-testid="structure-template-save"]').trigger('click')
    await flushPromises()
    expect(save).not.toHaveBeenCalled()
  })
  it('多分类合并排序也按SEQ和流程ID排序，不退化成更新时间排序', async()=>{
    const flows=[
      {...FLOWS[0],id:'10',seq:20,categoryId:'c1'},
      {...FLOWS[0],id:'3',seq:0,categoryId:'c2'},
      {...FLOWS[0],id:'2',seq:0,categoryId:'c1'},
    ] as FlowRecord[]
    const w=await mountCenter(flows)
    await w.get('[data-testid="flow-center-sort"]').setValue('seq-asc')
    const setup=(w.vm.$ as unknown as {setupState:{onFilterCategoryChange:(v:string[])=>void}}).setupState
    setup.onFilterCategoryChange(['c1','c2'])
    await flushPromises()
    const ids=rows(w).map(row=>row.find('small').text())
    expect(ids).toEqual(['2 · v1','3 · v1','10 · v1'])
    expect(flowCenterApi.paged).toHaveBeenLastCalledWith(expect.objectContaining({field:'seq',order:'asc'}))
  })
})

it('模板管理列表默认按SEQ升序展示',async()=>{
  const w=await mountCenter()
  await w.get('[data-testid="flow-center-scope"]').setValue('template')
  await flushPromises()
  expect(flowCenterApi.paged).toHaveBeenLastCalledWith(expect.objectContaining({onlyTemplate:true,field:'seq',order:'asc'}))
})
