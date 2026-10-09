// @vitest-environment jsdom
// 1008-07：源数据视图与数据中心共用的工具条小组件。菜单项 / data-testid 以源数据视图为准，两边都靠它们的测试兜住。
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AddDataMenu from './AddDataMenu.vue'
import ExportMenu from './ExportMenu.vue'
import FullscreenToggle from './FullscreenToggle.vue'
import BrowseModeToggle from './BrowseModeToggle.vue'

// 与 ResultView.test 同一套桩：下拉内容直接渲染，@click 经 attrs 透传到桩的根节点
const ElDropdown = { name: 'ElDropdown', template: '<div><slot /><slot name="dropdown" /></div>' }
const ElDropdownMenu = { name: 'ElDropdownMenu', template: '<div><slot /></div>' }
const ElDropdownItem = { name: 'ElDropdownItem', props: ['disabled', 'divided'], template: '<div class="el-dropdown-item" :disabled="disabled ? \'\' : undefined"><slot /></div>' }
const global = { stubs: { ElDropdown, ElDropdownMenu, ElDropdownItem } }

describe('AddDataMenu', () => {
  it('手工录入 / Excel 导入各发一个事件', async () => {
    const wrapper = mount(AddDataMenu, { global })
    expect(wrapper.get('[data-testid="data-add"]').text()).toBe('新增 ▾')
    await wrapper.get('[data-testid="data-add-manual"]').trigger('click')
    await wrapper.get('[data-testid="data-add-import"]').trigger('click')
    expect(wrapper.emitted('manual')).toHaveLength(1)
    expect(wrapper.emitted('import')).toHaveLength(1)
  })

  it('compact 加紧凑样式类（ResultView 工具条 28px 高）', () => {
    expect(mount(AddDataMenu, { global }).get('button').classes()).not.toContain('is-compact')
    expect(mount(AddDataMenu, { props: { compact: true }, global }).get('button').classes()).toContain('is-compact')
  })
})

describe('ExportMenu', () => {
  it('默认三项：当前页 CSV / 当前源 Excel / 取数 API，各发对应事件', async () => {
    const wrapper = mount(ExportMenu, { global })
    expect(wrapper.get('[data-testid="data-export"]').text()).toBe('导出 ▾')
    expect(wrapper.get('[data-testid="data-export-excel"]').text()).toBe('导出当前源 Excel')
    await wrapper.get('[data-testid="data-export-page"]').trigger('click')
    await wrapper.get('[data-testid="data-export-excel"]').trigger('click')
    await wrapper.get('[data-testid="data-export-api"]').trigger('click')
    expect(wrapper.emitted('export-page')).toHaveLength(1)
    expect(wrapper.emitted('export-excel')).toHaveLength(1)
    expect(wrapper.emitted('show-api')).toHaveLength(1)
  })

  it('showExcel=false（数据中心）菜单里不放 Excel；触发按钮 testid 可改，避开同页的一级「导出 Excel」', () => {
    const wrapper = mount(ExportMenu, { props: { showExcel: false, triggerTestid: 'data-export-menu' }, global })
    expect(wrapper.find('[data-testid="data-export-excel"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-export"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-export-menu"]').exists()).toBe(true)
  })

  it('excelReason 非空：Excel 项禁用并以原因作 title；可点时用 excelHint；当前页与 API 项独立禁用', () => {
    const blocked = mount(ExportMenu, { props: { excelReason: '请先选择源和数据表', pageDisabled: true, apiDisabled: true }, global })
    expect(blocked.get('[data-testid="data-export-excel"]').attributes('disabled')).toBeDefined()
    expect(blocked.get('[data-testid="data-export-excel"]').attributes('title')).toBe('请先选择源和数据表')
    expect(blocked.get('[data-testid="data-export-page"]').attributes('disabled')).toBeDefined()
    expect(blocked.get('[data-testid="data-export-api"]').attributes('disabled')).toBeDefined()

    const ok = mount(ExportMenu, { props: { excelHint: '按当前条件导出' }, global })
    expect(ok.get('[data-testid="data-export-excel"]').attributes('disabled')).toBeUndefined()
    expect(ok.get('[data-testid="data-export-excel"]').attributes('title')).toBe('按当前条件导出')
  })
})

describe('FullscreenToggle', () => {
  it('v-model：点一下取反，文案和 title 跟着变', async () => {
    const wrapper = mount(FullscreenToggle, { props: { modelValue: false } })
    expect(wrapper.text()).toBe('⤢ 全屏')
    expect(wrapper.attributes('title')).toBe('全屏查看数据')
    await wrapper.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([true])
    await wrapper.setProps({ modelValue: true })
    expect(wrapper.text()).toBe('⤡ 退出全屏')
    expect(wrapper.attributes('title')).toBe('退出全屏（Esc）')
    await wrapper.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })
})

describe('BrowseModeToggle', () => {
  it('两个图标按钮：当前项 aria-pressed，点哪个发哪个值', async () => {
    const wrapper = mount(BrowseModeToggle, { props: { modelValue: 'table' } })
    const [table, step] = wrapper.findAll('button')
    expect(table!.attributes('aria-pressed')).toBe('true')
    expect(step!.attributes('aria-pressed')).toBe('false')
    await step!.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['step'])
    await wrapper.setProps({ modelValue: 'step' })
    expect(wrapper.findAll('button')[1]!.attributes('aria-pressed')).toBe('true')
    await table!.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['table'])
  })
})
