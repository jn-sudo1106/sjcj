// @vitest-environment jsdom
// 提示词配置编辑弹窗（1:1 对齐旧 ai-chat-view src/demo/modal/ChatFlowStepEditor.vue）。
// 钉的是这个模块容易被"顺手重构"掉的四条口径：
// ① 16 个字段全提交（旧弹窗就这 16 项，没有 status 入口 —— 新增也不替后端补 '0'）；
// ② 重试次数是**数字**（旧页唯一的 a-input-number），留空即 undefined，不写成空串；
// ③ 编辑提交只发表单字段 + id，不再像旧版那样把整行（createTime/updateTime/status）原样 POST 回去；
// ④ 步骤编码 / 流程编码必填（旧版留空也能存成一条永远不会被 nextStepCode 命中的步骤）。
// 挂载方式同 DataIndexSyncEditDialog.test.ts：el-dialog 是 append-to-body 的 teleport，
// 用 attachTo: document.body + document 查询，不要 stub teleport。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElInputNumber } from 'element-plus'
import ChatFlowStepEditDialog from './ChatFlowStepEditDialog.vue'
import { chatFlowStepApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  chatFlowStepApi: { save: vi.fn() },
}))

type Vm = { open: (record?: Record<string, unknown> | null) => void }

function mountDialog() {
  return mount(ChatFlowStepEditDialog, { global: { plugins: [ElementPlus] }, attachTo: document.body })
}
function callOpen(wrapper: ReturnType<typeof mountDialog>, record?: Record<string, unknown> | null) {
  ;(wrapper.vm as unknown as Vm).open(record ?? null)
}
function itemOf(label: string): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>('.el-dialog .el-form-item')].find((el) =>
    el.querySelector('.el-form-item__label')?.textContent?.includes(label),
  )!
}
function fill(label: string, value: string) {
  const el = itemOf(label).querySelector('input') ?? itemOf(label).querySelector('textarea')
  el!.value = value
  el!.dispatchEvent(new Event('input', { bubbles: true }))
}
function fillTextarea(label: string, value: string) {
  const el = itemOf(label).querySelector('textarea')!
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
/** 重试次数：直接发 update:modelValue，保持数字口径 */
function setRetryCount(wrapper: ReturnType<typeof mountDialog>, value: number) {
  wrapper.findComponent(ElInputNumber).vm.$emit('update:modelValue', value)
}
function footerButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('.el-dialog__footer button')].find((b) => b.textContent?.trim() === label)
}
function savedPayload(index = 0) {
  return vi.mocked(chatFlowStepApi.save).mock.calls[index]?.[0] as Record<string, unknown>
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
  vi.mocked(chatFlowStepApi.save).mockResolvedValue({ ok: true, message: '操作成功' })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ChatFlowStepEditDialog', () => {
  it('新增：标题「新增」，16 个字段全提交、不带 id、也不替后端补 status', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('新增')
    // 旧弹窗里状态项是注释掉的，这里也不该出现状态控件
    expect(document.querySelector('.el-dialog .el-switch')).toBeNull()

    fill('步骤编码', 'sql_generate')
    fill('流程编码', 'chat_main')
    fill('步骤名称', 'SQL 生成')
    fill('引用字典编码', 'BRANCH_NAME')
    fill('入参定义', 'question,intent')
    fill('执行条件', "intent == '指标查询'")
    fill('步骤动作', 'llm')
    fill('下一步编码', 'sql_check')
    fill('变量1', 'KHFA_KHZBJG_JG')
    fill('变量2', '')
    fill('结果清洗规则', 'string.trim(result)')
    fill('结果校验规则', 'json.isValid(result)')
    fill('输出字段', 'sql')
    fill('系统prompt', '只输出 SQL 语句')
    fillTextarea('模板定义', '问句：{{question}}')
    setRetryCount(wrapper, 3)
    await saveClick(wrapper)

    expect(savedPayload()).toEqual({
      stepCode: 'sql_generate',
      flowCode: 'chat_main',
      stepName: 'SQL 生成',
      dictCodes: 'BRANCH_NAME',
      inputParams: 'question,intent',
      execCond: "intent == '指标查询'",
      stepAction: 'llm',
      systemPrompt: '只输出 SQL 语句',
      templateDef: '问句：{{question}}',
      cleanRule: 'string.trim(result)',
      checkRule: 'json.isValid(result)',
      outputParams: 'sql',
      nextStepCode: 'sql_check',
      var1: 'KHFA_KHZBJG_JG',
      var2: '',
      retryCount: 3,
    })
  })

  it('重试次数留空提交 undefined（旧 a-input-number 的数字口径，不是空串）', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    fill('步骤编码', 'answer_summary')
    fill('流程编码', 'chat_main')
    await saveClick(wrapper)

    expect(savedPayload().retryCount).toBeUndefined()
    expect(savedPayload().templateDef).toBe('')
  })

  it('步骤编码 / 流程编码留空被拦下（前后端都不该收到一条没有编码的步骤）', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    await saveClick(wrapper)
    expect(document.body.textContent).toContain('请填写步骤编码')
    expect(chatFlowStepApi.save).not.toHaveBeenCalled()

    fill('步骤编码', 'sql_generate')
    await saveClick(wrapper)
    expect(document.body.textContent).toContain('请填写流程编码')
    expect(chatFlowStepApi.save).not.toHaveBeenCalled()

    // 步骤编码带空格 → 提交 trim 后的值
    fill('流程编码', '  chat_main  ')
    await saveClick(wrapper)
    expect(savedPayload()).toMatchObject({ stepCode: 'sql_generate', flowCode: 'chat_main' })
  })

  it('编辑：标题「编辑」，16 个字段按行回显，提交只带表单字段 + id（不再整行原样回传）', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, {
      id: 11,
      stepCode: 'sql_generate',
      flowCode: 'chat_main',
      stepName: 'SQL 生成',
      dictCodes: 'BRANCH_NAME',
      inputParams: 'question',
      execCond: '',
      stepAction: 'llm',
      systemPrompt: '只输出 SQL',
      templateDef: '问句：{{question}}',
      cleanRule: 'trim',
      checkRule: 'json.isValid',
      outputParams: 'sql',
      retryCount: 3,
      nextStepCode: 'sql_check',
      var1: 'a',
      var2: 'b',
      // 这三个是列表/后端字段，旧版会把整行原样 POST 回去，这里不该出现在提交体里
      status: '1',
      createTime: '2025-01-08 15:21:40',
      updateTime: '2025-04-11 10:50:30',
    })
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('编辑')
    expect(itemOf('步骤编码').querySelector('input')!.value).toBe('sql_generate')
    expect(itemOf('模板定义').querySelector('textarea')!.value).toBe('问句：{{question}}')

    await saveClick(wrapper)
    const payload = savedPayload()
    expect(payload).toMatchObject({ id: 11, stepCode: 'sql_generate', retryCount: 3, var2: 'b' })
    expect(payload).not.toHaveProperty('createTime')
    expect(payload).not.toHaveProperty('updateTime')
    expect(payload).not.toHaveProperty('status')
  })

  it('重试次数在真实响应里可能是数字字符串，回显与提交都归成数字', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, { id: 12, stepCode: 'a', flowCode: 'b', retryCount: '2' })
    await flushPromises()

    await saveClick(wrapper)
    expect(savedPayload().retryCount).toBe(2)
  })

  it('重试次数回空串按「未填」处理：回显空、提交 undefined（不能静默存成 0）', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, { id: 13, stepCode: 'a', flowCode: 'b', retryCount: '' })
    await flushPromises()

    await saveClick(wrapper)
    expect(savedPayload().retryCount).toBeUndefined()
  })

  it('保存成功后关弹窗并 emit saved；失败保持打开并提示后端 msg', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    fill('步骤编码', 'sql_generate')
    fill('流程编码', 'chat_main')
    await saveClick(wrapper)
    expect(wrapper.emitted('saved')?.[0]).toEqual([{ mode: 'add', id: undefined }])
    expect(document.querySelector('.el-overlay')?.getAttribute('style') ?? '').toContain('display: none')

    // 失败：弹窗不关，错误提示用后端 msg（重新打开后表单是空的，先补齐两个必填）
    vi.mocked(chatFlowStepApi.save).mockRejectedValueOnce(new Error('步骤编码已存在'))
    callOpen(wrapper)
    await flushPromises()
    fill('步骤编码', 'mock_step')
    fill('流程编码', 'chat_main')
    await saveClick(wrapper)
    expect(document.body.textContent).toContain('步骤编码已存在')
    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('新增')
  })
})
