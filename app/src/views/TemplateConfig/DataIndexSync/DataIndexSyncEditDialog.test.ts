// @vitest-environment jsdom
// 数据索引同步编辑弹窗（1:1 对齐旧 ai-chat-view src/demo/modal/DataIndexSyncConfigEditor.vue）。
// 钉的是这个模块最容易被"顺手重构"掉的四条口径：
// ① type 提交的是**数字** 0/1/2（不是问句改写那种字符串码值），新增默认 2；
// ② 新增不带 id，且固定 status: '0'（旧 form 初始值，本域没有启停入口）；
// ③ 编辑时同步名称 / 表/主题 / 同步类型 三项**置灰**（旧 :disabled="isEditor"），
//    提交只发表单字段 + id，另原样带回没有入口的 aliasColumn / codeColumn；
// ④ 同步名称 / 表/主题 / 同步内容三项必填（旧版留空也能存成一条空跑的索引配置）。
// 挂载方式同 QuestionDicEditDialog.test.ts：el-dialog 是 append-to-body 的 teleport，
// 用 attachTo: document.body + document 查询，不要 stub teleport（stub 后 ElSelect 会递归更新报错）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElSelect } from 'element-plus'
import DataIndexSyncEditDialog from './DataIndexSyncEditDialog.vue'
import { dataIndexSyncApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  dataIndexSyncApi: { save: vi.fn() },
}))

type Vm = { open: (record?: Record<string, unknown> | null) => void }

function mountDialog() {
  return mount(DataIndexSyncEditDialog, { global: { plugins: [ElementPlus] }, attachTo: document.body })
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
function fill(label: string, value: string) {
  const el = formInput(label) ?? formTextarea(label)
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
function fillTextarea(label: string, value: string) {
  formTextarea(label).value = value
  formTextarea(label).dispatchEvent(new Event('input', { bubbles: true }))
}
/** 同步类型下拉：直接发 update:modelValue，绕开 teleported popper（值保持数字口径） */
function selectType(wrapper: ReturnType<typeof mountDialog>, value: number) {
  const select = wrapper.findAllComponents(ElSelect).find((c) => c.element === itemOf('同步类型').querySelector('.el-select'))!
  select.vm.$emit('update:modelValue', value)
}
function footerButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('.el-dialog__footer button')].find((b) => b.textContent?.trim() === label)
}
function savedPayload(index = 0) {
  return vi.mocked(dataIndexSyncApi.save).mock.calls[index]?.[0] as Record<string, unknown>
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
  vi.mocked(dataIndexSyncApi.save).mockResolvedValue({ ok: true, message: '操作成功' })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('DataIndexSyncEditDialog', () => {
  it('新增：标题「新增」，type 默认 2（数字）且带 status="0"，不带 id', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('新增')
    fill('同步名称', '机构指标数据表-机构编号')
    fill('表/主题', 'ADS_HFBI_ZQFXS_JGZBMX')
    fill('列名', 'BRANCH_NO')
    fillTextarea('同步内容', 'select distinct BRANCH_NO from ADS_HFBI_ZQFXS_JGZBMX')
    fillTextarea('前置sql', '')
    fillTextarea('后置sql', '')
    await saveClick(wrapper)

    expect(savedPayload()).toEqual({
      comment: '机构指标数据表-机构编号',
      tableName: 'ADS_HFBI_ZQFXS_JGZBMX',
      type: 2,
      columnName: 'BRANCH_NO',
      syncSql: 'select distinct BRANCH_NO from ADS_HFBI_ZQFXS_JGZBMX',
      beforeSql: '',
      afterSql: '',
      aliasColumn: null,
      codeColumn: null,
      status: '0',
    })
  })

  it('新增：改选同步类型后按数字提交（0 sql同步）', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    fill('同步名称', '机构指标数据表-机构名称')
    fill('表/主题', 'ADS_HFBI_ZQFXS_JGZBMX')
    fillTextarea('同步内容', 'select distinct BRANCH_NAME from ADS_HFBI_ZQFXS_JGZBMX')
    selectType(wrapper, 0)
    await saveClick(wrapper)

    expect(savedPayload()).toMatchObject({ type: 0 })
  })

  it('编辑：三个锁定字段回显且置灰，其余可改；提交带 id 并原样带回 aliasColumn/codeColumn', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, {
      id: 56,
      type: 0,
      comment: '机构指标数据表-机构名称',
      tableName: 'ADS_HFBI_ZQFXS_JGZBMX',
      columnName: 'BRANCH_NAME',
      aliasColumn: 'BRANCH_ALIAS',
      codeColumn: 'BRANCH_NO',
      syncSql: 'select distinct BRANCH_NAME from ADS_HFBI_ZQFXS_JGZBMX',
      beforeSql: null,
      afterSql: null,
      status: 0,
      lastSync: '2025-06-13 18:23:56',
      createTime: '2025-04-22 18:56:48',
      updateTime: '2025-04-22 18:56:48',
      delFlag: '0',
    })
    await flushPromises()

    expect(document.querySelector('.el-dialog__title')?.textContent).toBe('编辑')
    // 旧口径 isEditor：同步名称 / 表/主题 / 同步类型 编辑态不可改
    expect(formInput('同步名称').value).toBe('机构指标数据表-机构名称')
    expect(formInput('同步名称').disabled).toBe(true)
    expect(formInput('表/主题').disabled).toBe(true)
    expect(formInput('列名').disabled).toBe(false)
    expect(formTextarea('同步内容').value).toBe('select distinct BRANCH_NAME from ADS_HFBI_ZQFXS_JGZBMX')

    fill('列名', 'BRANCH_NO')
    fillTextarea('后置sql', 'delete from tmp_index where 1=0')
    await saveClick(wrapper)

    // 整行的 status/lastSync/createTime/updateTime/delFlag 不能被原样 POST 回去（旧版缺陷），
    // 但没有 UI 入口的 aliasColumn/codeColumn 要带回，否则更新语句把它们写成 null
    expect(savedPayload()).toEqual({
      id: 56,
      comment: '机构指标数据表-机构名称',
      tableName: 'ADS_HFBI_ZQFXS_JGZBMX',
      type: 0,
      columnName: 'BRANCH_NO',
      syncSql: 'select distinct BRANCH_NAME from ADS_HFBI_ZQFXS_JGZBMX',
      beforeSql: '',
      afterSql: 'delete from tmp_index where 1=0',
      aliasColumn: 'BRANCH_ALIAS',
      codeColumn: 'BRANCH_NO',
    })
  })

  it('必填拦截：同步名称/表/同步内容任缺其一都不发请求', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper)
    await flushPromises()

    // 名称没填
    await saveClick(wrapper)
    expect(dataIndexSyncApi.save).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填写同步名称')

    // 填了名称，表/主题还没填
    fill('同步名称', '机构指标数据表')
    await saveClick(wrapper)
    expect(dataIndexSyncApi.save).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填写表/主题')

    // 名称与表都填了，同步内容为空（全空格也算空）
    fill('表/主题', 'ADS_HFBI_ZQFXS_JGZBMX')
    fillTextarea('同步内容', '   ')
    await saveClick(wrapper)
    expect(dataIndexSyncApi.save).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填写同步内容')
  })

  it('保存成功后关弹窗并 emit saved；失败保持打开并提示后端 msg', async () => {
    const wrapper = mountDialog()
    callOpen(wrapper, { id: 56, type: 0, comment: '机构指标数据表-机构名称', tableName: 'T', syncSql: 'select 1' })
    await flushPromises()

    vi.mocked(dataIndexSyncApi.save).mockRejectedValueOnce(new Error('同步配置不存在'))
    await saveClick(wrapper)
    expect(document.body.textContent).toContain('同步配置不存在')
    expect(document.querySelector('.el-dialog__title')).not.toBeNull()

    await saveClick(wrapper)
    await flushPromises()
    expect(wrapper.emitted('saved')?.at(-1)?.[0]).toEqual({ mode: 'edit', id: 56 })
  })
})
