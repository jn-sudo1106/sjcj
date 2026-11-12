// @vitest-environment jsdom
// 自动补全编辑弹窗（1:1 对齐旧 ai-chat-view src/demo/DicEditor.vue）。
// 钉的是这个模块最容易被"顺手重构"掉的三条口径：
// ① 新增不带 id，且固定 type: 1、status: '0'（旧 doEdit 的写死值）；
// ② 编辑带 id、回显 content/keyWords，不重发 status/createTime 等整行字段；
// ③ 内容为空直接拦下不发请求（对旧版"空词条也能存"的缺陷修正）。
// 挂载方式同 TableTemplateEditDialog.test.ts：el-dialog 是 append-to-body 的 teleport，
// 用 attachTo: document.body + document 查询。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import DicTemplateEditDialog from './DicTemplateEditDialog.vue'
import { dicTemplateApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  dicTemplateApi: { save: vi.fn() },
}))

type Vm = { open: (record?: Record<string, unknown> | null) => void }

function mountDialog() {
  return mount(DicTemplateEditDialog, { global: { plugins: [ElementPlus] }, attachTo: document.body })
}
function callOpen(wrapper: ReturnType<typeof mountDialog>, record?: Record<string, unknown> | null) {
  ;(wrapper.vm as unknown as Vm).open(record ?? null)
}
function footerButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('.el-dialog__footer button')].find((b) => b.textContent?.trim() === label)
}
/** 按表单项标题找文本域（两个字段都是 textarea） */
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
function savedPayload(index = 0) {
  return vi.mocked(dicTemplateApi.save).mock.calls[index]?.[0] as Record<string, unknown>
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
  vi.mocked(dicTemplateApi.save).mockResolvedValue({ ok: true, message: '操作成功' })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('DicTemplateEditDialog', () => {
  it('新增：标题「新增」，提交不带 id，固定 type=1、status="0"', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('新增')
    fill('内容', '新词条内容')
    fill('简称', '新 词条')
    await saveClick(wrapper)

    expect(savedPayload()).toEqual({ content: '新词条内容', keyWords: '新 词条', type: 1, status: '0' })
  })

  it('编辑：标题「编辑」，回显 content/keyWords，提交带 id 且只发表单字段', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, {
      id: 3,
      content: '查询某机构某日期的客户指标结果',
      keyWords: '机构 日期',
      status: '0',
      createTime: '2025-04-15 09:52:07',
      updateTime: '2025-04-15 09:52:07',
    })
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('编辑')
    expect(formTextarea('内容').value).toBe('查询某机构某日期的客户指标结果')
    expect(formTextarea('简称').value).toBe('机构 日期')

    fill('简称', '机构 日期 指标')
    await saveClick(wrapper)

    // 整行的 createTime/updateTime/status 不能被原样 POST 回去（旧版缺陷）
    expect(savedPayload()).toEqual({ id: 3, content: '查询某机构某日期的客户指标结果', keyWords: '机构 日期 指标' })
  })

  it('内容为空（或全空格）直接拦下，不发请求', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    fill('内容', '   ')
    await saveClick(wrapper)

    expect(dicTemplateApi.save).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填写内容')
  })

  it('保存成功后关弹窗并 emit saved；失败保持打开并提示后端 msg', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    vi.mocked(dicTemplateApi.save).mockRejectedValueOnce(new Error('词条已存在'))
    fill('内容', '重复词条')
    await saveClick(wrapper)
    expect(document.body.textContent).toContain('词条已存在')
    expect(document.querySelector('.el-dialog__title')).not.toBeNull()

    fill('内容', '不重复的词条')
    await saveClick(wrapper)
    await flushPromises()
    expect(wrapper.emitted('saved')?.at(-1)?.[0]).toEqual({ mode: 'add', id: undefined })
  })
})
