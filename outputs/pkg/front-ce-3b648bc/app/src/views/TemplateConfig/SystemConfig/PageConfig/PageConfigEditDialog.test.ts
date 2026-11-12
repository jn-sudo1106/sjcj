// @vitest-environment jsdom
// 页面配置编辑弹窗（1:1 对齐旧 ai-chat-view src/system/config/modules/SysPageConfigEditor.vue）。
// 钉的是这个模块的口径：
// ① 只有编辑态：open(record) 必给行数据，标题恒「编辑」，提交走 update 端点且带 id
//    （单条新增是死代码，新增归批量弹窗）；
// ② 表单只有「内容」一个文本域（类型在旧弹窗被注释掉）；
// ③ 提交只发 id + content，**不重发 status、也不把 createTime/updateTime 原样 POST 回去**
//    （旧版 `this.form = data` 发整行，是缺陷）；
// ④ 内容必填（旧版留空也能存进库）；成功提示「操作成功」并 emit saved。
// 挂载方式同 WordSegmentConfigEditDialog.test.ts：teleport 弹窗用 attachTo: document.body。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import PageConfigEditDialog from './PageConfigEditDialog.vue'
import { pageConfigApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  pageConfigApi: { update: vi.fn() },
}))

type Vm = { open: (record: Record<string, unknown>) => void }

const ROW = {
  id: 2,
  content: '图表详情页',
  status: '0',
  createTime: '2025-03-21 10:00:00',
  updateTime: '2025-05-06 11:20:00',
}

function mountDialog() {
  return mount(PageConfigEditDialog, { global: { plugins: [ElementPlus] }, attachTo: document.body })
}
function contentTextarea(): HTMLTextAreaElement {
  return document.querySelector<HTMLElement>('.el-dialog .el-form-item')!.querySelector('textarea')!
}
function fillContent(value: string) {
  const el = contentTextarea()
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
  vi.mocked(pageConfigApi.update).mockResolvedValue({ ok: true, message: '操作成功' })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('PageConfigEditDialog', () => {
  it('编辑：标题「编辑」，内容文本域回显行数据', async () => {
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open(ROW)
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('编辑')
    expect(contentTextarea().value).toBe('图表详情页')
    // 只有「内容」一个表单项（类型旧弹窗已注释）
    expect(document.querySelectorAll('.el-dialog .el-form-item').length).toBe(1)
  })

  it('提交只发 id + content：不重发 status，也不带 createTime/updateTime（旧版发整行）', async () => {
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open(ROW)
    await flushPromises()

    fillContent('图表详情页 ')
    await saveClick(wrapper)

    expect(vi.mocked(pageConfigApi.update).mock.calls[0]?.[0]).toEqual({ id: 2, content: '图表详情页 ' })
    expect(wrapper.emitted('saved')?.at(-1)?.[0]).toEqual({ id: 2 })
  })

  it('内容必填：留空/纯空白拦下不发请求（旧版留空也能存进库）', async () => {
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open(ROW)
    await flushPromises()

    fillContent('   ')
    await saveClick(wrapper)
    expect(pageConfigApi.update).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填写内容')
  })

  it('保存失败：弹窗保持打开并透出后端 msg，不 emit saved', async () => {
    vi.mocked(pageConfigApi.update).mockRejectedValueOnce(new Error('未找到要保存的页面配置'))
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open(ROW)
    await flushPromises()

    await saveClick(wrapper)
    expect(document.body.textContent).toContain('未找到要保存的页面配置')
    expect(document.querySelector('.el-dialog__title')).not.toBeNull()
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('取消编辑不回写列表行（旧版把行对象本身当表单，改一半取消也污染表格）', async () => {
    const wrapper = mountDialog()
    const row = { ...ROW }
    ;(wrapper.vm as unknown as Vm).open(row)
    await flushPromises()

    fillContent('改到一半')
    footerButton('取消')?.click()
    await flushPromises()

    expect(row.content).toBe('图表详情页')
    expect(pageConfigApi.update).not.toHaveBeenCalled()
  })
})
