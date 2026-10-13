// @vitest-environment jsdom
// 模板配置通用编辑弹窗：钉住 schema 驱动的提交口径（1013 迁入 SQL 模板配置时抽出）。
// 这里最容易被改坏的是「提交带了哪些字段」——旧平台是整行回传，这里只回传表单字段 + id，
// 少一条断言就可能把 createTime 之类又塞回请求体，或把 required 的拦截悄悄去掉。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import TemplateFormDialog from './TemplateFormDialog.vue'
import type { TemplateField, TemplateListApi } from './types'

const fields: TemplateField[] = [
  { prop: 'name', label: 'sql模板名称', required: true },
  { prop: 'content', label: '模板内容', type: 'textarea' },
  { prop: 'status', label: '状态', type: 'radio', options: [{ label: '启用', value: '0' }, { label: '禁用', value: '1' }] },
]

const row = {
  id: 36,
  name: '不校验',
  content: null,
  status: '1',
  createTime: '2025-04-11 11:34:39',
  updateTime: '2025-04-11 11:38:35',
  delFlag: '0',
}

/** 弹窗只用到 api.save，测试桩按 save 收窄，挂到组件上时再补回完整接口形状。 */
function mountDialog(save: (payload: Record<string, unknown>) => Promise<unknown>) {
  const api = { page: async () => ({ total: 0, list: [] }), save } as unknown as TemplateListApi
  return mount(TemplateFormDialog, {
    props: { fields, api, addTitle: '新增sql模板', editTitle: '编辑sql模板', defaults: { status: '0' } },
    global: { plugins: [ElementPlus] },
    attachTo: document.body,
  })
}

function footerButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('.el-dialog__footer button')].find((b) => b.textContent?.trim() === label)
}

/** script-setup + defineExpose 暴露的 open()（VTU2 没有 $callMethod） */
type DialogVm = { open: (record?: Record<string, unknown> | null) => void }
function callOpen(wrapper: { vm: unknown }, record?: Record<string, unknown> | null) {
  ;(wrapper.vm as DialogVm).open(record ?? null)
}

/** 第一个 el-input 就是「sql模板名称」（模板内容是 textarea，状态是 radio） */
function fillName(value: string) {
  const input = document.querySelector<HTMLInputElement>('.el-dialog .el-input__inner')!
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('TemplateFormDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('新增态用 defaults 起步（状态默认启用），标题走 addTitle，提交不带 id', async () => {
    const save = vi.fn(async () => ({ ok: true }))
    const wrapper = mountDialog(save)

    callOpen(wrapper, null)
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('新增sql模板')
    fillName('新模板')
    await flushPromises()
    footerButton('保存')?.click()
    await flushPromises()

    expect(save).toHaveBeenCalledWith({ name: '新模板', content: '', status: '0' })
  })

  it('编辑态只提交表单字段 + id，不回传 createTime/updateTime/delFlag', async () => {
    const save = vi.fn(async () => ({ ok: true }))
    const wrapper = mountDialog(save)

    callOpen(wrapper, row)
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('编辑sql模板')
    footerButton('保存')?.click()
    await flushPromises()

    expect(save).toHaveBeenCalledWith({ id: 36, name: '不校验', content: '', status: '1' })
  })

  it('必填为空时拦下提交并提示（旧版会带着空名称提交成功）', async () => {
    const warn = vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({}) as never)
    const save = vi.fn(async () => ({ ok: true }))
    const wrapper = mountDialog(save)

    callOpen(wrapper, { ...row, name: '  ' })
    await flushPromises()
    footerButton('保存')?.click()
    await flushPromises()

    expect(save).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('请填写sql模板名称')
  })

  it('保存成功 emit saved，失败展示后端 msg', async () => {
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({}) as never)
    const save = vi.fn(async () => ({ ok: true }))
    const wrapper = mountDialog(save)

    callOpen(wrapper, row)
    await flushPromises()
    footerButton('保存')?.click()
    await flushPromises()
    expect(wrapper.emitted('saved')?.at(-1)).toEqual([{ mode: 'edit', id: 36 }])

    save.mockRejectedValueOnce(new Error('模板名称已存在'))
    callOpen(wrapper, { name: '重复的名字' })
    await flushPromises()
    footerButton('保存')?.click()
    await flushPromises()

    expect(error).toHaveBeenCalledWith('模板名称已存在')
    expect(wrapper.emitted('saved')?.length).toBe(1)
  })
})
