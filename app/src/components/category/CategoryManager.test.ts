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
      if (props.data) {
        return () => (
          h('div', { class: 'el-tree-mock' }, props.data.map((d: any) =>
            slots.default?.({ node: { expanded: true }, data: d }),
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

  it('挂载即渲染，展示头部标题与操作按钮（没有关闭按钮——它现在是整页）', () => {
    const wrapper = mount(CategoryManager, {
      global: { stubs },
    })

    expect(wrapper.text()).toContain('分类目录')
    expect(wrapper.text()).toContain('新增根分类')
    expect(wrapper.text()).toContain('批量添加')
    expect(wrapper.find('button[title="关闭"]').exists()).toBe(false)
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
    const editBtn = wrapper.findAll('button').find((b) => b.attributes('title') === '修改分类')
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

    const upBtns = wrapper.findAll('button').filter((b) => b.attributes('title') === '上移')
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

    const upBtns = wrapper.findAll('button').filter((b) => b.attributes('title') === '上移')
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
