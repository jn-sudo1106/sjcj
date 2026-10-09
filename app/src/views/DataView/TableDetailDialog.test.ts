// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import * as xlsxExport from '@/utils/format/xlsxExport'
import TableDetailDialog from './TableDetailDialog.vue'
import type { DataTableMeta } from '@/api'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function mountDialog(tableMeta: DataTableMeta | null) {
  return mount(TableDetailDialog, {
    props: { modelValue: true, tableMeta },
    global: { plugins: [ElementPlus] },
    attachTo: document.body,
  })
}

/** el-table 内部渲染依赖布局/宏任务，flushPromises 不够，多等一拍 */
async function settle() {
  await flushPromises()
  await new Promise((r) => setTimeout(r, 50))
}

function meta(overrides: Partial<DataTableMeta> = {}): DataTableMeta {
  return {
    tableId: '2102179',
    tableName: 'sense_data.TB_GNBK',
    name: '概念板块',
    state: 'C',
    keyField: 'K1',
    remark: '',
    updatedAt: '2026-09-28 10:07:45',
    fields: [
      { prop: 'concept_name', columnName: 'K1', desc: '概念名称', type: 'string', width: 255, itemId: '4107985', seq: 1 },
      { prop: 'concept_code', columnName: 'K2', desc: '概念板块代码', type: 'string', width: 50, itemId: '4107986', seq: 2 },
      { prop: 'desc', columnName: 'K3', desc: '简介', type: 'string', width: 500, itemId: '4107987', seq: 3 },
      { prop: 'result', columnName: 'K4', desc: '详情json', type: 'string', width: 1000, itemId: '4107988', seq: 4 },
      { prop: 'concept_type', columnName: 'K5', desc: '概念类型', type: 'string', width: 255, itemId: '4107989', seq: 5 },
      { prop: 'source', columnName: 'K6', desc: '数据来源', type: 'string', width: 50, itemId: '4107990', seq: 6 },
    ],
    ...overrides,
  }
}

describe('TableDetailDialog', () => {
  it('字段列表列对齐老平台：排序/ID/编码/展示名/数据库列/类型/校验/列宽/预处理', async () => {
    const wrapper = mountDialog(meta())
    await settle()

    // el-drawer append-to-body，表头在 document.body 里（与 DataQueryTab.test 同口径）
    const bodyText = document.body.textContent ?? ''
    for (const label of ['排序', 'ID', '编码', '展示名', '数据库列', '类型', '校验', '列宽', '预处理']) {
      expect(bodyText).toContain(label)
    }
    // 第一行数据：concept_name / 概念名称 / K1
    expect(bodyText).toContain('concept_name')
    expect(bodyText).toContain('概念名称')
    expect(bodyText).toContain('K1')
    wrapper.unmount()
  })

  it('导出字段：点按钮按老平台列（序号/内部ID/数据库列/字段编码/字段名称/数据类型）调 downloadXlsx', async () => {
    const download = vi.spyOn(xlsxExport, 'downloadXlsx').mockImplementation(() => {})
    const wrapper = mountDialog(meta())
    await flushPromises()

    const exportBtn = document.body.querySelector<HTMLButtonElement>('[data-testid="export-fields"]')
    expect(exportBtn).not.toBeNull()
    exportBtn!.click()
    await flushPromises()

    expect(download).toHaveBeenCalledTimes(1)
    const [filename, rows] = download.mock.calls.at(-1)!
    expect(filename).toMatch(/^表字段_TB_GNBK_\d{8}$/)
    expect(rows[0]).toEqual(['序号', '内部ID', '数据库列', '字段编码', '字段名称', '数据类型'])
    // string 类型 → varchar(列宽)；第一行 concept_name width 255
    expect(rows[1]).toEqual(['1', '4107985', 'K1', 'concept_name', '概念名称', 'varchar(255)'])
    wrapper.unmount()
  })

  it('导出字段：string 类型列宽缺省或 <=0 时按 128（老平台口径）', async () => {
    const download = vi.spyOn(xlsxExport, 'downloadXlsx').mockImplementation(() => {})
    const wrapper = mountDialog(meta({
      fields: [
        { prop: 'no_width', columnName: 'K1', desc: '无列宽', type: 'string', itemId: '1', seq: 1 },
        { prop: 'int_col', columnName: 'K2', desc: '整型', type: 'long', width: 20, itemId: '2', seq: 2 },
      ],
    }))
    await flushPromises()

    const exportBtn = document.body.querySelector<HTMLButtonElement>('[data-testid="export-fields"]')
    expect(exportBtn).not.toBeNull()
    exportBtn!.click()
    await flushPromises()

    const [, rows] = download.mock.calls.at(-1)!
    expect(rows[1]).toEqual(['1', '1', 'K1', 'no_width', '无列宽', 'varchar(128)'])
    expect(rows[2]).toEqual(['2', '2', 'K2', 'int_col', '整型', 'long'])
    wrapper.unmount()
  })
})
