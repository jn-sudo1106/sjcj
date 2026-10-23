// @vitest-environment jsdom
// 表字段管理接线回归（旧 ai-chat-view src/demo/EntityConfig.vue）。钉住旧口径：
// ① 挂载即拉表列表（entry-list?name=）；选中表按 entryTypeId 回填表头 5 项并拉字段（table-info?tableId=）；
// ② 表头必填缺失时保存被拦下并提示「请填写完整信息」（旧 validate + message 口径）；
// ③ 保存整表覆盖：useAlias 开关回写 0/1、行上 dataIndexFlag/vectorFlag 回写 dataIndex/vector，
//    form.tableName 存的是 entryTypeId、payload.entityType.tableName 取 entry-list 的表名，保存后重查表列表；
// ④ 指标类型切「日期」联动：业务类型落 date、格式落 yyyyMMdd 且业务类型禁用（旧 aiIndexTypeChange）；
// ⑤ 与旧版的两处有意偏差：挂载拉到的表要真渲染成下拉默认选项、「使用生产名称」初始为「是」（后端回 0 时仍回填 0）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import EntityConfigPage from './index.vue'
import { pocEntityConfigSave, pocTableEntryList, pocTableFieldList } from '@/api/templateConfig'

const ENTRIES = [
  {
    entryTypeId: 1,
    tableName: 'sense_data.KHFA_KHZBJG_JG',
    typeName: '客户指标结果',
    aiComment: '客户指标结果',
    aiRule: '机构不能为空',
    aiDesc: '按机构与日期存储的客户指标结果',
    aliasName: 'PROD_KHFA_JG',
    useAlias: 1,
  },
  { entryTypeId: 2, tableName: 'DIM_DATE', typeName: '日期维表', aiComment: '', aiRule: '', aiDesc: '', aliasName: '', useAlias: 0 },
]

const FIELDS = [
  { itemId: 101, itemCode: 'JGMC', itemName: '机构名称', aliasName: 'BRANCH_NAME', dataType: 'VARCHAR2', aiIndexType: 'w', aiBusinessType: 'text', trainingData: '0', dataIndex: 1, vector: 0 },
  { itemId: 102, itemCode: 'SJRQ', itemName: '数据日期', aliasName: 'DATA_DATE', dataType: 'DATE', aiIndexType: 'date', aiBusinessType: 'date', trainingData: '1', dataIndex: 0, vector: 1 },
]

vi.mock('@/api/templateConfig', () => ({
  pocTableEntryList: vi.fn(async () => ENTRIES.map((entry) => ({ ...entry }))),
  pocTableFieldList: vi.fn(async () => FIELDS.map((field) => ({ ...field }))),
  pocEntityConfigSave: vi.fn(async () => ({ ok: true, message: '保存成功' })),
}))

function mountPage() {
  return mount(EntityConfigPage, { global: { plugins: [ElementPlus] } })
}

function inputByLabel(wrapper: ReturnType<typeof mountPage>, label: string) {
  const item = wrapper.findAll('.el-form-item').find((i) => i.find('label')?.text() === label)
  return item?.find('input')
}

async function selectTable(wrapper: ReturnType<typeof mountPage>, entryTypeId: number) {
  const tableSelect = wrapper.findAllComponents({ name: 'ElSelect' })[0]!
  tableSelect.vm.$emit('update:modelValue', entryTypeId)
  tableSelect.vm.$emit('change', entryTypeId)
  await flushPromises()
}

beforeEach(() => {
  vi.mocked(pocTableEntryList).mockClear()
  vi.mocked(pocTableFieldList).mockClear()
  vi.mocked(pocEntityConfigSave).mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('表字段管理页', () => {
  it('挂载即按旧口径拉表列表', async () => {
    mountPage()
    await flushPromises()
    expect(pocTableEntryList).toHaveBeenCalledWith('')
  })

  it('挂载拉到的表选项要渲染进「选择表」下拉（默认就有可选项）', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('.ec-table-select input').trigger('click')
    await flushPromises()
    const items = Array.from(document.body.querySelectorAll('.el-select-dropdown__item')).map((el) => el.textContent?.trim())
    expect(items).toEqual(['KHFA_KHZBJG_JG[客户指标结果]', 'DIM_DATE[日期维表]'])
  }, 45000)

  it('选中表：回填表头 5 项（useAlias 数字 1 落成开关），并按 entryTypeId 拉字段', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await selectTable(wrapper, 1)
    expect(pocTableFieldList).toHaveBeenCalledWith(1)
    expect(inputByLabel(wrapper, '表别名')?.element.value).toBe('客户指标结果')
    expect(inputByLabel(wrapper, '表描述')?.element.value).toBe('按机构与日期存储的客户指标结果')
    expect(inputByLabel(wrapper, '校验规则')?.element.value).toBe('机构不能为空')
    expect(inputByLabel(wrapper, '生产表名称')?.element.value).toBe('PROD_KHFA_JG')
    expect(wrapper.find('.el-switch').classes()).toContain('is-checked')
    expect(wrapper.findAll('.el-table__body-wrapper tbody tr')).toHaveLength(2)
    // 18 列行内编辑表在 jsdom 里首屏渲染很慢，这台机器实测超过默认 15s 用例超时
  }, 45000)

  it('未选表时「使用生产名称」开关默认是（迁移后的产品要求，旧版初始为空串）', async () => {
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.el-switch').classes()).toContain('is-checked')
  })

  it('选中 useAlias=0 的表：开关按后端值落回关闭（旧 selectTableChange 口径）', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await selectTable(wrapper, 2)
    expect(wrapper.find('.el-switch').classes()).not.toContain('is-checked')
  }, 45000)

  it('模糊搜索：remote-method 按关键词重查，返回的数据要拼接成下拉选项（空关键词不重查，旧 handleTableConfigSearch）', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(pocTableEntryList).mockClear()

    const remoteMethod = wrapper.findAllComponents({ name: 'ElSelect' })[0]!.props('remoteMethod') as (v: string) => void
    remoteMethod('')
    await flushPromises()
    expect(pocTableEntryList).not.toHaveBeenCalled()

    remoteMethod('DIM')
    await flushPromises()
    expect(pocTableEntryList).toHaveBeenCalledWith('DIM')
    const items = Array.from(document.body.querySelectorAll('.el-select-dropdown__item')).map((el) => el.textContent?.trim())
    expect(items).toEqual(['KHFA_KHZBJG_JG[客户指标结果]', 'DIM_DATE[日期维表]'])
  }, 45000)

  it('未选表点保存：整表校验不过，提示「请填写完整信息」且不发保存请求', async () => {
    const wrapper = mountPage()
    await flushPromises()
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({}) as never)

    await wrapper.find('.ec-save-bar button').trigger('click')
    await flushPromises()
    expect(error).toHaveBeenCalledWith('请填写完整信息')
    expect(pocEntityConfigSave).not.toHaveBeenCalled()
  })

  it('保存整表覆盖：开关回写 0/1、dataIndexFlag/vectorFlag 回写 dataIndex/vector，表名取选中行，保存后重查表列表', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await selectTable(wrapper, 1)
    const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => ({}) as never)

    await wrapper.find('.ec-save-bar button').trigger('click')
    await flushPromises()
    expect(pocEntityConfigSave).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(pocEntityConfigSave).mock.calls[0]![0]
    expect(payload.entityType).toMatchObject({
      entryTypeId: 1,
      tableName: 'sense_data.KHFA_KHZBJG_JG',
      aiComment: '客户指标结果',
      aiDesc: '按机构与日期存储的客户指标结果',
      aiRule: '机构不能为空',
      aliasName: 'PROD_KHFA_JG',
      useAlias: 1,
    })
    expect(payload.entityItems.map((item) => item.dataIndex)).toEqual([1, 0])
    expect(payload.entityItems.map((item) => item.vector)).toEqual([0, 1])
    expect(payload.entityItems.map((item) => item.no)).toEqual([1, 2])
    expect(success).toHaveBeenCalledWith('保存成功')
    // 旧版保存后立即重查表列表（不等保存响应）
    expect(pocTableEntryList).toHaveBeenLastCalledWith('')
  })

  it('指标类型切「日期」：业务类型落 date、业务类型格式落 yyyyMMdd，且业务类型下拉禁用（旧 aiIndexTypeChange）', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await selectTable(wrapper, 1)

    // 行 1（aiIndexType=w）的「指标类型」下拉：选择表(0) 之后按行内列顺序 chooseType(1)/mappingType(2)/aiIndexType(3)
    const indexTypeSelect = wrapper.findAllComponents({ name: 'ElSelect' })[3]!
    indexTypeSelect.vm.$emit('update:modelValue', 'date')
    indexTypeSelect.vm.$emit('change', 'date')
    await flushPromises()

    const businessTypeSelect = wrapper.findAllComponents({ name: 'ElSelect' })[4]!
    expect(businessTypeSelect.props('modelValue')).toBe('date')
    expect(businessTypeSelect.props('disabled')).toBe(true)
  }, 45000)
})
