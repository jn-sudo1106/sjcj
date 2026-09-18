// @vitest-environment jsdom
// 0915-14 网站标签：打标签的唯一入口就是这个弹窗（卡片右键/⋯、表格铅笔、源侧栏右键三处共用）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SiteEditorDialog from './SiteEditorDialog.vue'
import { siteApi, type Site, type SourceCategory } from '@/api'

const categories: SourceCategory[] = [{ id: '7', name: '新闻', children: [] }] as never

function site(tags?: string[]): Site {
  return { siteId: '1', name: '新浪财经1', category: '新闻', dirId: '7', owner: '', sourceCount: 2, errorCount: 0, tags }
}

const stubs = {
  ElDialog: { name: 'ElDialog', props: ['modelValue'], template: '<div><slot /><slot name="footer" /></div>' },
  ElForm: { template: '<form><slot /></form>' },
  ElFormItem: { props: ['label'], template: '<div><label>{{ label }}</label><slot /></div>' },
  ElInput: { props: ['modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  ElSelect: {
    name: 'ElSelect', props: ['modelValue'],
    template: '<div class="el-select"><slot /></div>',
    emits: ['update:modelValue', 'change'],
  },
  ElOption: { props: ['label', 'value'], template: '<div class="el-option">{{ label }}</div>' },
  ElButton: { template: '<button><slot /></button>' },
  // 2026-09-18：分类从扁平 el-select 换成了懒加载的 el-tree-select（三级目录）
  ElTreeSelect: {
    name: 'ElTreeSelect',
    // Boolean 要显式声明类型，否则模板里的无值属性（lazy / check-strictly）传进来是空串
    props: {
      modelValue: null, data: null, load: null, cacheData: null,
      lazy: Boolean, checkStrictly: Boolean, filterable: Boolean, clearable: Boolean,
    },
    template: '<div class="el-tree-select" />',
  },
}

function mountDlg(s: Site) {
  return mount(SiteEditorDialog, { props: { visible: true, site: s, categories }, global: { stubs } })
}

describe('SiteEditorDialog 网站标签', () => {
  afterEach(() => vi.restoreAllMocks())

  it('打开时回填已有标签，并拉取候选清单', async () => {
    const tagsApi = vi.spyOn(siteApi, 'siteTags').mockResolvedValue(['测试', '服务'])
    const wrapper = mountDlg(site(['测试']))
    await flushPromises()

    expect(tagsApi).toHaveBeenCalled()
    expect(wrapper.get('[data-testid="site-tag-editor"]').text()).toContain('测试')
  })

  it('保存时把标签一起提交', async () => {
    vi.spyOn(siteApi, 'siteTags').mockResolvedValue([])
    const update = vi.spyOn(siteApi, 'siteUpdate').mockResolvedValue({ ok: true })
    const wrapper = mountDlg(site(['测试', '服务']))
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text().includes('保存'))!.trigger('click')
    await flushPromises()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ siteId: '1', tags: ['测试', '服务'] }))
  })

  it('能删掉多余标签（剩一个以上时）', async () => {
    vi.spyOn(siteApi, 'siteTags').mockResolvedValue([])
    const update = vi.spyOn(siteApi, 'siteUpdate').mockResolvedValue({ ok: true })
    const wrapper = mountDlg(site(['测试', '服务']))
    await flushPromises()

    await wrapper.findAll('[data-testid="site-tag-remove"]')[1].trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('保存'))!.trigger('click')
    await flushPromises()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ tags: ['测试'] }))
  })

  // 后端把空串当作"未提供"跳过（2026-09-16 实测，旧平台删最后一个标签同样失败但界面提示成功）。
  // 与其让人删完保存、刷新发现还在，不如当场禁掉。后端支持清空后删掉这条即可。
  it('只剩一个标签时不许删，并说明原因', async () => {
    vi.spyOn(siteApi, 'siteTags').mockResolvedValue([])
    const wrapper = mountDlg(site(['测试']))
    await flushPromises()

    const x = wrapper.get('[data-testid="site-tag-remove"]')
    expect(x.classes()).toContain('disabled')
    expect(x.attributes('title')).toContain('至少保留一个')

    await x.trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="site-tag-editor"]').text()).toContain('测试')
  })

  it('新增标签：去掉误输入的 # 前缀，重复的不再添加', async () => {
    vi.spyOn(siteApi, 'siteTags').mockResolvedValue([])
    const update = vi.spyOn(siteApi, 'siteUpdate').mockResolvedValue({ ok: true })
    const wrapper = mountDlg(site(['测试']))
    await flushPromises()

    const select = wrapper.findAllComponents({ name: 'ElSelect' }).at(-1)!
    await select.vm.$emit('change', '#服务')   // 源标签习惯带 #，网站标签不带
    await select.vm.$emit('change', '测试')    // 已存在
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text().includes('保存'))!.trigger('click')
    await flushPromises()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ tags: ['测试', '服务'] }))
  })
})

// ---- 新建网站（2026-09-18）：与编辑共用这一个弹窗，mode='create' 时走 siteCreate ----
describe('SiteEditorDialog 新建网站', () => {
  afterEach(() => vi.restoreAllMocks())

  function mountCreate() {
    return mount(SiteEditorDialog, {
      props: { visible: true, site: null, categories, mode: 'create' as const },
      global: { stubs },
    })
  }

  async function fill(wrapper: ReturnType<typeof mountCreate>, name: string, dirId: string) {
    await wrapper.get('input').setValue(name)
    // categoryPath 由分类下拉给值，stub 下直接写 vm
    ;(wrapper.vm as unknown as { form: { categoryPath: string } }).form.categoryPath = dirId
  }

  it('标题与提交按钮是「新建」口径', async () => {
    vi.spyOn(siteApi, 'siteTags').mockResolvedValue([])
    const wrapper = mountCreate()
    await flushPromises()
    expect(wrapper.findAll('button').some((b) => b.text().includes('创建'))).toBe(true)
  })

  it('提交走 siteCreate 且源数组为空——只建站，不建源', async () => {
    vi.spyOn(siteApi, 'siteTags').mockResolvedValue([])
    const create = vi.spyOn(siteApi, 'siteCreate').mockResolvedValue({ ok: true, siteId: '99' })
    const wrapper = mountCreate()
    await flushPromises()
    await fill(wrapper, '新站点', '7')

    await wrapper.findAll('button').find((b) => b.text().includes('创建'))!.trigger('click')
    await flushPromises()

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: '新站点', dirId: '7' }),
      [],
    )
    // saved 要把新 siteId 带给调用方
    expect(wrapper.emitted('saved')?.[0]).toEqual(['99'])
  })

  it('填了标签时，建完再补一次 siteUpdate（site/add 不吃 tags）', async () => {
    vi.spyOn(siteApi, 'siteTags').mockResolvedValue([])
    vi.spyOn(siteApi, 'siteCreate').mockResolvedValue({ ok: true, siteId: '99' })
    const update = vi.spyOn(siteApi, 'siteUpdate').mockResolvedValue({ ok: true })
    const wrapper = mountCreate()
    await flushPromises()
    await fill(wrapper, '新站点', '7')
    ;(wrapper.vm as unknown as { tags: string[] }).tags = ['测试']

    await wrapper.findAll('button').find((b) => b.text().includes('创建'))!.trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ siteId: '99', tags: ['测试'] }))
  })

  it('名称或分类没填时不发请求', async () => {
    vi.spyOn(siteApi, 'siteTags').mockResolvedValue([])
    const create = vi.spyOn(siteApi, 'siteCreate').mockResolvedValue({ ok: true, siteId: '99' })
    const wrapper = mountCreate()
    await flushPromises()
    await wrapper.get('input').setValue('只有名字')

    await wrapper.findAll('button').find((b) => b.text().includes('创建'))!.trigger('click')
    await flushPromises()

    expect(create).not.toHaveBeenCalled()
  })
})

// 2026-09-18 用户提：新建网站的分类只有两级，而查询那边是三级树。
describe('SiteEditorDialog 分类选择器', () => {
  afterEach(() => vi.restoreAllMocks())

  it('用的是懒加载树选择器，不是拍平成「父 / 子」的两级下拉', async () => {
    vi.spyOn(siteApi, 'siteTags').mockResolvedValue([])
    const wrapper = mount(SiteEditorDialog, {
      props: { visible: true, site: null, categories, mode: 'create' as const },
      global: { stubs },
    })
    await flushPromises()

    const tree = wrapper.findComponent({ name: 'ElTreeSelect' })
    expect(tree.exists()).toBe(true)
    expect(tree.props('lazy')).toBe(true)
    // check-strictly：允许直接选中间层级（网站可以只挂到二级目录）
    expect(tree.props('checkStrictly')).toBe(true)
    // 单选——没有 multiple
    expect(tree.props()).not.toHaveProperty('multiple')
  })

  it('编辑挂在深层目录的网站时，用 categoryPath 兜底回显，不显示裸 ID', async () => {
    vi.spyOn(siteApi, 'siteTags').mockResolvedValue([])
    const deep: Site = { ...site(), dirId: '99', categoryPath: '/财经资讯/财经媒体/中央级媒体' }
    const wrapper = mount(SiteEditorDialog, {
      props: { visible: true, site: deep, categories },
      global: { stubs },
    })
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ElTreeSelect' }).props('cacheData'))
      .toEqual([{ value: '99', label: '财经资讯 / 财经媒体 / 中央级媒体' }])
  })
})
