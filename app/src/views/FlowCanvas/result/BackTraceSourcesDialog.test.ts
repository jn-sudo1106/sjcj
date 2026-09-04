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

function makeSource(id: string, siteId = 's1'): Source {
  return { sourceId: id, name: `源 ${id}`, siteId, url: '', configId: '', mainTable: '', owner: 'a', state: 'C' } as Source
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
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 3, list: ['1', '2', '3'].map((id) => makeSource(id)) })

    const wrapper = await mountDialog()

    expect(wrapper.get('[data-testid="backtrace-hit"]').text()).toContain('3')
    expect(wrapper.findAll('[data-testid="backtrace-row"]')).toHaveLength(3)
    expect(wrapper.text()).toContain('源 2')
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
  // 而源视图锁死在当前网站内（0812 纠偏），把跨网站的 ID 递过去只会查出一张空表——
  // 实测踩到过：URL 上带着 20 个 ID，源视图显示"共 0 个源"。
  it('默认不跨网站：只显示本网站的源，勾选后才带上其它网站', async () => {
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['1', '2', '3'])
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 3,
      list: [makeSource('1', 's1'), makeSource('2', 'other'), makeSource('3', 's1')],
    })

    const wrapper = mount(BackTraceSourcesDialog, {
      props: { query: QUERY, siteSourceIds: ['1', '3'] },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    // 默认只看本网站：2 号（别的网站）不出现
    expect(wrapper.findAll('[data-testid="backtrace-row"]')).toHaveLength(2)
    expect(wrapper.get('[data-testid="backtrace-cross-site"]').text()).toContain('另有 1 个')
    await wrapper.get('[data-testid="backtrace-launch"]').trigger('click')
    expect(wrapper.emitted('launch')![0]).toEqual([['1', '3']])

    // 勾上「包含其它网站」后三个都在
    await wrapper.get('[data-testid="backtrace-cross-site"] input').setValue(true)
    expect(wrapper.findAll('[data-testid="backtrace-row"]')).toHaveLength(3)
    await wrapper.get('[data-testid="backtrace-launch"]').trigger('click')
    expect(wrapper.emitted('launch')![1]).toEqual([['1', '2', '3']])
    // 但「在源视图中打开」永远只带本网站的——源视图查不到别家的源
    await wrapper.get('[data-testid="backtrace-open-source-view"]').trigger('click')
    expect(wrapper.emitted('openInSourceView')![0]).toEqual([['1', '3']])
  })

  it('命中源全都不在当前网站：给出可操作的空态，且「在源视图中打开」禁用', async () => {
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['9'])
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [makeSource('9')] })

    const wrapper = mount(BackTraceSourcesDialog, {
      props: { query: QUERY, siteSourceIds: ['1', '3'] },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="backtrace-none-in-site"]').text()).toContain('包含其它网站的源')
    const btn = wrapper.get('[data-testid="backtrace-open-source-view"]')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.attributes('title')).toContain('只能查看本网站的源')
  })

  // 与源视图「发任务」同一套口径（0831 F06）：不勾 = 全部
  it('未勾选时对全部命中源生效；勾选后只对勾选项', async () => {
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['1', '2', '3'])
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 3, list: ['1', '2', '3'].map((id) => makeSource(id)) })

    const wrapper = await mountDialog()
    await wrapper.get('[data-testid="backtrace-launch"]').trigger('click')
    expect(wrapper.emitted('launch')![0]).toEqual([['1', '2', '3']])

    await wrapper.findAll('[data-testid="backtrace-row"] input')[1].setValue(true)
    await wrapper.get('[data-testid="backtrace-launch"]').trigger('click')
    expect(wrapper.emitted('launch')![1]).toEqual([['2']])
  })
})
