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
  it('渲染检查项 8 列与启用/总数，展示方式、摘要、数据结论、计划', () => {
    const wrapper = mountView({
      monitors: [monitor(), monitor({ id: 'm-2', name: '日达标监控', enabled: false, data: 'abnormal' })],
    })

    const head = wrapper.get('[data-testid="site-monitor-checks-table"] thead').text()
    for (const column of ['名称', '方式', '检查摘要', '启用', '最近数据结论', '计划', '编辑', '运行记录']) {
      expect(head).toContain(column)
    }
    expect(wrapper.get('[data-testid="site-monitor-checks-count"]').text()).toContain('1 启用 ／ 共 2 项')
    expect(wrapper.text()).toContain('日增量监控')
    expect(wrapper.text()).toContain('AI 检查')
    expect(wrapper.text()).toContain('rowCount')
    expect(wrapper.text()).toContain('数据正常')
    expect(wrapper.text()).toContain('数据异常')
    expect(wrapper.text()).toContain('0 0 * * * ?')
  })

  it('草稿状态在名称旁标「未生效」，不冒充已生效', () => {
    const wrapper = mountView({ monitors: [monitor({ publishStatus: 'draft' })] })
    expect(wrapper.text()).toContain('未生效')
  })

  it('空列表给加监控引导，不显示空表格', () => {
    const wrapper = mountView({ monitors: [] })
    expect(wrapper.get('[data-testid="site-monitor-checks-empty"]').text()).toContain('＋ 加监控')
    expect(wrapper.find('[data-testid="site-monitor-checks-table"]').exists()).toBe(false)
  })

  it('加载失败显示错误并可重试', async () => {
    const wrapper = mountView({ error: '后端 500' })
    expect(wrapper.get('[data-testid="site-monitor-checks-error"]').text()).toContain('后端 500')

    await wrapper.findAll('button').find((b) => b.text() === '重试')!.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('不提供换源入口：没有源选择组件，并提示源已锁定', () => {
    const wrapper = mountView()
    expect(wrapper.findComponent({ name: 'SiteSourceSelect' }).exists()).toBe(false)
    expect(wrapper.text()).toContain('当前源锁定')
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
