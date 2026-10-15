// @vitest-environment jsdom
// 向量表配置弹窗（1:1 对齐旧 ai-chat-view src/demo/modal/VectorMapping.vue）。
// 钉的是这个模块最容易被"顺手重构"掉的五条口径：
// ① 保存 body 是 {config, items} 包装（不是平铺表单），新建不带 id、编辑带 id；
// ② 选源表自动回填：备注=typeName、源表名剥 'sense_data.' 前缀、向量表表名=`源表名_VECTOR`，并按 entryTypeId 拉源表字段；
// ③ 新建预置三行空映射（type '1'/'2'/'3' = 编码/内容/别名），编辑/详情的映射来自 mapping/info；
// ④ 列映射明细取回失败**不开弹窗**（旧版异步回填不兜底，空 items 直接保存会清掉已有映射）；
// ⑤ 编辑整行带回除编辑字段与 createTime/updateTime 外的所有键（lastSync 也在带回之列，同 passthrough 先例）。
// 挂载方式同 MatchTableConfigEditDialog.test.ts：el-dialog 是 append-to-body 的 teleport，
// 用 attachTo: document.body + document 查询，不要 stub teleport。
// ⚠️ 慢用例显式 30s 超时：弹窗 + el-table 首编译很重，单跑「新建」就要 8s，
// 批量多 worker 抢 CPU 时能压过全局 15s 的 testTimeout（同 components/SqlConditionEditor.test.ts 的口径与注释）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElSelect } from 'element-plus'
import VectorConfigEditDialog from './VectorConfigEditDialog.vue'
import { pocTableEntryList, pocTableFieldList, vectorConfigApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  vectorConfigApi: {
    save: vi.fn(async () => ({ ok: true, message: '保存成功' })),
    mappingInfo: vi.fn(async () => [
      { id: 11, configId: 1, type: '1', sourceColumn: 'JGDM', targetColumn: 'jg_code', valueColumn: '', rule: '' },
      { id: 12, configId: 1, type: '2', sourceColumn: 'JGMC', targetColumn: 'jg_name', valueColumn: '', rule: '' },
      { id: 13, configId: 1, type: '3', sourceColumn: 'JGMC', targetColumn: 'jg_alias', valueColumn: '', rule: '' },
    ]),
  },
  pocTableEntryList: vi.fn(async () => [
    { entryTypeId: 1, tableName: 'sense_data.KHFA_KHZBJG_JG', typeName: '客户指标结果' },
    { entryTypeId: 3, tableName: 'sense_data.DIM_JG', typeName: '机构向量表-类型名' },
  ]),
  pocTableFieldList: vi.fn(async () => [
    { itemId: 301, itemCode: 'JGDM', itemName: '机构代码' },
    { itemId: 302, itemCode: 'JGMC', itemName: '机构名称' },
  ]),
}))

type Vm = { open: (record?: Record<string, unknown> | null) => Promise<void> | void; openDetail: (record: Record<string, unknown>) => Promise<void> | void }

function mountDialog() {
  return mount(VectorConfigEditDialog, { global: { plugins: [ElementPlus] }, attachTo: document.body })
}
function itemByLabel(label: string): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>('.el-dialog .el-form-item')].find((el) =>
    el.querySelector('.el-form-item__label')?.textContent?.includes(label),
  )!
}
function fill(label: string, value: string) {
  const input = itemByLabel(label).querySelector('input, textarea')!
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
/** 源表下拉：v-model 写值 + change 触发旧 selectTableChange 的自动回填（绕开 teleported popper） */
async function pickSourceTable(wrapper: ReturnType<typeof mountDialog>, entryTypeId: number) {
  const select = wrapper
    .findAllComponents(ElSelect)
    .find((c) => c.element === itemByLabel('源表').querySelector('.el-select'))!
  select.vm.$emit('update:modelValue', entryTypeId)
  select.vm.$emit('change', entryTypeId)
  await flushPromises()
}
/** 映射表第一行的「源列名」下拉（findAllComponents 顺序：0=源表，1..n=各行源列名） */
function pickRowSourceColumn(wrapper: ReturnType<typeof mountDialog>, index: number, itemCode: string) {
  const select = wrapper.findAllComponents(ElSelect)[index]!
  select.vm.$emit('update:modelValue', itemCode)
}
function footerButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('.el-dialog__footer button')].find((b) => b.textContent?.trim() === label)
}
function mappingRows(): HTMLTableRowElement[] {
  return [...document.querySelectorAll<HTMLTableRowElement>('.vce-map-table .el-table__body-wrapper tbody tr')]
}
function savedPayload(index = 0) {
  return vi.mocked(vectorConfigApi.save).mock.calls[index]?.[0] as { config: Record<string, unknown>; items: Record<string, unknown>[] }
}

async function saveClick(wrapper: ReturnType<typeof mountDialog>) {
  footerButton('保存')?.click()
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.resetAllMocks()
  vi.mocked(vectorConfigApi.save).mockResolvedValue({ ok: true, message: '保存成功' })
  vi.mocked(vectorConfigApi.mappingInfo).mockResolvedValue([
    { id: 11, configId: 1, type: '1', sourceColumn: 'JGDM', targetColumn: 'jg_code', valueColumn: '', rule: '' },
    { id: 12, configId: 1, type: '2', sourceColumn: 'JGMC', targetColumn: 'jg_name', valueColumn: '', rule: '' },
    { id: 13, configId: 1, type: '3', sourceColumn: 'JGMC', targetColumn: 'jg_alias', valueColumn: '', rule: '' },
  ])
  vi.mocked(pocTableEntryList).mockResolvedValue([
    { entryTypeId: 1, tableName: 'sense_data.KHFA_KHZBJG_JG', typeName: '客户指标结果' },
    { entryTypeId: 3, tableName: 'sense_data.DIM_JG', typeName: '机构向量表-类型名' },
  ])
  vi.mocked(pocTableFieldList).mockResolvedValue([
    { itemId: 301, itemCode: 'JGDM', itemName: '机构代码' },
    { itemId: 302, itemCode: 'JGMC', itemName: '机构名称' },
  ])
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('VectorConfigEditDialog', () => {
  it('新建：标题「向量表配置」，预置编码/内容/别名三行空映射，保存发 {config, items} 不带 id', async () => {
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open()
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('向量表配置')
    expect(pocTableEntryList).toHaveBeenCalledWith('')
    expect(mappingRows().map((tr) => tr.cells[0]?.textContent?.trim())).toEqual(['编码', '内容', '别名'])

    await pickSourceTable(wrapper, 3)
    fill('字典表类型', 'X')
    await saveClick(wrapper)
    expect(savedPayload()).toEqual({
      config: { sourceTableId: 3, sourceTable: 'DIM_JG', name: 'DIM_JG_VECTOR', comment: '机构向量表-类型名', returnNum: 1, matchDegree: 0.6, dataIndexCode: 'X', preRule: '', dataClearRule: '' },
      items: [{ type: '1' }, { type: '2' }, { type: '3' }],
    })
    expect(wrapper.emitted('saved')?.at(-1)?.[0]).toEqual({ mode: 'add' })
  }, 30_000)

  it('选源表自动回填：备注=typeName、源表名剥 sense_data. 前缀、表名=源表名_VECTOR，并按 entryTypeId 拉源表字段', async () => {
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open()
    await flushPromises()

    await pickSourceTable(wrapper, 3)
    expect(itemByLabel('向量表备注').querySelector('input')!.value).toBe('机构向量表-类型名')
    expect(itemByLabel('向量表表名').querySelector('input')!.value).toBe('DIM_JG_VECTOR')
    expect(pocTableFieldList).toHaveBeenCalledWith(3)
  }, 30_000)

  it('必填拦截（文案照旧 rules）：缺源表/表名/备注/字典表类型都不发请求', async () => {
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open()
    await flushPromises()

    await saveClick(wrapper)
    expect(vectorConfigApi.save).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请选择源表')

    await pickSourceTable(wrapper, 3)
    await saveClick(wrapper)
    expect(document.body.textContent).toContain('请填写字典表类型')
    expect(vectorConfigApi.save).not.toHaveBeenCalled()
  }, 30_000)

  it('编辑：mapping/info 回填列映射；提交带 id，原样带回 lastSync/sourceTableId，不发 createTime/updateTime', async () => {
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open({
      id: 1,
      name: 'DIM_JG_VECTOR',
      comment: '机构向量表',
      sourceTable: 'DIM_JG',
      sourceTableId: 3,
      matchDegree: 0.85,
      dataIndexCode: 'JG',
      returnNum: 5,
      lastSync: '2026-10-12 09:20:31',
      createTime: '2026-09-01 08:00:00',
      updateTime: '2026-10-12 09:20:31',
    })
    await flushPromises()

    expect(vectorConfigApi.mappingInfo).toHaveBeenCalledWith(1)
    expect(pocTableFieldList).toHaveBeenCalledWith(3)
    expect(mappingRows()).toHaveLength(3)
    expect(itemByLabel('向量表表名').querySelector('input')!.value).toBe('DIM_JG_VECTOR')

    pickRowSourceColumn(wrapper, 1, 'JGDH')
    await saveClick(wrapper)

    const { config, items } = savedPayload()
    expect(config).toMatchObject({ id: 1, name: 'DIM_JG_VECTOR', sourceTableId: 3, returnNum: 5, matchDegree: 0.85, lastSync: '2026-10-12 09:20:31' })
    expect(config.createTime).toBeUndefined()
    expect(config.updateTime).toBeUndefined()
    expect(items[0]).toMatchObject({ id: 11, configId: 1, sourceColumn: 'JGDH' })
    expect(wrapper.emitted('saved')?.at(-1)?.[0]).toEqual({ mode: 'edit' })
  }, 30_000)

  it('列映射明细取回失败：不开弹窗（旧版空 items 直接保存会清掉已有映射）', async () => {
    vi.mocked(vectorConfigApi.mappingInfo).mockRejectedValueOnce(new Error('未找到对应的向量表配置'))
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open({ id: 1, name: 'DIM_JG_VECTOR' })
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')).toBeNull()
    expect(document.body.textContent).toContain('未找到对应的向量表配置')
  })

  it('详情：同一表单只读态，无输入控件、无保存按钮（旧 showModal）', async () => {
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).openDetail({
      id: 1,
      name: 'DIM_JG_VECTOR',
      comment: '机构向量表',
      sourceTable: 'DIM_JG',
      sourceTableId: 3,
      matchDegree: 0.85,
      dataIndexCode: 'JG',
      returnNum: 5,
    })
    await flushPromises()

    expect(wrapper.findAllComponents(ElSelect)).toHaveLength(0)
    expect(itemByLabel('向量表表名').textContent).toContain('DIM_JG_VECTOR')
    expect(itemByLabel('源表').textContent).toContain('DIM_JG')
    expect(mappingRows().map((tr) => tr.textContent)).toHaveLength(3)
    expect(mappingRows()[0]!.textContent).toContain('编码')
    expect(footerButton('保存')).toBeUndefined()
    expect(footerButton('关闭')).toBeDefined()

    footerButton('关闭')?.click()
    await flushPromises()
  })

  it('删除映射行按下标只删当前行（旧版按 JSON 全等过滤会误删同内容行）', async () => {
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open({
      id: 1,
      name: 'DIM_JG_VECTOR',
      comment: 'c',
      sourceTable: 'DIM_JG',
      sourceTableId: 3,
      matchDegree: 0.6,
      dataIndexCode: 'JG',
      returnNum: 1,
    })
    await flushPromises()
    expect(mappingRows()).toHaveLength(3)

    const firstDelete = mappingRows()[0]!.querySelector('.vce-del-icon')!
    firstDelete.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(mappingRows()).toHaveLength(2)
    expect(mappingRows().map((tr) => tr.cells[0]?.textContent?.trim())).toEqual(['内容', '别名'])
  }, 30_000)
})
