// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import ColumnPickerDialog from './ColumnPickerDialog.vue'

vi.mock('element-plus', async () => {
  const actual = await vi.importActual<typeof import('element-plus')>('element-plus')
  return { ...actual, ElMessage: { ...actual.ElMessage, warning: vi.fn(), success: vi.fn(), error: vi.fn() } }
})

const COLS = [
  { prop: 'ENTRY_ID', label: 'ENTRY_ID' },
  { prop: 'SOURCE_ID', label: '源' },
  { prop: 'title', label: '标题-K1' },
  { prop: 'url', label: 'URL-K2' },
  { prop: 'html', label: '正文html路径-K17' },
]

const ElDialogStub = {
  name: 'ElDialog',
  props: ['modelValue', 'title', 'width', 'appendToBody', 'closeOnClickModal'],
  emits: ['update:modelValue'],
  template: '<div v-if="modelValue" data-testid="column-picker-dialog"><slot /><footer><slot name="footer" /></footer></div>',
}

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(ColumnPickerDialog, {
    props: {
      open: true,
      columns: COLS,
      hidden: [],
      order: COLS.map((c) => c.prop),
      ...props,
    },
    global: { stubs: { ElDialog: ElDialogStub, Teleport: true } },
  })
}

describe('ColumnPickerDialog', () => {
  it('勾选后点确定才 emit，取消不发 confirm', async () => {
    const wrapper = mountDialog()
    const html = wrapper.findAll('.cpk-row').find((row) => row.text().includes('正文html路径-K17'))!
    await html.get('input[type="checkbox"]').setValue(false)
    await wrapper.get('[data-testid="column-picker-cancel"]').trigger('click')
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])

    const again = mountDialog()
    const row = again.findAll('.cpk-row').find((r) => r.text().includes('正文html路径-K17'))!
    await row.get('input[type="checkbox"]').setValue(false)
    await again.get('[data-testid="column-picker-ok"]').trigger('click')
    expect(again.emitted('confirm')?.[0]).toEqual([{ hidden: ['html'], order: COLS.map((c) => c.prop) }])
  })

  it('仅身份列只留 ENTRY_ID / 源；恢复默认全部可见并回到 schema 顺序', async () => {
    const wrapper = mountDialog({ hidden: ['title'], order: ['url', 'ENTRY_ID', 'SOURCE_ID', 'title', 'html'] })
    await wrapper.get('[data-testid="column-picker-identity"]').trigger('click')
    await wrapper.get('[data-testid="column-picker-ok"]').trigger('click')
    const first = wrapper.emitted('confirm')![0][0] as { hidden: string[]; order: string[] }
    expect(first.hidden.sort()).toEqual(['html', 'title', 'url'])

    const reset = mountDialog({ hidden: ['title'], order: ['url', 'ENTRY_ID'] })
    await reset.get('[data-testid="column-picker-reset"]').trigger('click')
    await reset.get('[data-testid="column-picker-ok"]').trigger('click')
    expect(reset.emitted('confirm')?.[0]).toEqual([{
      hidden: [],
      order: COLS.map((c) => c.prop),
    }])
  })

  it('至少一列可见：去掉最后一列时 toast 且不改草稿', async () => {
    vi.mocked(ElMessage.warning).mockClear()
    const wrapper = mountDialog({
      hidden: ['SOURCE_ID', 'title', 'url', 'html'],
      order: COLS.map((c) => c.prop),
    })
    const idRow = wrapper.findAll('.cpk-row').find((row) => row.text().includes('ENTRY_ID'))!
    await idRow.get('input[type="checkbox"]').setValue(false)
    expect(ElMessage.warning).toHaveBeenCalledWith('至少保留一列可见')
    await wrapper.get('[data-testid="column-picker-ok"]').trigger('click')
    expect(wrapper.emitted('confirm')?.[0]).toEqual([{
      hidden: ['SOURCE_ID', 'title', 'url', 'html'],
      order: COLS.map((c) => c.prop),
    }])
  })

  it('筛选后只列出命中列', async () => {
    const wrapper = mountDialog()
    await wrapper.get('[data-testid="column-picker-search"]').setValue('K17')
    expect(wrapper.findAll('.cpk-row')).toHaveLength(1)
    expect(wrapper.get('.cpk-row').text()).toContain('正文html路径-K17')
  })
})
