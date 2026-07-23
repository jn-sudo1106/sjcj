// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import ParamEditorDrawer from './ParamEditorDrawer.vue'
import { paramApi, type Param } from '../../api'

const dialogStub = {
  props: ['modelValue'],
  template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>',
}

describe('ParamEditorDrawer', () => {
  it('新建参数走中间弹框（0721 会议 A2），显示原系统一致的定义字段与五种参数类型；无分组ID输入（A3）', () => {
    const wrapper = mount(ParamEditorDrawer, {
      props: { modelValue: true, param: null },
      global: { stubs: { 'el-dialog': dialogStub } },
    })

    expect(wrapper.text()).toContain('参数名称')
    expect(wrapper.text()).toContain('参数类型')
    expect(wrapper.text()).not.toContain('分组')
    expect(wrapper.text()).toContain('默认值')
    expect(wrapper.find('option[value="list"]').exists()).toBe(true)
    expect(wrapper.find('option[value="date"]').exists()).toBe(true)
    expect(wrapper.find('option[value="sequence"]').exists()).toBe(true)
    expect(wrapper.find('option[value="date_sequence"]').exists()).toBe(true)
    expect(wrapper.find('option[value="database"]').exists()).toBe(true)
  })

  it('编辑已有分组的旧参数：没有编辑入口也不会把分组悄悄清空（A3 口径：删的是输入框，不是数据）', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const updateSpy = vi.spyOn(paramApi, 'paramUpdate').mockResolvedValue({ ok: true, param: {} as Param })
    const existing: Param = { paramId: 'p-legacy', name: '旧参数', group: '5', kind: 'list', values: ['a'] }

    // 真实用法里弹框总是从「关」切到「开」（resetDraft 靠这个切换触发），直接以 modelValue:true 挂载
    // 不会走初始化逻辑——不是组件的真实使用场景，这里如实模拟一次打开的过程。
    const wrapper = mount(ParamEditorDrawer, {
      props: { modelValue: false, param: existing },
      global: { stubs: { 'el-dialog': dialogStub } },
    })
    await wrapper.setProps({ modelValue: true })
    await wrapper.get('.rc-btn.primary').trigger('click')
    await flushPromises()

    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ paramId: 'p-legacy', group: '5' }))
  })

  it('新建参数：不传分组字段（§六-3 拍板：不传）', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const createSpy = vi.spyOn(paramApi, 'paramCreate').mockResolvedValue({ ok: true, param: {} as Param })

    const wrapper = mount(ParamEditorDrawer, {
      props: { modelValue: true, param: null },
      global: { stubs: { 'el-dialog': dialogStub } },
    })
    await wrapper.get('input.rc-input').setValue('新参数')
    await wrapper.get('textarea.rc-input').setValue('a,b')
    await wrapper.get('.rc-btn.primary').trigger('click')
    await flushPromises()

    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ name: '新参数' }))
    // group 传 undefined 而不是空字符串/固定值——JSON.stringify 序列化时会整个丢掉这个 key，等价于"不传"
    expect(createSpy.mock.calls[0][0].group).toBeUndefined()
  })
})
