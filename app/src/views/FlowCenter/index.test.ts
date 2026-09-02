// @vitest-environment jsdom
// 流程中心（0828 W6）。核心口径 §2.11：**节点就是配置**——
// 配置只作为搜索的输入，结果永远是流程列表；不出现「配置列表」这一屏。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import FlowCenter from './index.vue'
import { configApi, flowCenterApi, sourceApi, type FlowRecord } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { useUiStore } from '@/stores/ui'

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

afterEach(() => vi.restoreAllMocks())

async function mountCenter(flows: FlowRecord[] = FLOWS, total = flows.length) {
  vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total, list: flows })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/flows', component: { template: '<div/>' } }, { path: '/rules', component: { template: '<div/>' } }] })
  await router.push('/flows'); await router.isReady()
  const pinia = createPinia(); setActivePinia(pinia)
  const wrapper = mount(FlowCenter, {
    global: {
      plugins: [pinia, router],
      directives: { loading: {} },
      stubs: {
        FlowBoard: { props: ['embedded'], template: '<div data-testid="embedded-flow-board">流程画布</div>' },
        NodeInspector: { props: ['hideAi'], template: '<div data-testid="embedded-node-inspector">节点配置 表配置 编排配置 参数配置 任务配置</div>' },
        GlobalSourceSelect: {
          props: ['modelValue'], emits: ['update:modelValue'],
          template: '<input data-testid="source-select-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        'el-dialog': { props: ['modelValue'], template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>' },
      },
    },
  })
  await flushPromises()
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
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ page: 1, keywords: undefined, field: 'updateDt' }))
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
    expect(labels).toEqual(['查询', '清空'])
  })

  it('新建流程后自动重查列表', async () => {
    const created = { ...FLOWS[1], id: 'flow-new', name: '新流程' } as FlowRecord
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '新流程', action: 'confirm' } as never)
    vi.spyOn(flowCenterApi, 'save').mockResolvedValue(created)
    const w = await mountCenter()
    const paged = vi.mocked(flowCenterApi.paged)
    paged.mockClear()
    useUiStore().fireAction('新建流程')
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
describe('流程中心 · 操作列', () => {
  const actions = (w: Awaited<ReturnType<typeof mountCenter>>) =>
    rows(w)[0].findAll('.fc-actions button').map((b) => b.text())

  it('只有编辑、关联到源、删除流程三个操作', async () => {
    const w = await mountCenter()
    expect(actions(w)).toEqual(['编辑', '关联到源', '删除流程'])
  })

  it('删除前二次确认，并把关联源数写进确认文案', async () => {
    const w = await mountCenter([{ ...FLOWS[0], sourceCnt: 7 }])
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const remove = vi.spyOn(flowCenterApi, 'remove').mockResolvedValue({ ok: true })
    await w.get('[data-testid="flow-delete"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('关联 7 个源'),
      '删除流程',
      expect.anything(),
    )
    expect(remove).toHaveBeenCalledWith(['flow-10086'])
  })

  it('取消确认时不发删除请求', async () => {
    const w = await mountCenter()
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const remove = vi.spyOn(flowCenterApi, 'remove')
    await w.get('[data-testid="flow-delete"]').trigger('click')
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()
  })

  it('删除失败时抛后端原文，不谎报成功', async () => {
    const w = await mountCenter()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(flowCenterApi, 'remove').mockResolvedValue({ ok: false, message: '未找到流程ID，ids=flow-10086' })
    const error = vi.spyOn(ElMessage, 'error')
    await w.get('[data-testid="flow-delete"]').trigger('click')
    await flushPromises()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('未找到流程ID'))
  })
})

describe('流程中心 · 可编辑工作区', () => {
  // 0902 联调修：列表走 flowPaged，不返回 flowConf，行上的 definition 恒为空流程。
  // 工作区必须自己去 flowDetail 取完整定义，否则点开任何已有流程都是空画布，
  // 一保存还会把真实 flowConf 覆盖成空。这两条用例的 detail 桩就是在锁这件事。
  it('点行打开工作区：去 flowDetail 取完整定义载入画布，而不是用列表行的空 definition', async () => {
    const detail = vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(FLOWS[0])
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
    const apply = rows(w)[0].findAll('button').find((button) => button.text() === '关联到源')!
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
    const apply = rows(w)[0].findAll('button').find((button) => button.text() === '关联到源')!
    await apply.trigger('click')
    await w.get('[data-testid="source-select-stub"]').setValue('source-1')
    await w.get('[data-testid="flow-apply-confirm"]').trigger('click')
    await flushPromises()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('目标流程不存在或已删除'))
  })
})
