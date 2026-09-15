// @vitest-environment jsdom
// 监控视图（0910 从旧平台「数据源告警」迁入，第一期只读 + 开关）。
// 这里验证接线：全部源态拦住、按源查询、告警标记、启停的 isDelete 反向语义、日志弹窗传参。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SiteMonitorView from './SiteMonitorView.vue'
import { siteApi, sourceCheckApi, type Source, type SourceCheck } from '@/api'

function check(over: Partial<SourceCheck> = {}): SourceCheck {
  return {
    id: 'ck-1', isDelete: 0, state: 'C', name: '日增量监控',
    lastMsg: '2026-09-09 11:00:46---正常, 数量:1240',
    tableName: 'sense_data.tb_jjjk', schedule: '0 0 * * * ?',
    nextRun: '2026-09-09 12:00:00', lastRun: '2026-09-09 11:00:19',
    sourceId: 's1', checkConf: '{}',
    ...over,
  }
}

function source(id: string, name = `源${id}`): Source {
  return { sourceId: id, name, url: '', configId: '', mainTable: '', owner: 'admin', state: 'C' }
}

const stubs = {
  SiteSourceSelect: { name: 'SiteSourceSelect', template: '<div />', emits: ['update:modelValue'] },
  CheckLogDialog: { name: 'CheckLogDialog', props: ['modelValue', 'check'], template: '<div />' },
  ElSwitch: {
    name: 'ElSwitch',
    props: ['modelValue', 'loading', 'disabled'],
    emits: ['change'],
    template: '<button class="el-switch" :data-on="modelValue" @click="$emit(\'change\', !modelValue)" />',
  },
  ElPagination: { name: 'ElPagination', props: ['currentPage', 'pageSize', 'total'], template: '<div />' },
}

function mountView(siteId = 'site-a') {
  return mount(SiteMonitorView, { props: { siteId }, global: { stubs, directives: { loading: {} } } })
}
function mountViewWithSourceSelect(siteId = 'site-auto') {
  const { SiteSourceSelect, ...stubsWithoutSourceSelect } = stubs
  void SiteSourceSelect
  return mount(SiteMonitorView, { props: { siteId }, global: { stubs: stubsWithoutSourceSelect, directives: { loading: {} } } })
}
async function pickSource(wrapper: ReturnType<typeof mountView>, sourceId = 's1') {
  await wrapper.findComponent({ name: 'SiteSourceSelect' }).vm.$emit('update:modelValue', sourceId)
  await flushPromises()
}

afterEach(() => vi.restoreAllMocks())

describe('SiteMonitorView', () => {
  // 后端 source/check/paged 的 sourceId 是单值，一个网站几千个源查不出来。
  // 与其像数据视图那样逐源归并（已证明会炸），不如把话说清楚。
  it('全部源态不发请求，提示先选一个具体源', async () => {
    const paged = vi.spyOn(sourceCheckApi, 'paged')
    const wrapper = mountView()
    await flushPromises()

    expect(paged).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="site-monitor-need-source"]').exists()).toBe(true)
  })

  it('选中源后按该源查询，筛选条件一并透传', async () => {
    const paged = vi.spyOn(sourceCheckApi, 'paged').mockResolvedValue({ total: 1, list: [check()] })
    const wrapper = mountView()
    await pickSource(wrapper)

    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 's1', page: 1, size: 10 }))
    expect(wrapper.find('[data-testid="site-monitor-need-source"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('共 1 条监控')

    await wrapper.get('select[aria-label="告警状态"]').setValue('E')
    await wrapper.get('input[aria-label="名称"]').setValue('增量')
    await wrapper.findAll('button').find((b) => b.text() === '查询')!.trigger('click')
    await flushPromises()

    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'E', name: '增量' }))
  })

  it('进入监控视图时默认选择第一个源，并用 page=1、limit=10 的口径查询', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('391007770', 'baodu'), source('391007768', 'test1')])
    const paged = vi.spyOn(sourceCheckApi, 'paged').mockResolvedValue({ total: 1, list: [check({ sourceId: '391007770' })] })

    const wrapper = mountViewWithSourceSelect('site-auto-first')
    await flushPromises()

    expect(paged).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: '391007770',
      page: 1,
      size: 10,
    }))
    expect(wrapper.find('[data-testid="site-monitor-need-source"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('共 1 条监控')
  })

  it('告警行整行标记，执行结果剥掉与「上次」重复的时间戳前缀', async () => {
    vi.spyOn(sourceCheckApi, 'paged').mockResolvedValue({
      total: 1,
      list: [check({ state: 'E', lastMsg: '2026-09-09 11:00:46---[X]:日增量-异常, 数量:0' })],
    })
    const wrapper = mountView()
    await pickSource(wrapper)

    const row = wrapper.get('.smv-table tbody tr')
    expect(row.classes()).toContain('is-alarm')
    // 时间戳前缀不再出现在结果列里，只留真正的结果文本
    expect(row.get('.smv-msg').text()).toBe('[X]:日增量-异常, 数量:0')
    expect(wrapper.get('[data-testid="site-monitor-alarm-count"]').text()).toContain('1')
  })

  // isDelete 的语义是反的：0 才是在用。旧平台在 loadData 里转了一道，
  // 迁过来最容易在这里把布尔搞反。
  it('在用开关按 isDelete 反向语义显示，切换时发的是 0/1 而不是布尔', async () => {
    vi.spyOn(sourceCheckApi, 'paged').mockResolvedValue({
      total: 2,
      list: [check({ id: 'on', isDelete: 0 }), check({ id: 'off', isDelete: 1 })],
    })
    const changeEnable = vi.spyOn(sourceCheckApi, 'changeEnable').mockResolvedValue({ ok: true })
    const wrapper = mountView()
    await pickSource(wrapper)

    const switches = wrapper.findAll('.el-switch')
    expect(switches[0].attributes('data-on')).toBe('true')  // isDelete 0 → 在用
    expect(switches[1].attributes('data-on')).toBe('false') // isDelete 1 → 停用

    await switches[0].trigger('click')
    await flushPromises()
    expect(changeEnable).toHaveBeenCalledWith(['on'], 1) // 在用 → 停用，发 1
  })

  it('点日志把该条监控传给弹窗，源与 jobId 都带上', async () => {
    vi.spyOn(sourceCheckApi, 'paged').mockResolvedValue({ total: 1, list: [check({ id: 'ck-9', sourceId: 's1' })] })
    const wrapper = mountView()
    await pickSource(wrapper)

    await wrapper.get('[data-testid="site-monitor-logs"]').trigger('click')
    const dialog = wrapper.findComponent({ name: 'CheckLogDialog' })
    expect(dialog.props('modelValue')).toBe(true)
    expect((dialog.props('check') as SourceCheck).id).toBe('ck-9')
  })

  it('「只看告警」是 state=E 的一键开关，再点回到全部', async () => {
    const paged = vi.spyOn(sourceCheckApi, 'paged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = mountView()
    await pickSource(wrapper)

    await wrapper.get('[data-testid="site-monitor-only-alarm"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'E' }))

    await wrapper.get('[data-testid="site-monitor-only-alarm"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ state: '' }))
  })

  it('查询失败时给出错误而不是空表格假装没事', async () => {
    vi.spyOn(sourceCheckApi, 'paged').mockRejectedValue(new Error('后端 500'))
    const wrapper = mountView()
    await pickSource(wrapper)

    expect(wrapper.text()).toContain('后端 500')
  })
})
