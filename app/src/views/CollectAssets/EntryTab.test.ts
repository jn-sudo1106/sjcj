// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import EntryTab from './EntryTab.vue'
import { useAuthStore } from '../../stores/auth'
import { entryApi, type EntryType } from '../../api'

// 表 ID 列表迁移方案 §4.2/§4.4/§1.6：检索参数形状、批量确认流、read 角色隐藏
describe('EntryTab · 表ID列表', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  async function mountTab(query: Record<string, string> = {}) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/collect', component: { template: '<div />' } }],
    })
    await router.push({ path: '/collect', query })
    await router.isReady()
    wrapper = mount(EntryTab, { global: { plugins: [ElementPlus, router] } })
    return wrapper
  }

  async function waitForLoad() {
    await flushPromises()
    await new Promise((r) => setTimeout(r, 200))
    await flushPromises()
  }

  it('初始查询携带 enable=\'0\'；查询按钮显式传 entryTypeId/name，不再猜词', async () => {
    const pagedSpy = vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 0, list: [] })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountTab()
    await waitForLoad()

    expect(pagedSpy).toHaveBeenCalledWith(expect.objectContaining({ enable: '0', page: 1, size: 20 }))

    await wrapper.find('input[placeholder="表 ID"]').setValue('2001')
    await wrapper.find('input[placeholder="表名称"]').setValue('公告')
    await wrapper.findAll('button').find((b) => b.text() === '查询')!.trigger('click')
    await flushPromises()

    expect(pagedSpy).toHaveBeenLastCalledWith(expect.objectContaining({ entryTypeId: '2001', name: '公告', enable: '0' }))
  })

  it('重置清空查询框并去掉 enable 条件', async () => {
    const pagedSpy = vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 0, list: [] })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountTab()
    await waitForLoad()

    await wrapper.find('input[placeholder="表 ID"]').setValue('2001')
    await wrapper.findAll('button').find((b) => b.text() === '重置')!.trigger('click')
    await flushPromises()

    expect(pagedSpy).toHaveBeenLastCalledWith(expect.objectContaining({ entryTypeId: undefined, name: undefined, enable: undefined }))
  })

  it('深链接 ?entryTypeId= 自动带入检索', async () => {
    const pagedSpy = vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 0, list: [] })
    await mountTab({ entryTypeId: '2102157' })
    await waitForLoad()

    expect(pagedSpy).toHaveBeenCalledWith(expect.objectContaining({ entryTypeId: '2102157' }))
  })

  it('admin 角色可见批量操作与新建；read 角色隐藏全部写入口；「清除缓存」入口已下线（同参数列表 0721 会议 §六-2）', async () => {
    vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 0, list: [] })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountTab()
    await waitForLoad()
    expect(wrapper.text()).not.toContain('清除缓存')
    expect(wrapper.text()).toContain('新建')

    wrapper.unmount()
    auth.roles = ['read']
    await mountTab()
    await waitForLoad()
    expect(wrapper.text()).not.toContain('清除缓存')
    expect(wrapper.text()).not.toContain('新建')
    expect(wrapper.find('th input, th .el-checkbox').exists()).toBe(false)
  })

  it('批量删除：confirm 文案含数量与 ids，成功后静默补一次清缓存、清空选中并刷新', async () => {
    const entries: EntryType[] = [
      { tableId: 't1', tableName: 'tb_a', fields: [] },
      { tableId: 't2', tableName: 'tb_b', fields: [] },
    ]
    const pagedSpy = vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 2, list: entries })
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const deleteSpy = vi.spyOn(entryApi, 'deleteEntries').mockResolvedValue({ ok: true })
    const clearSpy = vi.spyOn(entryApi, 'clearCache').mockResolvedValue({ ok: true })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountTab()
    await waitForLoad()

    const rowCheckbox = wrapper.findAllComponents({ name: 'ElCheckbox' }).find((c) => c.props('ariaLabel') === '选择表 t1')
    await rowCheckbox!.vm.$emit('change', true)
    await flushPromises()

    const moreBtn = wrapper.findAll('button').find((b) => b.text().startsWith('更多'))
    expect(moreBtn).toBeTruthy()
    await moreBtn!.trigger('click')
    await flushPromises()
    const delItem = new DOMWrapper(document.body).findAll('li, .el-dropdown-menu__item').find((el) => el.text() === '批量删除')
    await delItem!.trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('数量:1'), '提示', expect.anything())
    expect(deleteSpy).toHaveBeenCalledWith(['t1'])
    expect(clearSpy).toHaveBeenCalledWith(['t1'])
    expect(pagedSpy).toHaveBeenCalled()
  })

  it('表ID列展示为纯文本，不是可点击链接（点表ID=自查行为交互反直觉，已去掉；深链接改为仅支持 URL 直达）', async () => {
    const entries: EntryType[] = [{ tableId: 't1', tableName: 'tb_a', fields: [] }]
    vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 1, list: entries })
    await mountTab()
    await waitForLoad()

    expect(wrapper.text()).toContain('t1')
    expect(wrapper.findAll('button.et-name').length).toBe(0)
  })

  it('提取表字段：拼出 编码:展示名:列宽 文本、展示字段数，点复制写入剪贴板', async () => {
    const entries: EntryType[] = [{ tableId: 't1', tableName: 'tb_a', fields: [] }]
    vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 1, list: entries })
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue({
      tableId: 't1', tableName: 'tb_a',
      fields: [
        { prop: 'title', desc: '标题', type: 'string', required: false, width: 1000 },
        { prop: 'author', desc: '作者', type: 'string', required: false, width: 5 },
      ],
    })
    const auth = useAuthStore()
    auth.roles = ['admin']
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    await mountTab()
    await waitForLoad()

    const moreBtn = wrapper.findAll('button').find((b) => b.text().startsWith('更多'))!
    await moreBtn.trigger('click')
    await flushPromises()
    const extractItem = new DOMWrapper(document.body).findAll('li, .el-dropdown-menu__item').find((el) => el.text() === '提取表字段')!
    await extractItem.trigger('click')
    await flushPromises()

    // el-dialog append-to-body：内容 teleport 到 document.body，脱离 wrapper 的可查询范围
    const body = new DOMWrapper(document.body)
    expect(body.text()).toContain('共 2 个字段')
    const textarea = body.get<HTMLTextAreaElement>('.et-extract-textarea')
    // width < 10 时按 255 兜底（既有契约，未随样式改动变化）
    expect(textarea.element.value).toBe('title:标题:1000\nauthor:作者:255')

    const copyBtn = body.findAll('button').find((b) => b.text().includes('复制'))!
    await copyBtn.trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith('title:标题:1000\nauthor:作者:255')
  })

  it('新建/编辑保存成功后静默补一次清缓存（同参数列表口径）', async () => {
    const entries: EntryType[] = [{ tableId: 't1', tableName: 'tb_a', fields: [] }]
    vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 1, list: entries })
    const clearSpy = vi.spyOn(entryApi, 'clearCache').mockResolvedValue({ ok: true })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountTab()
    await waitForLoad()

    const editorDrawer = wrapper.findComponent({ name: 'EntryEditorDrawer' })
    editorDrawer.vm.$emit('saved', 't1')
    await flushPromises()

    expect(clearSpy).toHaveBeenCalledWith(['t1'])
  })
})
