// @vitest-environment jsdom
// SourceMonitorDialog = 旧平台 `page/config/modules/MonitorModal.vue` 的迁移版：
//   一个「监控」弹窗，内嵌源监控列表的**嵌入形态**，打开时把源 ID 交给列表。
// 本文件只测这个壳的三件事：懒渲染、showModal 传源、标题沿用旧版。
// 列表自身的行为在 ../sourceCheck/index.test.ts，表单在 CheckEditDialog.test.ts。
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import SourceMonitorDialog from './SourceMonitorDialog.vue'

/** 内嵌列表桩：只暴露 embedded / sourceId 两个 props。
 *  embedded 必须声明成 Boolean —— 模板里写的是裸属性 `<SourceCheck embedded />`，
 *  Vue 3 对组件传的是 `""`，靠 type:Boolean 才能转成 true（真实组件是 TS 声明的 boolean，
 *  自动带这个转换；桩用数组式 props 就不会转，会拿到 ""）。 */
const SourceCheckStub = defineComponent({
  name: 'SourceCheck',
  props: {
    embedded: { type: Boolean, default: false },
    sourceId: { type: String, default: '' },
  },
  template: '<div data-testid="source-check-stub" />',
})

const ElDialogStub = defineComponent({
  name: 'ElDialog',
  // inheritAttrs:false 是必须的：生产模板在 el-dialog 上带了 data-testid / class / top 等，
  // 默认会 fallthrough 到本桩的根节点，把桩自己的 data-testid **覆盖**掉（同名时 attrs 胜出），
  // 于是 find('[data-testid="monitor-dialog-stub"]') 永远查不到——现象上看着像"桩没生效"。
  inheritAttrs: false,
  props: ['modelValue', 'title', 'width'],
  emits: ['update:modelValue'],
  template: '<div v-if="modelValue" data-testid="monitor-dialog-stub"><slot /></div>',
})

function mountDialog() {
  return mount(SourceMonitorDialog, {
    global: { stubs: { SourceCheck: SourceCheckStub, 'el-dialog': ElDialogStub } },
  })
}

describe('SourceMonitorDialog · 复刻旧平台 MonitorModal', () => {
  it('初始不渲染弹窗内容（懒渲染），showModal 后才出现', async () => {
    const wrapper = mountDialog()
    expect(wrapper.find('[data-testid="monitor-dialog-stub"]').exists()).toBe(false)

    wrapper.vm.showModal('430016944')
    await flushPromises()

    expect(wrapper.find('[data-testid="monitor-dialog-stub"]').exists()).toBe(true)
  })

  it('showModal(源ID) 把该源交给内嵌列表，且走嵌入形态', async () => {
    const wrapper = mountDialog()
    wrapper.vm.showModal('430016944')
    await flushPromises()

    const list = wrapper.findComponent(SourceCheckStub)
    expect(list.props('sourceId')).toBe('430016944')
    expect(list.props('embedded')).toBe(true)
  })

  it('showModal 不带源也能开（源交给用户在列表里选）', async () => {
    const wrapper = mountDialog()
    wrapper.vm.showModal()
    await flushPromises()

    expect(wrapper.findComponent(SourceCheckStub).props('sourceId')).toBe('')
  })

  it('标题沿用旧版「监控」', async () => {
    const wrapper = mountDialog()
    wrapper.vm.showModal('1')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ElDialog' }).props('title')).toBe('监控')
  })
})
