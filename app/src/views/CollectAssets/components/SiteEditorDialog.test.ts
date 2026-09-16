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
