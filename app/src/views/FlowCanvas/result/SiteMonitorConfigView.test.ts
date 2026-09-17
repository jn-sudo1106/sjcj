// @vitest-environment jsdom
// 监控视图「监控配置」Tab（0916，0917 改版）：网站态没有画布，节点得由本组件自己按源拉步骤拼出来。
//
// **本文件测的是这个容器**：按源拼种子、只列数据监控节点、以及它 provide 给编排 Tab 的那个
// 编辑上下文（读写落在本地种子上）、还有两条保存通路的分工。
// 编排 Tab 本身（监控方法/描述/模型/生成脚本/告警面板）的字段级行为在
// inspector/tabs/RuleOrchestrationTab.test.ts 里测——这里把它换成读取上下文的桩，
// 这样"容器给了 Tab 什么"是一眼可见的，不用连带 mock 一整套模型/提示词接口。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import SiteMonitorConfigView from './SiteMonitorConfigView.vue'
import { useNodeEditorContext } from '@/views/FlowCanvas/inspector/nodeEditorContext'
import type { MonitorAlertConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { ckSourceApi, entryApi, sourceApi, type Source, type Step } from '@/api'

const SOURCE: Source = {
  sourceId: '1400995', name: '沐言社媒', url: 'https://example.com', configId: 'cfg-1',
  mainTable: 'sense_data.tb_my', owner: 'admin', state: 'C',
}

/** 一个采集步骤 + 一个数据监控步骤：只有后者该出现在节点下拉里。 */
function steps(sourceId = SOURCE.sourceId): Step[] {
  return [
    { stepId: 'st1', sourceId, name: '抓取列表页', outputTable: 'TB_RAW', enabled: true },
    { stepId: 'st2', sourceId, name: '数据监控', nodeType: 'monitor', inputTable: 'TB_RAW', outputTable: 'TB_RAW', enabled: true },
  ]
}

const DEFAULT_SNAPSHOT: MonitorAlertConfig = {
  enabled: true,
  policies: [{
    name: '数据延迟超过阈值', metric: 'delay_minutes', operator: 'gt', threshold: '30',
    consecutiveCount: 3, repeatMinutes: 30, recoveryNotify: true, enabled: true, channelTypes: ['email'],
  }],
  channels: [{ type: 'email', enabled: true, target: 'ops@example.com' }],
}
const EDITED_SNAPSHOT: MonitorAlertConfig = {
  ...DEFAULT_SNAPSHOT,
  policies: [{ ...DEFAULT_SNAPSHOT.policies[0], threshold: '120' }],
}

/** 编排 Tab 桩：只做一件事——把注入到的编辑上下文暴露出来按需驱动。 */
const RuleOrchestrationTabStub = defineComponent({
  name: 'RuleOrchestrationTab',
  setup() {
    const ctx = useNodeEditorContext()
    return { ctx }
  },
  render() {
    return h('div', { 'data-testid': 'orch-tab' }, [
      h('span', { 'data-testid': 'orch-node' }, this.ctx.id.value),
      h('button', { 'data-testid': 'orch-patch', onClick: () => this.ctx.patch({ describe: '拍了拍描述' }) }),
      h('button', { 'data-testid': 'orch-methods', onClick: () => this.ctx.setMonitorMethods(['当日数据是否正常入库']) }),
      h('button', { 'data-testid': 'orch-alert', onClick: () => this.ctx.setMonitorAlertConfig(DEFAULT_SNAPSHOT) }),
    ])
  },
})

const stubs = {
  SiteSourceSelect: { name: 'SiteSourceSelect', props: ['modelValue'], template: '<div />', emits: ['update:modelValue'] },
  RuleOrchestrationTab: RuleOrchestrationTabStub,
}

function mountView(sourceId = '') {
  return mount(SiteMonitorConfigView, {
    props: { siteId: 'site-4', sourceId },
    global: { stubs },
  })
}

/** 选择源＝子组件 emit + 父组件把新 prop 传回来（v-model 的两半，测试里得自己接上） */
async function pickSource(wrapper: ReturnType<typeof mountView>, sourceId = SOURCE.sourceId) {
  await wrapper.findComponent({ name: 'SiteSourceSelect' }).vm.$emit('update:modelValue', sourceId)
  await wrapper.setProps({ sourceId })
  await flushPromises()
}

/** 点桩上的按钮＝走一遍注入上下文的写回通路 */
async function driveContext(wrapper: ReturnType<typeof mountView>, testid: string) {
  await wrapper.get(`[data-testid="${testid}"]`).trigger('click')
  await flushPromises()
}

afterEach(() => vi.restoreAllMocks())

describe('SiteMonitorConfigView', () => {
  it('网站里没有源可挑时也给全套控件（草稿节点），不去拉源详情', async () => {
    const detail = vi.spyOn(sourceApi, 'sourceDetail')
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-testid="orch-tab"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="site-monitor-draft-note"]').text()).toContain('选个源')
    // 没有源就没有落库目标，保存按钮只做展示
    expect(wrapper.get('[data-testid="site-monitor-config-save"]').attributes('disabled')).toBeDefined()
    expect(detail).not.toHaveBeenCalled()
  })

  it('进来默认停在「全部源」，照样给全套控件（草稿节点），不自动预置某个源', async () => {
    const plain: Source = { ...SOURCE, sourceId: '111', name: '纯采集源' }
    const monitorSource: Source = { ...SOURCE, sourceId: '222', name: '有监控的源' }
    const detail = vi.spyOn(sourceApi, 'sourceDetail').mockImplementation(async (id: string) => (id === '222' ? monitorSource : plain))
    vi.spyOn(sourceApi, 'sourceSteps').mockImplementation(async (id: string) => (id === '222'
      ? steps(id)
      : [{ stepId: 's1', sourceId: id, name: '抓取列表页', outputTable: 'TB_RAW', enabled: true }]))
    const wrapper = mountView()
    await flushPromises()
    await flushPromises()

    // 下拉框保持"全部源"：不替用户选源，也不去读任何源的详情
    expect(wrapper.findComponent({ name: 'SiteSourceSelect' }).props('modelValue')).toBe('')
    expect(detail).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="orch-tab"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="site-monitor-draft-note"]').text()).toContain('选个源')
    // 没选源就没有落库目标，保存按钮只做展示
    expect(wrapper.get('[data-testid="site-monitor-config-save"]').attributes('disabled')).toBeDefined()
    // 「全部源」只在本档内生效：不往父级 emit，免得把「监控结果」那档的源也改掉
    expect(wrapper.emitted('update:sourceId')).toBeUndefined()
  })

  it('源上有数据监控节点时用真实节点，不显示草稿提示', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(steps())
    const wrapper = mountView()
    await pickSource(wrapper)

    const options = wrapper.findAll('select[aria-label="数据监控节点"] option')
    expect(options.map((o) => o.text())).toEqual(['数据监控'])
    // 编辑上下文（编排 Tab 拿到的那个）指向真实节点——Tab 里所有读写都由它决定落点
    expect(wrapper.find('[data-testid="orch-tab"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="orch-node"]').text()).toBe('st2')
    expect(wrapper.find('[data-testid="site-monitor-draft-note"]').exists()).toBe(false)
  })

  it('源上没有数据监控节点也用草稿节点把控件铺出来（没有节点也能配监控）', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
      { stepId: 'st1', sourceId: SOURCE.sourceId, name: '抓取列表页', outputTable: 'TB_RAW', enabled: true },
    ])
    const wrapper = mountView()
    await pickSource(wrapper)

    expect(wrapper.find('[data-testid="orch-tab"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="orch-node"]').text()).toBe('__draft_monitor__')
    expect(wrapper.get('[data-testid="site-monitor-draft-note"]').text()).toContain('还没有数据监控节点')
    expect(wrapper.findAll('select[aria-label="数据监控节点"] option').map((o) => o.text())).toEqual(['数据监控'])
  })

  it('草稿态保存只合入告警字段，不拿草稿默认值覆盖线上真实的监控方法与脚本', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
      { stepId: 'st1', sourceId: SOURCE.sourceId, name: '抓取列表页', outputTable: 'TB_RAW', enabled: true },
    ])
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([{
      id: 3,
      sourceId: 1400995,
      checkConf: JSON.stringify({
        monitorMethods: ['当日数据是否正常入库'],
        orchestration: { inputTable: 'TB_RAW', scriptPath: '/code01/real.py' },
        minSize: '1',
      }),
    }])
    const update = vi.spyOn(ckSourceApi, 'update').mockResolvedValue(true)

    const wrapper = mountView()
    await pickSource(wrapper)
    await driveContext(wrapper, 'orch-methods')
    await driveContext(wrapper, 'orch-alert')
    const ctx = wrapper.findComponent(RuleOrchestrationTabStub).vm.ctx
    ctx.setMonitorAlertConfig(EDITED_SNAPSHOT)
    await flushPromises()

    await wrapper.get('[data-testid="site-monitor-config-save"]').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledTimes(1)
    const conf = JSON.parse(update.mock.calls[0][0].checkConf ?? '{}')
    expect(conf.minSize).toBe('120')
    // 线上原有的监控方法与脚本路径原样保留——草稿里的默认值不能盖上去
    expect(conf.monitorMethods).toEqual(['当日数据是否正常入库'])
    expect(conf.orchestration.scriptPath).toBe('/code01/real.py')
  })

  it('监控配置页不出现「上传 Excel」入口，生成脚本 / 测试脚本照旧（0917 产品口径）', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(steps())
    // 真实 Tab 挂载时会自己去拉模型/提示词（画布上也是它自己拉），这里把 fetch 兜住，
    // 免得 jsdom 里发不出请求留下一串 unhandled rejection
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    // 这条要挂**真实**的编排 Tab（其余用例都把它换成桩），才能验到按钮真的不在界面上
    const wrapper = mount(SiteMonitorConfigView, {
      props: { siteId: 'site-4', sourceId: SOURCE.sourceId },
      global: {
        stubs: {
          SiteSourceSelect: { name: 'SiteSourceSelect', props: ['modelValue'], template: '<div />', emits: ['update:modelValue'] },
        },
      },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="main-upload-excel"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="main-excel-file-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="main-generate-script"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="main-test-script"]').exists()).toBe(true)
  })

  it('源加载失败时给出错误与重试', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(null)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([])
    const wrapper = mountView()
    await pickSource(wrapper)

    expect(wrapper.text()).toContain('源不存在或加载失败')
    expect(wrapper.get('.smc-empty button.rc-btn').text()).toContain('重试')
  })

  it('面板一挂载就交给我们的默认策略不算改动，保存按钮保持禁用', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(steps())
    const update = vi.spyOn(ckSourceApi, 'update')
    const wrapper = mountView()
    await pickSource(wrapper)

    await driveContext(wrapper, 'orch-alert')
    await flushPromises()

    const save = wrapper.get('[data-testid="site-monitor-config-save"]')
    expect(save.attributes('disabled')).toBeDefined()
    await save.trigger('click')
    expect(update).not.toHaveBeenCalled()
  })

  it('只动告警：保存只把告警相关的键合进 checkConf，保留监控方法与编排', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(steps())
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([{
      id: 3,
      sourceId: 1400995,
      checkConf: JSON.stringify({
        monitorMethods: ['当日数据是否正常入库'],
        orchestration: { inputTable: 'TB_RAW', scriptPath: '/code01/real.py' },
        minSize: '1',
        cond: 'old cond',
      }),
    }])
    const update = vi.spyOn(ckSourceApi, 'update').mockResolvedValue(true)

    const wrapper = mountView()
    await pickSource(wrapper)
    await driveContext(wrapper, 'orch-alert')
    // 第一次是挂载快照，第二次才是用户改动
    const ctx = wrapper.findComponent(RuleOrchestrationTabStub).vm.ctx
    ctx.setMonitorAlertConfig(EDITED_SNAPSHOT)
    await flushPromises()

    const save = wrapper.get('[data-testid="site-monitor-config-save"]')
    expect(save.attributes('disabled')).toBeUndefined()
    await save.trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledTimes(1)
    const payload = update.mock.calls[0][0]
    expect(payload.sourceId).toBe(1400995)
    const conf = JSON.parse(payload.checkConf ?? '{}')
    expect(conf.minSize).toBe('120')
    expect(conf.monitorMethods).toEqual(['当日数据是否正常入库'])
    expect(conf.orchestration.scriptPath).toBe('/code01/real.py')
    // 存过之后又回到干净态，避免同一次改动重复写
    expect(wrapper.get('[data-testid="site-monitor-config-save"]').attributes('disabled')).toBeDefined()
  })

  it('动过编排字段（监控方法/描述）：整包写 ck_source，监控方法跟着走', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(steps())
    // 步骤里只有输入表 ID，整包保存时要按 ID 回查一次物理表名（syncMonitorCkSource 里的老口径）
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue({ tableId: 'TB_RAW', tableName: 'sense_data.TB_RAW', fields: [] } as never)
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([{ id: 3, sourceId: 1400995, checkConf: '{}' }])
    const update = vi.spyOn(ckSourceApi, 'update').mockResolvedValue(true)

    const wrapper = mountView()
    await pickSource(wrapper)
    await driveContext(wrapper, 'orch-methods')
    await driveContext(wrapper, 'orch-patch')

    await wrapper.get('[data-testid="site-monitor-config-save"]').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledTimes(1)
    const payload = update.mock.calls[0][0]
    expect(payload.tableName).toBe('sense_data.TB_RAW')
    const conf = JSON.parse(payload.checkConf ?? '{}')
    expect(conf.monitorMethods).toEqual(['当日数据是否正常入库'])
    expect(conf.orchestration.describe).toBe('拍了拍描述')
    // 告警面板没动过：不把面板里那份演示默认策略写上线，告警键仍留给 ck_source 原值
    expect(conf.minSize).toBeUndefined()
  })

  it('换源时清掉上一个源的改动，不会把它的修改写进新源', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(steps())
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([{ id: 3, sourceId: 1400995, checkConf: '{}' }])
    const update = vi.spyOn(ckSourceApi, 'update').mockResolvedValue(true)

    const wrapper = mountView()
    await pickSource(wrapper)
    await driveContext(wrapper, 'orch-alert')
    const ctx = wrapper.findComponent(RuleOrchestrationTabStub).vm.ctx
    ctx.setMonitorAlertConfig(EDITED_SNAPSHOT)
    await flushPromises()
    await pickSource(wrapper, 'other-source')
    await flushPromises()

    expect(wrapper.get('[data-testid="site-monitor-config-save"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="site-monitor-config-save"]').trigger('click')
    expect(update).not.toHaveBeenCalled()
  })
})
