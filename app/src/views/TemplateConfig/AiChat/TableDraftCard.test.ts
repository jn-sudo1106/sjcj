// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import TableDraftCard from './TableDraftCard.vue'
import type { TableDraftState } from '@/utils/aiChat/tableDraft'

function state(overrides: Partial<TableDraftState> = {}): TableDraftState {
  return {
    draft: {
      name: '统计局指标',
      tableName: 'TB_TJJZB',
      dsKind: 'CK',
      remark: '',
      fields: [
        { code: 'indicator', desc: '指标名称', type: 'string', dedup: true },
        { code: 'value', desc: '数值', type: 'number', dedup: false },
      ],
    },
    status: 'pending',
    ...overrides,
  }
}

/** el-input 把 data-testid 透传到内部 input 上（不同版本也可能在外层），两种都兼容 */
function inputOf(wrapper: ReturnType<typeof mountCard>, testId: string) {
  const hit = wrapper.find(`[data-testid="${testId}"]`)
  return hit.element.tagName === 'INPUT' ? hit : hit.find('input')
}

function mountCard(props: Record<string, unknown>) {
  return mount(TableDraftCard, {
    props: props as never,
    global: { plugins: [ElementPlus], stubs: { RouterLink: RouterLinkStub } },
  })
}

describe('建表草稿卡片 · TableDraftCard', () => {
  it('确认时带出用户改过的草稿，不改动原 props', async () => {
    const original = state()
    const wrapper = mountCard({ state: original })
    expect(wrapper.findAll('[data-testid="table-draft-field-row"]')).toHaveLength(2)

    await inputOf(wrapper, 'table-draft-name').setValue('统计局月度指标')
    await wrapper.find('[data-testid="table-draft-add-field"]').trigger('click')
    const rows = wrapper.findAll('[data-testid="table-draft-field-row"]')
    const inputs = rows[2].findAll('input')
    await inputs[0].setValue('unit')
    await inputs[1].setValue('单位')
    await wrapper.find('[data-testid="table-draft-confirm"]').trigger('click')

    const emitted = wrapper.emitted('confirm')![0][0] as TableDraftState['draft']
    expect(emitted.name).toBe('统计局月度指标')
    expect(emitted.fields.map((f) => f.code)).toEqual(['indicator', 'value', 'unit'])
    expect(original.draft.name).toBe('统计局指标')
    expect(original.draft.fields).toHaveLength(2)
  })

  it('校验不过不发确认，并列出问题', async () => {
    const wrapper = mountCard({ state: state() })
    await inputOf(wrapper, 'table-draft-table-name').setValue('')
    await wrapper.find('[data-testid="table-draft-confirm"]').trigger('click')
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.find('[data-testid="table-draft-errors"]').text()).toContain('物理表名必填')
  })

  it('对话流式中确认按钮置灰', () => {
    const wrapper = mountCard({ state: state(), disabled: true })
    expect(wrapper.find('[data-testid="table-draft-confirm"]').attributes('disabled')).toBeDefined()
  })

  it('已创建：只读，显示表 ID 和数据中心链接，没有确认按钮', () => {
    const wrapper = mountCard({ state: state({ status: 'created', tableId: '2101999' }) })
    expect(wrapper.find('[data-testid="table-draft-confirm"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="table-draft-result"]').text()).toContain('2101999')
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toEqual({ path: '/data', query: { tab: 'entry', entryTypeId: '2101999' } })
    expect(inputOf(wrapper, 'table-draft-name').attributes('disabled')).toBeDefined()
  })

  it('失败：显示后端原因，可改后重新创建', () => {
    const wrapper = mountCard({ state: state({ status: 'failed', error: '物理表已存在' }) })
    expect(wrapper.find('[data-testid="table-draft-error"]').text()).toBe('物理表已存在')
    expect(wrapper.find('[data-testid="table-draft-confirm"]').text()).toBe('重新创建')
  })
})
