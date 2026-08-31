// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import EntryEditorDrawer from './EntryEditorDrawer.vue'
import { entryApi, type EntryType } from '../../api'

// el-drawer append-to-body：内容 teleport 到 document.body，需用 DOMWrapper 查找（同 ParamTab.test.ts 套路）
function body() {
  return new DOMWrapper(document.body)
}

// 表 ID 列表迁移方案 §1.4/§4.5：K 序只读自动编号、去重↔keyField 联动、重复编码校验
describe('EntryEditorDrawer · 数据表编辑器', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    vi.restoreAllMocks()
  })

  async function mountEditor(entry: EntryType | null) {
    wrapper = mount(EntryEditorDrawer, {
      props: { modelValue: true, entry },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()
    return wrapper
  }

  it('新建：新增行 columnName 自动编号 K1，已有字段的 columnName 输入框只读', async () => {
    await mountEditor(null)
    const columnInputs = body().findAll('td input[disabled]')
    expect(columnInputs.length).toBeGreaterThan(0)
    expect((columnInputs[0].element as HTMLInputElement).value).toBe('K1')
  })

  it('新增字段：新行编号在既有最大序号基础上 +1，不改写已有行 columnName', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', fields: [
        { prop: 'a', desc: 'A', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
        { prop: 'b', desc: 'B', type: 'string', required: false, dedup: false, columnName: 'K3', itemId: '2', seq: 2 },
      ],
    }
    await mountEditor(entry)
    await body().findAll('button').find((b) => b.text() === '＋ 新增字段')!.trigger('click')
    await flushPromises()

    const columnInputs = body().findAll('td input[disabled]').map((i) => (i.element as HTMLInputElement).value)
    expect(columnInputs).toEqual(['K1', 'K3', 'K4'])
  })

  // 2026-08-28 生产实测 77 张表，K 序全部连续、零空洞——columnName 是前端定的、后端照单收，
  // 删掉中间的新增行必须把后面的新增行补上来，不能给后端漏空洞。
  // 前提是「只有新增行可删」：已落库字段（itemId>0）的 columnName 一个都不碰。
  it('删掉中间的新增行后，后续新增行的 K 序补齐，不留空洞', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', fields: [
        { prop: 'a', desc: 'A', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
        { prop: 'b', desc: 'B', type: 'string', required: false, dedup: false, columnName: 'K2', itemId: '2', seq: 2 },
      ],
    }
    await mountEditor(entry)
    const addBtn = () => body().findAll('button').find((b) => b.text() === '＋ 新增字段')!
    await addBtn().trigger('click')
    await addBtn().trigger('click')
    await addBtn().trigger('click')
    await flushPromises()
    const cols = () => body().findAll('td input[disabled]').map((i) => (i.element as HTMLInputElement).value)
    expect(cols()).toEqual(['K1', 'K2', 'K3', 'K4', 'K5'])

    // 删掉中间那个新增行（K4）。已落库行也有删除按钮（禁用态），所以只在可用的里面取。
    const enabledDels = () => body().findAll('button.danger').filter((b) => b.attributes('disabled') === undefined)
    await enabledDels()[1].trigger('click')
    await flushPromises()
    expect(cols()).toEqual(['K1', 'K2', 'K3', 'K4'])
  })

  it('补齐 K 序时绝不改写已落库字段的 columnName', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', fields: [
        { prop: 'a', desc: 'A', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
        { prop: 'b', desc: 'B', type: 'string', required: false, dedup: false, columnName: 'K5', itemId: '2', seq: 2 },
      ],
    }
    await mountEditor(entry)
    await body().findAll('button').find((b) => b.text() === '＋ 新增字段')!.trigger('click')
    await flushPromises()
    await body().findAll('button.danger').filter((b) => b.attributes('disabled') === undefined)[0].trigger('click')
    await flushPromises()
    // 已落库的 K1 / K5 原样保留（K5 那个"空洞"是历史数据，不该被我们悄悄压缩）
    const cols = body().findAll('td input[disabled]').map((i) => (i.element as HTMLInputElement).value)
    expect(cols).toEqual(['K1', 'K5'])
  })

  // 2026-08-28：已落库行改成**禁用态**删除按钮（原来是直接不渲染）——
  // 整列空白看不出"为什么这行不能删"，禁用 + 悬浮说明才讲得清。
  it('已有行（itemId>0）的删除按钮禁用，新增行可删', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', fields: [
        { prop: 'a', desc: 'A', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
      ],
    }
    await mountEditor(entry)
    expect(body().findAll('button.danger').length).toBe(1)
    expect(body().find('button.danger').attributes('disabled')).toBeDefined()

    await body().findAll('button').find((b) => b.text() === '＋ 新增字段')!.trigger('click')
    await flushPromises()
    const dels = body().findAll('button.danger')
    expect(dels.length).toBe(2)
    expect(dels[0].attributes('disabled')).toBeDefined()   // 已落库
    expect(dels[1].attributes('disabled')).toBeUndefined() // 新增行
  })

  it('去重勾选联动：勾选字段后只读 keyField 输入按 columnName 逗号连接实时更新', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', keyField: '', fields: [
        { prop: 'a', desc: 'A', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
        { prop: 'b', desc: 'B', type: 'string', required: false, dedup: false, columnName: 'K2', itemId: '2', seq: 2 },
      ],
    }
    await mountEditor(entry)
    // 去重是每行第一个 checkbox（第二个是必填），按行取避免被列数变化影响
    const rows = body().findAll('tbody tr')
    await rows[0].find('td input[type="checkbox"]').setValue(true)
    await rows[1].find('td input[type="checkbox"]').setValue(true)
    await flushPromises()

    const keyFieldField = body().findAll('.rc-field').find((f) => f.text().includes('去重列'))!
    const keyFieldInput = keyFieldField.find('input')
    expect((keyFieldInput.element as HTMLInputElement).value).toBe('K1,K2')
  })

  it('必填勾选：勾了才会作为 true 传给 entrySave（数据表页动态列按 required 过滤，需要能勾）', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', name: '表A', fields: [
        { prop: 'a', desc: 'A', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
      ],
    }
    const saveSpy = vi.spyOn(entryApi, 'entrySave').mockResolvedValue({ message: 'ok', tableId: 't1' })
    await mountEditor(entry)
    // 每行第二个 checkbox 是必填（第一个是去重）
    await body().findAll('tbody tr')[0].findAll('td input[type="checkbox"]')[1].setValue(true)
    await body().findAll('button').find((b) => b.text() === '保存')!.trigger('click')
    await flushPromises()

    expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
      fields: [expect.objectContaining({ prop: 'a', required: true })],
    }))
  })

  it('提交前校验：itemCode 重复时报错且不调用 entrySave', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', name: '表A', fields: [
        { prop: 'dup', desc: 'A', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
        { prop: 'dup', desc: 'B', type: 'string', required: false, dedup: false, columnName: 'K2', itemId: '2', seq: 2 },
      ],
    }
    const saveSpy = vi.spyOn(entryApi, 'entrySave')
    const warnSpy = vi.spyOn(ElMessage, 'warning')
    await mountEditor(entry)

    await body().findAll('button').find((b) => b.text() === '保存')!.trigger('click')
    await flushPromises()

    expect(warnSpy).toHaveBeenCalledWith('出错，属性重复:dup')
    expect(saveSpy).not.toHaveBeenCalled()
  })
})
