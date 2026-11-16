// CategoryManager 单元测试（0924-03 由分类管理抽屉迁来：抽屉壳去掉，用例原样保留）
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { h } from 'vue'
import CategoryManager from './CategoryManager.vue'
import { categoryApi, sourceApi } from '@/api'

const stubs = {
  ElTooltip: { props: ['content', 'placement', 'showAfter'], template: '<slot />' },
  ElDialog: {
    name: 'ElDialog',
    props: ['modelValue', 'title'],
    template: '<div v-if="modelValue" class="el-dialog-mock"><div class="el-dialog-title">{{ title }}</div><slot /><slot name="footer" /></div>',
  },
  ElForm: { template: '<form><slot /></form>' },
  ElFormItem: { props: ['label'], template: '<div><label>{{ label }}</label><slot /></div>' },
  ElInput: {
    props: ['modelValue'],
    template: '<div class="el-input-mock"><input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><span class="input-val-text">{{ modelValue }}</span></div>',
  },
  ElInputNumber: {
    props: ['modelValue'],
    template: '<input type="number" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
  },
  ElTree: {
    name: 'ElTree',
    props: ['load', 'lazy', 'props', 'data'],
    setup(props: any, { slots }: any) {
      if (props.data && props.data.length) {
        // 非懒加载（1014）：data 里的根节点各包一层 node（带 parent.childNodes，让 isFirstSibling/上移可用）
        const nodes = props.data.map((d: any) => ({
          data: d,
          expanded: true,
          parent: { level: 0, childNodes: [] as any[] },
        }))
        nodes.forEach((n: any) => { n.parent.childNodes = nodes })
        return () => (
          h('div', { class: 'el-tree-mock' }, nodes.map((n: any) =>
            slots.default?.({ node: n, data: n.data }),
          ))
        )
      }
      const nodeA: any = {
        data: { id: '101', name: '财经资讯', count: 12, seq: 10 },
        parent: { level: 0, childNodes: [] },
      }
      const nodeB: any = {
        data: { id: '102', name: '海外社媒', count: 3, seq: 20 },
        parent: { level: 0, childNodes: [] },
      }
      nodeA.parent.childNodes = [nodeA, nodeB]
      nodeB.parent.childNodes = [nodeA, nodeB]
      return () => (
        h('div', { class: 'el-tree-mock' }, [
          slots.default?.({ node: nodeA, data: nodeA.data }),
          slots.default?.({ node: nodeB, data: nodeB.data }),
        ])
      )
    },
  },
  ElButton: {
    props: ['disabled', 'loading'],
    template: '<button :disabled="disabled"><slot /></button>',
  },
  ElIcon: { template: '<i><slot /></i>' },
}

describe('CategoryManager 分类目录', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(sourceApi, 'sourceCategories').mockResolvedValue([
      { id: '101', name: '财经资讯', count: 12 },
      { id: '102', name: '海外社媒', count: 3 },
    ])
  })

  it('挂载即渲染：单行工具栏（计数 + 新增 / 批量添加）+ 表头，没有关闭按钮和底部说明栏', () => {
    const wrapper = mount(CategoryManager, {
      global: { stubs },
    })

    expect(wrapper.text()).toContain('个一级分类')
    expect(wrapper.text()).toContain('新增根分类')
    expect(wrapper.text()).toContain('批量添加')
    expect(wrapper.find('.ca-table-head').text()).toContain('分类名称')
    expect(wrapper.find('button[aria-label="关闭"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('批量导入')
  })

  // 1016：首屏只拉根目录 + 预取一层；展开时再预取下一层，不再一次 BFS 拉全
  it('按需加载：首屏只拉根和根的子级，展开节点时才预取它子目录的子级', async () => {
    const tree: Record<string, { id: string; name: string }[]> = {
      '': [{ id: '101', name: '财经资讯' }, { id: '102', name: '海外社媒' }],
      '101': [{ id: '201', name: '基金' }],
      '102': [],
      '201': [{ id: '301', name: '公募' }],
    }
    const spy = vi.spyOn(sourceApi, 'sourceCategories').mockImplementation(async (pid?: string) => tree[pid ?? ''] ?? [])
    const wrapper = mount(CategoryManager, { global: { stubs } })
    await flushPromises()
    expect(spy.mock.calls.map((c) => c[0])).toEqual([undefined, '101', '102'])
    expect(wrapper.text()).toContain('财经资讯')

    wrapper.findComponent({ name: 'ElTree' }).vm.$emit('node-expand', { id: '101', name: '财经资讯' })
    await flushPromises()
    expect(spy.mock.calls.map((c) => c[0])).toEqual([undefined, '101', '102', '201'])
  })

  // 按钮外面已套 el-tooltip，再带原生 title 会在悬停时同时弹出两个提示
  it('操作按钮不带原生 title，只靠 el-tooltip + aria-label', () => {
    const wrapper = mount(CategoryManager, {
      global: { stubs },
    })
    const labelled = wrapper.findAll('button[aria-label]')
    expect(labelled.length).toBeGreaterThan(0)
    expect(labelled.filter((b) => b.attributes('title') !== undefined)).toHaveLength(0)
  })

  it('点击「新增根分类」按钮会打开新增弹窗', async () => {
    const wrapper = mount(CategoryManager, {
      global: { stubs },
    })

    const addBtn = wrapper.findAll('button').find((b) => b.text().includes('新增根分类'))
    expect(addBtn).toBeDefined()
    await addBtn!.trigger('click')

    expect(wrapper.text()).toContain('顶级根目录 (parentId: 0)')
    expect(wrapper.text()).toContain('分类名称')
  })

  it('搜索框输入关键词并触发搜索，调用 searchCategories 接口并展示匹配树节点', async () => {
    const spy = vi.spyOn(sourceApi, 'searchCategories').mockResolvedValue([
      { id: '201', name: '标签', parentId: '0', path: '0,' },
    ])

    const wrapper = mount(CategoryManager, {
      global: { stubs },
    })

    const input = wrapper.find('.ca-search-bar input')
    await input.setValue('标签')
    await input.trigger('keyup.enter')
    await flushPromises()

    expect(spy).toHaveBeenCalledWith('标签')
    expect(wrapper.text()).toContain('标签')
  })

  it('编辑分类提交后调用 categoryApi.update', async () => {
    const spy = vi.spyOn(categoryApi, 'update').mockResolvedValue({ ok: true })

    const wrapper = mount(CategoryManager, {
      global: { stubs },
    })

    // 点击修改按钮
    const editBtn = wrapper.findAll('button').find((b) => b.attributes('aria-label') === '修改分类')
    expect(editBtn).toBeDefined()
    await editBtn!.trigger('click')

    expect(wrapper.text()).toContain('编辑分类')
    const saveBtn = wrapper.findAll('.ca-dialog-footer button').find((b) => b.text().includes('确定保存'))
    expect(saveBtn).toBeDefined()
    await saveBtn!.trigger('click')
    await flushPromises()

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      categoryId: '101',
      categoryName: '财经资讯',
    }))
  })

  it('首个节点禁用上移，第二个节点点击上移调用 categoryApi.update 互换 seq 权重', async () => {
    const spy = vi.spyOn(categoryApi, 'update').mockResolvedValue({ ok: true })

    const wrapper = mount(CategoryManager, {
      global: { stubs },
    })

    const upBtns = wrapper.findAll('button').filter((b) => b.attributes('aria-label') === '上移')
    expect(upBtns).toHaveLength(2)
    // 第一个兄弟节点禁用上移
    expect(upBtns[0]?.attributes('disabled')).toBeDefined()
    // 第二个兄弟节点启用上移
    expect(upBtns[1]?.attributes('disabled')).toBeUndefined()

    // 点击第二个节点上移
    await upBtns[1]!.trigger('click')
    await flushPromises()

    expect(spy).toHaveBeenCalled()
    // 互换后的参数调用
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      categoryId: '102',
      seq: 10,
    }))
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      categoryId: '101',
      seq: 20,
    }))
    for (const call of spy.mock.calls) {
      expect(call[0]).not.toHaveProperty('parentId')
    }
  })

  it('未赋权节点（seq 均为 0 或 undefined）点击上移按 DESC 降序重新赋权且不传 parentId', async () => {
    const spy = vi.spyOn(categoryApi, 'update').mockResolvedValue({ ok: true })
    const customStubs = {
      ...stubs,
      ElTree: {
        name: 'ElTree',
        props: ['load', 'lazy', 'props', 'data'],
        setup(_props: any, { slots }: any) {
          const node1: any = {
            data: { id: '201', name: '节点一', count: 1 },
            parent: { level: 0, childNodes: [] },
          }
          const node2: any = {
            data: { id: '202', name: '节点二', count: 2 },
            parent: { level: 0, childNodes: [] },
          }
          node1.parent.childNodes = [node1, node2]
          node2.parent.childNodes = [node1, node2]
          return () => (
            h('div', { class: 'el-tree-mock' }, [
              slots.default?.({ node: node1, data: node1.data }),
              slots.default?.({ node: node2, data: node2.data }),
            ])
          )
        },
      },
    }

    const wrapper = mount(CategoryManager, {
      global: { stubs: customStubs },
    })

    const upBtns = wrapper.findAll('button').filter((b) => b.attributes('aria-label') === '上移')
    await upBtns[1]!.trigger('click')
    await flushPromises()

    expect(spy).toHaveBeenCalled()
    // 节点二被移到顶部，total=2，赋予 newSeq = (2 - 0) * 10 = 20
    expect(spy).toHaveBeenCalledWith({
      categoryId: '202',
      categoryName: '节点二',
      seq: 20,
    })
    // 节点一移到第二位，newSeq = (2 - 1) * 10 = 10
    expect(spy).toHaveBeenCalledWith({
      categoryId: '201',
      categoryName: '节点一',
      seq: 10,
    })
    // 确保绝对没有传 parentId
    for (const call of spy.mock.calls) {
      expect(call[0]).not.toHaveProperty('parentId')
    }
  })
})

// 1114 源产出监控一期 C：业务目录预期产出周期
describe('CategoryManager · 业务目录预期产出周期', () => {
  const radioStubs = {
    ElRadioGroup: {
      name: 'ElRadioGroup',
      props: ['modelValue'],
      emits: ['update:modelValue'],
      setup(props: any, { emit, slots }: any) {
        return () => h('div', { class: 'radio-group-mock', 'data-value': props.modelValue }, slots.default?.({ pick: (v: string) => emit('update:modelValue', v) }))
      },
    },
    ElRadioButton: {
      props: ['value'],
      template: '<button type="button" class="radio-mock" :data-radio="value" @click="$parent.$emit(\'update:modelValue\', value)"><slot /></button>',
    },
  }
  // 原 ElTree 桩只在 setup 时读一次 data（挂载时还是空，就退回固定的两条假节点）；这里每次渲染都读 props.data
  const ReactiveTree = {
    name: 'ElTree',
    props: ['data', 'props'],
    setup(props: any, { slots }: any) {
      return () => h('div', { class: 'el-tree-mock' }, (props.data ?? []).map((d: any) =>
        slots.default?.({ node: { data: d, expanded: false, parent: { level: 0, childNodes: [] } }, data: d })))
    },
  }
  const allStubs = { ...stubs, ...radioStubs, ElTree: ReactiveTree }

  async function mountWith(roots: Record<string, unknown>[]) {
    vi.spyOn(sourceApi, 'sourceCategories').mockImplementation(async (pid?: string) => (pid ? [] : roots) as never)
    const wrapper = mount(CategoryManager, { global: { stubs: allStubs } })
    await flushPromises()
    return wrapper
  }

  beforeEach(() => vi.restoreAllMocks())

  it('只有业务目录有周期列内容和设置入口；系统目录、根 -2 都没有', async () => {
    const wrapper = await mountWith([
      { id: '9011553', name: '招投标', parentId: '-2', expectCycleHours: 24 },
      { id: '9011554', name: '学术研究', parentId: '-2' },
      { id: '9008989', name: 'ctrip' },
      { id: '-2', name: '业务分类' },
    ])
    expect(wrapper.find('.ca-table-head').text()).toContain('产出周期')
    expect(wrapper.get('[data-testid="category-cycle-9011553"]').text()).toBe('1 天')
    expect(wrapper.get('[data-testid="category-cycle-9011554"]').text()).toBe('未设置')
    expect(wrapper.get('[data-testid="category-cycle-9008989"]').text()).toBe('')
    expect(wrapper.get('[data-testid="category-cycle--2"]').text()).toBe('')
    expect(wrapper.find('[data-testid="category-cycle-edit-9011553"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="category-cycle-edit-9008989"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="category-cycle-edit--2"]').exists()).toBe(false)
  })

  it('自定义 36 小时保存后就地显示；清空传 0；非法小时不发请求', async () => {
    const save = vi.spyOn(categoryApi, 'updateExpectCycle').mockResolvedValue({ ok: true })
    const wrapper = await mountWith([{ id: '9011553', name: '招投标', parentId: '-2', expectCycleHours: 24 }])
    await wrapper.get('[data-testid="category-cycle-edit-9011553"]').trigger('click')
    expect(wrapper.get('.radio-group-mock').attributes('data-value')).toBe('24')

    await wrapper.get('[data-radio="custom"]').trigger('click')
    const hoursInput = wrapper.get('[data-testid="category-cycle-hours"]')
    await hoursInput.setValue('0')
    await wrapper.get('[data-testid="category-cycle-save"]').trigger('click')
    expect(save).not.toHaveBeenCalled()

    await hoursInput.setValue('36')
    await wrapper.get('[data-testid="category-cycle-save"]').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenLastCalledWith('9011553', 36)
    expect(wrapper.get('[data-testid="category-cycle-9011553"]').text()).toBe('36 小时')

    await wrapper.get('[data-testid="category-cycle-edit-9011553"]').trigger('click')
    expect(wrapper.get('.radio-group-mock').attributes('data-value')).toBe('custom')
    await wrapper.get('[data-radio="none"]').trigger('click')
    await wrapper.get('[data-testid="category-cycle-save"]').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenLastCalledWith('9011553', 0)
    expect(wrapper.get('[data-testid="category-cycle-9011553"]').text()).toBe('未设置')
  })

  it('选预设「7 天」传 168；后端拒绝时提示错误、不改显示', async () => {
    const save = vi.spyOn(categoryApi, 'updateExpectCycle').mockRejectedValueOnce(new Error('只有业务目录（根 -2 下）可以设置预期周期'))
    const wrapper = await mountWith([{ id: '9011554', name: '学术研究', parentId: '-2' }])
    await wrapper.get('[data-testid="category-cycle-edit-9011554"]').trigger('click')
    expect(wrapper.get('.radio-group-mock').attributes('data-value')).toBe('none')
    await wrapper.get('[data-radio="168"]').trigger('click')
    await wrapper.get('[data-testid="category-cycle-save"]').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenCalledWith('9011554', 168)
    expect(wrapper.get('[data-testid="category-cycle-9011554"]').text()).toBe('未设置')
    expect(wrapper.find('.el-dialog-mock').exists()).toBe(true)
  })
})
