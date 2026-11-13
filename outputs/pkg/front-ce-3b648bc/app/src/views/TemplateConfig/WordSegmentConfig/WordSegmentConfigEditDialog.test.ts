// @vitest-environment jsdom
// 分词配置编辑弹窗（1:1 对齐旧 ai-chat-view src/demo/modal/WordSegmentConfigEditor.vue）。
// 钉的是这个模块最容易被"顺手重构"掉的四条口径：
// ① 只有编辑态：open(record) 必给行数据，标题恒「编辑」，提交走 update 端点且带 id
//    （本域没有单条新增入口，新增是批量弹窗的事）；
// ② 三个字段都可改、都不置灰（旧弹窗没有 :disabled）；
// ③ 提交只发三个表单字段 + id，**不重发 status、也不把 createTime/updateTime 原样 POST 回去**
//    （旧版 `this.form = data` 发整行，是缺陷）；
// ④ 三个字段必填（旧版留空也能存进库）。
// 挂载方式同 DataIndexConfigEditDialog.test.ts：el-dialog 是 append-to-body 的 teleport，
// 用 attachTo: document.body + document 查询，不要 stub teleport。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import WordSegmentConfigEditDialog from './WordSegmentConfigEditDialog.vue'
import { wordSegmentApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  wordSegmentApi: { update: vi.fn() },
}))

type Vm = { open: (record: Record<string, unknown>) => void }

const ROW = {
  id: 2669,
  type: 'ORGANIZATION',
  content: '新城科技园',
  token: 'base',
  status: '0',
  createTime: '2025-03-25 15:27:18',
  updateTime: '2025-03-25 15:27:18',
}

function mountDialog() {
  return mount(WordSegmentConfigEditDialog, { global: { plugins: [ElementPlus] }, attachTo: document.body })
}
function callOpen(wrapper: ReturnType<typeof mountDialog>) {
  ;(wrapper.vm as unknown as Vm).open(ROW)
}
function itemOf(label: string): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>('.el-dialog .el-form-item')].find((el) =>
    el.querySelector('.el-form-item__label')?.textContent?.includes(label),
  )!
}
function formInput(label: string): HTMLInputElement {
  return itemOf(label).querySelector('input')!
}
function fillInput(label: string, value: string) {
  const el = formInput(label)
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
function footerButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('.el-dialog__footer button')].find(
    (b) => b.textContent?.trim() === label,
  )
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
  vi.mocked(wordSegmentApi.update).mockResolvedValue({ ok: true, message: '操作成功' })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('WordSegmentConfigEditDialog', () => {
  it('编辑：标题「编辑」，三个字段回显行数据且都可改', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('编辑')
    expect(formInput('类型').value).toBe('ORGANIZATION')
    expect(formInput('类型').disabled).toBe(false)
    expect(formInput('内容').value).toBe('新城科技园')
    expect(formInput('分词类型').value).toBe('base')
    expect(formInput('分词类型').disabled).toBe(false)
  })

  it('提交只发三个表单字段 + id：不重发 status，也不带 createTime/updateTime（旧版发整行）', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    fillInput('内容', '新城科技园 ')
    await saveClick(wrapper)

    expect(vi.mocked(wordSegmentApi.update).mock.calls[0]?.[0]).toEqual({
      id: 2669,
      type: 'ORGANIZATION',
      content: '新城科技园 ',
      token: 'base',
    })
  })

  it('三个必填：留空拦下不发请求，并提示对应字段（旧版留空也能存进库）', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    fillInput('类型', '   ')
    await saveClick(wrapper)
    expect(wordSegmentApi.update).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填写类型')

    fillInput('类型', 'ORGANIZATION')
    fillInput('分词类型', '')
    await saveClick(wrapper)
    expect(wordSegmentApi.update).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填写分词类型')
  })

  it('取消编辑不回写列表行（旧版把行对象本身当表单，改一半取消也污染表格）', async () => {
    const wrapper = mountDialog()
    const row = { ...ROW }
    ;(wrapper.vm as unknown as Vm).open(row)
    await flushPromises()

    fillInput('内容', '改到一半')
    footerButton('取消')?.click()
    await flushPromises()

    expect(row.content).toBe('新城科技园')
    expect(wordSegmentApi.update).not.toHaveBeenCalled()
  })

  it('保存成功后关弹窗并 emit saved；失败保持打开并提示后端 msg', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    vi.mocked(wordSegmentApi.update).mockRejectedValueOnce(new Error('未找到要保存的分词配置'))
    await saveClick(wrapper)
    expect(document.body.textContent).toContain('未找到要保存的分词配置')
    expect(document.querySelector('.el-dialog__title')).not.toBeNull()

    await saveClick(wrapper)
    await flushPromises()
    // el-dialog 关闭不是卸载，而是给 .el-overlay 打 v-show（display: none）
    expect((document.querySelector<HTMLElement>('.el-overlay')?.style.display ?? '') === 'none').toBe(true)
    expect(wrapper.emitted('saved')?.at(-1)?.[0]).toEqual({ id: 2669 })
  })
})
