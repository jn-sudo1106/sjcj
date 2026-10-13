// @vitest-environment jsdom
// 表模板编辑弹窗（1:1 对齐旧 ai-chat-view src/demo/QuestionTempEditModal.vue）。
// 钉的是这个模块最容易被"顺手重构"掉的四条口径：
// ① tableArr / sqlTempConfigIds 提交前是 JSON 字符串、回显时要 parse；
// ② sql 模板回显要把已选 ids 发给分页端点反查名称；
// ③ 编辑带 id、新增不带 id；
// ④ 旧版裸 JSON.parse 会整页崩，坏数据在这里按空处理并提示。
// 挂载方式同 components/templateConfig 的弹窗测试：el-dialog 是 append-to-body 的 teleport，
// 用 attachTo: document.body + document 查询，不要 stub teleport（stub 后 ElSelect 会递归更新报错）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import TableTemplateEditDialog from './TableTemplateEditDialog.vue'
import { pocTableEntryList, sqlTemplateApi, tableTemplateApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  pocTableEntryList: vi.fn(),
  sqlTemplateApi: { page: vi.fn() },
  tableTemplateApi: { save: vi.fn() },
}))

const ENTRY = { tableName: 'KHFA_KHZBJG_JG', typeName: '客户指标结果' }
const SQL_ROW = { id: 9, name: '根据日期查询指标信息', status: '0' }

type Vm = { open: (record?: Record<string, unknown> | null) => void }

function mountDialog() {
  return mount(TableTemplateEditDialog, { global: { plugins: [ElementPlus] }, attachTo: document.body })
}
function callOpen(wrapper: ReturnType<typeof mountDialog>, record?: Record<string, unknown> | null) {
  ;(wrapper.vm as unknown as Vm).open(record ?? null)
}
function footerButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('.el-dialog__footer button')].find((b) => b.textContent?.trim() === label)
}
/** 按表单项标题找输入框（el-select 内部也有 input，不能按序号取） */
function formInput(label: string): HTMLInputElement {
  const item = [...document.querySelectorAll<HTMLElement>('.el-dialog .el-form-item')].find((el) =>
    el.querySelector('.el-form-item__label')?.textContent?.includes(label),
  )
  return item!.querySelector('input')!
}
function fill(label: string, value: string) {
  const input = formInput(label)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
function savedPayload(index = 0) {
  return vi.mocked(tableTemplateApi.save).mock.calls[index]?.[0] as Record<string, unknown>
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
  vi.mocked(pocTableEntryList).mockResolvedValue([ENTRY])
  vi.mocked(sqlTemplateApi.page).mockResolvedValue({ total: 1, list: [SQL_ROW] })
  vi.mocked(tableTemplateApi.save).mockResolvedValue({ ok: true, message: '提交成功' })
})

afterEach(() => {
  document.body.innerHTML = ''
})

// 每条用例都要挂载一整个 el-dialog + 两个远程多选（teleport + popper），比通用弹窗更重；
// 机器另有负载时会撞全局 15s（vitest.config.ts 的 testTimeout 注释），这里按文件放宽到 30s。
describe('TableTemplateEditDialog', { timeout: 30_000 }, () => {
  it('新增：默认「启用」，两个多选空着也按 JSON 空数组提交，且不带 id', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    fill('问句样例', '查询某机构某日期的指标值')
    await saveClick(wrapper)

    expect(tableTemplateApi.save).toHaveBeenCalledTimes(1)
    expect(savedPayload()).toEqual({
      name: '查询某机构某日期的指标值',
      rule: '',
      tableArr: '[]',
      sqlTempConfigIds: '[]',
      status: '0',
    })
    expect(wrapper.emitted('saved')?.at(-1)).toEqual([{ mode: 'add', id: undefined }])
    wrapper.unmount()
  })

  it('问句样例为空直接拦下，不发保存请求（旧版空名称也提示提交成功）', async () => {
    const warn = vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({}) as never)
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    await saveClick(wrapper)

    expect(tableTemplateApi.save).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('请填写问句样例')
    wrapper.unmount()
  })

  it('编辑：JSON 字符串回显成多选值，sql 模板按已选 ids 反查名称，保存带回 id', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, {
      id: 12,
      name: '旧问句',
      rule: "string.contains(msg,'指标')",
      tableArr: '["KHFA_KHZBJG_JG"]',
      sqlTempConfigIds: '[9]',
      status: '1',
      createTime: '2025-04-15 09:52:07',
    })
    await flushPromises()

    expect(sqlTemplateApi.page).toHaveBeenCalledWith(expect.objectContaining({ pageNo: 1, pageSize: 10, ids: [9] }))
    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('编辑模板')
    expect(formInput('问句样例').value).toBe('旧问句')

    await saveClick(wrapper)

    // 只提交表单字段 + id：createTime/updateTime/delFlag 不再原样 POST 回去（旧版把整行发回）
    expect(savedPayload()).toEqual({
      id: 12,
      name: '旧问句',
      rule: "string.contains(msg,'指标')",
      tableArr: '["KHFA_KHZBJG_JG"]',
      sqlTempConfigIds: '[9]',
      status: '1',
    })
    expect(wrapper.emitted('saved')?.at(-1)).toEqual([{ mode: 'edit', id: 12 }])
    wrapper.unmount()
  })

  it('多选改值后按数组顺序序列化成 JSON 字符串', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, { id: 3, name: 'x', tableArr: '[]', sqlTempConfigIds: '[]', status: '0' })
    await flushPromises()

    const selects = wrapper.findAllComponents({ name: 'ElSelect' })
    selects[0]!.vm.$emit('update:modelValue', ['KHFA_ZB_DEF', 'KHFA_KHZBJG_JG'])
    selects[1]!.vm.$emit('update:modelValue', [8, 6])
    await flushPromises()

    await saveClick(wrapper)

    expect(savedPayload()).toMatchObject({ tableArr: '["KHFA_ZB_DEF","KHFA_KHZBJG_JG"]', sqlTempConfigIds: '[8,6]' })
    wrapper.unmount()
  })

  it('坏数据：非法 JSON 按空处理并提示，不再像旧版那样 JSON.parse 直接崩', async () => {
    const warn = vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({}) as never)
    const wrapper = mountDialog()
    callOpen(wrapper, { id: 4, name: 'x', tableArr: '{不是 JSON', sqlTempConfigIds: '"9"', status: '0' })
    await flushPromises()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('无法解析'))

    await saveClick(wrapper)

    expect(savedPayload()).toMatchObject({ tableArr: '[]', sqlTempConfigIds: '[]' })
    wrapper.unmount()
  })

  it('已选 sql 模板超过 10 个时按数量放宽反查条数（旧版固定 10 条，选中的后面只剩 id）', async () => {
    const wrapper = mountDialog()
    const ids = Array.from({ length: 12 }, (_, i) => i + 1)
    callOpen(wrapper, { id: 5, name: 'x', tableArr: '[]', sqlTempConfigIds: JSON.stringify(ids), status: '0' })
    await flushPromises()

    expect(sqlTemplateApi.page).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 12, ids }))
    wrapper.unmount()
  })

  it('数据表下拉：远程搜索结果与已选项合并，已选项不会被新一页结果挤掉', async () => {
    // 首次加载只回 DIM_DATE —— 回显的 KHFA_KHZBJG_JG 在选项里没有，走「已选但查不到类型名」的兜底标签
    vi.mocked(pocTableEntryList).mockResolvedValue([{ tableName: 'DIM_DATE', typeName: '日期维表' }])
    const wrapper = mountDialog()
    callOpen(wrapper, { id: 6, name: 'x', tableArr: '["KHFA_KHZBJG_JG"]', sqlTempConfigIds: '[]', status: '0' })
    await flushPromises()

    // 直接驱动 :remote-method（旧 queryTableList），不去模拟 EP 内部输入事件
    const select = wrapper.findAllComponents({ name: 'ElSelect' })[0]!
    vi.mocked(pocTableEntryList).mockResolvedValue([{ tableName: 'KHFA_ZB_DEF', typeName: '指标定义' }])
    await (select.props('remoteMethod') as (query: string) => Promise<void>)('ZB')
    await flushPromises()

    expect(pocTableEntryList).toHaveBeenLastCalledWith('ZB')
    const labels = [...document.querySelectorAll('.el-select-dropdown__item')].map((li) => li.textContent?.trim())
    expect(labels.some((t) => t?.includes('KHFA_KHZBJG_JG'))).toBe(true)
    expect(labels.some((t) => t?.includes('KHFA_ZB_DEF【指标定义】'))).toBe(true)
    wrapper.unmount()
  })
})
