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

  it('加属性：新行编号在既有最大序号基础上 +1，不改写已有行 columnName', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', fields: [
        { prop: 'a', desc: 'A', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
        { prop: 'b', desc: 'B', type: 'string', required: false, dedup: false, columnName: 'K3', itemId: '2', seq: 2 },
      ],
    }
    await mountEditor(entry)
    await body().findAll('button').find((b) => b.text() === '加属性')!.trigger('click')
    await flushPromises()

    const columnInputs = body().findAll('td input[disabled]').map((i) => (i.element as HTMLInputElement).value)
    expect(columnInputs).toEqual(['K1', 'K3', 'K4'])
  })

  it('已有行（itemId>0）不可删除，仅新增行可删', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', fields: [
        { prop: 'a', desc: 'A', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
      ],
    }
    await mountEditor(entry)
    expect(body().find('button.danger').exists()).toBe(false)

    await body().findAll('button').find((b) => b.text() === '加属性')!.trigger('click')
    await flushPromises()
    expect(body().find('button.danger').exists()).toBe(true)
  })

  it('去重勾选联动：勾选字段后只读 keyField 输入按 columnName 逗号连接实时更新', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', keyField: '', fields: [
        { prop: 'a', desc: 'A', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
        { prop: 'b', desc: 'B', type: 'string', required: false, dedup: false, columnName: 'K2', itemId: '2', seq: 2 },
      ],
    }
    await mountEditor(entry)
    const dedupBoxes = body().findAll('td input[type="checkbox"]')
    await dedupBoxes[0].setValue(true)
    await dedupBoxes[1].setValue(true)
    await flushPromises()

    const keyFieldField = body().findAll('.rc-field').find((f) => f.text().includes('去重列'))!
    const keyFieldInput = keyFieldField.find('input')
    expect((keyFieldInput.element as HTMLInputElement).value).toBe('K1,K2')
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
