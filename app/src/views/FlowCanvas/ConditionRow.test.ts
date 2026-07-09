// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ConditionRow from './ConditionRow.vue'

describe('ConditionRow', () => {
  it('勾选进入条件后立即展开条件编辑区', async () => {
    const wrapper = mount(ConditionRow, {
      props: {
        condition: undefined,
        fields: [{ prop: 'title-K2', desc: '标题' }],
      },
    })

    await wrapper.get('input[type="checkbox"]').setValue(true)

    expect(wrapper.find('.cond-fields').exists()).toBe(true)
    expect(wrapper.text()).toContain('添加条件')
    expect(wrapper.emitted('change')?.[0]).toEqual([{ mode: 'fields', logic: 'AND', items: [{ field: 'title-K2', op: 'contains', value: '' }] }])
  })

  it('切到表达式模式：隐藏字段行，露出裸文本框；输入内容原样透传（0707 优化·补）', async () => {
    const wrapper = mount(ConditionRow, {
      props: { condition: undefined, fields: [{ prop: 'title-K2', desc: '标题' }] },
    })
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('.cond-mode button:nth-child(2)').trigger('click')

    expect(wrapper.find('.cond-fields').exists()).toBe(false)
    expect(wrapper.find('textarea.cond-expr').exists()).toBe(true)

    await wrapper.get('textarea.cond-expr').setValue('status = "C" AND quality_score >= 0.95')
    const last = wrapper.emitted('change')!.at(-1)![0]
    expect(last).toEqual({ mode: 'expr', logic: 'AND', items: [], expr: 'status = "C" AND quality_score >= 0.95' })
  })

  it('表达式模式回显：condition 带 mode=expr 时直接展示原表达式', () => {
    const wrapper = mount(ConditionRow, {
      props: {
        condition: { mode: 'expr', logic: 'AND', items: [], expr: 'a > 1' },
        fields: [],
      },
    })
    expect((wrapper.get('textarea.cond-expr').element as HTMLTextAreaElement).value).toBe('a > 1')
  })
})
