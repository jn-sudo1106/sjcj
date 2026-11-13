// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import StructureGuardDialog from './StructureGuardDialog.vue'

enableAutoUnmount(afterEach)

afterEach(() => {
  document.body.innerHTML = ''
  document.body.removeAttribute('class')
  document.body.style.removeProperty('overflow')
})

const baseProps = {
  visible: true,
  instanceName: '公告列表→详情·上交所 2026 新增',
  affectedSourceCount: 86,
  defaultSourceCount: 62,
}

async function mountDialog(over: Partial<typeof baseProps> = {}) {
  const wrapper = mount(StructureGuardDialog, {
    props: { ...baseProps, ...over },
    global: { plugins: [ElementPlus] },
    attachTo: document.body,
  })
  // el-dialog 在 onMounted 里把内部 visible 置 true，内容要到下一个 tick 才渲染出来
  await flushPromises()
  return wrapper
}

/** el-dialog append-to-body 后 DOM 落在 document.body 上，查询统一走 body */
function body() {
  return new DOMWrapper(document.body)
}

type DialogWrapper = Awaited<ReturnType<typeof mountDialog>>

/** 选中某个改结构方式：走 el-radio-group 的 update:modelValue（等价用户点选项） */
async function pick(wrapper: DialogWrapper, value: 'migrate' | 'copy-as-new' | 'cancel') {
  wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', value)
  await flushPromises()
}

describe('StructureGuardDialog', () => {
  it('用 el-dialog 承载：560px、点击遮罩不关闭、挂到 body 外', async () => {
    const wrapper = await mountDialog()

    const dialog = wrapper.findComponent({ name: 'ElDialog' })
    expect(dialog.props('width')).toBe('560px')
    expect(dialog.props('appendToBody')).toBe(true)
    expect(dialog.props('closeOnClickModal')).toBe(false)
    expect(dialog.props('modelValue')).toBe(true)
    // 内容 teleport 出组件树
    expect(wrapper.find('[data-testid="structure-guard-dialog"]').exists()).toBe(false)
    expect(body().find('[data-testid="structure-guard-dialog"]').exists()).toBe(true)
  })

  it('标题与正文带受影响源数，并给出查看受影响源清单入口', async () => {
    const wrapper = await mountDialog()

    expect(body().get('[data-testid="guard-title"]').text()).toContain('改结构会修改当前实例：影响 86 个源')
    expect(body().text()).toContain('的结构修改会立刻作用于这 86 个源；同模板其它实例不受影响')
    // 影响范围落在 el-alert（warning）里
    expect(body().get('[data-testid="structure-guard-dialog"] .el-alert--warning').text()).toContain('受影响源 86 个')
    expect(body().text()).toContain('默认流程 62 个')

    await body().get('[data-testid="guard-view-sources"]').trigger('click')
    expect(wrapper.emitted('view-sources')).toHaveLength(1)
  })

  it('不传 defaultSourceCount 时不显示默认流程数', async () => {
    await mountDialog({ defaultSourceCount: undefined })
    expect(body().text()).not.toContain('默认流程')
  })

  it('三个选项用 el-radio 渲染，文案正确，默认未选时「继续」禁用', async () => {
    await mountDialog()
    const options = body().findAll('[data-testid="guard-option"]')
    expect(options).toHaveLength(3)
    expect(options.every((option) => option.classes().includes('el-radio'))).toBe(true)

    expect(options[0]!.text()).toContain('修改当前实例并迁移到新模板')
    expect(options[0]!.text()).toContain('推荐')
    // 推荐标签用 el-tag success 承载
    expect(options[0]!.find('.el-tag').classes()).toContain('el-tag--success')
    expect(options[0]!.text()).toContain('实例 ID 与源绑定不变，原模板留存不变')
    expect(options[1]!.text()).toContain('复制为新实例并另存为新模板')
    expect(options[1]!.text()).toContain('未选的源仍绑原实例')
    expect(options[2]!.text()).toContain('取消修改')

    expect(body().get('[data-testid="guard-continue"]').attributes('disabled')).toBeDefined()
  })

  it('选①继续 emit migrate', async () => {
    const wrapper = await mountDialog()
    await pick(wrapper, 'migrate')
    expect(body().get('[data-testid="guard-continue"]').attributes('disabled')).toBeUndefined()

    await body().get('[data-testid="guard-continue"]').trigger('click')
    expect(wrapper.emitted('migrate')).toHaveLength(1)
    expect(wrapper.emitted('copy-as-new')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('选②继续 emit copy-as-new', async () => {
    const wrapper = await mountDialog()
    await pick(wrapper, 'copy-as-new')
    await body().get('[data-testid="guard-continue"]').trigger('click')
    expect(wrapper.emitted('copy-as-new')).toHaveLength(1)
    expect(wrapper.emitted('migrate')).toBeUndefined()
  })

  it('选③继续 emit close', async () => {
    const wrapper = await mountDialog()
    await pick(wrapper, 'cancel')
    await body().get('[data-testid="guard-continue"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('migrate')).toBeUndefined()
  })

  it('底部「取消」按钮 emit close', async () => {
    const wrapper = await mountDialog()
    await body().get('[data-testid="guard-cancel"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('重新打开时清空上次选择，「继续」回到禁用', async () => {
    const wrapper = await mountDialog()
    await pick(wrapper, 'migrate')
    expect(body().get('[data-testid="guard-continue"]').attributes('disabled')).toBeUndefined()

    await wrapper.setProps({ visible: false })
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ElDialog' }).props('modelValue')).toBe(false)

    await wrapper.setProps({ visible: true })
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ElDialog' }).props('modelValue')).toBe(true)
    expect(body().get('[data-testid="guard-continue"]').attributes('disabled')).toBeDefined()
  })
})