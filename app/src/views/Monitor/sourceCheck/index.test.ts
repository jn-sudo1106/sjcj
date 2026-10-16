// @vitest-environment jsdom
// 数据源告警（旧 MonitorList.vue → sourceCheck/index.vue）表格操作接线回归。
// 这里只验证「每个操作调到了哪条接口、带了什么参数」——旧页面这一列操作全是直连后端的，
// 迁到新平台后最容易出的问题是接线断了或落回 mock，而不是少个按钮。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { h } from 'vue'
import ElementPlus from 'element-plus'
import SourceCheckPage from './index.vue'
import * as monitorApi from '../../../api/monitor'
import type { SourceCheck } from '../../../api'

// Element Plus 的表格内部用 ResizeObserver 量宽，jsdom 没有
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

// confirmDanger 真实实现要弹 ElMessageBox（无法在 jsdom 里点「确认执行」），
// 测试直接放行动作本身——要验的是动作里发的接口，不是确认框。
vi.mock('@/utils/confirmDanger', () => ({
  confirmDanger: (_title: string, _body: string, run: () => Promise<unknown>) => run(),
  confirmOrRun: (_need: boolean, _t: string, _b: string, run: () => Promise<unknown>) => run(),
}))

const openDialog = vi.fn()
const logsShow = vi.fn()

function check(over: Partial<SourceCheck> = {}): SourceCheck {
  return {
    id: 'ck-1',
    isDelete: 0,
    state: 'C',
    lastMsg: '2026-09-09 11:00:46---正常, 数量:1240',
    name: '日增量监控',
    tableName: 'sense_data.tb_jjjk',
    schedule: '0 0 * * * ?',
    nextRun: '2026-09-09 12:00:00',
    lastRun: '2026-09-09 11:00:19',
    sourceId: 's1',
    checkConf: '{}',
    ...over,
  }
}

const stubs = {
  SourceSelect: {
    name: 'SourceSelect',
    props: ['modelValue'],
    emits: ['update:modelValue', 'change'],
    template: '<div class="stub-source-select" />',
  },
  StatusTag: { name: 'StatusTag', props: ['state', 'text', 'tone'], template: '<span class="stub-status" />' },
  CheckEditDialog: {
    name: 'CheckEditDialog',
    props: ['sourceId'],
    emits: ['saved'],
    setup(_p: unknown, { expose }: { expose: (o: Record<string, unknown>) => void }) {
      expose({ openDialog })
      return () => h('div', { class: 'stub-edit' })
    },
  },
  CheckLogsDrawer: {
    name: 'CheckLogsDrawer',
    props: ['sourceId'],
    setup(_p: unknown, { expose }: { expose: (o: Record<string, unknown>) => void }) {
      expose({ show: logsShow })
      return () => h('div', { class: 'stub-logs' })
    },
  },
  ElSwitch: {
    name: 'ElSwitch',
    props: ['modelValue'],
    emits: ['change'],
    template: '<button class="stub-switch" @click="$emit(\'change\', !modelValue)" />',
  },
  ElPagination: { name: 'ElPagination', props: ['currentPage', 'pageSize', 'total'], template: '<div class="stub-pager" />' },
  ElDrawer: { name: 'ElDrawer', props: ['modelValue', 'title'], template: '<div class="stub-drawer"><slot /></div>' },
  ElDescriptions: { name: 'ElDescriptions', template: '<div><slot /></div>' },
  ElDescriptionsItem: { name: 'ElDescriptionsItem', props: ['label'], template: '<div><slot /></div>' },
}

const ROWS: SourceCheck[] = [
  check({ id: 'ck-1', isDelete: 0, sourceId: 's1', jobId: 'job-9', name: '日增量监控' }),
  check({ id: 'ck-2', isDelete: 1, sourceId: 's1', name: '小时增量监控' }),
]

function mountPage(props: Record<string, unknown> = {}) {
  // v-loading 由 ElementPlus 插件自带，别再覆盖注册一遍（会打 duplicate directive 警告）
  return mount(SourceCheckPage, { props, global: { plugins: [ElementPlus], stubs } })
}

const pagedSpy = () => vi.spyOn(monitorApi, 'pagedSourceCheck').mockResolvedValue({ total: ROWS.length, list: ROWS })
/** 勾选行：直接给 el-table 抛 selection-change（等价于用户勾了两行） */
async function selectRows(wrapper: VueWrapper, ids: string[]) {
  wrapper.findComponent({ name: 'ElTable' }).vm.$emit('selection-change', ids)
  await flushPromises()
}
const btn = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll('button').find((b) => b.text().trim() === text)!
/** 第一行的行内操作：已改成图标（原「更多」里的详情 / 立即运行 / 删除也平铺了），按 tooltip 文案找 */
const link = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll('tr.el-table__row')[0].findAllComponents({ name: 'ElTooltip' })
    .find((t: VueWrapper) => (t.props() as { content?: string }).content === text)!.find('.sc-op-icon')

beforeEach(() => {
  openDialog.mockClear()
  logsShow.mockClear()
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('数据源告警 · 表格操作与接口调用（对齐旧 MonitorList）', () => {
  it('首屏按旧契约查询：sourceId/enable/state/name + page/limit（不发 size）', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    expect(paged).toHaveBeenCalledTimes(1)
    expect(paged).toHaveBeenCalledWith({ sourceId: '', enable: '', state: '', name: '', page: 1, limit: 10 })
    expect(wrapper.text()).toContain('日增量监控')
  })

  it('查询按钮带上名称条件重新拉取，并回到第 1 页', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.get('input[placeholder="名称"]').setValue('增量')
    await btn(wrapper, '查询').trigger('click')
    await flushPromises()

    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ name: '增量', page: 1, limit: 10 }))
  })

  it('行内开关按 isDelete 反向语义：在用→传 false 停用，停用→传 true 启用', async () => {
    pagedSpy()
    const changeEnable = vi.spyOn(monitorApi, 'changeSourceCheckEnable').mockResolvedValue({ ok: true } as never)
    const wrapper = mountPage()
    await flushPromises()

    const switches = wrapper.findAll('.stub-switch')
    expect(switches).toHaveLength(2)

    await switches[0].trigger('click') // ck-1 在用 → 停用
    await flushPromises()
    expect(changeEnable).toHaveBeenLastCalledWith(['ck-1'], false)

    await switches[1].trigger('click') // ck-2 停用 → 启用
    await flushPromises()
    expect(changeEnable).toHaveBeenLastCalledWith(['ck-2'], true)
  })

  it('批量操作：重跑 / 停用 / 启用 / 删除各自打到对应接口（ids 用勾选集合）', async () => {
    pagedSpy()
    const runNow = vi.spyOn(monitorApi, 'handleRunNow').mockResolvedValue({} as never)
    const changeEnable = vi.spyOn(monitorApi, 'changeSourceCheckEnable').mockResolvedValue({} as never)
    const remove = vi.spyOn(monitorApi, 'deleteSourceCheck').mockResolvedValue({} as never)
    const wrapper = mountPage()
    await flushPromises()

    // 未勾选时批量条不出现（对齐旧版 dropdown 的 v-if）
    expect(wrapper.find('.sc-batch-bar').exists()).toBe(false)

    await selectRows(wrapper, ['ck-1', 'ck-2'])
    expect(wrapper.find('.sc-batch-bar').exists()).toBe(true)

    await btn(wrapper, '批量重跑').trigger('click')
    await flushPromises()
    expect(runNow).toHaveBeenLastCalledWith(['ck-1', 'ck-2'])

    await btn(wrapper, '批量停用').trigger('click')
    await flushPromises()
    expect(changeEnable).toHaveBeenLastCalledWith(['ck-1', 'ck-2'], false)

    await btn(wrapper, '批量启用').trigger('click')
    await flushPromises()
    expect(changeEnable).toHaveBeenLastCalledWith(['ck-1', 'ck-2'], true)

    await btn(wrapper, '批量删除').trigger('click')
    await flushPromises()
    expect(remove).toHaveBeenLastCalledWith(['ck-1', 'ck-2'])
  })

  it('行内「立即运行 / 删除」打到 runNow / delete（单条 id）', async () => {
    pagedSpy()
    const runNow = vi.spyOn(monitorApi, 'handleRunNow').mockResolvedValue({} as never)
    const remove = vi.spyOn(monitorApi, 'deleteSourceCheck').mockResolvedValue({} as never)
    const wrapper = mountPage()
    await flushPromises()

    await link(wrapper, '立即运行').trigger('click')
    await flushPromises()
    expect(runNow).toHaveBeenLastCalledWith(['ck-1'])

    await link(wrapper, '删除').trigger('click')
    await flushPromises()
    expect(remove).toHaveBeenLastCalledWith(['ck-1'])
  })

  it('行内「详情」打开详情抽屉（不发请求，只看当前行）', async () => {
    pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ElDrawer' }).exists()).toBe(false)
    await link(wrapper, '详情').trigger('click')
    await flushPromises()

    const drawer = wrapper.findComponent({ name: 'ElDrawer' })
    expect(drawer.exists()).toBe(true)
    expect(drawer.props('modelValue')).toBe(true)
  })

  it('行内「编辑」把整行交给新增/修改弹窗', async () => {
    pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    await link(wrapper, '编辑').trigger('click')
    await flushPromises()
    expect(openDialog).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'ck-1' }))
  })

  it('行内「日志」按旧版口径传 queryParam.sourceId + record.jobId', async () => {
    pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    await link(wrapper, '日志').trigger('click')
    await flushPromises()

    // 未在筛选里选源 → 回退到该行自身的 sourceId；jobId 用记录上的（不是记录 id）
    expect(logsShow).toHaveBeenLastCalledWith('s1', 'job-9', '日增量监控')
  })

  it('未选源时点「加监控」只提示不打开弹窗；选了源之后才打开', async () => {
    pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    await btn(wrapper, '加监控').trigger('click')
    await flushPromises()
    expect(openDialog).not.toHaveBeenCalled()

    await wrapper.findComponent({ name: 'SourceSelect' }).vm.$emit('update:modelValue', 's9')
    await wrapper.findComponent({ name: 'SourceSelect' }).vm.$emit('change')
    await flushPromises()

    // 换源即查（旧版 d-source-select 的 @change → handleRefresh）
    expect(vi.mocked(monitorApi.pagedSourceCheck).mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ sourceId: 's9' }),
    )
    expect(wrapper.findComponent({ name: 'CheckEditDialog' }).props('sourceId')).toBe('s9')

    await btn(wrapper, '加监控').trigger('click')
    await flushPromises()
    expect(openDialog).toHaveBeenLastCalledWith(null)
  })

  it('内嵌形态：只去掉卡片壳，筛选整套保留，传入的源作为初值透给列表与弹窗', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage({ embedded: true, sourceId: 's-embedded' })
    await flushPromises()

    // 源是初值：查询按它过滤，「加监控」也拿它预填数据源
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 's-embedded' }))
    expect(wrapper.findComponent({ name: 'CheckEditDialog' }).props('sourceId')).toBe('s-embedded')
    // 筛选表单不被裁剪——旧平台 MonitorModal 里的 MonitorList 就是完整带筛选的，
    // 用户在弹窗里仍要能按 在用 / 告警状态 / 源ID 过滤
    expect(wrapper.find('.stub-source-select').exists()).toBe(true)
    // 卡片壳仍去掉：外层已经是弹窗
    expect(wrapper.find('.sc-head').exists()).toBe(false)
  })

  it('新增/修改保存成功后重新拉列表', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()
    expect(paged).toHaveBeenCalledTimes(1)

    wrapper.findComponent({ name: 'CheckEditDialog' }).vm.$emit('saved')
    await flushPromises()
    expect(paged).toHaveBeenCalledTimes(2)
  })
})
