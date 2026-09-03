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
