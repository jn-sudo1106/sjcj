// @vitest-environment jsdom
// 参数设置编辑弹窗（1:1 对齐旧 ai-chat-view src/system/config/modules/ConfigEditForm.vue）。
// 钉的是这个模块最容易被"顺手重构"掉的口径：
// ① 只有编辑态：open(record) 必给详情数据（列表页先走 detail() 取数），提交走 save 且带 id；
// ② 三个必填文案照旧 rules（「参数名称不能为空 / 参数编码不能为空 / 参数值不能为空」），拦下不发请求；
// ③ configType 单选 是(Y)/否(N) 可改（旧版 typeOptions 恒空数组、选项渲染不出来，见 options.ts 偏差说明）；
// ④ 提交只发表单字段 + id，成功提示「修改成功」并 emit saved。
// 挂载方式同 WordSegmentConfigEditDialog.test.ts：teleport 弹窗用 attachTo: document.body。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ParamConfigEditDialog from './ParamConfigEditDialog.vue'
import { systemConfigApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  systemConfigApi: { save: vi.fn() },
}))

type Vm = { open: (record: Record<string, unknown>) => void }

const DETAIL = {
  id: 1,
  configKey: 'poc.answer.maxRows',
  configName: '问数单次返回最大行数',
  configValue: '200',
  configType: 'Y',
  remark: '超过该行数的查询结果在回答里截断',
  createTime: '2025-03-20 10:12:00',
  updateTime: '2025-06-11 09:30:00',
}

function mountDialog() {
  return mount(ParamConfigEditDialog, { global: { plugins: [ElementPlus] }, attachTo: document.body })
}
function callOpen(wrapper: ReturnType<typeof mountDialog>) {
  ;(wrapper.vm as unknown as Vm).open(DETAIL)
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
  vi.mocked(systemConfigApi.save).mockResolvedValue({ ok: true, message: '修改成功' })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ParamConfigEditDialog', () => {
  it('编辑：标题「修改参数」，四个可编辑字段回显详情数据', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('修改参数')
    expect(formInput('参数编码').value).toBe('poc.answer.maxRows')
    expect(formInput('参数名称').value).toBe('问数单次返回最大行数')
    expect(formInput('参数值').value).toBe('200')
    expect(itemOf('备注').querySelector('textarea')?.value).toBe(DETAIL.remark)
    // 是否内置参数：详情回 'Y' → 选中「是」
    const checked = [...itemOf('是否内置参数').querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.checked)
    expect(checked?.value).toBe('Y')
  })

  it('必填三条照旧文案，留空拦下不发请求', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    fillInput('参数名称', '  ')
    await saveClick(wrapper)
    expect(systemConfigApi.save).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('参数名称不能为空')

    fillInput('参数名称', '问数单次返回最大行数')
    fillInput('参数编码', '')
    await saveClick(wrapper)
    expect(systemConfigApi.save).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('参数编码不能为空')

    fillInput('参数编码', 'poc.answer.maxRows')
    fillInput('参数值', '')
    await saveClick(wrapper)
    expect(systemConfigApi.save).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('参数值不能为空')
  })

  it('改内置标记后提交：整表单 + id 走 save（旧 saveConfig 同端点），成功提示「修改成功」并 emit saved', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    const radioN = [...itemOf('是否内置参数').querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.value === 'N')!
    radioN.checked = true
    radioN.dispatchEvent(new Event('change', { bubbles: true }))
    fillInput('参数值', '300')
    await saveClick(wrapper)

    expect(vi.mocked(systemConfigApi.save).mock.calls[0]?.[0]).toEqual({
      id: 1,
      configKey: 'poc.answer.maxRows',
      configName: '问数单次返回最大行数',
      configValue: '300',
      configType: 'N',
      remark: DETAIL.remark,
    })
    expect(wrapper.emitted('saved')?.at(-1)?.[0]).toEqual({ id: 1 })
  })

  it('保存失败：弹窗保持打开并透出后端 msg（旧版 then 无 catch，失败静默）', async () => {
    vi.mocked(systemConfigApi.save).mockRejectedValueOnce(new Error('参数编码已存在'))
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    await saveClick(wrapper)
    expect(document.body.textContent).toContain('参数编码已存在')
    expect(document.querySelector('.el-dialog__title')).not.toBeNull()
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('取消编辑不回写详情对象（旧版把对象当表单引用直改）', async () => {
    const wrapper = mountDialog()
    const detail = { ...DETAIL }
    ;(wrapper.vm as unknown as Vm).open(detail)
    await flushPromises()

    fillInput('参数值', '改到一半')
    footerButton('取消')?.click()
    await flushPromises()

    expect(detail.configValue).toBe('200')
    expect(systemConfigApi.save).not.toHaveBeenCalled()
  })
})
