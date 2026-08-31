// @vitest-environment jsdom
// 流程中心（0828 W6）。核心口径 §2.11：**节点就是配置**——
// 配置只作为搜索的输入，结果永远是流程列表；不出现「配置列表」这一屏。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import FlowCenter from './index.vue'
import { flowApi, flowCenterApi, sourceApi, type FlowRecord } from '@/api'
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

async function mountCenter() {
  vi.spyOn(flowCenterApi, 'list').mockResolvedValue(FLOWS)
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
  it('列出流程，节点数不算 start/end 两个终端', async () => {
    const w = await mountCenter()
    expect(rows(w).length).toBe(2)
    expect(rows(w)[0].text()).toContain('2 个')
  })

  it('使用源数不编造：后端没有「按流程反查源」的接口，显示 —', async () => {
    const w = await mountCenter()
    expect(rows(w)[0].text()).toContain('—')
  })

  it('按流程名搜', async () => {
    const w = await mountCenter()
    await search(w).setValue('微信')
    expect(rows(w).length).toBe(1)
  })

  it('按节点名（= 配置名）搜', async () => {
    const w = await mountCenter()
    await search(w).setValue('详情页')
    expect(rows(w).length).toBe(1)
    expect(rows(w)[0].text()).toContain('新闻采集标准流程')
  })

  // §2.11 规则②：配置只能作为搜索的输入，**命中结果仍然是流程列表**
  it('按配置 ID 搜，结果仍是流程行，并说明是反查', async () => {
    const w = await mountCenter()
    await search(w).setValue('1400765')
    expect(rows(w).length).toBe(1)
    expect(w.get('[data-testid="flow-center-search-note"]').text()).toContain('命中 1 条流程')
  })

  // §2.11 规则⑤：搜到 0 条不能笼统说「无结果」，要说清配置本身可能存在
  it('配置没有被任何流程引用时给明确提示，而不是笼统的无结果', async () => {
    const w = await mountCenter()
    await search(w).setValue('1409999')
    expect(rows(w).length).toBe(0)
    expect(w.get('[data-testid="flow-center-search-note"]').text()).toContain('没有被任何流程引用')
  })

  it('顶部新建流程动作会创建空白流程并直接打开工作区', async () => {
    const created = { ...FLOWS[1], id: 'flow-new', name: '新流程', definition: { main: ['start', 'end'], branches: [], configs: {} } } as FlowRecord
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '新流程', action: 'confirm' } as never)
    const save = vi.spyOn(flowCenterApi, 'save').mockResolvedValue(created)
    const w = await mountCenter()
    useUiStore().fireAction('新建流程')
    await flushPromises()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: '新流程' }))
    expect(w.get('.fd-name').element).toHaveProperty('value', '新流程')
  })
})

describe('流程中心 · 可编辑工作区', () => {
  it('点行打开工作区，并把原流程载入复用画布', async () => {
    const w = await mountCenter()
    await rows(w)[0].trigger('click')
    expect(w.find('.fd-drawer').exists()).toBe(true)
    expect(w.find('[data-testid="embedded-flow-board"]').exists()).toBe(true)
    expect(useFlowStore().main).toEqual(['start', 'web-list', 'web-detail', 'end'])
  })

  it('右侧直接复用节点设置，且流程中心不展示 AI 对话', async () => {
    const w = await mountCenter()
    await rows(w)[0].trigger('click')
    const inspector = w.get('[data-testid="embedded-node-inspector"]')
    expect(inspector.text()).toContain('节点配置')
    expect(inspector.text()).toContain('任务配置')
    expect(w.find('.fd-drawer').text()).not.toContain('AI 对话')
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

  it('应用到源会清空旧绑定并以当前流程全量保存', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({
      sourceId: 'source-1', name: '目标源', url: 'https://example.com', configId: '', mainTable: '', owner: '', state: 'C',
      nodeBindings: { old: { outputTable: 'OLD' } },
    })
    const sourceUpdate = vi.spyOn(sourceApi, 'sourceUpdate').mockResolvedValue({ ok: true })
    const flowSave = vi.spyOn(flowApi, 'flowSave').mockResolvedValue({ ok: true })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const w = await mountCenter()
    const apply = rows(w)[0].findAll('button').find((button) => button.text() === '应用到源')!
    await apply.trigger('click')
    await w.get('[data-testid="source-select-stub"]').setValue('source-1')
    await w.get('[data-testid="flow-apply-confirm"]').trigger('click')
    await flushPromises()
    expect(sourceUpdate).toHaveBeenCalledWith(expect.objectContaining({ nodeBindings: {}, templateId: 'flow-10086' }))
    expect(flowSave).toHaveBeenCalledWith(expect.objectContaining({
      main: ['start', 'web-list', 'web-detail', 'end'],
      configs: expect.objectContaining({ 'web-list': expect.objectContaining({ configId: '1400774' }) }),
    }))
  })
})
