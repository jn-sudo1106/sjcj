// @vitest-environment jsdom
// 问句改写编辑弹窗（1:1 对齐旧 ai-chat-view src/demo/modal/QuestionDicEditor.vue）。
// 钉的是这个模块最容易被"顺手重构"掉的四条口径：
// ① 阶段/类型提交的是码值字符串（'before-llm'、'11'），不是中文标签，type 也不是数字；
// ② 新增不带 id，且固定 tag: ''、status: '0'（旧 form 初始值）；
// ③ 编辑带 id、回显五个字段，不重发 createTime/updateTime/status 等整行字段；
// ④ 阶段/类型/内容三项必填（旧版留空也能存成一条永不生效的规则）。
// 挂载方式同 TableTemplateEditDialog.test.ts：el-dialog 是 append-to-body 的 teleport，
// 用 attachTo: document.body + document 查询，不要 stub teleport（stub 后 ElSelect 会递归更新报错）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElSelect } from 'element-plus'
import QuestionDicEditDialog from './QuestionDicEditDialog.vue'
import { questionDicApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  questionDicApi: { save: vi.fn() },
}))

type Vm = { open: (record?: Record<string, unknown> | null) => void }

function mountDialog() {
  return mount(QuestionDicEditDialog, { global: { plugins: [ElementPlus] }, attachTo: document.body })
}
function callOpen(wrapper: ReturnType<typeof mountDialog>, record?: Record<string, unknown> | null) {
  ;(wrapper.vm as unknown as Vm).open(record ?? null)
}
function footerButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('.el-dialog__footer button')].find((b) => b.textContent?.trim() === label)
}
/** 按表单项标题找文本域（两个下拉不在这里取） */
function formTextarea(label: string): HTMLTextAreaElement {
  const item = [...document.querySelectorAll<HTMLElement>('.el-dialog .el-form-item')].find((el) =>
    el.querySelector('.el-form-item__label')?.textContent?.includes(label),
  )
  return item!.querySelector('textarea')!
}
function fill(label: string, value: string) {
  const textarea = formTextarea(label)
  textarea.value = value
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
/** 下拉按标题找（阶段在前、类型在后），直接发 update:modelValue，绕开 teleported popper */
function selectByLabel(wrapper: ReturnType<typeof mountDialog>, label: string, value: string) {
  const item = [...document.querySelectorAll<HTMLElement>('.el-dialog .el-form-item')].find((el) =>
    el.querySelector('.el-form-item__label')?.textContent?.includes(label),
  )
  const select = wrapper.findAllComponents(ElSelect).find((c) => c.element === item!.querySelector('.el-select'))!
  select.vm.$emit('update:modelValue', value)
}
function savedPayload(index = 0) {
  return vi.mocked(questionDicApi.save).mock.calls[index]?.[0] as Record<string, unknown>
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
  vi.mocked(questionDicApi.save).mockResolvedValue({ ok: true, message: '操作成功' })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('QuestionDicEditDialog', () => {
  it('新增：标题「新增」，提交带码值与 tag=""/status="0"，不带 id', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('新增')
    selectByLabel(wrapper, '阶段', 'pre-replace')
    selectByLabel(wrapper, '类型', '10')
    fill('接收条件', "string.contains(msg,'机构')")
    fill('内容', '上个月')
    fill('目标内容', '上月')
    await saveClick(wrapper)

    expect(savedPayload()).toEqual({
      stepCode: 'pre-replace',
      type: '10',
      receiveRule: "string.contains(msg,'机构')",
      content: '上个月',
      targetContent: '上月',
      tag: '',
      status: '0',
    })
  })

  it('编辑：标题「编辑」，五个字段回显，提交带 id 且只发表单字段', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, {
      id: 11,
      stepCode: 'before-llm',
      type: '11',
      receiveRule: "string.contains(msg,'机构')",
      content: '各个机构',
      targetContent: '各机构',
      status: '1',
      createTime: '2025-01-08 15:21:40',
      updateTime: '2025-04-11 10:50:30',
    })
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('编辑')
    expect(formTextarea('内容').value).toBe('各个机构')
    expect(formTextarea('目标内容').value).toBe('各机构')
    expect(formTextarea('接收条件').value).toBe("string.contains(msg,'机构')")

    fill('目标内容', '各机构名称')
    await saveClick(wrapper)

    // 整行的 createTime/updateTime/status 不能被原样 POST 回去（旧版缺陷）
    expect(savedPayload()).toEqual({
      id: 11,
      stepCode: 'before-llm',
      type: '11',
      receiveRule: "string.contains(msg,'机构')",
      content: '各个机构',
      targetContent: '各机构名称',
      tag: '',
    })
  })

  it('必填拦截：阶段/类型/内容任缺其一都不发请求', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    // 阶段没选
    await saveClick(wrapper)
    expect(questionDicApi.save).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请选择阶段')

    // 选了阶段，类型还没选
    selectByLabel(wrapper, '阶段', 'pre-replace')
    await saveClick(wrapper)
    expect(questionDicApi.save).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请选择类型')

    // 阶段类型都选了，内容为空（全空格也算空）
    selectByLabel(wrapper, '类型', '10')
    fill('内容', '   ')
    await saveClick(wrapper)
    expect(questionDicApi.save).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填写内容')
  })

  it('保存成功后关弹窗并 emit saved；失败保持打开并提示后端 msg', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, { id: 11, stepCode: 'before-llm', type: '11', content: '各个机构', targetContent: '各机构' })
    await flushPromises()

    vi.mocked(questionDicApi.save).mockRejectedValueOnce(new Error('改写规则不存在'))
    await saveClick(wrapper)
    expect(document.body.textContent).toContain('改写规则不存在')
    expect(document.querySelector('.el-dialog__title')).not.toBeNull()

    await saveClick(wrapper)
    await flushPromises()
    expect(wrapper.emitted('saved')?.at(-1)?.[0]).toEqual({ mode: 'edit', id: 11 })
  })
})
