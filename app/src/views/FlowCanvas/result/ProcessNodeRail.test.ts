// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ProcessNodeRail from './ProcessNodeRail.vue'
import { entryApi } from '@/api'
import { buildHorizontalLayout, NODE_CONFIGS } from '@/views/FlowCanvas/canvas/flowModel'

describe('ProcessNodeRail', () => {
  it('点击可选节点时只发出该 nodeId', async () => {
    const layout = buildHorizontalLayout(['start', 'web-list', 'end'], [], NODE_CONFIGS, [], { includeTerminals: false })
    const wrapper = mount(ProcessNodeRail, { props: { layout, modelValue: '', selectable: () => true } })
    await wrapper.find('[data-node-id="web-list"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['web-list']])
  })

  it('主链节点以卡片展示，并用居中箭头连线和最终结果标记关联', () => {
    const layout = buildHorizontalLayout(['start', 'web-list', 'web-detail', 'end'], [], NODE_CONFIGS, [], { includeTerminals: false })
    const wrapper = mount(ProcessNodeRail, { props: { layout, modelValue: 'web-detail', selectable: () => true } })

    expect(wrapper.find('.pnr').attributes('style')).toContain(`width: ${layout.totalWidth}px`)
    // marker id 每实例唯一（0925：同页可能同时挂多个节点条，重复 id 会让后挂实例引用先挂实例的箭头）
    expect(wrapper.find('.pnr-edge').attributes('marker-end')).toMatch(/^url\(#pnr-arrow-\d+\)$/)
    // 0917-03：优先展示节点配置里的队列名
    expect(wrapper.find('[data-node-id="web-list"] .pnr-node-sub').text()).toBe('announcement.list')
    expect(wrapper.find('[data-node-id="web-detail"] .pnr-node-final').text()).toBe('最终结果')
  })

  // 0926 REVIEW F1：唯一化计数器必须在模块级——放 setup 里每实例重置，永远算出 pnr-arrow-1。
  it('同页挂多个节点条时 marker id 各自唯一，互不引用', () => {
    const layout = buildHorizontalLayout(['start', 'web-list', 'web-detail', 'end'], [], NODE_CONFIGS, [], { includeTerminals: false })
    const a = mount(ProcessNodeRail, { props: { layout, selectable: () => true } })
    const b = mount(ProcessNodeRail, { props: { layout, selectable: () => true } })
    const aId = a.find('marker').attributes('id')
    const bId = b.find('marker').attributes('id')
    expect(aId).toMatch(/^pnr-arrow-\d+$/)
    expect(bId).not.toBe(aId)
    // 各自引用自己的 marker（重复 id 时后挂实例会解析到先挂实例的箭头，先挂卸载就集体消失）
    expect(a.find('.pnr-edge').attributes('marker-end')).toBe(`url(#${aId})`)
    expect(b.find('.pnr-edge').attributes('marker-end')).toBe(`url(#${bId})`)
  })

  it('需要展示运行事实的只读视图可传入节点状态', () => {
    const layout = buildHorizontalLayout(['start', 'web-list', 'end'], [], NODE_CONFIGS, [], { includeTerminals: false })
    const wrapper = mount(ProcessNodeRail, { props: { layout, nodeStates: { 'web-list': 'E' } } })
    expect(wrapper.find('[data-node-id="web-list"] .pnr-node-state').classes()).toContain('state-E')
    expect(wrapper.find('[data-node-id="web-list"] .pnr-node-state').attributes('aria-label')).toBe('异常')
  })

  it('0917-03 · 节点卡片优先展示外部传入的队列名，悬停提示完整信息', () => {
    const layout = buildHorizontalLayout(['start', 'web-list', 'end'], [], NODE_CONFIGS, [], { includeTerminals: false })
    const wrapper = mount(ProcessNodeRail, {
      props: {
        layout,
        nodeQueues: { 'web-list': 'news_snatch_html_download' },
      },
    })
    const nodeEl = wrapper.find('[data-node-id="web-list"]')
    expect(nodeEl.find('.pnr-node-sub').text()).toBe('news_snatch_html_download')
    expect(nodeEl.attributes('title')).toBe('公告列表抓取 ([90] 网页抓取 · 源配置 · news_snatch_html_download)')
  })

  it('0917-03 · 无队列时副标题退回展示节点标识', () => {
    const customConfigs = {
      ...NODE_CONFIGS,
      'no-queue-node': {
        ...NODE_CONFIGS['web-list'],
        id: 'no-queue-node',
        sub: 'custom-sub',
        taskCfg: undefined,
      },
    }
    const layout = buildHorizontalLayout(['start', 'no-queue-node', 'end'], [], customConfigs, [], { includeTerminals: false })
    const wrapper = mount(ProcessNodeRail, { props: { layout } })
    const nodeEl = wrapper.find('[data-node-id="no-queue-node"]')
    expect(nodeEl.find('.pnr-node-sub').text()).toBe('custom-sub')
    expect(nodeEl.attributes('title')).toBe('公告列表抓取 (custom-sub)')
  })

  it('节点徽标优先展示表 ID 而不是固定 90 类型码，无表时回退类型图标', () => {
    const customConfigs = {
      ...NODE_CONFIGS,
      'collect-900': {
        ...NODE_CONFIGS['web-list'],
        title: '网页抓取01',
        collectCfg: {
          ...NODE_CONFIGS['web-list'].collectCfg!,
          snatchType: '[90] - 网页抓取',
          outputTable: '900',
        },
      },
      'decision-node': {
        ...NODE_CONFIGS['decision'],
        title: '条件判断',
        collectCfg: undefined,
        outputTable: '',
        inputTable: '',
      },
    }
    const layout = buildHorizontalLayout(['start', 'collect-900', 'decision-node', 'end'], [], customConfigs, [], { includeTerminals: false })
    const wrapper = mount(ProcessNodeRail, { props: { layout } })

    const collectEl = wrapper.find('[data-node-id="collect-900"]')
    expect(collectEl.find('.pnr-node-icon').text()).toBe('900')
    expect(collectEl.find('.pnr-node-icon').attributes('title')).toBe('表 ID: 900')

    const decisionEl = wrapper.find('[data-node-id="decision-node"]')
    expect(decisionEl.find('.pnr-node-icon').text()).toBe('IF')
  })

  it('副标题与提示展示表名（支持显式传入 tableNames 并去除 sense_data. 前缀）', () => {
    const customConfigs = {
      ...NODE_CONFIGS,
      'node-1': {
        ...NODE_CONFIGS['web-list'],
        title: '公司新闻',
        collectCfg: {
          ...NODE_CONFIGS['web-list'].collectCfg!,
          outputTable: '900',
        },
        taskCfg: {
          ...NODE_CONFIGS['web-list'].taskCfg!,
          queue: 'news_snt',
        },
      },
    }
    const layout = buildHorizontalLayout(['start', 'node-1', 'end'], [], customConfigs, [], { includeTerminals: false })
    const wrapper = mount(ProcessNodeRail, {
      props: {
        layout,
        tableNames: { '900': 'sense_data.TB_CNEWS' },
      },
    })
    const nodeEl = wrapper.find('[data-node-id="node-1"]')
    // 卡片内表名与队列分行展示，表名去除前缀
    expect(nodeEl.find('.pnr-node-table').text()).toBe('TB_CNEWS')
    expect(nodeEl.find('.pnr-node-queue').text()).toBe('news_snt')
    // hover title 完整保留表 ID、完整物理表名和队列
    expect(nodeEl.attributes('title')).toBe('公司新闻 (表: 900 · sense_data.TB_CNEWS · 队列: news_snt)')
  })

  it('未显式传入 tableNames 时自动按 tableId 异步加载表名并更新卡片与 hover 提示', async () => {
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue({
      tableId: '900',
      tableName: 'sense_data.TB_CNEWS',
      name: '通用新闻表',
      fields: [],
    })

    const customConfigs = {
      ...NODE_CONFIGS,
      'node-async': {
        ...NODE_CONFIGS['web-list'],
        title: '新闻抓取',
        collectCfg: {
          ...NODE_CONFIGS['web-list'].collectCfg!,
          outputTable: '900',
        },
        taskCfg: {
          ...NODE_CONFIGS['web-list'].taskCfg!,
          queue: 'news_snt',
        },
      },
    }
    const layout = buildHorizontalLayout(['start', 'node-async', 'end'], [], customConfigs, [], { includeTerminals: false })
    const wrapper = mount(ProcessNodeRail, { props: { layout } })

    const nodeEl = wrapper.find('[data-node-id="node-async"]')
    // 异步返回前先展示队列兜底
    expect(nodeEl.find('.pnr-node-queue').text()).toBe('news_snt')

    await flushPromises()

    // 异步返回后，表名与队列换行分行展示
    expect(nodeEl.find('.pnr-node-table').text()).toBe('通用新闻表')
    expect(nodeEl.find('.pnr-node-queue').text()).toBe('news_snt')
    expect(nodeEl.attributes('title')).toBe('新闻抓取 (表: 900 · 通用新闻表 · 队列: news_snt)')
  })
})

