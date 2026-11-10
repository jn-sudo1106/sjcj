// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ClarificationCard from './ClarificationCard.vue'
import type { Clarification } from '@/api/aiChat'

function clarification(overrides: Partial<Clarification> = {}): Clarification {
  return {
    kind: 'table_choice',
    reason: 'TOO_MANY',
    question: '请选择要分析的表',
    allowFreeText: true,
    maxSelect: 3,
    options: Array.from({ length: 6 }, (_, index) => ({
      entryTypeId: 100 + index,
      tableName: `sense_data.T_${index}`,
      typeName: `候选表${index}`,
    })),
    ...overrides,
  }
}

function mountCard(props: Record<string, unknown>) {
  return mount(ClarificationCard, {
    props: props as never,
    global: { plugins: [ElementPlus] },
  })
}

describe('多选表澄清卡片 · ClarificationCard', () => {
  it('按 maxSelect 截断多选，超出后剩余选项置灰', async () => {
    const wrapper = mountCard({ clarification: clarification() })
    const options = wrapper.findAll('[data-testid^="clarification-option-"]')

    await options[0].trigger('click')
    await options[1].trigger('click')
    await options[2].trigger('click')
    await options[3].trigger('click')

    expect(wrapper.findAll('.cc-option.selected')).toHaveLength(3)
    expect(options[3].classes()).toContain('disabled')
    expect(wrapper.find('[data-testid="clarification-confirm"]').attributes('disabled')).toBeUndefined()
  })

  it('确认时按 entryTypeId 回传并带上自由补充', async () => {
    const wrapper = mountCard({ clarification: clarification() })

    await wrapper.find('[data-testid="clarification-option-100"]').trigger('click')
    await wrapper.find('[data-testid="clarification-option-102"]').trigger('click')
    await wrapper.find('[data-testid="clarification-free-text"]').setValue('近 7 天')
    await wrapper.find('[data-testid="clarification-confirm"]').trigger('click')

    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual({
      selectedEntryTypeIds: [100, 102],
      freeText: '近 7 天',
    })
  })

  it('零命中（free_text）时没有选项，仅凭补充文字也能确认', async () => {
    const wrapper = mountCard({
      clarification: clarification({
        kind: 'free_text',
        reason: 'NO_MATCH',
        options: [],
        question: '没有匹配到表，请换个叫法',
      }),
    })

    expect(wrapper.findAll('[data-testid^="clarification-option-"]')).toHaveLength(0)
    expect(wrapper.find('[data-testid="clarification-confirm"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-testid="clarification-free-text"]').setValue('客户满意度')
    await wrapper.find('[data-testid="clarification-confirm"]').trigger('click')

    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual({
      selectedEntryTypeIds: [],
      freeText: '客户满意度',
    })
  })

  it('已确认后卡片锁定：不再响应点选，只展示已采纳标签', async () => {
    const wrapper = mountCard({ clarification: clarification(), confirmed: true })
    const options = wrapper.findAll('[data-testid^="clarification-option-"]')

    await options[0].trigger('click')

    expect(wrapper.findAll('.cc-option.selected')).toHaveLength(0)
    expect(wrapper.find('[data-testid="clarification-confirmed"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="clarification-confirm"]').exists()).toBe(false)
  })
})
