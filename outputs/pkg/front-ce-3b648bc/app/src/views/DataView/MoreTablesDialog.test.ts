// @vitest-environment jsdom
// 数据中心 → 数据查询 → 「数据表选择」弹窗：点「详情」打开表结构详情抽屉（2026-10-14）。
// 217 反馈：表名称、更新时间显示成「—」——弹窗从接口取到的表详情只手工抄了 5 个字段，
// 表名称 / 更新时间 / 备注 / 记录变更 / 校验标识 / 校验规则 / 核心参数都丢了。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import MoreTablesDialog from './MoreTablesDialog.vue'
import { entryApi, type EntryType } from '../../api'

const LIST_ROW: EntryType = { tableId: '6200038', tableName: 'sense_data.TB_GGSJ', name: '公告数据', state: 'C', keyField: 'K8', updatedAt: '2026-10-08 16:55:10', fields: [] }
const DETAIL: EntryType = {
  ...LIST_ROW,
  remark: '备注说明',
  recFlag: 1,
  checkFlag: 2,
  checkRule: 'rule-a',
  coreParam: '{"a":1}',
  fields: [{ prop: 'announcement_id', type: 'string', desc: '公告ID', columnName: 'K1', itemId: '52000517', seq: 1, width: 100, required: false }],
}

describe('MoreTablesDialog · 表详情', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 1, list: [LIST_ROW] })
  })
  afterEach(() => {
    wrapper?.unmount()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  async function openDetail(detail: EntryType) {
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue(detail)
    wrapper = mount(MoreTablesDialog, { props: { modelValue: false }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    await new DOMWrapper(document.body).find('.dv-picker-dialog button.el-button--primary.is-link').trigger('click')
    await flushPromises()
    return new DOMWrapper(document.body).find('.rc-kv')
  }

  /** 抽屉里「标签 → 值」对照（dt / dd 成对） */
  const pairs = (kv: DOMWrapper<Element>) => {
    const dt = kv.findAll('dt').map((n) => n.text())
    const dd = kv.findAll('dd').map((n) => n.text())
    return Object.fromEntries(dt.map((label, i) => [label, dd[i]]))
  }

  it('表名称、更新时间、备注和规则类字段都显示接口返回的值，不再是「—」', async () => {
    const kv = await openDetail(DETAIL)
    expect(pairs(kv)).toMatchObject({
      '表 ID': '6200038',
      '表名称': '公告数据',
      '物理表名': 'sense_data.TB_GGSJ',
      '去重字段': 'K8',
      '状态': 'C',
      '备注': '备注说明',
      '更新时间': '2026-10-08 16:55:10',
      '记录变更': '1',
      '校验标识': '2',
      '校验规则': 'rule-a',
      '核心参数': '{"a":1}',
    })
  })

  it('表级字段对齐旧平台详情：没有「数据量」一项', async () => {
    const kv = await openDetail(DETAIL)
    expect(Object.keys(pairs(kv))).toEqual(['表 ID', '表名称', '物理表名', '状态', '去重字段', '备注', '更新时间', '记录变更', '校验标识', '校验规则', '核心参数'])
  })

  it('接口没返回的可选字段仍显示「—」', async () => {
    const kv = await openDetail({ ...LIST_ROW, fields: [] })
    expect(pairs(kv)).toMatchObject({ '表名称': '公告数据', '更新时间': '2026-10-08 16:55:10', '备注': '—', '核心参数': '—' })
  })
})
