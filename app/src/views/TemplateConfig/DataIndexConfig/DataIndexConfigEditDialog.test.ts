// @vitest-environment jsdom
// 数据字典编辑弹窗（1:1 对齐旧 ai-chat-view src/demo/modal/DataIndexConfigEditor.vue）。
// 钉的是这个模块最容易被"顺手重构"掉的四条口径：
// ① 编码 / 类型 / 内容 三项**恒置灰**（旧 :disabled="true"，新增态也不可填），页面上唯一能改的是别名；
// ② 新增不带 id，且固定 status: '0'（旧 form 初始值，弹窗里的状态选择是注释掉的）；
// ③ 编辑时提交别名 + id，并原样带回没有入口的 contentCode —— 旧版发整行恰好带上了，不带回会被更新语句写成 null；
//    createTime/updateTime/delFlag 这类元数据不能原样 POST 回去（旧版缺陷）。
// ④ 别名必填（旧版留空也能存进库）。
// 挂载方式同 DataIndexSyncEditDialog.test.ts：el-dialog 是 append-to-body 的 teleport，
// 用 attachTo: document.body + document 查询，不要 stub teleport。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import DataIndexConfigEditDialog from './DataIndexConfigEditDialog.vue'
import { dataIndexConfigApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  dataIndexConfigApi: { save: vi.fn() },
}))

type Vm = { open: (record?: Record<string, unknown> | null) => void }

function mountDialog() {
  return mount(DataIndexConfigEditDialog, { global: { plugins: [ElementPlus] }, attachTo: document.body })
}
function callOpen(wrapper: ReturnType<typeof mountDialog>, record?: Record<string, unknown> | null) {
  ;(wrapper.vm as unknown as Vm).open(record ?? null)
}
function itemOf(label: string): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>('.el-dialog .el-form-item')].find((el) =>
    el.querySelector('.el-form-item__label')?.textContent?.includes(label),
  )!
}
function formInput(label: string): HTMLInputElement {
  return itemOf(label).querySelector('input')!
}
function formTextarea(label: string): HTMLTextAreaElement {
  return itemOf(label).querySelector('textarea')!
}
function fillTextarea(label: string, value: string) {
  const el = formTextarea(label)
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
function footerButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('.el-dialog__footer button')].find((b) => b.textContent?.trim() === label)
}
function savedPayload(index = 0) {
  return vi.mocked(dataIndexConfigApi.save).mock.calls[index]?.[0] as Record<string, unknown>
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
  vi.mocked(dataIndexConfigApi.save).mockResolvedValue({ ok: true, message: '操作成功' })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('DataIndexConfigEditDialog', () => {
  it('新增：标题「新增」，三项锁定字段是空的置灰输入框，提交带 status="0" 且不带 id', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('新增')
    expect(formInput('编码').value).toBe('')
    expect(formInput('编码').disabled).toBe(true)
    expect(formInput('类型').disabled).toBe(true)
    expect(formInput('内容').disabled).toBe(true)
    expect(formTextarea('别名').disabled).toBe(false)

    fillTextarea('别名', '   ')
    await saveClick(wrapper)
    expect(dataIndexConfigApi.save).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填写别名')

    fillTextarea('别名', '城南')
    await saveClick(wrapper)
    expect(savedPayload()).toEqual({ code: '', type: '', content: '', alias: '城南', contentCode: null, status: '0' })
  })

  it('编辑：锁定字段回显行数据且置灰，提交别名 + id 并原样带回 code/type/content/contentCode', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, {
      id: 41,
      code: 'BRANCH_NAME',
      type: 'ORG',
      content: '城南支行',
      alias: '城南',
      contentCode: '1001',
      status: '0',
      createTime: '2025-04-22 18:56:48',
      updateTime: '2025-05-09 10:12:33',
      delFlag: '0',
    })
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('编辑')
    expect(formInput('编码').value).toBe('BRANCH_NAME')
    expect(formInput('编码').disabled).toBe(true)
    expect(formInput('内容').value).toBe('城南支行')

    fillTextarea('别名', '城南支行')
    await saveClick(wrapper)

    // 旧版 `this.form = data` 会把整行（含 createTime/updateTime/delFlag/status）原样 POST 回去；
    // 这里只发表单字段 + id，编辑态不重发 status（启停走 /status 端点）
    expect(savedPayload()).toEqual({
      id: 41,
      code: 'BRANCH_NAME',
      type: 'ORG',
      content: '城南支行',
      alias: '城南支行',
      contentCode: '1001',
    })
  })

  it('取消编辑不回写列表行（旧版把行对象本身当表单，改一半取消也污染表格）', async () => {
    const wrapper = mountDialog()
    const row = { id: 41, code: 'BRANCH_NAME', type: 'ORG', content: '城南支行', alias: '城南', status: '0' }
    callOpen(wrapper, row)
    await flushPromises()

    fillTextarea('别名', '改到一半')
    footerButton('取消')?.click()
    await flushPromises()

    // 行数据没被表单改动污染（旧版 `this.form = data` 会当场改脏表格那一行），且没有发出保存请求
    expect(row.alias).toBe('城南')
    expect(dataIndexConfigApi.save).not.toHaveBeenCalled()
  })

  it('保存成功后关弹窗并 emit saved；失败保持打开并提示后端 msg', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, { id: 41, code: 'BRANCH_NAME', type: 'ORG', content: '城南支行', alias: '城南', status: '0' })
    await flushPromises()

    fillTextarea('别名', '  ')
    await saveClick(wrapper)
    expect(document.querySelector('.el-dialog__title')).not.toBeNull()

    fillTextarea('别名', '城南支行')
    vi.mocked(dataIndexConfigApi.save).mockRejectedValueOnce(new Error('未找到对应的字典项'))
    await saveClick(wrapper)
    expect(document.body.textContent).toContain('未找到对应的字典项')
    expect(document.querySelector('.el-dialog__title')).not.toBeNull()

    await saveClick(wrapper)
    await flushPromises()
    expect(wrapper.emitted('saved')?.at(-1)?.[0]).toEqual({ mode: 'edit', id: 41 })
  })
})
