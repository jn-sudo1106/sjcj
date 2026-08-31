// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import ConditionRow from './ConditionRow.vue'
import type { ConditionGroup } from '@/views/FlowCanvas/canvas/flowModel'

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

  it('一体化进入条件选择字段后自动生成下方表达式，且支持编辑', async () => {
    const wrapper = mount(ConditionRow, {
      props: { condition: undefined, integrated: true, fields: [{ prop: 'title-K2', desc: '标题' }] },
    })
    await wrapper.get('[data-testid="add-entry-condition"]').trigger('click')

    expect(wrapper.find('.cond-mode').exists()).toBe(false)
    expect((wrapper.get('textarea.cond-expr').element as HTMLTextAreaElement).value).toBe("string.contains(title-K2,'')")

    await wrapper.get('textarea.cond-expr').setValue('status = "C"')
    expect(wrapper.emitted('change')!.at(-1)![0]).toEqual({
      mode: 'expr', logic: 'AND', items: [{ field: 'title-K2', op: 'contains', value: '' }], expr: 'status = "C"',
    })
  })

  it('字段带 columnName 时，生成的表达式用物理列名，不是下拉选中的 prop（2026-08-26 修复：条件字段 prop 是 itemCode，真实表达式认物理列名）', async () => {
    const wrapper = mount(ConditionRow, {
      props: {
        condition: undefined,
        integrated: true,
        fields: [{ prop: 'content_path', desc: '正文路径', columnName: 'K6' }],
      },
    })
    await wrapper.get('[data-testid="add-entry-condition"]').trigger('click')

    expect((wrapper.get('textarea.cond-expr').element as HTMLTextAreaElement).value).toBe("string.contains(K6,'')")
    expect(wrapper.emitted('change')!.at(-1)![0]).toEqual({
      mode: 'expr', logic: 'AND', items: [{ field: 'content_path', op: 'contains', value: '' }], expr: "string.contains(K6,'')",
    })
  })

  it('一体化模式回传手工表达式后，再修改字段条件不会覆盖表达式', async () => {
    const wrapper = mount(ConditionRow, {
      props: { condition: undefined, integrated: true, fields: [{ prop: 'title-K2', desc: '标题' }] },
    })
    await wrapper.get('[data-testid="add-entry-condition"]').trigger('click')
    await wrapper.get('textarea.cond-expr').setValue('status = "C" OR manual_check = true')
    await wrapper.setProps({ condition: wrapper.emitted('change')!.at(-1)![0] as ConditionGroup })

    await wrapper.get('.cond-fields input').setValue('公告')

    expect((wrapper.get('textarea.cond-expr').element as HTMLTextAreaElement).value).toBe('status = "C" OR manual_check = true')
  })

  // 迁移来的条件只有 expr、没有 items（applyStepMetadata 就是这么塞的）。此前这里直接显示成
  // 空的字段下拉，用户看不到条件里到底选了哪个字段。现在解析回字段行。
  describe('迁移来的原始表达式解析回字段行', () => {
    afterEach(() => { vi.restoreAllMocks() })

    it('K6==nil：默认就有一条字段行，字段按 columnName 映射回业务字段，操作符是「为空」', () => {
      const wrapper = mount(ConditionRow, {
        props: {
          condition: { mode: 'expr', logic: 'AND', items: [], expr: 'K6==nil' },
          integrated: true,
          fields: [{ prop: 'content_path', desc: '正文路径', columnName: 'K6' }],
        },
      })

      const rows = wrapper.findAll('.cond-fields')
      expect(rows).toHaveLength(1)
      expect((rows[0].get('select').element as HTMLSelectElement).value).toBe('content_path')
      expect((rows[0].findAll('select')[1].element as HTMLSelectElement).value).toBe('isEmpty')
      // 为空/非空不需要填值，值输入框不出现
      expect(rows[0].find('input.rc-input').exists()).toBe(false)
      // 未改动前表达式保留原文（含原来的空格写法），不因为解析就重写
      expect((wrapper.get('textarea.cond-expr').element as HTMLTextAreaElement).value).toBe('K6==nil')
    })

    it("K17 != nil && !string.contains(K2,'weixin.qq')：解析成两行 + AND", () => {
      const wrapper = mount(ConditionRow, {
        props: {
          condition: { mode: 'expr', logic: 'AND', items: [], expr: "K17 != nil && !string.contains(K2,'weixin.qq')" },
          integrated: true,
          fields: [
            { prop: 'content_html_path', desc: '正文html路径', columnName: 'K17' },
            { prop: 'url', desc: 'URL', columnName: 'K2' },
          ],
        },
      })

      const rows = wrapper.findAll('.cond-fields')
      expect(rows).toHaveLength(2)
      expect((rows[0].get('select').element as HTMLSelectElement).value).toBe('content_html_path')
      expect((rows[0].findAll('select')[1].element as HTMLSelectElement).value).toBe('notEmpty')
      expect((rows[1].get('select').element as HTMLSelectElement).value).toBe('url')
      expect((rows[1].findAll('select')[1].element as HTMLSelectElement).value).toBe('notContains')
      expect((rows[1].get('input.rc-input').element as HTMLInputElement).value).toBe('weixin.qq')
    })

    it('改字段行后按真实语法重新生成表达式（不是旧的 SQL 风格）', async () => {
      const wrapper = mount(ConditionRow, {
        props: {
          condition: { mode: 'expr', logic: 'AND', items: [], expr: 'K6==nil' },
          integrated: true,
          fields: [
            { prop: 'content_path', desc: '正文路径', columnName: 'K6' },
            { prop: 'title', desc: '标题', columnName: 'K1' },
          ],
        },
      })

      await wrapper.get('.cond-fields select').setValue('title')

      expect((wrapper.get('textarea.cond-expr').element as HTMLTextAreaElement).value).toBe('K1 == nil')
    })

    it('表字段异步到位（entryDetail 后于解析返回）：先按列名占位，字段来了自动映射回业务字段', async () => {
      const wrapper = mount(ConditionRow, {
        props: {
          condition: { mode: 'expr', logic: 'AND', items: [], expr: 'K6==nil' },
          integrated: true,
          fields: [], // 解析时字段还没加载
        },
      })

      // 映射不到就先原样显示列名，并补进下拉选项，不至于显示成空白
      expect((wrapper.get('.cond-fields select').element as HTMLSelectElement).value).toBe('K6')

      await wrapper.setProps({ fields: [{ prop: 'content_path', desc: '正文路径', columnName: 'K6' }] })

      expect((wrapper.get('.cond-fields select').element as HTMLSelectElement).value).toBe('content_path')
    })

    it('NEXT_FLAG == nil：不是表字段的运行时标记也解析出来，标识符补进下拉不丢', () => {
      const wrapper = mount(ConditionRow, {
        props: {
          condition: { mode: 'expr', logic: 'AND', items: [], expr: 'NEXT_FLAG == nil' },
          integrated: true,
          fields: [{ prop: 'content_path', desc: '正文路径', columnName: 'K6' }],
        },
      })

      expect((wrapper.get('.cond-fields select').element as HTMLSelectElement).value).toBe('NEXT_FLAG')
    })
  })

  // 解析不了的表达式才走原来的兜底：不拆成字段行，点「+ 添加条件」要二次确认
  describe('解析不了的表达式：点“+ 添加条件”仍需二次确认', () => {
    const UNPARSEABLE = { mode: 'expr' as const, logic: 'AND' as const, items: [], expr: "custom.check(K1,'x')" }
    afterEach(() => { vi.restoreAllMocks() })

    it('取消则表达式和空字段列表都不变', async () => {
      vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
      const wrapper = mount(ConditionRow, {
        props: { condition: UNPARSEABLE, integrated: true, fields: [{ prop: 'title', desc: '标题', columnName: 'K1' }] },
      })

      expect(wrapper.find('.cond-fields').exists()).toBe(false)
      await wrapper.get('.cond-add').trigger('click')
      await flushPromises()

      expect(ElMessageBox.confirm).toHaveBeenCalled()
      expect(wrapper.find('.cond-fields').exists()).toBe(false)
      expect((wrapper.get('textarea.cond-expr').element as HTMLTextAreaElement).value).toBe("custom.check(K1,'x')")
    })

    it('确认后放弃原表达式，改由字段模式重新生成', async () => {
      vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
      const wrapper = mount(ConditionRow, {
        props: { condition: UNPARSEABLE, integrated: true, fields: [{ prop: 'title', desc: '标题', columnName: 'K1' }] },
      })

      await wrapper.get('.cond-add').trigger('click')
      await flushPromises()

      expect(wrapper.find('.cond-fields').exists()).toBe(true)
      expect((wrapper.get('textarea.cond-expr').element as HTMLTextAreaElement).value).toBe("string.contains(K1,'')")
    })
  })
})
