// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import BackTraceSourcesDialog from './BackTraceSourcesDialog.vue'
import { dataApi, sourceApi, type RowQuery, type Source } from '@/api'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const QUERY: RowQuery = { tableId: 't1', sql: "K1 LIKE '%人保%'" }

function makeSource(id: string): Source {
  return { sourceId: id, name: `源 ${id}`, url: '', configId: '', mainTable: '', owner: 'a', state: 'C' } as Source
}

async function mountDialog(query: RowQuery | null = QUERY) {
  const wrapper = mount(BackTraceSourcesDialog, {
    props: { query, conditionLabel: "K1 LIKE '%人保%'" },
    global: { plugins: [ElementPlus] },
  })
  await flushPromises()
  return wrapper
}

describe('BackTraceSourcesDialog（0903 Y2 / H12）', () => {
  // 反查改成"把网站的源写进查询条件"（2026-09-04 重写）：
  // 老做法是全表捞 ID 再前端取交集，而 entryDistinctSource 不认 siteId、按表搜全库，
  // 共用表全平台命中动辄上千，分页一截本网站的源就整个不在返回里——
  // 真实故障：数据列表里明明有 920663 的行，反查却说"命中 0 个源"。上限调多大都堵不住。
  it('有网站源清单时：走 summaryEntryData 分组，把 SOURCE_ID IN 写进条件', async () => {
    const summary = vi.spyOn(dataApi, 'summaryData').mockResolvedValue([
      { SOURCE_ID: '430016824', CNT: 5 } as never,
    ])
    const distinct = vi.spyOn(dataApi, 'distinctSource')
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [makeSource('430016824')] })

    const wrapper = mount(BackTraceSourcesDialog, {
      props: { query: QUERY, siteSourceIds: ['430016824', '430016398'] },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    // 不再全表捞 ID
    expect(distinct).not.toHaveBeenCalled()
    const [q, fields] = summary.mock.calls[0]
    expect(fields).toEqual(['SOURCE_ID'])
    expect(q.sql).toContain("K1 LIKE '%人保%'")
    expect(q.sql).toContain("SOURCE_ID IN ('430016824','430016398')")

    expect(wrapper.get('[data-testid="backtrace-hit"]').text()).toContain('1')
    expect(wrapper.findAll('[data-testid="backtrace-row"]')).toHaveLength(1)
    // 命中条数来自分组结果，比源的总数据量贴题
    expect(wrapper.get('[data-testid="backtrace-row"]').text()).toContain('5')
  })

  it('条件为空时也能只按网站源范围分组，不拼出畸形 SQL', async () => {
    const summary = vi.spyOn(dataApi, 'summaryData').mockResolvedValue([])
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })

    mount(BackTraceSourcesDialog, {
      props: { query: { tableId: 't1' }, siteSourceIds: ['1'] },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    expect(summary.mock.calls[0][0].sql).toBe("SOURCE_ID IN ('1')")
  })

  it('没给网站源清单时才退回全表 distinctSource', async () => {
    const distinct = vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['9'])
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [makeSource('9')] })

    await mountDialog()

    expect(distinct).toHaveBeenCalled()
  })

  it('本网站的源都没命中：给空态', async () => {
    vi.spyOn(dataApi, 'summaryData').mockResolvedValue([])
    const paged = vi.spyOn(sourceApi, 'sourcePaged')

    const wrapper = mount(BackTraceSourcesDialog, {
      props: { query: QUERY, siteSourceIds: ['1', '2'] },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="backtrace-empty"]').exists()).toBe(true)
    expect(paged).not.toHaveBeenCalled()
  })

  it('补详情失败时仍列出源 ID，只是名称显示为未取到', async () => {
    vi.spyOn(dataApi, 'summaryData').mockResolvedValue([{ SOURCE_ID: '7', CNT: 2 } as never])
    vi.spyOn(sourceApi, 'sourcePaged').mockRejectedValue(new Error('boom'))

    const wrapper = mount(BackTraceSourcesDialog, {
      props: { query: QUERY, siteSourceIds: ['7'] },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.findAll('[data-testid="backtrace-row"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('（未取到名称）')
    expect(wrapper.find('[data-testid="backtrace-error"]').exists()).toBe(false)
  })

  it('反查本身失败：显示错误，不显示空态', async () => {
    vi.spyOn(dataApi, 'summaryData').mockRejectedValue(new Error('网关超时'))

    const wrapper = mount(BackTraceSourcesDialog, {
      props: { query: QUERY, siteSourceIds: ['1'] },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="backtrace-error"]').text()).toContain('网关超时')
    expect(wrapper.find('[data-testid="backtrace-empty"]').exists()).toBe(false)
  })

  // 与源视图「发任务」同一套口径（0831 F06）：不勾 = 全部
  it('未勾选时对全部命中源生效；勾选后只对勾选项', async () => {
    vi.spyOn(dataApi, 'summaryData').mockResolvedValue([
      { SOURCE_ID: '1', CNT: 1 } as never, { SOURCE_ID: '2', CNT: 1 } as never, { SOURCE_ID: '3', CNT: 1 } as never,
    ])
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 3, list: ['1', '2', '3'].map(makeSource) })

    const wrapper = mount(BackTraceSourcesDialog, {
      props: { query: QUERY, siteSourceIds: ['1', '2', '3'] },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    await wrapper.get('[data-testid="backtrace-launch"]').trigger('click')
    expect(wrapper.emitted('launch')![0]).toEqual([['1', '2', '3']])

    await wrapper.findAll('[data-testid="backtrace-row"] input')[1].setValue(true)
    await wrapper.get('[data-testid="backtrace-launch"]').trigger('click')
    expect(wrapper.emitted('launch')![1]).toEqual([['2']])
  })
})
