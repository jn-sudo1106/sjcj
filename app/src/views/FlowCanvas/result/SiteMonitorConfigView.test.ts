// @vitest-environment jsdom
// 监控视图「监控配置」Tab（0916）：网站态没有画布，节点得由本组件自己按源拉步骤拼出来。
// 这里验证接线：未选源不发请求、监控节点只列数据监控节点、保存只写告警字段、
// 以及"没改过不让保存"——面板挂载时会 emit 一次演示默认策略，拿它去写会把线上阈值覆盖掉。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SiteMonitorConfigView from './SiteMonitorConfigView.vue'
import { ckSourceApi, sourceApi, type Source, type Step } from '@/api'

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

const AlertConfigPanelStub = {
  name: 'AlertConfigPanel',
  props: ['nodeId', 'nodeTitle', 'sourceLabel', 'scriptPath'],
  emits: ['update:alert-config'],
  template: '<div data-testid="alert-panel" />',
}

const stubs = {
  SiteSourceSelect: { name: 'SiteSourceSelect', template: '<div />', emits: ['update:modelValue'] },
  AlertConfigPanel: AlertConfigPanelStub,
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

/** 面板首帧那次 emit 是基线（演示默认值），第二次才是用户改动。 */
function emitAlertConfig(wrapper: ReturnType<typeof mountView>, config: Record<string, unknown>) {
  return wrapper.findComponent({ name: 'AlertConfigPanel' }).vm.$emit('update:alert-config', config)
}

const DEFAULT_SNAPSHOT = {
  enabled: true,
  policies: [{
    name: '数据延迟超过阈值', metric: 'delay_minutes', operator: 'gt', threshold: '30',
    consecutiveCount: 3, repeatMinutes: 30, recoveryNotify: true, enabled: true, channelTypes: ['email'],
  }],
  channels: [{ type: 'email', enabled: true, target: 'ops@example.com' }],
}
const EDITED_SNAPSHOT = { ...DEFAULT_SNAPSHOT, policies: [{ ...DEFAULT_SNAPSHOT.policies[0], threshold: '120' }] }

afterEach(() => vi.restoreAllMocks())

describe('SiteMonitorConfigView', () => {
  it('未选源时提示先选源，不拉源和步骤', async () => {
    const detail = vi.spyOn(sourceApi, 'sourceDetail')
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-testid="site-monitor-need-source"]').exists()).toBe(true)
    expect(detail).not.toHaveBeenCalled()
  })

  it('选中源后只把数据监控节点列进下拉，并默认选中第一个', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(steps())
    const wrapper = mountView()
    await pickSource(wrapper)

    const options = wrapper.findAll('select[aria-label="数据监控节点"] option')
    expect(options.map((o) => o.text())).toEqual(['数据监控'])
    expect(wrapper.find('[data-testid="alert-panel"]').exists()).toBe(true)
    // 面板上下文用源名 + 输入表，跟单源画布那版一致
    const panel = wrapper.findComponent({ name: 'AlertConfigPanel' })
    expect(panel.props('sourceLabel')).toBe('沐言社媒 / TB_RAW')
    expect(panel.props('nodeTitle')).toBe('数据监控')
  })

  it('该源没有数据监控节点时给出引导，不渲染配置面板', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
      { stepId: 'st1', sourceId: SOURCE.sourceId, name: '抓取列表页', outputTable: 'TB_RAW', enabled: true },
    ])
    const wrapper = mountView()
    await pickSource(wrapper)

    expect(wrapper.find('[data-testid="site-monitor-no-node"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="alert-panel"]').exists()).toBe(false)
  })

  it('源加载失败时给出错误与重试，不让面板挂在空节点上', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(null)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([])
    const wrapper = mountView()
    await pickSource(wrapper)

    expect(wrapper.text()).toContain('源不存在或加载失败')
    expect(wrapper.find('button.rc-btn').text()).toContain('重试')
    expect(wrapper.find('[data-testid="alert-panel"]').exists()).toBe(false)
  })

  it('面板一挂载就交给我们的默认策略不算改动，保存按钮保持禁用', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(steps())
    const update = vi.spyOn(ckSourceApi, 'update')
    const wrapper = mountView()
    await pickSource(wrapper)

    await emitAlertConfig(wrapper, DEFAULT_SNAPSHOT)
    await flushPromises()

    const save = wrapper.get('[data-testid="site-monitor-config-save"]')
    expect(save.attributes('disabled')).toBeDefined()
    await save.trigger('click')
    expect(update).not.toHaveBeenCalled()
  })

  it('改动后保存：只把告警相关的键合进 checkConf，保留监控方法与编排', async () => {
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
    await emitAlertConfig(wrapper, DEFAULT_SNAPSHOT)
    await emitAlertConfig(wrapper, EDITED_SNAPSHOT)
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

  it('换源时清掉上一个源的快照，不会把它的改动写进新源', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(steps())
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([{ id: 3, sourceId: 1400995, checkConf: '{}' }])
    const update = vi.spyOn(ckSourceApi, 'update').mockResolvedValue(true)

    const wrapper = mountView()
    await pickSource(wrapper)
    await emitAlertConfig(wrapper, DEFAULT_SNAPSHOT)
    await emitAlertConfig(wrapper, EDITED_SNAPSHOT)
    await pickSource(wrapper, 'other-source')
    await flushPromises()

    expect(wrapper.get('[data-testid="site-monitor-config-save"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="site-monitor-config-save"]').trigger('click')
    expect(update).not.toHaveBeenCalled()
  })
})
