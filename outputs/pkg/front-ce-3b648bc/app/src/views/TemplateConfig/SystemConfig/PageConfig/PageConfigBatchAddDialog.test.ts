// @vitest-environment jsdom
// 页面配置批量新增弹窗（1:1 对齐旧 ai-chat-view src/system/config/SysPageConfigList.vue:81-91、213-236）。
// 钉的是这个模块的口径：
// ① 一行一条，每行按英文逗号切开后**只取第 0 段**当 content（旧口径，逗号后被丢弃）；
// ② 提交 POST /poc/system/page-config/batch，body 是 **{content} 对象数组**（不是包装对象）；
// ③ 空白行跳过、每段 trim、零有效行不发请求（旧版空行也发 {content:''}、零行也 POST 空数组）；
// ④ 成功后提示、关弹窗并 emit saved({count})，失败透出后端 msg。
// 挂载方式同 WordSegmentBatchAddDialog.test.ts：teleport 弹窗用 attachTo: document.body。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import PageConfigBatchAddDialog from './PageConfigBatchAddDialog.vue'
import { pageConfigApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  pageConfigApi: { batchAdd: vi.fn() },
}))

type Vm = { open: () => void }

function mountDialog() {
  return mount(PageConfigBatchAddDialog, { global: { plugins: [ElementPlus] }, attachTo: document.body })
}
function dataTextarea(): HTMLTextAreaElement {
  return document.querySelector<HTMLElement>('.el-dialog .el-form-item')!.querySelector('textarea')!
}
function fillContent(value: string) {
  const el = dataTextarea()
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
  vi.mocked(pageConfigApi.batchAdd).mockResolvedValue({ ok: true, message: '操作成功' })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('PageConfigBatchAddDialog', () => {
  it('一行一条、只取逗号前第 0 段并 trim（旧口径：逗号后被丢弃，但旧版不 trim）', async () => {
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open()
    await flushPromises()

    fillContent(' 问数首页 ,多余的段被丢掉\n图表详情页')
    await saveClick(wrapper)

    expect(vi.mocked(pageConfigApi.batchAdd).mock.calls[0]?.[0]).toEqual([
      { content: '问数首页' },
      { content: '图表详情页' },
    ])
    expect(wrapper.emitted('saved')?.at(-1)?.[0]).toEqual({ count: 2 })
  })

  it('空白行跳过、零有效行不发请求（旧版空行也发 {content:\'\'}, 零行也 POST 空数组）', async () => {
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open()
    await flushPromises()

    fillContent('\n   \n')
    await saveClick(wrapper)
    expect(pageConfigApi.batchAdd).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('没有要新增的数据')
  })

  it('batchAdd 收到的是对象数组本体（POST body 不是包装对象）', async () => {
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open()
    await flushPromises()

    fillContent('问数首页')
    await saveClick(wrapper)
    const body = vi.mocked(pageConfigApi.batchAdd).mock.calls[0]?.[0]
    expect(Array.isArray(body)).toBe(true)
  })

  it('失败：弹窗保持打开、透出后端 msg、不 emit saved', async () => {
    vi.mocked(pageConfigApi.batchAdd).mockRejectedValueOnce(new Error('没有要新增的页面配置'))
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open()
    await flushPromises()

    fillContent('问数首页')
    await saveClick(wrapper)
    expect(document.body.textContent).toContain('没有要新增的页面配置')
    expect(document.querySelector('.el-dialog__title')).not.toBeNull()
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('每次打开清空上一次的输入', async () => {
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open()
    await flushPromises()
    fillContent('问数首页')
    footerButton('取消')?.click()
    await flushPromises()

    ;(wrapper.vm as unknown as Vm).open()
    await flushPromises()
    expect(dataTextarea().value).toBe('')
  })
})
