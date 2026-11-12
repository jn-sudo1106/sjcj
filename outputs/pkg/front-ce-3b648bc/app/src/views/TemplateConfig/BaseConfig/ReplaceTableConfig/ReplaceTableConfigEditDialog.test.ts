// @vitest-environment jsdom
// 表改写编辑弹窗（1:1 对齐旧 ai-chat-view src/demo/modal/ReplaceTableConfigEditor.vue）。
// 钉的是这个模块最容易被"顺手重构"掉的四条口径：
// ① 替换类型提交的是码值 unionall（不是中文标签），新增即默认它；
// ② 新增不带 id、status 显式发 '0'（旧版留 undefined 由后端兜底）；编辑带 id，
//    除表单四个字段外原样带回 delFlag（页面没入口，整行回传正是旧版把它们带回去的方式），
//    但不发 createTime/updateTime；
// ③ 表名称与替换表名称必填（旧版留空也能存成一条谁也不会命中的改写规则）；
// ④ 状态提交字符串 '0'/'1'（旧版 radio 是数字 0/1，本域统一按 TemplateRow 的字符串口径）。
// 挂载方式同 MatchTableConfigEditDialog.test.ts：el-dialog 是 append-to-body 的 teleport，
// 用 attachTo: document.body + document 查询，不要 stub teleport（stub 后 ElSelect 会递归更新报错）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElSelect } from 'element-plus'
import ReplaceTableConfigEditDialog from './ReplaceTableConfigEditDialog.vue'
import { replaceTableConfigApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  replaceTableConfigApi: { save: vi.fn() },
}))

type Vm = { open: (record?: Record<string, unknown> | null) => void }

function mountDialog() {
  return mount(ReplaceTableConfigEditDialog, { global: { plugins: [ElementPlus] }, attachTo: document.body })
}
function callOpen(wrapper: ReturnType<typeof mountDialog>, record?: Record<string, unknown> | null) {
  ;(wrapper.vm as unknown as Vm).open(record ?? null)
}
function footerButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('.el-dialog__footer button')].find((b) => b.textContent?.trim() === label)
}
function itemByLabel(label: string): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>('.el-dialog .el-form-item')].find((el) =>
    el.querySelector('.el-form-item__label')?.textContent?.includes(label),
  )!
}
function fill(label: string, value: string) {
  const input = itemByLabel(label).querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
/** 替换类型下拉：直接发 update:modelValue，绕开 teleported popper */
function selectReplaceType(wrapper: ReturnType<typeof mountDialog>, value: string) {
  const select = wrapper.findAllComponents(ElSelect).find((c) => c.element === itemByLabel('替换类型').querySelector('.el-select'))!
  select.vm.$emit('update:modelValue', value)
}
/** 状态单选：点 label 里的 radio，读回的是字符串口径 */
async function clickStatusRadio(label: string) {
  const radio = [...itemByLabel('状态').querySelectorAll<HTMLInputElement>('.el-radio')].find((el) => el.textContent?.trim() === label)!
  radio.querySelector('input')!.click()
  await flushPromises()
}
function savedPayload(index = 0) {
  return vi.mocked(replaceTableConfigApi.save).mock.calls[index]?.[0] as Record<string, unknown>
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
  vi.mocked(replaceTableConfigApi.save).mockResolvedValue({ ok: true, message: '操作成功' })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ReplaceTableConfigEditDialog', () => {
  it('新增：标题「新增」，替换类型默认 unionall、status 落码值字符串，不带 id', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('新增')
    fill('表名称', 'KHFA_ZB')
    fill('替换表名称', 'KHFA_ZB_HISTORY')
    await saveClick(wrapper)

    expect(savedPayload()).toEqual({
      tableName: 'KHFA_ZB',
      replaceTableName: 'KHFA_ZB_HISTORY',
      replaceType: 'unionall',
      status: '0',
    })
  })

  it('编辑：四个字段回显（status 数字也归一成字符串），提交带 id、原样带回 delFlag，不发 createTime/updateTime', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, {
      id: 13,
      tableName: 'YJZB_HY_JX',
      replaceTableName: 'YJZB_HY_GHKJ',
      replaceType: 'unionall',
      status: 1,
      delFlag: '0',
      createTime: '2025-04-18 17:56:05',
      updateTime: '2025-04-27 12:33:06',
    })
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('编辑')
    expect(itemByLabel('表名称').querySelector('input')!.value).toBe('YJZB_HY_JX')
    expect(itemByLabel('替换表名称').querySelector('input')!.value).toBe('YJZB_HY_GHKJ')

    await clickStatusRadio('启用')
    await saveClick(wrapper)

    expect(savedPayload()).toEqual({
      id: 13,
      tableName: 'YJZB_HY_JX',
      replaceTableName: 'YJZB_HY_GHKJ',
      replaceType: 'unionall',
      status: '0',
      delFlag: '0',
    })
  })

  it('表名称与替换表名称必填：留空或全空格都不发请求', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    await saveClick(wrapper)
    expect(replaceTableConfigApi.save).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填写表名称')

    fill('表名称', 'KHFA_ZB')
    await saveClick(wrapper)
    expect(replaceTableConfigApi.save).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填写替换表名称')

    fill('替换表名称', '   ')
    await saveClick(wrapper)
    expect(replaceTableConfigApi.save).not.toHaveBeenCalled()

    fill('替换表名称', 'KHFA_ZB_HISTORY')
    await saveClick(wrapper)
    expect(savedPayload()).toMatchObject({ tableName: 'KHFA_ZB', replaceTableName: 'KHFA_ZB_HISTORY' })
  })

  it('替换类型提交的是码值不是中文，切成别的码值也照原样上送', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    fill('表名称', 'DIM_JG')
    fill('替换表名称', 'DIM_JG_UNION')
    selectReplaceType(wrapper, 'unionall')
    await saveClick(wrapper)

    expect(savedPayload()).toMatchObject({ replaceType: 'unionall' })
  })

  it('状态可切成禁用，提交字符串码值', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, { id: 12, tableName: 'A', replaceTableName: 'B', replaceType: 'unionall', status: '0' })
    await flushPromises()

    await clickStatusRadio('禁用')
    await saveClick(wrapper)

    expect(savedPayload()).toMatchObject({ status: '1' })
  })

  it('保存成功后关弹窗并 emit saved；失败保持打开并提示后端 msg', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, { id: 13, tableName: 'A', replaceTableName: 'B', replaceType: 'unionall', status: '0', delFlag: '0' })
    await flushPromises()

    vi.mocked(replaceTableConfigApi.save).mockRejectedValueOnce(new Error('表名称已存在'))
    await saveClick(wrapper)
    expect(document.body.textContent).toContain('表名称已存在')
    expect(document.querySelector('.el-dialog__title')).not.toBeNull()

    await saveClick(wrapper)
    await flushPromises()
    expect(wrapper.emitted('saved')?.at(-1)?.[0]).toEqual({ mode: 'edit', id: 13 })
  })

  it('取消后再次打开新增：回到初始值（旧版 form 被清成 {}，连 unionall 默认都没了）', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, { id: 13, tableName: 'YJZB_HY_JX', replaceTableName: 'YJZB_HY_GHKJ', status: '1' })
    await flushPromises()

    footerButton('取消')?.click()
    await flushPromises()
    callOpen(wrapper)
    await flushPromises()

    expect(itemByLabel('表名称').querySelector('input')!.value).toBe('')
    expect(itemByLabel('替换表名称').querySelector('input')!.value).toBe('')

    fill('表名称', 'A')
    fill('替换表名称', 'B')
    await saveClick(wrapper)
    expect(savedPayload()).toMatchObject({ replaceType: 'unionall', status: '0' })
    expect(savedPayload().id).toBeUndefined()
    expect(savedPayload().delFlag).toBeUndefined()
  })
})
