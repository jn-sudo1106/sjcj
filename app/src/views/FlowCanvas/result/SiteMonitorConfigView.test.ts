// @vitest-environment jsdom
// 检查项面板（1111 源内监控视图）：一页一个源，列表由容器传入（不再自拉 ck_source 分页）。
// 这里测接线：列展示口径、启用开关事件、编辑/新增弹窗锁源、运行记录事件、未保存改动确认。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import type { MonitorRecordView } from '@/api/types/monitorCenter'
import SiteMonitorConfigView from './SiteMonitorConfigView.vue'

function monitor(over: Partial<MonitorRecordView> = {}): MonitorRecordView {
  return {
    id: 'm-1',
    sourceId: 'src-1',
    name: '日增量监控',
    tableName: 'sense_data.tb_jjjk',
    kind: 'ai',
    enabled: true,
    schedule: '0 0 * * * ?',
    nextRun: '2026-11-11 12:00:00',
    lastRun: '2026-11-11 11:00:00',
    publishStatus: 'ready',
    exec: 'succeeded',
    data: 'normal',
    notify: 'unknown',
    lastCheckAt: '2026-11-11 11:00:46',
    count: '1240',
    conf: { methods: ['rowCount'] },
    raw: {} as never,
    ...over,
  }
}

/** 编辑器桩的「有未保存改动」开关：父级关窗守卫直接读 stub 的 isDirty() */
let editorDirty = false
const EditorStub = defineComponent({
  name: 'MonitorConfigEditor',
  props: ['siteId', 'sourceId', 'sourceLocked', 'record'],
  emits: ['saved', 'cancel'],
  methods: {
    isBusy(): boolean { return false },
    isDirty(): boolean {
      return editorDirty
    },
  },
  template: '<div data-testid="monitor-editor-stub" :data-locked="String(sourceLocked)" />',
})

const ElDialogStub = defineComponent({
  name: 'ElDialog',
  props: ['modelValue', 'title', 'width', 'beforeClose'],
  emits: ['update:modelValue'],
  methods: {
    async onCloseClick() {
      const done = () => this.$emit('update:modelValue', false)
      const beforeClose = this.beforeClose as ((d: () => void) => void) | undefined
      if (beforeClose) await beforeClose(done)
      else done()
    },
  },
  template: `<div v-if="modelValue" data-testid="site-monitor-editor-dialog">
    <button type="button" data-testid="config-dialog-close" @click="onCloseClick">×</button>
    <slot />
  </div>`,
})

const stubs = {
  MonitorConfigEditor: EditorStub,
  ElDialog: ElDialogStub,
  ElSwitch: defineComponent({
    name: 'ElSwitch',
    props: ['modelValue', 'loading', 'disabled'],
    emits: ['change'],
    template: '<button class="el-switch" :data-on="modelValue" @click="$emit(\'change\', !modelValue)" />',
  }),
}

function mountView(over: { monitors?: MonitorRecordView[]; loading?: boolean; error?: string } = {}) {
  return mount(SiteMonitorConfigView, {
    props: {
      siteId: 'site-4',
      sourceId: 'src-1',
      monitors: over.monitors ?? [monitor()],
      loading: over.loading ?? false,
      error: over.error ?? '',
    },
    global: { stubs },
  })
}

beforeEach(() => {
  editorDirty = false
})

afterEach(() => vi.restoreAllMocks())

describe('SiteMonitorConfigView · 检查项表', () => {
  it('一张表 7 列：状态列合并执行与数据结论，头部汇总启用/总数', () => {
    const wrapper = mountView({
      monitors: [monitor(), monitor({ id: 'm-2', name: '日达标监控', enabled: false, data: 'abnormal', message: '2026-11-23 10:00:00---[X]:日达标监控-异常, 数量:0' })],
    })

    const head = wrapper.get('[data-testid="site-monitor-checks-table"] thead').findAll('th').map((th) => th.text())
    expect(head).toEqual(['检查项', '方式', '状态', '最近检查', '计划', '启用', '操作'])
    expect(wrapper.get('[data-testid="site-monitor-checks-count"]').text()).toContain('1 启用 ／ 共 2 项')
    expect(wrapper.text()).toContain('AI 检查')
    expect(wrapper.text()).toContain('rowCount')
    expect(wrapper.text()).toContain('0 0 * * * ?')
    const statuses = wrapper.findAll('[data-testid="site-monitor-check-status"]').map((n) => n.text())
    // 异常排在前面
    expect(statuses).toEqual(['异常', '正常'])
    expect(wrapper.findAll('[data-testid="site-monitor-check-row"]')[0]!.text()).toContain('数量 0')
    expect(wrapper.findAll('[data-testid="site-monitor-check-row"]')[0]!.text()).not.toContain('---')
  })

  it('执行失败标「执行失败」，没跑过标「未运行」', () => {
    const wrapper = mountView({
      monitors: [
        monitor({ id: 'm-1', exec: 'none', data: 'unknown', lastCheckAt: '' }),
        monitor({ id: 'm-2', exec: 'failed', data: 'unknown', message: '连接超时' }),
      ],
    })
    const statuses = wrapper.findAll('[data-testid="site-monitor-check-status"]').map((n) => n.text())
    expect(statuses).toEqual(['执行失败', '未运行'])
    expect(wrapper.text()).toContain('连接超时')
  })

  it('点「N 项不正常」只看不正常的检查项，再点恢复全部', async () => {
    const wrapper = mountView({
      monitors: [monitor(), monitor({ id: 'm-2', data: 'abnormal' })],
    })
    const btn = wrapper.get('[data-testid="site-monitor-checks-problems"]')
    expect(btn.text()).toContain('1 项不正常')
    await btn.trigger('click')
    expect(wrapper.findAll('[data-testid="site-monitor-check-row"]')).toHaveLength(1)
    await btn.trigger('click')
    expect(wrapper.findAll('[data-testid="site-monitor-check-row"]')).toHaveLength(2)
  })

  it('全部正常时不出现「不正常」入口；「全部运行记录」交给容器开抽屉', async () => {
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="site-monitor-checks-problems"]').exists()).toBe(false)
    await wrapper.get('[data-testid="site-monitor-all-runs"]').trigger('click')
    expect(wrapper.emitted('allRuns')).toHaveLength(1)
  })

  it('草稿状态在名称旁标「未生效」，不冒充已生效', () => {
    const wrapper = mountView({ monitors: [monitor({ publishStatus: 'draft' })] })
    expect(wrapper.text()).toContain('未生效')
  })

  it('计划列为空时标「仅手动」，有计划的行不标', () => {
    const withPlan = mountView({ monitors: [monitor()] })
    expect(withPlan.text()).not.toContain('仅手动')

    const manual = mountView({ monitors: [monitor({ schedule: '' })] })
    expect(manual.text()).toContain('未设置')
    expect(manual.text()).toContain('仅手动')
  })

  it('空列表给加监控引导，不显示空表格', () => {
    const wrapper = mountView({ monitors: [] })
    const empty = wrapper.get('[data-testid="site-monitor-checks-empty"]')
    expect(empty.text()).toContain('该源还没有配置监控')
    expect(empty.text()).toContain('＋ 加监控')
    expect(wrapper.find('[data-testid="site-monitor-all-runs"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="site-monitor-checks-table"]').exists()).toBe(false)
  })

  it('加载失败显示错误并可重试', async () => {
    const wrapper = mountView({ error: '后端 500' })
    expect(wrapper.get('[data-testid="site-monitor-checks-error"]').text()).toContain('后端 500')

    await wrapper.findAll('button').find((b) => b.text() === '重试')!.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('不提供换源入口：没有源选择组件', () => {
    const wrapper = mountView()
    expect(wrapper.findComponent({ name: 'SiteSourceSelect' }).exists()).toBe(false)
  })
})

describe('SiteMonitorConfigView · 开关与运行记录', () => {
  it('点启用开关把目标状态抛给容器（由容器统一调 API 与刷新）', async () => {
    const wrapper = mountView()
    await wrapper.get('[data-testid="site-monitor-check-toggle"]').trigger('click')

    const events = wrapper.emitted('toggle')!
    expect(events).toHaveLength(1)
    expect((events[0]![0] as MonitorRecordView).id).toBe('m-1')
    expect(events[0]![1]).toBe(false)
  })

  it('启用中的开关在请求期间置 loading，避免连点', () => {
    const wrapper = mount(SiteMonitorConfigView, {
      props: { siteId: 'site-4', sourceId: 'src-1', monitors: [monitor()], togglingId: 'm-1' },
      global: { stubs },
    })
    expect(wrapper.getComponent({ name: 'ElSwitch' }).props('loading')).toBe(true)
  })

  it('行上「记录」按该检查项打开运行记录（带 monitorId 的入口交给容器）', async () => {
    const wrapper = mountView()
    await wrapper.get('[data-testid="site-monitor-check-runs"]').trigger('click')
    const events = wrapper.emitted('runs')!
    expect((events[0]![0] as MonitorRecordView).id).toBe('m-1')
  })
})

describe('SiteMonitorConfigView · 新增/编辑锁源', () => {
  it('「＋ 加监控」打开编辑器，sourceId 必填且只读（sourceLocked=true）', async () => {
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="monitor-editor-stub"]').exists()).toBe(false)

    await wrapper.get('[data-testid="site-monitor-add-monitor"]').trigger('click')

    const editor = wrapper.findComponent(EditorStub)
    expect(editor.exists()).toBe(true)
    expect(editor.props('siteId')).toBe('site-4')
    expect(editor.props('sourceId')).toBe('src-1')
    expect(editor.props('record')).toBeNull()
    expect(editor.props('sourceLocked')).toBe(true)
  })

  it('行上「编辑」用当前源打开编辑器（页面内所有检查项同属一个源）', async () => {
    const wrapper = mountView({ monitors: [monitor({ id: 'm-9' })] })
    await wrapper.get('[data-testid="site-monitor-check-edit"]').trigger('click')

    const editor = wrapper.findComponent(EditorStub)
    expect(editor.props('sourceId')).toBe('src-1')
    expect(editor.props('record')).toMatchObject({ id: 'm-9' })
    expect(editor.props('sourceLocked')).toBe(true)
  })

  it('编辑器保存后关闭弹窗，并通知容器刷新，再次新增不带旧记录', async () => {
    const wrapper = mountView()
    await wrapper.get('[data-testid="site-monitor-add-monitor"]').trigger('click')
    const saved = monitor({ id: 'm-new', name: '新建检查项' })

    await wrapper.findComponent(EditorStub).vm.$emit('saved', saved)
    await flushPromises()

    expect(wrapper.find('[data-testid="site-monitor-editor-dialog"]').exists()).toBe(false)
    const events = wrapper.emitted('saved')!
    expect(events).toHaveLength(1)
    expect((events[0]![0] as MonitorRecordView).id).toBe('m-new')
    await wrapper.get('[data-testid="site-monitor-add-monitor"]').trigger('click')
    expect(wrapper.findComponent(EditorStub).props('record')).toBeNull()
  })

  it('保存后回读不到记录时保留弹窗并原样告诉容器（由容器/编辑器提示未回读）', async () => {
    const wrapper = mountView()
    await wrapper.get('[data-testid="site-monitor-add-monitor"]').trigger('click')

    await wrapper.findComponent(EditorStub).vm.$emit('saved', null)
    await flushPromises()

    expect(wrapper.find('[data-testid="site-monitor-editor-dialog"]').exists()).toBe(true)
    expect(wrapper.findComponent(EditorStub).props('record')).toBeNull()
    expect(wrapper.emitted('saved')![0]![0]).toBeNull()
  })

  it('编辑器点「取消」由宿主关窗，并清掉当前记录（下次加监控不带上旧记录）', async () => {
    const wrapper = mountView({ monitors: [monitor({ id: 'm-9' })] })
    await wrapper.get('[data-testid="site-monitor-check-edit"]').trigger('click')
    await wrapper.findComponent(EditorStub).vm.$emit('cancel')
    await flushPromises()

    expect(wrapper.find('[data-testid="site-monitor-editor-dialog"]').exists()).toBe(false)

    await wrapper.get('[data-testid="site-monitor-add-monitor"]').trigger('click')
    expect(wrapper.findComponent(EditorStub).props('record')).toBeNull()
  })

  it('有未保存改动时关窗先确认；取消则留在弹窗', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))
    const wrapper = mountView()
    await wrapper.get('[data-testid="site-monitor-add-monitor"]').trigger('click')
    editorDirty = true

    await wrapper.get('[data-testid="config-dialog-close"]').trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="site-monitor-editor-dialog"]').exists()).toBe(true)
  })

  it('有未保存改动时确认放弃才关闭', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = mountView()
    await wrapper.get('[data-testid="site-monitor-add-monitor"]').trigger('click')
    editorDirty = true

    await wrapper.get('[data-testid="config-dialog-close"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="site-monitor-editor-dialog"]').exists()).toBe(false)
  })
})
