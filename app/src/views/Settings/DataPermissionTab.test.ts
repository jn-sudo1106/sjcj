// 系统设置 → 数据权限设置（组级数据权限规则）列表页接线回归。
// 重点钉四件容易回退的事：groupId 必填且 >90000、枚举取自 meta、保存前强制试算、删除走 ids query。
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import DataPermissionTab from './DataPermissionTab.vue'
import * as groupResApi from '@/api/groupRes'
import { useAuthStore } from '@/stores/auth'
import type { GroupResMeta, GroupResRule } from '@/api/groupRes'

// el-table 在 jsdom 里要量宽
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

const META: GroupResMeta = {
  resTypes: [
    { key: 'SOURCE', name: '数据源', baseTable: 'cs_source', idColumn: 'SOURCE_ID', fields: [] },
    { key: 'CATEGORY', name: '目录', baseTable: 'cfg_category', idColumn: 'CATEGORY_ID', fields: [] },
  ],
  actions: [{ key: 'ACCEPT', name: '入选' }, { key: 'REJECT', name: '排除' }],
  condTypes: [{ key: 'ID', name: 'ID列表' }, { key: 'STRUCT', name: '结构化条件' }, { key: 'SQL', name: 'SQL条件' }],
}

const ROWS: GroupResRule[] = [
  { id: 15, groupId: 100001, action: 'ACCEPT', resType: 'SOURCE', condType: 'SQL', resCond: 'CATEGORY_ID IN (9009387,9009388)', condJson: null, remarks: '研发一组可见的源', isDelete: 0 },
  { id: 16, groupId: 100001, action: 'REJECT', resType: 'SOURCE', condType: 'ID', resCond: '430001300,430001301', condJson: null, remarks: '排除测试源', isDelete: 0 },
  { id: 17, groupId: 100001, action: 'ACCEPT', resType: 'CATEGORY', condType: 'STRUCT', resCond: 'CATEGORY_ID IN (9009387)', condJson: '[{"field":"CATEGORY_ID","op":"IN","value":[9009387]}]', remarks: null, isDelete: 0 },
]

function dialogEl(): HTMLElement {
  const el = [...document.querySelectorAll<HTMLElement>('.el-dialog')].find((d) => d.offsetParent !== null || d.style.display !== 'none')
  if (!el) throw new Error('dialog not open')
  return el
}
// Element Plus 的 ElInput 把外部 attrs 落在原生 input / textarea 上，所以 data-testid 就是那个元素
function dialogField(testid: string): HTMLInputElement | HTMLTextAreaElement {
  const el = dialogEl().querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-testid="${testid}"]`)
  if (!el) throw new Error(`field not found: ${testid}`)
  return el
}
async function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flushPromises()
}
async function clickSave() {
  dialogEl().querySelector<HTMLElement>('[data-testid="group-res-save"]')!.click()
  await flushPromises()
}

async function mountAs(roles: string[], query = '100001') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().roles = roles
  vi.spyOn(groupResApi, 'groupResMeta').mockResolvedValue(META)
  vi.spyOn(groupResApi, 'pagedGroupRes').mockResolvedValue({ total: ROWS.length, list: ROWS.map((r) => ({ ...r })) })
  const wrapper = mount(DataPermissionTab, { global: { plugins: [pinia, ElementPlus] } })
  await flushPromises()
  if (query) await wrapper.get('[data-testid="group-res-group-id"]').setValue(query)
  return wrapper
}

describe('数据权限设置页面', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('进入页面就加载 meta 并查第一页列表（组 ID 留空 = 请求不带 groupId）', async () => {
    await mountAs(['admin'], '')
    const warning = vi.spyOn(ElMessage, 'warning')

    expect(groupResApi.groupResMeta).toHaveBeenCalledTimes(1)
    expect(groupResApi.pagedGroupRes).toHaveBeenCalledTimes(1)
    expect(vi.mocked(groupResApi.pagedGroupRes).mock.lastCall?.[0]).toEqual({ resType: '', action: '', page: 1, limit: 20 })
    expect(warning).not.toHaveBeenCalled()
  })

  it('点查询按输入框里的组 ID 重查：请求带上 groupId', async () => {
    const wrapper = await mountAs(['admin'], '')
    await wrapper.get('[data-testid="group-res-group-id"]').setValue('100002')
    await wrapper.get('[data-testid="group-res-query"]').trigger('click')
    await flushPromises()

    expect(groupResApi.pagedGroupRes).toHaveBeenLastCalledWith({ groupId: 100002, resType: '', action: '', page: 1, limit: 20 })
  })

  it('组 ID 填了 90000 也原样发给后端：前端不拦，报错用后端那条文案', async () => {
    const wrapper = await mountAs(['admin'], '')
    const warning = vi.spyOn(ElMessage, 'warning')
    const error = vi.spyOn(ElMessage, 'error')
    vi.mocked(groupResApi.pagedGroupRes).mockRejectedValueOnce(new Error('groupId 必须大于 90000'))
    await wrapper.get('[data-testid="group-res-group-id"]').setValue('90000')
    await wrapper.get('[data-testid="group-res-query"]').trigger('click')
    await flushPromises()

    expect(groupResApi.pagedGroupRes).toHaveBeenLastCalledWith({ groupId: 90000, resType: '', action: '', page: 1, limit: 20 })
    expect(warning).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('加载数据权限规则失败：groupId 必须大于 90000')
  })

  it('查询渲染规则行，枚举名取自 meta；行为/内容类型/条件类型都是中文名', async () => {
    const wrapper = await mountAs(['admin'])
    await wrapper.get('[data-testid="group-res-query"]').trigger('click')
    await flushPromises()

    expect(groupResApi.pagedGroupRes).toHaveBeenLastCalledWith({ groupId: 100001, resType: '', action: '', page: 1, limit: 20 })
    // 条数只在分页里显示，操作区不再有「共 x 条规则」
    expect(wrapper.find('.gr-count').exists()).toBe(false)
    expect(wrapper.text()).toContain('入选')
    expect(wrapper.text()).toContain('数据源')
    expect(wrapper.text()).toContain('ID列表')
  })

  it('下拉改了不自动请求：只有点查询才带上 resType 回第一页', async () => {
    const wrapper = await mountAs(['admin'])
    const callsAfterMount = vi.mocked(groupResApi.pagedGroupRes).mock.calls.length

    const select = wrapper.findAllComponents({ name: 'ElSelect' })[0]!
    select.vm.$emit('update:modelValue', 'CATEGORY')
    await flushPromises()
    expect(vi.mocked(groupResApi.pagedGroupRes).mock.calls.length).toBe(callsAfterMount)

    await wrapper.get('[data-testid="group-res-query"]').trigger('click')
    await flushPromises()

    expect(groupResApi.pagedGroupRes).toHaveBeenLastCalledWith({ groupId: 100001, resType: 'CATEGORY', action: '', page: 1, limit: 20 })
  })

  it('点详情：按 id 调 /group-res/detail，抽屉显示详情接口返回的记录', async () => {
    const detail = vi.spyOn(groupResApi, 'groupResDetail').mockResolvedValue({
      ...ROWS[2]!,
      resCond: 'CATEGORY_ID IN (9009387) 详情覆盖',
      remarks: '详情接口返回',
    })
    const wrapper = await mountAs(['admin'])
    await wrapper.get('[data-testid="group-res-query"]').trigger('click')
    await flushPromises()

    await wrapper.findAll('[data-testid="group-res-detail"]')[2]!.trigger('click')
    await flushPromises()

    expect(detail).toHaveBeenCalledWith(17)
    // el-drawer 没开 append-to-body，内容就在组件自身子树里
    expect(wrapper.text()).toContain('详情接口返回')
    expect(wrapper.text()).toContain('详情覆盖')
  })

  it('重置：清空三个条件、每页条数回默认 20，并回第一页重查', async () => {
    const wrapper = await mountAs(['admin'])
    await wrapper.get('[data-testid="group-res-group-id"]').setValue('100001')
    await wrapper.get('[data-testid="group-res-query"]').trigger('click')
    await flushPromises()

    const pager = wrapper.findComponent({ name: 'ElPagination' })
    expect(pager.props('pageSizes')).toEqual([10, 20, 50])
    pager.vm.$emit('size-change', 10)
    await flushPromises()
    expect(groupResApi.pagedGroupRes).toHaveBeenLastCalledWith({ groupId: 100001, resType: '', action: '', page: 1, limit: 10 })

    await wrapper.get('[data-testid="group-res-reset"]').trigger('click')
    await flushPromises()

    expect(vi.mocked(groupResApi.pagedGroupRes).mock.lastCall?.[0]).toEqual({ resType: '', action: '', page: 1, limit: 20 })
    expect((wrapper.get('[data-testid="group-res-group-id"]').element as HTMLInputElement).value).toBe('')
  })

  it('没查询过也能直接新建：弹窗打开，用户组 ID 留空由用户填', async () => {
    const wrapper = await mountAs(['admin'], '')
    const warning = vi.spyOn(ElMessage, 'warning')
    await wrapper.get('[data-testid="group-res-create"]').trigger('click')
    await flushPromises()

    expect(warning).not.toHaveBeenCalled()
    expect(dialogField('group-res-rule-group-id').value).toBe('')
  })

  it('新建时组 ID 没填或填了内置组段（<=90000）：只提示，不发试算也不发保存', async () => {
    const preview = vi.spyOn(groupResApi, 'previewGroupRes')
    const add = vi.spyOn(groupResApi, 'addGroupRes')
    const warning = vi.spyOn(ElMessage, 'warning')
    const wrapper = await mountAs(['admin'])
    await wrapper.get('[data-testid="group-res-query"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="group-res-create"]').trigger('click')
    await flushPromises()
    await setValue(dialogField('group-res-rescond'), '1')
    await clickSave()
    await setValue(dialogField('group-res-rule-group-id'), '90000')
    await clickSave()

    expect(warning).toHaveBeenNthCalledWith(1, '请输入用户组 ID（必须大于 90000）')
    expect(warning).toHaveBeenNthCalledWith(2, '请输入用户组 ID（必须大于 90000）')
    expect(preview).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })

  it('只读角色看不到新建 / 编辑 / 删除', async () => {
    const wrapper = await mountAs(['read'])
    expect(wrapper.find('[data-testid="group-res-create"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="group-res-edit"]')).toHaveLength(0)
    expect(wrapper.findAll('[data-testid="group-res-delete"]')).toHaveLength(0)
  })

  describe('新建规则（保存前强制试算）', () => {
    it('默认入选 + meta 第一个内容类型 + ID 条件：先 preview 再 add，成功后按原筛选重查，不改动组 ID 输入框', async () => {
      const preview = vi.spyOn(groupResApi, 'previewGroupRes').mockResolvedValue({ compiledCond: '430001300', condType: 'ID', count: 1, sample: [430001300], error: null })
      const add = vi.spyOn(groupResApi, 'addGroupRes').mockResolvedValue({ ok: true, message: '新增成功', data: 18 })
      const wrapper = await mountAs(['admin'])
      await wrapper.get('[data-testid="group-res-query"]').trigger('click')
      await flushPromises()
      const listCallsBefore = vi.mocked(groupResApi.pagedGroupRes).mock.calls.length

      await wrapper.get('[data-testid="group-res-create"]').trigger('click')
      await flushPromises()
      await setValue(dialogField('group-res-rule-group-id'), '100002')
      await setValue(dialogField('group-res-rescond'), '430001300, 430001301')
      await clickSave()

      // 空格被去掉，按后端口径提交
      expect(preview).toHaveBeenCalledWith({ resType: 'SOURCE', condType: 'ID', resCond: '430001300,430001301' })
      expect(add).toHaveBeenCalledWith({ groupId: 100002, action: 'ACCEPT', resType: 'SOURCE', condType: 'ID', resCond: '430001300,430001301', remarks: undefined })
      expect(vi.mocked(groupResApi.pagedGroupRes).mock.calls.length).toBe(listCallsBefore + 1)
      // 查询区的组 ID 一个字没动，重查仍按已生效的 100001
      expect((wrapper.get('[data-testid="group-res-group-id"]').element as HTMLInputElement).value).toBe('100001')
      expect(vi.mocked(groupResApi.pagedGroupRes).mock.lastCall?.[0]).toMatchObject({ groupId: 100001, page: 1 })
    })

    it('试算报 error（success 仍是 true）：不发写请求', async () => {
      vi.spyOn(groupResApi, 'previewGroupRes').mockResolvedValue({ compiledCond: 'SOURCE_ID=1', condType: 'ID', count: 0, sample: [], error: 'ids 只能是逗号分隔的数字' })
      const add = vi.spyOn(groupResApi, 'addGroupRes')
      const error = vi.spyOn(ElMessage, 'error')
      const wrapper = await mountAs(['admin'])
      await wrapper.get('[data-testid="group-res-query"]').trigger('click')
      await flushPromises()

      await wrapper.get('[data-testid="group-res-create"]').trigger('click')
      await flushPromises()
      await setValue(dialogField('group-res-rule-group-id'), '100001')
      await setValue(dialogField('group-res-rescond'), '1')
      await clickSave()

      expect(add).not.toHaveBeenCalled()
      expect(error).toHaveBeenCalledWith('条件试算未通过：ids 只能是逗号分隔的数字')
    })

    it('命中 0 条要二次确认：取消则不保存', async () => {
      vi.spyOn(groupResApi, 'previewGroupRes').mockResolvedValue({ compiledCond: '1', condType: 'ID', count: 0, sample: [], error: null })
      vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
      const add = vi.spyOn(groupResApi, 'addGroupRes')
      const wrapper = await mountAs(['admin'])
      await wrapper.get('[data-testid="group-res-query"]').trigger('click')
      await flushPromises()

      await wrapper.get('[data-testid="group-res-create"]').trigger('click')
      await flushPromises()
      await setValue(dialogField('group-res-rule-group-id'), '100001')
      await setValue(dialogField('group-res-rescond'), '1')
      await clickSave()

      expect(add).not.toHaveBeenCalled()
    })

    it('SQL 条件在前端就按黑名单拦下，不发试算也不发保存', async () => {
      const preview = vi.spyOn(groupResApi, 'previewGroupRes')
      const add = vi.spyOn(groupResApi, 'addGroupRes')
      const warning = vi.spyOn(ElMessage, 'warning')
      const wrapper = await mountAs(['admin'])
      await wrapper.get('[data-testid="group-res-query"]').trigger('click')
      await flushPromises()

      await wrapper.get('[data-testid="group-res-create"]').trigger('click')
      await flushPromises()
      await setValue(dialogField('group-res-rule-group-id'), '100001')
      // condType 单选组过滤掉 STRUCT，只剩 ID / SQL
      dialogEl().querySelectorAll<HTMLInputElement>('[data-testid="group-res-condtype"] input')[1]!.click()
      await flushPromises()
      await setValue(dialogField('group-res-rescond'), '1=1 union select')
      await clickSave()

      expect(preview).not.toHaveBeenCalled()
      expect(add).not.toHaveBeenCalled()
      expect(warning).toHaveBeenCalledWith('SQL 条件包含非法关键字：union')
    })
  })

  it('编辑：回填原条件并调 modify（带 id）', async () => {
    vi.spyOn(groupResApi, 'previewGroupRes').mockResolvedValue({ compiledCond: '1,2', condType: 'ID', count: 2, sample: [1, 2], error: null })
    const modify = vi.spyOn(groupResApi, 'modifyGroupRes').mockResolvedValue({ ...ROWS[1]!, resCond: '1,2' })
    const wrapper = await mountAs(['admin'])
    await wrapper.get('[data-testid="group-res-query"]').trigger('click')
    await flushPromises()

    await wrapper.findAll('[data-testid="group-res-edit"]')[1]!.trigger('click')
    await flushPromises()
    // 编辑时组 ID 跟着原规则，且锁死不可改（改组等于把规则搬到另一个组的权限里）
    const groupField = dialogField('group-res-rule-group-id')
    expect(groupField.value).toBe('100001')
    expect(groupField.disabled).toBe(true)
    expect(dialogField('group-res-rescond').value).toBe('430001300,430001301')
    await setValue(dialogField('group-res-rescond'), '1,2')
    await clickSave()

    expect(modify).toHaveBeenCalledWith({ id: 16, groupId: 100001, action: 'REJECT', resType: 'SOURCE', condType: 'ID', resCond: '1,2', remarks: '排除测试源' })
  })

  it('STRUCT 规则不开放编辑：条件由 condJson 编译，改了会覆盖后端结果', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    const wrapper = await mountAs(['admin'])
    await wrapper.get('[data-testid="group-res-query"]').trigger('click')
    await flushPromises()

    await wrapper.findAll('[data-testid="group-res-edit"]')[2]!.trigger('click')
    await flushPromises()

    expect(warning).toHaveBeenCalledWith(expect.stringContaining('暂不支持在此编辑'))
    expect(document.querySelector('.el-dialog')).toBeNull()
  })

  describe('删除', () => {
    it('二次确认后按 ids 删除，成功提示并刷新', async () => {
      const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
      const del = vi.spyOn(groupResApi, 'deleteGroupRes').mockResolvedValue({ ok: true, message: '删除数量:1', data: 1 })
      const success = vi.spyOn(ElMessage, 'success')
      const wrapper = await mountAs(['admin'])
      await wrapper.get('[data-testid="group-res-query"]').trigger('click')
      await flushPromises()
      const listCallsBefore = vi.mocked(groupResApi.pagedGroupRes).mock.calls.length

      await wrapper.findAll('[data-testid="group-res-delete"]')[0]!.trigger('click')
      await flushPromises()

      expect(confirm).toHaveBeenCalledWith('是否确认删除规则 [ 15 ] - 入选 数据源 ?', '提示', expect.objectContaining({ confirmButtonText: '删除' }))
      expect(del).toHaveBeenCalledWith([15])
      expect(success).toHaveBeenCalledWith('删除成功：删除数量:1')
      expect(vi.mocked(groupResApi.pagedGroupRes).mock.calls.length).toBe(listCallsBefore + 1)
    })

    it('取消确认：不发删除请求', async () => {
      vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
      const del = vi.spyOn(groupResApi, 'deleteGroupRes')
      const wrapper = await mountAs(['admin'])
      await wrapper.get('[data-testid="group-res-query"]').trigger('click')
      await flushPromises()

      await wrapper.findAll('[data-testid="group-res-delete"]')[0]!.trigger('click')
      await flushPromises()

      expect(del).not.toHaveBeenCalled()
    })
  })
})
