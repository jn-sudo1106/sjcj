// @vitest-environment jsdom
// 分词配置批量新增弹窗（1:1 对齐旧 ai-chat-view src/demo/WordSegmentConfigList.vue:89-99、228-255）。
// 钉的是这一域的行为口径：
// ① 一行一条，`类型,内容,分词类型` 三段（英文逗号），提交 POST /poc/word-segment-config/batch，
//    body 是 **对象数组**（见接口契约测试）；
// ② 每段 trim 后再发（旧版不 trim，把「 张宪 」这种带空格的词条存进库）；
// ③ 非法行不再静默丢掉：报行号并拦住提交（旧版 split(',').length !== 3 的行直接跳过，
//    且一行都没解析出来时还把空数组 POST 给后端）；
// ④ 空行（含结尾换行）不算非法，与旧版一致。
// 挂载方式同 WordSegmentConfigEditDialog.test.ts：append-to-body 的 teleport 走 document 查询。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import WordSegmentBatchAddDialog from './WordSegmentBatchAddDialog.vue'
import { wordSegmentApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  wordSegmentApi: { batchAdd: vi.fn() },
}))

type Vm = { open: () => void }

function mountDialog() {
  return mount(WordSegmentBatchAddDialog, { global: { plugins: [ElementPlus] }, attachTo: document.body })
}
function textarea(): HTMLTextAreaElement {
  return document.querySelector<HTMLTextAreaElement>('.el-dialog textarea')!
}
async function fill(value: string) {
  const el = textarea()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
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
function hint(): string {
  // 压掉所有空白：hint 里那段「已解析 N 条，M 行格式不对」跨了 <span> 边界，textContent 会带进换行缩进
  return document.querySelector('.ws-batch-hint')?.textContent?.replace(/\s+/g, '') ?? ''
}
/** el-dialog 关闭不是卸载，而是给 .el-overlay 打 v-show（display: none） */
function isDialogHidden(): boolean {
  return (document.querySelector<HTMLElement>('.el-overlay')?.style.display ?? '') === 'none'
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.resetAllMocks()
  vi.mocked(wordSegmentApi.batchAdd).mockResolvedValue({ ok: true, message: '操作成功' })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('WordSegmentBatchAddDialog', () => {
  it('打开是空文本域，占位文案照旧版', async () => {
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open()
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('批量新增')
    expect(textarea().value).toBe('')
    expect(textarea().placeholder).toBe('格式： 类型,内容,分词类型;多条数据用换行')
  })

  it('多行按「类型,内容,分词类型」拆成对象数组提交，每段 trim，末尾空行不算非法', async () => {
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open()
    await flushPromises()

    await fill('PERSON, 张宪 , base\nORGANIZATION,白下分行,base\n')

    expect(hint()).toContain('已解析2条')

    await saveClick(wrapper)
    expect(vi.mocked(wordSegmentApi.batchAdd).mock.calls[0]?.[0]).toEqual([
      { type: 'PERSON', content: '张宪', token: 'base' },
      { type: 'ORGANIZATION', content: '白下分行', token: 'base' },
    ])
  })

  it('段落数不对（含中文逗号、缺第三段、段落留空）报行号并拦住提交', async () => {
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open()
    await flushPromises()

    await fill('PERSON,张宪,base\nPERSON，李四，base\nORGANIZATION,新街口支行')

    expect(hint()).toContain('已解析1条')
    expect(hint()).toContain('2行格式不对')
    expect(hint()).toContain('第2、3行')

    await saveClick(wrapper)
    expect(wordSegmentApi.batchAdd).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('第 2、3 行格式不对')
    expect(document.querySelector('.el-dialog__title')).not.toBeNull()
  })

  it('没解析出任何一行时不发请求（旧版会把空数组 POST 给后端）', async () => {
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open()
    await flushPromises()

    await saveClick(wrapper)
    expect(wordSegmentApi.batchAdd).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('没有要新增的数据')
  })

  it('提交成功后关弹窗并 emit saved（带条数，列表据此回第一页重查）；失败保持打开并提示后端 msg', async () => {
    const wrapper = mountDialog()
    ;(wrapper.vm as unknown as Vm).open()
    await flushPromises()

    await fill('indicatorname,鑫动能,base')

    vi.mocked(wordSegmentApi.batchAdd).mockRejectedValueOnce(new Error('批量数据格式错误'))
    await saveClick(wrapper)
    expect(document.body.textContent).toContain('批量数据格式错误')
    expect(document.querySelector('.el-dialog__title')).not.toBeNull()

    await saveClick(wrapper)
    await flushPromises()
    expect(isDialogHidden()).toBe(true)
    expect(wrapper.emitted('saved')?.at(-1)?.[0]).toEqual({ count: 1 })
  })

  it('每次打开清空上一次的输入', async () => {
    const wrapper = mountDialog()
    const vm = wrapper.vm as unknown as Vm
    vm.open()
    await flushPromises()
    await fill('PERSON,张宪,base')

    vm.open()
    await flushPromises()
    expect(textarea().value).toBe('')
    expect(hint()).toContain('已解析0条')
  })
})
