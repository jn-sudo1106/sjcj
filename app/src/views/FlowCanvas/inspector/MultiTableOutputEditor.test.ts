// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import ElementPlus from 'element-plus'
import MultiTableOutputEditor from './MultiTableOutputEditor.vue'
import { entryApi, type EntryType } from '@/api'
import { buildConfigPayload } from '@/utils/flow/nodeConfigPayload'
import { cloneConfig, NODE_CONFIGS } from '@/views/FlowCanvas/canvas/flowModel'

const tables: EntryType[] = [
  { tableId: '900', tableName: 'TB_NEWS', name: '新闻', fields: [{ prop: 'title', desc: '标题', columnName: 'K1', itemId: '9001', type: 'string', required: false }] },
  { tableId: '901', tableName: 'TB_FILES', name: '附件', fields: [{ prop: 'name', desc: '文件名', columnName: 'K1', itemId: '9011', type: 'string', required: false }] },
]
const initial = {
  globals: ['global'], skipCheck: true, custom: { keep: true },
  table: { entryTypeId: 900, keys: ['news'], ignored: [], colMap: [{ colId: '9001', fromId: 'title' }], subs: [
    { entryTypeId: 901, keys: ['attachments'], colMap: [{ colId: '9011', fromId: 'filename', minRow: 2 }], subs: [
      { entryTypeId: 902, keys: ['extra'], colMap: [], custom: 'nested' },
    ] },
  ] },
}
async function open(value = JSON.stringify(initial)) {
  const state = ref(value)
  const update = vi.fn((next: string) => { state.value = next })
  const host = mount({
    components: { MultiTableOutputEditor },
    setup: () => ({ state, tables, update }),
    template: '<MultiTableOutputEditor :model-value="state" main-table-id="900" :tables="tables" @update:model-value="update" />',
  }, { global: { plugins: [ElementPlus] } })
  await flushPromises()
  return { host, state, update }
}
afterEach(() => vi.restoreAllMocks())

describe('多表输出编辑', () => {
  it('仅打开不改写旧 JSON，不额外加载已有字段元数据', async () => {
    const detail = vi.spyOn(entryApi, 'entryDetail')
    const { host, update } = await open()
    expect(host.text()).toContain('2 张表')
    expect(host.text()).toContain('1 项下级配置（保留）')
    expect(update).not.toHaveBeenCalled()
    expect(detail).not.toHaveBeenCalled()
    host.unmount()
  })

  it('首次配置需补全结果分组与真实字段映射，完成前不改节点', async () => {
    const { host, state, update } = await open('')
    await host.get('[data-testid="add-output-table"]').trigger('click')
    await flushPromises()
    await host.get('[data-testid="complete-output-target"]').trigger('click')
    expect(host.text()).toContain('请填写结果分组')
    expect(update).not.toHaveBeenCalled()
    await host.get('#output-result-keys').setValue('news')
    await host.get('[data-testid="add-output-mapping"]').trigger('click')
    await host.get('[aria-label="目标字段 1"]').setValue('9001')
    await host.get('[aria-label="结果取值 1"]').setValue('title')
    await host.get('[data-testid="complete-output-target"]').trigger('click')
    const rule = JSON.parse(state.value)
    expect(rule).toMatchObject({ globals: [], checkIds: [], table: { entryTypeId: 900, keys: ['news'], colMap: [{ colId: '9001', fromId: 'title' }] } })
    const node = cloneConfig(NODE_CONFIGS['web-list'])
    node.collectCfg!.structuredConfig = state.value
    expect(buildConfigPayload(node).codeRule).toBe(state.value)
    host.unmount()
  })

  it('编辑附表保留高级字段与嵌套 subs，目标保存真实字段 ID', async () => {
    const { host, state } = await open()
    await host.get('[data-testid="additional-output-table"]').findAll('button')[0].trigger('click')
    await flushPromises()
    await host.get('[aria-label="结果取值 1"]').setValue('newFilename')
    await host.get('[data-testid="complete-output-target"]').trigger('click')
    const value = JSON.parse(state.value)
    expect(value.custom).toEqual(initial.custom)
    expect(value.globals).toEqual(initial.globals)
    expect(value.skipCheck).toBe(true)
    expect(value.table.subs[0]).toMatchObject({ colMap: [{ colId: '9011', fromId: 'newFilename', minRow: 2 }], subs: initial.table.subs[0].subs })
    host.unmount()
  })

  it('换表不按相同 K1 重新关联；旧字段不匹配时不能完成', async () => {
    const { host, update } = await open()
    await host.get('[data-testid="additional-output-table"]').findAll('button')[0].trigger('click')
    await host.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', '900')
    await flushPromises()
    expect(host.get<HTMLSelectElement>('[aria-label="目标字段 1"]').element.value).toBe('9011')
    await host.get('[data-testid="complete-output-target"]').trigger('click')
    expect(host.text()).toContain('已失效的目标字段需要重新选择')
    expect(update).not.toHaveBeenCalled()
    host.unmount()
  })

  it('取消编辑和移除目标行为明确，不影响其他表', async () => {
    const { host, state, update } = await open()
    await host.get('[data-testid="edit-main-output"]').trigger('click')
    await host.get('#output-result-keys').setValue('changed')
    await host.findAll('button').find((button) => button.text() === '取消')!.trigger('click')
    expect(update).not.toHaveBeenCalled()
    await host.get('[aria-label="移除输出表 901及其下级配置"]').trigger('click')
    expect(JSON.parse(state.value).table.subs).toEqual([])
    expect(JSON.parse(state.value).table.colMap).toEqual(initial.table.colMap)
    host.unmount()
  })

  it('不识别的旧协议不能被空白表单覆盖', async () => {
    const { host, update } = await open('AUTO')
    expect(host.get<HTMLButtonElement>('[data-testid="add-output-table"]').element.disabled).toBe(true)
    expect(host.text()).toContain('原内容已保留')
    expect(update).not.toHaveBeenCalled()
    host.unmount()
  })
})
