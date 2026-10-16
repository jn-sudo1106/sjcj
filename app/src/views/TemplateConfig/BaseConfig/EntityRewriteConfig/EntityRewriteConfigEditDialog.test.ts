// @vitest-environment jsdom
// 实体改写编辑弹窗（1:1 对齐旧 ai-chat-view src/demo/modal/EntityRewriteConfigEditor.vue）。
// 钉的是这个模块最容易被"顺手重构"掉的五条口径：
// ① 替换类型提交的是码值（regular_replacement / simple_replacement），不是中文标签，
//    且新增默认落在 cleanType 上 —— 旧版 data() 的默认值写在与模板对不上的 replaceType 字段里，等于没默认值；
// ② 新增不带 id、status 显式发 '0'（旧版留 undefined 由后端兜底）；编辑带 id，
//    表单五字段以外的列原样带回（本域真实行未抓到，整行回传正是旧版把它们带回去的方式），但不发 createTime/updateTime；
// ③ 实体名称必填（旧版留空也能存进库）；
// ④ 状态提交字符串 '0'/'1'（旧版 radio 是数字 0/1，本域统一按 TemplateRow 的字符串口径）；
// ⑤ 标题按新增 / 编辑区分（旧版写死「编辑」）。
// 挂载方式同 MatchTableConfigEditDialog.test.ts：el-dialog 是 append-to-body 的 teleport，
// 用 attachTo: document.body + document 查询，不要 stub teleport（stub 后 ElSelect 会递归更新报错）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElSelect } from 'element-plus'
import EntityRewriteConfigEditDialog from './EntityRewriteConfigEditDialog.vue'
import { entityRewriteConfigApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  entityRewriteConfigApi: { save: vi.fn() },
}))

type Vm = { open: (record?: Record<string, unknown> | null) => void }

function mountDialog() {
  return mount(EntityRewriteConfigEditDialog, { global: { plugins: [ElementPlus] }, attachTo: document.body })
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
  const input = itemByLabel(label).querySelector('input, textarea')!
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
/** 替换类型下拉：直接发 update:modelValue，绕开 teleported popper */
function selectCleanType(wrapper: ReturnType<typeof mountDialog>, value: string) {
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
  return vi.mocked(entityRewriteConfigApi.save).mock.calls[index]?.[0] as Record<string, unknown>
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
  vi.mocked(entityRewriteConfigApi.save).mockResolvedValue({ ok: true, message: '操作成功' })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('EntityRewriteConfigEditDialog', () => {
  it('新增：标题「新增」，替换类型默认正则替换、status 落码值字符串，不带 id，也不发旧版那个对不上的 replaceType', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('新增')
    fill('实体名称', '行员')
    fill('替换内容', '(行员|员工)')
    fill('目标内容', '行员')
    await saveClick(wrapper)

    expect(savedPayload()).toEqual({
      entityName: '行员',
      cleanType: 'regular_replacement',
      content: '(行员|员工)',
      targetContent: '行员',
      status: '0',
    })
  })

  it('编辑：五个字段回显（status 数字也归一成字符串），提交带 id、原样带回表单外的列，不发 createTime/updateTime', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, {
      id: 2,
      entityName: '管户口径',
      cleanType: 'simple_replacement',
      content: '管户口径',
      targetContent: '个人管户口径',
      status: 1,
      delFlag: '0',
      createTime: '2025-04-22 10:12:08',
      updateTime: '2025-06-13 17:58:31',
    })
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('编辑')
    expect(itemByLabel('实体名称').querySelector('input')!.value).toBe('管户口径')
    expect(itemByLabel('目标内容').querySelector('input')!.value).toBe('个人管户口径')

    await clickStatusRadio('启用')
    await saveClick(wrapper)

    expect(savedPayload()).toEqual({
      id: 2,
      entityName: '管户口径',
      cleanType: 'simple_replacement',
      content: '管户口径',
      targetContent: '个人管户口径',
      status: '0',
      delFlag: '0',
    })
  })

  it('实体名称必填：留空或全空格都不发请求', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    await saveClick(wrapper)
    expect(entityRewriteConfigApi.save).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填写实体名称')

    fill('实体名称', '   ')
    await saveClick(wrapper)
    expect(entityRewriteConfigApi.save).not.toHaveBeenCalled()

    fill('实体名称', '绩效口径')
    await saveClick(wrapper)
    expect(savedPayload()).toMatchObject({ entityName: '绩效口径' })
  })

  it('替换类型可切成简单替换，提交的是码值不是中文', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    fill('实体名称', '绩效口径')
    selectCleanType(wrapper, 'simple_replacement')
    await saveClick(wrapper)

    expect(savedPayload()).toMatchObject({ cleanType: 'simple_replacement' })
  })

  it('保存成功后关弹窗并 emit saved；失败保持打开并提示后端 msg', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, { id: 2, entityName: '行员', cleanType: 'regular_replacement', content: '员工', targetContent: '行员', status: '0' })
    await flushPromises()

    vi.mocked(entityRewriteConfigApi.save).mockRejectedValueOnce(new Error('实体名称已存在'))
    await saveClick(wrapper)
    expect(document.body.textContent).toContain('实体名称已存在')
    expect(document.querySelector('.el-dialog__title')).not.toBeNull()

    await saveClick(wrapper)
    await flushPromises()
    expect(wrapper.emitted('saved')?.at(-1)?.[0]).toEqual({ mode: 'edit', id: 2 })
  })
})
