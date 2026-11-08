// @vitest-environment jsdom
// 监控视图「监控配置」Tab（2026-09-18 改版）：页面主体 = ck_source 分页列表（样式同「监控结果」），
// 「＋ 新增配置」/ 行上「编辑」打开居中弹窗，弹窗内容是 MonitorConfigEditor（改版前这个 Tab 的整页）。
// 本文件测的是**列表与弹窗的接线**：分页/筛选调用契约、新增与编辑往编辑器传什么、保存后关窗刷新。
// 编辑器本身的字段级行为在 MonitorConfigEditor.test.ts 里测——这里把编辑器换成桩。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import SiteMonitorConfigView from './SiteMonitorConfigView.vue'
import { ckSourceApi, type CkSourceRecord } from '@/api'

function row(over: Partial<CkSourceRecord> = {}): CkSourceRecord {
  return {
    id: 1, sourceId: 1400995, name: '日增量监控', tableName: 'sense_data.tb_jjjk',
    schedule: '0 0 * * * ?', lastRun: '2026-09-18 10:00:00', nextRun: '2026-09-18 11:00:00',
    lastMsg: '正常, 数量:1240',
    ...over,
  }
}

function pageResult(over: Partial<Awaited<ReturnType<typeof ckSourceApi.page>>> = {}) {
  return {
    total: 1, pages: 1, pageNum: 1, pageSize: 10, list: [row()],
    ...over,
  }
}

/** 编辑器桩：只暴露 props（新增/编辑各传什么 sourceId），saved 由用例手动抛 */
const MonitorConfigEditorStub = defineComponent({
  name: 'MonitorConfigEditor',
  props: ['siteId', 'sourceId'],
  emits: ['saved'],
  template: '<div data-testid="monitor-editor-stub" />',
})

/** 监控弹窗桩（SourceMonitorDialog，旧平台 `MonitorModal.vue` 的迁移版）：
 *  只暴露 showModal(sourceId)，并把收到的源 ID 渲染出来——入口有没有把当前源带上，一眼可断言 */
const SourceMonitorDialogStub = defineComponent({
  name: 'SourceMonitorDialog',
  data: () => ({ opened: false, sourceId: '' }),
  methods: {
    showModal(id?: string) {
      this.opened = true
      this.sourceId = id ?? ''
    },
  },
  template: '<div v-if="opened" data-testid="source-monitor-stub">{{ sourceId || "(empty)" }}</div>',
})

const stubs = {
  MonitorConfigEditor: MonitorConfigEditorStub,
  SourceMonitorDialog: SourceMonitorDialogStub,
  // el-dialog 不注册 Element Plus 也能裸挂载：只关心"开着时渲染 slot"
  ElDialog: {
    name: 'ElDialog',
    props: ['modelValue', 'title', 'width'],
    emits: ['update:modelValue'],
    template: '<div v-if="modelValue" data-testid="config-dialog-stub"><slot /></div>',
  },
  ElPagination: {
    name: 'ElPagination',
    props: ['currentPage', 'pageSize', 'total'],
    emits: ['current-change', 'update:currentPage'],
    // 与真实 el-pagination 同序：先 update:currentPage（v-model 回写），再 current-change（触发查询）
    template: '<button class="pager-stub" data-testid="next-page" @click="$emit(\'update:currentPage\', currentPage + 1); $emit(\'current-change\', currentPage + 1)" />',
  },
}

function mountView(props: { siteId: string; sourceId?: string } = { siteId: 'site-4' }) {
  return mount(SiteMonitorConfigView, {
    props,
    global: { stubs, directives: { loading: {} } },
  })
}

/** 在编辑器桩上抛一次 saved（= 弹窗里点完保存） */
async function editorSaved(wrapper: ReturnType<typeof mountView>) {
  await wrapper.findComponent(MonitorConfigEditorStub).vm.$emit('saved')
  await flushPromises()
}

afterEach(() => vi.restoreAllMocks())

describe('SiteMonitorConfigView · ck_source 分页列表（2026-09-18 改版）', () => {
  it('首屏按分页契约查询整表并渲染行与总数，不默认带筛选条件', async () => {
    const paged = vi.spyOn(ckSourceApi, 'page').mockResolvedValue(pageResult({
      total: 12, pages: 2, list: [row(), row({ id: 2, sourceId: 1400996, name: '日达标监控' })],
    }))
    const wrapper = mountView()
    await flushPromises()

    expect(paged).toHaveBeenCalledTimes(1)
    expect(paged).toHaveBeenCalledWith({ pageNum: 1, pageSize: 10 })
    expect(wrapper.text()).toContain('共 12 条监控配置')
    expect(wrapper.get('.smv-table tbody').text()).toContain('日增量监控')
    expect(wrapper.get('.smv-table tbody').text()).toContain('日达标监控')
  })

  it('翻页把新页码带上重新查询', async () => {
    const paged = vi.spyOn(ckSourceApi, 'page').mockResolvedValue(pageResult({ pageNum: 2 }))
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-testid="next-page"]').trigger('click')
    await flushPromises()

    expect(paged).toHaveBeenLastCalledWith({ pageNum: 2, pageSize: 10 })
  })

  it('名称筛选：查询带上 name，清空后回到整表', async () => {
    const paged = vi.spyOn(ckSourceApi, 'page').mockResolvedValue(pageResult())
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('input[aria-label="名称"]').setValue('增量')
    await wrapper.findAll('button').find((b) => b.text() === '查询')!.trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith({ pageNum: 1, pageSize: 10, name: '增量' })

    await wrapper.findAll('button').find((b) => b.text() === '清空')!.trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith({ pageNum: 1, pageSize: 10 })
  })

  it('查询失败时给出错误而不是空表格假装没事', async () => {
    vi.spyOn(ckSourceApi, 'page').mockRejectedValue(new Error('后端 500'))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('后端 500')
  })

  it('空列表给引导文案，指到「＋ 新增配置」', async () => {
    vi.spyOn(ckSourceApi, 'page').mockResolvedValue(pageResult({ total: 0, pages: 0, list: [] }))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('暂无监控配置')
    expect(wrapper.text()).toContain('＋ 新增配置')
  })
})

describe('SiteMonitorConfigView · 按当前源过滤（2026-09-28 画布监控视图）', () => {
  it('传入 sourceId 时查询带上该源', async () => {
    const paged = vi.spyOn(ckSourceApi, 'page').mockResolvedValue(pageResult())
    mountView({ siteId: 'site-4', sourceId: '430016944' })
    await flushPromises()

    expect(paged).toHaveBeenCalledWith({ pageNum: 1, pageSize: 10, sourceId: '430016944' })
  })

  it('换源时回到第一页按新源重查', async () => {
    const paged = vi.spyOn(ckSourceApi, 'page').mockResolvedValue(pageResult())
    const wrapper = mountView({ siteId: 'site-4', sourceId: 'a' })
    await flushPromises()

    await wrapper.setProps({ sourceId: 'b' })
    await flushPromises()

    expect(paged).toHaveBeenLastCalledWith({ pageNum: 1, pageSize: 10, sourceId: 'b' })
  })
})

describe('SiteMonitorConfigView · 新增/编辑配置弹窗（2026-09-18 改版）', () => {
  it('「＋ 新增配置」打开弹窗，编辑器不带 sourceId（全部源起步）', async () => {
    vi.spyOn(ckSourceApi, 'page').mockResolvedValue(pageResult())
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="monitor-editor-stub"]').exists()).toBe(false)

    await wrapper.get('[data-testid="site-monitor-config-add"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="monitor-editor-stub"]').exists()).toBe(true)
    const editor = wrapper.findComponent(MonitorConfigEditorStub)
    expect(editor.props('sourceId')).toBeUndefined()
    expect(editor.props('siteId')).toBe('site-4')
  })

  it('已锁定当前源时「＋ 新增配置」默认带上该源（1105 会议）', async () => {
    vi.spyOn(ckSourceApi, 'page').mockResolvedValue(pageResult())
    const wrapper = mountView({ siteId: 'site-4', sourceId: '430016944' })
    await flushPromises()

    await wrapper.get('[data-testid="site-monitor-config-add"]').trigger('click')
    await flushPromises()

    expect(wrapper.findComponent(MonitorConfigEditorStub).props('sourceId')).toBe('430016944')
  })

  it('行上「编辑」打开弹窗，编辑器带该行的 sourceId', async () => {
    vi.spyOn(ckSourceApi, 'page').mockResolvedValue(pageResult({ list: [row({ sourceId: 1400995 })] }))
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-testid="site-monitor-config-edit"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="monitor-editor-stub"]').exists()).toBe(true)
    expect(wrapper.findComponent(MonitorConfigEditorStub).props('sourceId')).toBe('1400995')
  })

  it('编辑器保存成功后弹窗留着、列表在后面刷新（1105 会议：保存完还要接着生成、测试脚本）', async () => {
    const paged = vi.spyOn(ckSourceApi, 'page').mockResolvedValue(pageResult())
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="site-monitor-config-add"]').trigger('click')
    await flushPromises()

    await editorSaved(wrapper)

    expect(wrapper.find('[data-testid="monitor-editor-stub"]').exists()).toBe(true)
    expect(paged).toHaveBeenCalledTimes(2) // 首屏一次 + 保存后刷新一次
  })

  it('弹窗标题：新增带当前源时仍是「新增」，行上编辑才是「编辑」', async () => {
    vi.spyOn(ckSourceApi, 'page').mockResolvedValue(pageResult({ list: [row({ sourceId: 1400995 })] }))
    const wrapper = mountView({ siteId: 'site-4', sourceId: '430016944' })
    await flushPromises()
    const title = () => wrapper.getComponent({ name: 'ElDialog' }).props('title')

    await wrapper.get('[data-testid="site-monitor-config-add"]').trigger('click')
    await flushPromises()
    expect(title()).toBe('新增监控配置（源 430016944）')

    await wrapper.get('[data-testid="site-monitor-config-edit"]').trigger('click')
    await flushPromises()
    expect(title()).toBe('编辑监控配置（源 1400995）')
  })
})

describe('SiteMonitorConfigView · 「＋ 新增监控」（2026-10-16 迁移旧平台 SourceList 的加监控）', () => {
  it('点「＋ 新增监控」先开监控弹窗，并把当前源交给它（旧 MonitorModal.showModal(record)）', async () => {
    vi.spyOn(ckSourceApi, 'page').mockResolvedValue(pageResult())
    const wrapper = mountView({ siteId: 'site-4', sourceId: '430016944' })
    await flushPromises()

    expect(wrapper.find('[data-testid="source-monitor-stub"]').exists()).toBe(false)

    await wrapper.get('[data-testid="site-monitor-check-add"]').trigger('click')
    await flushPromises()

    // 这个源要一路传进弹窗内的列表：列表按它过滤，「加监控」再拿它预填「数据源」。
    // 少了它，「数据源」就没值可提交给后端。
    expect(wrapper.get('[data-testid="source-monitor-stub"]').text()).toBe('430016944')
  })

  it('未带源（网站「全部」形态）也照常打开，源交给用户在弹窗内自行选定', async () => {
    vi.spyOn(ckSourceApi, 'page').mockResolvedValue(pageResult())
    const wrapper = mountView({ siteId: 'site-4' })
    await flushPromises()

    await wrapper.get('[data-testid="site-monitor-check-add"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="source-monitor-stub"]').text()).toBe('(empty)')
  })
})
