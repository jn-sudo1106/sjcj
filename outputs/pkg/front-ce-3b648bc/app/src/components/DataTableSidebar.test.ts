// @vitest-environment jsdom
// 数据表侧栏（数据中心「数据查询」与问数配置「选表规则配置」共用）的分组页签口径：
// ① 默认两种分组都给，且默认落「业务目录」并按 biz 拉根层；
// ② bizOnly 只留业务目录 —— 「数据库」页签整条不出，避免选表规则配置里又冒出按引擎分的分组。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'

vi.mock('@/api/sourceDirs', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    loadDirChildren: vi.fn(async (_kind: string, parentId = '') => (parentId ? [] : [{ id: '9001', name: '股票数据', parentId: '' }])),
    bizDirTables: vi.fn(async () => ({ tableIds: [], failedFlowIds: [] })),
  }
})

import DataTableSidebar from './DataTableSidebar.vue'
import * as sourceDirs from '@/api/sourceDirs'
import type { EntryType } from '@/api'

const TABLES: EntryType[] = [{ tableId: '1042', tableName: 'sense_data.KHFA_KHZBJG_JG', name: '客户风险结果监管', fields: [] }]

async function mountSidebar(bizOnly?: boolean) {
  const wrapper = mount(DataTableSidebar, {
    props: { tables: TABLES, selectedId: '1042', scope: 'all' as const, loading: false, error: '', bizOnly },
    global: { plugins: [ElementPlus] },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.mocked(sourceDirs.loadDirChildren).mockClear()
  vi.mocked(sourceDirs.bizDirTables).mockClear()
})

describe('DataTableSidebar', () => {
  it('默认给「业务目录 / 数据库」两个页签，默认落业务目录并按 biz 拉根层', async () => {
    const wrapper = await mountSidebar()

    expect(wrapper.find('[data-tab="biz"]').exists()).toBe(true)
    expect(wrapper.find('[data-tab="db"]').exists()).toBe(true)
    expect(wrapper.find('[data-tab="biz"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[data-testid="data-table-biz-tree"]').exists()).toBe(true)
    expect(vi.mocked(sourceDirs.loadDirChildren).mock.calls[0]).toEqual(['biz', ''])
  })

  it('bizOnly 时不出「数据库」页签，业务目录树照常', async () => {
    const wrapper = await mountSidebar(true)

    expect(wrapper.find('[data-tab="db"]').exists()).toBe(false)
    expect(wrapper.find('[data-tab="biz"]').exists()).toBe(false)
    expect(wrapper.find('.dt-tabs').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-table-biz-tree"]').exists()).toBe(true)
    expect(wrapper.find('[data-dir-id="9001"]').text()).toContain('股票数据')
    // 按引擎分的分组（MYSQL / CK 段）不能借 bizOnly 冒出来
    expect(wrapper.find('[data-group="MYSQL"]').exists()).toBe(false)
  })

  it('bizOnly 下搜表名仍是平铺结果，不折回数据库分组', async () => {
    const wrapper = await mountSidebar(true)
    await wrapper.find('input[data-testid="data-table-search"]').setValue('客户')
    await flushPromises()

    expect(wrapper.find('[data-table-id="1042"]').exists()).toBe(true)
    expect(wrapper.find('[data-group="MYSQL"]').exists()).toBe(false)
  })
})
