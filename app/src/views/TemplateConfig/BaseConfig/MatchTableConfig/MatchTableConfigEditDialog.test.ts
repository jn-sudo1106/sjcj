// @vitest-environment jsdom
// 选表规则编辑弹窗（1:1 对齐旧 ai-chat-view src/demo/modal/MatchTableConfigEditor.vue）。
// 钉的是这个模块最容易被"顺手重构"掉的四条口径：
// ① 选表类型提交的是码值（text_selection / vector_selection），不是中文标签；
// ② 新增不带 id、status 显式发 '0'（旧版留 undefined 由后端兜底）；编辑带 id，
//    除表单四个字段外原样带回 tableId/type/delFlag（页面没入口，整行回传正是旧版把它们带回去的方式），
//    但不发 createTime/updateTime；
// ③ 表名称必填（旧版留空也能存成一条永远不会被选中的规则）；
// ④ 状态提交字符串 '0'/'1'（旧版 radio 是数字 0/1，本域统一按 TemplateRow 的字符串口径）。
// 挂载方式同 QuestionDicEditDialog.test.ts：el-dialog 是 append-to-body 的 teleport，
// 用 attachTo: document.body + document 查询，不要 stub teleport（stub 后 ElSelect 会递归更新报错）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElSelect } from 'element-plus'
import MatchTableConfigEditDialog from './MatchTableConfigEditDialog.vue'
import { matchTableConfigApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  matchTableConfigApi: { save: vi.fn() },
}))

type Vm = { open: (record?: Record<string, unknown> | null) => void }

function mountDialog() {
  return mount(MatchTableConfigEditDialog, { global: { plugins: [ElementPlus] }, attachTo: document.body })
}
function callOpen(wrapper: ReturnType<typeof mountDialog>, record?: Record<string, unknown> | null) {
  ;(wrapper.vm as unknown as Vm).open(record ?? null)
}
function footerButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('.el-dialog__footer button')].find((b) => b.textContent?.trim() === label)
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
/** 选表类型下拉：直接发 update:modelValue，绕开 teleported popper */
function selectSelectionType(wrapper: ReturnType<typeof mountDialog>, value: string) {
  const select = wrapper.findAllComponents(ElSelect).find((c) => c.element === itemByLabel('选表类型').querySelector('.el-select'))!
  select.vm.$emit('update:modelValue', value)
}
/** 状态单选：点 label 里的 radio，读回的是字符串口径 */
async function clickStatusRadio(label: string) {
  const radio = [...itemByLabel('状态').querySelectorAll<HTMLInputElement>('.el-radio')].find((el) => el.textContent?.trim() === label)!
  radio.querySelector('input')!.click()
  await flushPromises()
}
function savedPayload(index = 0) {
  return vi.mocked(matchTableConfigApi.save).mock.calls[index]?.[0] as Record<string, unknown>
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
  vi.mocked(matchTableConfigApi.save).mockResolvedValue({ ok: true, message: '操作成功' })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('MatchTableConfigEditDialog', () => {
  it('新增：标题「新增」，选表类型默认问句选表、status 落码值字符串，不带 id', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('新增')
    fill('表名称', 'KHFA_KHZBJG_JG')
    fill('匹配规则', '问句含「客户数」时选本表')
    await saveClick(wrapper)

    expect(savedPayload()).toEqual({
      tableName: 'KHFA_KHZBJG_JG',
      selectionType: 'text_selection',
      rule: '问句含「客户数」时选本表',
      status: '0',
    })
  })

  it('编辑：四个字段回显（status 数字也归一成字符串），提交带 id、原样带回 tableId/type/delFlag，不发 createTime/updateTime', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, {
      id: 3,
      tableName: 'DIM_JG',
      selectionType: 'vector_selection',
      rule: 'DIM_JG_VECTOR',
      status: 1,
      tableId: 1042,
      type: '0',
      delFlag: '0',
      createTime: '2025-01-06 09:12:48',
      updateTime: '2025-01-06 09:12:48',
    })
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('编辑')
    expect(itemByLabel('表名称').querySelector('input')!.value).toBe('DIM_JG')
    expect(itemByLabel('匹配规则').querySelector('textarea')!.value).toBe('DIM_JG_VECTOR')

    await clickStatusRadio('启用')
    await saveClick(wrapper)

    expect(savedPayload()).toEqual({
      id: 3,
      tableName: 'DIM_JG',
      selectionType: 'vector_selection',
      rule: 'DIM_JG_VECTOR',
      status: '0',
      tableId: 1042,
      type: '0',
      delFlag: '0',
    })
  })

  it('表名称必填：留空或全空格都不发请求', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    await saveClick(wrapper)
    expect(matchTableConfigApi.save).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填写表名称')

    fill('表名称', '   ')
    await saveClick(wrapper)
    expect(matchTableConfigApi.save).not.toHaveBeenCalled()

    fill('表名称', 'KHFA_ZB')
    await saveClick(wrapper)
    expect(savedPayload()).toMatchObject({ tableName: 'KHFA_ZB' })
  })

  it('选表类型可切成向量选表，提交的是码值不是中文', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    fill('表名称', 'DIM_JG')
    selectSelectionType(wrapper, 'vector_selection')
    await saveClick(wrapper)

    expect(savedPayload()).toMatchObject({ selectionType: 'vector_selection' })
  })

  it('保存成功后关弹窗并 emit saved；失败保持打开并提示后端 msg', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, { id: 3, tableName: 'DIM_JG', selectionType: 'text_selection', rule: 'x', status: '0' })
    await flushPromises()

    vi.mocked(matchTableConfigApi.save).mockRejectedValueOnce(new Error('表名称已存在'))
    await saveClick(wrapper)
    expect(document.body.textContent).toContain('表名称已存在')
    expect(document.querySelector('.el-dialog__title')).not.toBeNull()

    await saveClick(wrapper)
    await flushPromises()
    expect(wrapper.emitted('saved')?.at(-1)?.[0]).toEqual({ mode: 'edit', id: 3 })
  })
})
