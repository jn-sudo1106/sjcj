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

  it('初始查询携带 enable=\'0\'（与旧 EntryTypeList 页面初始查询口径一致，见迁移方案 §1.3-1）；查询按钮显式传 entryTypeId/name，不再猜词', async () => {
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

  it('admin 角色可见写入口白名单 [新建, 更多]；read 角色隐藏写入口但保留只读的「详情」；「清除缓存」入口已下线（0721 会议 §六-2）', async () => {
    // 列表需至少 1 行——空列表时行内「更多」触发按钮本就不会渲染，白名单断言会假通过（见 REVIEW-2026-07-24 复盘）
    const entries: EntryType[] = [{ tableId: 't1', tableName: 'tb_a', fields: [] }]
    vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 1, list: entries })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountTab()
    await waitForLoad()

    // admin 写入口白名单断言（替代旧的「清除缓存」黑名单，避免「假阳性」）
    expect(wrapper.text(), 'admin 缺写入口: 新建').toContain('新建')
    expect(wrapper.text(), 'admin 缺写入口: 编辑').toContain('编辑')
    expect(wrapper.findAll('button').some((b) => b.text().startsWith('更多')), 'admin 缺写入口: 更多').toBe(true)
    expect(wrapper.text()).not.toContain('清除缓存')

    wrapper.unmount()
    auth.roles = ['read']
    await mountTab()
    await waitForLoad()

    // read 角色隐藏写入口；「详情」是只读操作，read 应该保留（不在黑名单里）
    const writeEntries = ['新建', '编辑', '批量删除']
    writeEntries.forEach((entry) => expect(wrapper.text(), `read 不应有写入口: ${entry}`).not.toContain(entry))
    expect(wrapper.findAll('button').some((b) => b.text().startsWith('更多')), 'read 不应有「更多」入口').toBe(false)
    expect(wrapper.text(), 'read 应保留只读的「详情」').toContain('详情')
    // 表头勾选列也对 read 隐藏
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

  // ---- 写操作后清缓存契约（0721 会议 §六-2）----
  // 7 个写路径里只测了「批量删除」+「保存/编辑」= 2 个；以下补齐剩余 5 个。
  // 5 个都断言：成功后 entryApi.clearCache 被以正确 tableIds 调用。
  // 任一路径未来被漏掉 / 参数错 / 顺序错，CI 会发现。

  it('复制新表：成功提示透传后端 msg 并静默补一次清缓存', async () => {
    const entries: EntryType[] = [{ tableId: 't1', tableName: 'tb_a', fields: [] }]
    vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 1, list: entries })
    const copySpy = vi.spyOn(entryApi, 'copyEntry').mockResolvedValue({ ok: true, message: '复制成功' })
    const clearSpy = vi.spyOn(entryApi, 'clearCache').mockResolvedValue({ ok: true })
    const promptSpy = vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: 'tb_a_copy' } as never)
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountTab()
    await waitForLoad()

    const moreBtn = wrapper.findAll('button').find((b) => b.text().startsWith('更多'))!
    await moreBtn.trigger('click')
    await flushPromises()
    const item = new DOMWrapper(document.body).findAll('li, .el-dropdown-menu__item').find((el) => el.text() === '复制新表')!
    await item.trigger('click')
    await flushPromises()

    expect(promptSpy).toHaveBeenCalled()
    expect(copySpy).toHaveBeenCalledWith('t1', 'tb_a_copy')
    expect(clearSpy).toHaveBeenCalledWith(['t1'])
  })

  it('同步物理表结构：检查返回差异 SQL 时弹确认，确认后清缓存', async () => {
    const entries: EntryType[] = [{ tableId: 't1', tableName: 'tb_a', fields: [] }]
    vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 1, list: entries })
    const checkSpy = vi.spyOn(entryApi, 'checkTable').mockResolvedValue(['ALTER TABLE t ADD COLUMN k1 varchar(255)'])
    const syncSpy = vi.spyOn(entryApi, 'syncTable').mockResolvedValue({ ok: true, message: '物理表结构已更新' })
    const clearSpy = vi.spyOn(entryApi, 'clearCache').mockResolvedValue({ ok: true })
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountTab()
    await waitForLoad()

    const moreBtn = wrapper.findAll('button').find((b) => b.text().startsWith('更多'))!
    await moreBtn.trigger('click')
    await flushPromises()
    const item = new DOMWrapper(document.body).findAll('li, .el-dropdown-menu__item').find((el) => el.text() === '同步物理表结构')!
    await item.trigger('click')
    await flushPromises()

    expect(checkSpy).toHaveBeenCalledWith('t1')
    expect(confirmSpy).toHaveBeenCalled()
    expect(syncSpy).toHaveBeenCalledWith('t1')
    expect(clearSpy).toHaveBeenCalledWith(['t1'])
  })

  it('重新计算数据量：二次确认后清缓存', async () => {
    const entries: EntryType[] = [{ tableId: 't1', tableName: 'tb_a', fields: [] }]
    vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 1, list: entries })
    const calcSpy = vi.spyOn(entryApi, 'calcEntrySum').mockResolvedValue({ ok: true, message: '计算成功' })
    const clearSpy = vi.spyOn(entryApi, 'clearCache').mockResolvedValue({ ok: true })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountTab()
    await waitForLoad()

    const moreBtn = wrapper.findAll('button').find((b) => b.text().startsWith('更多'))!
    await moreBtn.trigger('click')
    await flushPromises()
    const item = new DOMWrapper(document.body).findAll('li, .el-dropdown-menu__item').find((el) => el.text() === '重新计算数据量')!
    await item.trigger('click')
    await flushPromises()

    expect(calcSpy).toHaveBeenCalledWith('t1')
    expect(clearSpy).toHaveBeenCalledWith(['t1'])
  })

  it('重建去重索引：二次确认后清缓存', async () => {
    const entries: EntryType[] = [{ tableId: 't1', tableName: 'tb_a', fields: [] }]
    vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 1, list: entries })
    const rebuildSpy = vi.spyOn(entryApi, 'rebuildIndex').mockResolvedValue({ ok: true, message: '重建成功' })
    const clearSpy = vi.spyOn(entryApi, 'clearCache').mockResolvedValue({ ok: true })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountTab()
    await waitForLoad()

    const moreBtn = wrapper.findAll('button').find((b) => b.text().startsWith('更多'))!
    await moreBtn.trigger('click')
    await flushPromises()
    const item = new DOMWrapper(document.body).findAll('li, .el-dropdown-menu__item').find((el) => el.text() === '重建去重索引')!
    await item.trigger('click')
    await flushPromises()

    expect(rebuildSpy).toHaveBeenCalledWith('t1')
    expect(clearSpy).toHaveBeenCalledWith(['t1'])
  })

  it('正式表/测试表切换：二次确认后清缓存（以 C → AC 方向为例）', async () => {
    // state='C' 才会显示「置为正式表」菜单项
    const entries: EntryType[] = [{ tableId: 't1', tableName: 'tb_a', state: 'C', fields: [] }]
    vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 1, list: entries })
    const markSpy = vi.spyOn(entryApi, 'markEntryType').mockResolvedValue({ ok: true, message: '设置成功' })
    const clearSpy = vi.spyOn(entryApi, 'clearCache').mockResolvedValue({ ok: true })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountTab()
    await waitForLoad()

    const moreBtn = wrapper.findAll('button').find((b) => b.text().startsWith('更多'))!
    await moreBtn.trigger('click')
    await flushPromises()
    const item = new DOMWrapper(document.body).findAll('li, .el-dropdown-menu__item').find((el) => el.text() === '置为正式表')!
    await item.trigger('click')
    await flushPromises()

    expect(markSpy).toHaveBeenCalledWith('t1', 'AC')
    expect(clearSpy).toHaveBeenCalledWith(['t1'])
  })

  it('批量重建：成功提示 + 清缓存 + 刷新列表（与批量删除同口径）', async () => {
    const entries: EntryType[] = [
      { tableId: 't1', tableName: 'tb_a', fields: [] },
      { tableId: 't2', tableName: 'tb_b', fields: [] },
    ]
    const pagedSpy = vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 2, list: entries })
    const rebuildSpy = vi.spyOn(entryApi, 'rebuildTable').mockResolvedValue({ ok: true, message: '重建完成' })
    const clearSpy = vi.spyOn(entryApi, 'clearCache').mockResolvedValue({ ok: true })
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountTab()
    await waitForLoad()

    // 勾选第一行
    const rowCheckbox = wrapper.findAllComponents({ name: 'ElCheckbox' }).find((c) => c.props('ariaLabel') === '选择表 t1')
    await rowCheckbox!.vm.$emit('change', true)
    await flushPromises()

    // 顶部「更多」按钮 → 检查并重建物理表
    const topMoreBtn = wrapper.findAll('button').find((b) => b.text().startsWith('更多'))!
    await topMoreBtn.trigger('click')
    await flushPromises()
    const item = new DOMWrapper(document.body).findAll('li, .el-dropdown-menu__item').find((el) => el.text().includes('检查并重建物理表'))!
    await item.trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('数量:1'), '检查表结构提示', expect.anything())
    expect(rebuildSpy).toHaveBeenCalledWith(['t1'])
    expect(clearSpy).toHaveBeenCalledWith(['t1'])
    expect(pagedSpy).toHaveBeenCalled()
  })
})
