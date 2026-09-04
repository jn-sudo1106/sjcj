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
  it('命中若干源：展示命中数并补齐名称', async () => {
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['1', '2', '3'])
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 3, list: ['1', '2', '3'].map(makeSource) })

    const wrapper = await mountDialog()

    expect(wrapper.get('[data-testid="backtrace-hit"]').text()).toContain('3')
    expect(wrapper.findAll('[data-testid="backtrace-row"]')).toHaveLength(3)
    expect(wrapper.text()).toContain('源 2')
  })

  // 2026-09-04 走查踩到：不传 size 时 buildLegacyRowQuery 退回分页默认值 20，
  // 反查只拿到全平台前 20 个源，本网站的源常常不在里面 → 表现成"命中的源都不属于当前网站"。
  // SiteDataView 早就为同一个坑显式传了 1000，本弹窗第一版忘了。
  it('反查必须显式传 size，避免退回分页默认值 20 只拿到前 20 个源', async () => {
    const distinct = vi.spyOn(dataApi, 'distinctSource').mockResolvedValue([])
    await mountDialog()
    expect(distinct).toHaveBeenCalledWith(expect.objectContaining({ tableId: 't1', size: 1000 }))
  })

  // 顶到上限 = 结果不完整，跟"命中太多看不过来"不是一回事：本网站可能还有源没被返回。
  // 2026-09-04 走查实证：一个命中面很广的条件真的返回了正好 1000 条。
  it('返回条数顶到上限时提示结果可能不完整', async () => {
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(Array.from({ length: 1000 }, (_, i) => String(i)))
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })

    const wrapper = await mountDialog()

    expect(wrapper.get('[data-testid="backtrace-truncated"]').text()).toContain('可能不完整')
  })

  it('命中 0 个：给空态，不发补详情的请求', async () => {
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue([])
    const paged = vi.spyOn(sourceApi, 'sourcePaged')

    const wrapper = await mountDialog()

    expect(wrapper.find('[data-testid="backtrace-empty"]').exists()).toBe(true)
    expect(paged).not.toHaveBeenCalled()
  })

  // 上限存在的意义是"别为了展示打十几次请求"，所以超限时**一条补详情的请求都不该发**
  it('超过上限：不展开清单也不补详情，但仍留「直接发任务」这条路', async () => {
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(Array.from({ length: 2001 }, (_, i) => String(i)))
    const paged = vi.spyOn(sourceApi, 'sourcePaged')

    const wrapper = await mountDialog()

    expect(wrapper.find('[data-testid="backtrace-over-limit"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="backtrace-row"]')).toHaveLength(0)
    expect(paged).not.toHaveBeenCalled()
    // 「在源视图中打开」禁用（展不开），但发任务仍可用
    expect(wrapper.get('[data-testid="backtrace-open-source-view"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="backtrace-launch"]').attributes('disabled')).toBeUndefined()
  })

  // 详情补齐失败不该把整个反查废掉——用户要的是"哪些源"，名称是锦上添花
  it('补详情失败时仍列出源 ID，只是名称显示为未取到', async () => {
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['7', '8'])
    vi.spyOn(sourceApi, 'sourcePaged').mockRejectedValue(new Error('boom'))

    const wrapper = await mountDialog()

    expect(wrapper.findAll('[data-testid="backtrace-row"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('（未取到名称）')
    expect(wrapper.find('[data-testid="backtrace-error"]').exists()).toBe(false)
  })

  it('反查本身失败：显示错误，不显示空态', async () => {
    vi.spyOn(dataApi, 'distinctSource').mockRejectedValue(new Error('网关超时'))

    const wrapper = await mountDialog()

    expect(wrapper.get('[data-testid="backtrace-error"]').text()).toContain('网关超时')
    expect(wrapper.find('[data-testid="backtrace-empty"]').exists()).toBe(false)
  })

  // 反查按表和 SQL 搜全库（entryDistinctSource 的载荷里没有 siteId），跨网站是常态。
  // 2026-09-04 拍板：**只保留本网站**——用户是在这个网站的数据视图里点的反查，
  // 心里的范围就是它；源视图也锁死在当前网站内（0812 纠偏），跨网站的源既进不去也不该在这里发。
  it('只展示本网站的命中源，其它网站的只报个数不列出', async () => {
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['1', '2', '3'])
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 3,
      list: [makeSource('1'), makeSource('2'), makeSource('3')],
    })

    const wrapper = mount(BackTraceSourcesDialog, {
      props: { query: QUERY, siteSourceIds: ['1', '3'] },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.findAll('[data-testid="backtrace-row"]')).toHaveLength(2)
    expect(wrapper.get('[data-testid="backtrace-cross-site"]').text()).toContain('另有 1 个')
    // 发任务与在源视图打开，作用范围都只是本网站那两个
    await wrapper.get('[data-testid="backtrace-launch"]').trigger('click')
    expect(wrapper.emitted('launch')![0]).toEqual([['1', '3']])
    await wrapper.get('[data-testid="backtrace-open-source-view"]').trigger('click')
    expect(wrapper.emitted('openInSourceView')![0]).toEqual([['1', '3']])
  })

  it('本网站一个都没命中：给出解释性空态，动作禁用', async () => {
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['9'])
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [makeSource('9')] })

    const wrapper = mount(BackTraceSourcesDialog, {
      props: { query: QUERY, siteSourceIds: ['1', '3'] },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="backtrace-none-in-site"]').text()).toContain('都属于其它网站')
    expect(wrapper.get('[data-testid="backtrace-open-source-view"]').attributes('disabled')).toBeDefined()
  })

  // 与源视图「发任务」同一套口径（0831 F06）：不勾 = 全部
  it('未勾选时对全部命中源生效；勾选后只对勾选项', async () => {
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['1', '2', '3'])
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 3, list: ['1', '2', '3'].map(makeSource) })

    const wrapper = await mountDialog()
    await wrapper.get('[data-testid="backtrace-launch"]').trigger('click')
    expect(wrapper.emitted('launch')![0]).toEqual([['1', '2', '3']])

    await wrapper.findAll('[data-testid="backtrace-row"] input')[1].setValue(true)
    await wrapper.get('[data-testid="backtrace-launch"]').trigger('click')
    expect(wrapper.emitted('launch')![1]).toEqual([['2']])
  })
})
