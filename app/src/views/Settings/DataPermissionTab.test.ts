// 系统设置 → 数据权限设置（组级数据权限规则）列表页接线回归。
// 重点钉四件容易回退的事：groupId 必填且 >90000、枚举取自 meta、保存前强制试算、删除走 ids query。
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'

// 弹窗里的 CondValueInput 会拉起 @/api 聚合桶与目录搜索；本测试只关心规则 CRUD 接线，部分 mock 隔离
vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, sourceApi: {
      // 单层返回、children 留空：贴合真实 categoryPaged 契约（一次只给一层，判叶靠 children===undefined）
      sourceCategories: vi.fn(async (parentId?: string) => {
        if (!parentId) return [{ id: '9009001', name: '企信平台', count: 5 }, { id: '9009003', name: '系统设置', count: 2 }]
        if (parentId === '9009001') return [{ id: '9009002', name: '微信平台', count: 3 }]
        return []
      }),
      categoryById: vi.fn(async (id: string) => ({ id, name: `目录${id}`, parentId: '', count: 0 })),
      sourcePaged: vi.fn(async () => ({ total: 0, list: [] })),
    }, siteApi: {}, configApi: {}, entryApi: {} }
})
vi.mock('@/api/sourceDirs', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, searchDirs: vi.fn(async () => []) }
})
vi.mock('@/api/sysUser', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, pagedSysUser: vi.fn(async () => ({ total: 0, list: [] })) }
})

import DataPermissionTab from './DataPermissionTab.vue'
import GroupResEditDialog from './GroupResEditDialog.vue'
import StructCondEditor from './groupRes/StructCondEditor.vue'
import CondValueInput from './groupRes/CondValueInput.vue'
import * as groupResApi from '@/api/groupRes'
import * as groupSourceScope from '@/api/groupSourceScope'
import { pagedSysUser } from '@/api/sysUser'
import { useAuthStore } from '@/stores/auth'
import type { GroupResMeta, GroupResRule } from '@/api/groupRes'

// el-table 在 jsdom 里要量宽
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

const SOURCE_FIELDS = [
  { field: 'SOURCE_ID', name: '数据源ID', type: 'num', ops: ['IN', '=', '>'], valueFrom: 'sourcePicker' },
  { field: 'CATEGORY_ID', name: '所属目录', type: 'num', ops: ['IN', '='], valueFrom: 'categoryTree' },
  { field: 'TAGS', name: '标签', type: 'str', ops: ['LIKE'], valueFrom: 'text' },
]

const META: GroupResMeta = {
  resTypes: [
    { key: 'SOURCE', name: '数据源', baseTable: 'cs_source', idColumn: 'SOURCE_ID', fields: SOURCE_FIELDS },
    { key: 'CATEGORY', name: '目录', baseTable: 'cfg_category', idColumn: 'CATEGORY_ID', fields: SOURCE_FIELDS },
  ],
  actions: [{ key: 'ACCEPT', name: '入选' }, { key: 'REJECT', name: '排除' }],
  condTypes: [{ key: 'ID', name: 'ID列表' }, { key: 'STRUCT', name: '结构化条件' }, { key: 'SQL', name: 'SQL条件' }],
}

const ROWS: GroupResRule[] = [
  { id: 15, groupId: 100001, action: 'ACCEPT', resType: 'SOURCE', condType: 'SQL', resCond: 'CATEGORY_ID IN (9009387,9009388)', condJson: null, remarks: '研发一组可见的源', isDelete: 0 },
  { id: 16, groupId: 100001, action: 'REJECT', resType: 'SOURCE', condType: 'ID', resCond: '430001300,430001301', condJson: null, remarks: '排除测试源', isDelete: 0 },
  { id: 17, groupId: 100001, action: 'ACCEPT', resType: 'CATEGORY', condType: 'STRUCT', resCond: 'CATEGORY_ID IN (9009387)', condJson: '[{"field":"CATEGORY_ID","op":"IN","values":["9009387"]}]', remarks: null, isDelete: 0 },
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
    // 挂载时 /group-res/list 被查两次：右侧规则列表第一页（不带 groupId）+ 左侧选中组的源数据权限读取。
    const listCalls = vi.mocked(groupResApi.pagedGroupRes).mock.calls.map((c) => c[0])
    expect(listCalls).toContainEqual({ resType: '', action: '', page: 1, limit: 20 })
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

    it('STRUCT 条件行不完整时前端就拦下（对齐后端"第 N 项"口径），不发试算也不发保存', async () => {
      const preview = vi.spyOn(groupResApi, 'previewGroupRes')
      const add = vi.spyOn(groupResApi, 'addGroupRes')
      const warning = vi.spyOn(ElMessage, 'warning')
      const wrapper = await mountAs(['admin'])
      await wrapper.get('[data-testid="group-res-query"]').trigger('click')
      await flushPromises()

      await wrapper.get('[data-testid="group-res-create"]').trigger('click')
      await flushPromises()
      await setValue(dialogField('group-res-rule-group-id'), '100001')
      // condType 单选组过滤掉 SQL，只剩 ID / STRUCT（D2② SQL 档已下线）
      dialogEl().querySelectorAll<HTMLInputElement>('[data-testid="group-res-condtype"] input')[1]!.click()
      await flushPromises()
      // 没加条件行 → 拦
      await clickSave()
      expect(warning).toHaveBeenCalledWith('请至少添加一个条件')

      // 加一行但值留空 → 仍拦
      dialogEl().querySelector<HTMLElement>('[data-testid="struct-cond-add"]')!.click()
      await flushPromises()
      await clickSave()
      expect(warning).toHaveBeenLastCalledWith('第 1 项的字段 SOURCE_ID 的值不能为空')
      expect(preview).not.toHaveBeenCalled()
      expect(add).not.toHaveBeenCalled()
    })

    it('STRUCT 新建（直挂弹窗）：填条件行后 preview 带 condJson、add 的 resCond 为空串（后端编译）', async () => {
      const preview = vi.spyOn(groupResApi, 'previewGroupRes').mockResolvedValue({ compiledCond: 'CATEGORY_ID IN (9009250)', condType: 'STRUCT', count: 12, sample: [1], error: null })
      const add = vi.spyOn(groupResApi, 'addGroupRes').mockResolvedValue({ ok: true, message: '新增成功', data: 19 })
      const pinia = createPinia()
      setActivePinia(pinia)
      const wrapper = mount(GroupResEditDialog, { props: { meta: META }, global: { plugins: [pinia, ElementPlus] } })
      wrapper.vm.open()
      await flushPromises()
      await setValue(dialogField('group-res-rule-group-id'), '100002')
      dialogEl().querySelectorAll<HTMLInputElement>('[data-testid="group-res-condtype"] input')[1]!.click()
      await flushPromises()

      dialogEl().querySelector<HTMLElement>('[data-testid="struct-cond-add"]')!.click()
      await flushPromises()
      // script-setup 组件实例默认闭合，编辑器行数据经其 vm 事件回填（等价于用户在下拉里选字段+填值）
      const editor = wrapper.findComponent(StructCondEditor)
      editor.vm.$emit('update:modelValue', [{ field: 'CATEGORY_ID', op: 'IN', values: ['9009250'] }])
      await flushPromises()
      await clickSave()

      const condJson = '[{"field":"CATEGORY_ID","op":"IN","values":["9009250"]}]'
      expect(preview).toHaveBeenCalledWith({ resType: 'SOURCE', condType: 'STRUCT', resCond: '', condJson })
      expect(add).toHaveBeenCalledWith({ groupId: 100002, action: 'ACCEPT', resType: 'SOURCE', condType: 'STRUCT', resCond: '', condJson, remarks: undefined })
    })
  })

  it('编辑 STRUCT 规则（直挂弹窗）：condJson 回显进条件行，保存仍走 modify + condJson', async () => {
    const preview = vi.spyOn(groupResApi, 'previewGroupRes').mockResolvedValue({ compiledCond: 'CATEGORY_ID IN (9009387)', condType: 'STRUCT', count: 3, sample: [], error: null })
    const modify = vi.spyOn(groupResApi, 'modifyGroupRes').mockResolvedValue({ ...ROWS[2]! })
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(GroupResEditDialog, { props: { meta: META }, global: { plugins: [pinia, ElementPlus] } })
    wrapper.vm.open({ ...ROWS[2]! })
    await flushPromises()

    const editor = wrapper.findComponent(StructCondEditor)
    expect(editor.props('modelValue')).toEqual([{ field: 'CATEGORY_ID', op: 'IN', values: ['9009387'] }])
    await clickSave()

    expect(modify).toHaveBeenCalledWith({
      id: 17, groupId: 100001, action: 'ACCEPT', resType: 'CATEGORY', condType: 'STRUCT',
      resCond: '', condJson: '[{"field":"CATEGORY_ID","op":"IN","values":["9009387"]}]', remarks: undefined,
    })
    expect(preview).toHaveBeenCalled()
  })

  it('ID 模式辅助选择器（直挂弹窗）：手输 ID 保留，选择结果合并去重后回填 resCond', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(GroupResEditDialog, { props: { meta: META }, global: { plugins: [pinia, ElementPlus] } })
    wrapper.vm.open()
    await flushPromises()
    await setValue(dialogField('group-res-rescond'), '430001300')

    dialogEl().querySelector<HTMLElement>('[data-testid="group-res-id-pick"]')!.click()
    await flushPromises()
    // 弹层里的值控件按 idColumn（SOURCE_ID → sourcePicker）分发；模拟选中两个 ID（含已手输的那个）
    const picker = wrapper.findComponent(CondValueInput)
    picker.vm.$emit('update:modelValue', ['430001300', '430001301'])
    await flushPromises()
    // el-popover 内容默认 teleport 到 body，不在 dialog 子树里
    document.querySelector<HTMLElement>('[data-testid="group-res-id-pick-confirm"]')!.click()
    await flushPromises()

    expect(dialogField('group-res-rescond').value).toBe('430001300,430001301')
  })

  it('idColumn 不在字段白名单时（如 PARAM 的 PARAM_ID）不渲染选择按钮，只留手输', async () => {
    const metaNoIdField: GroupResMeta = {
      ...META,
      resTypes: [{ key: 'PARAM', name: '参数', baseTable: 'cfg_param', idColumn: 'PARAM_ID', fields: [{ field: 'PARAM_NAME', name: '参数名称', type: 'str', ops: ['='], valueFrom: 'text' }] }],
    }
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(GroupResEditDialog, { props: { meta: metaNoIdField }, global: { plugins: [pinia, ElementPlus] } })
    wrapper.vm.open()
    await flushPromises()

    expect(dialogField('group-res-rescond')).toBeTruthy()
    expect(dialogEl().querySelector('[data-testid="group-res-id-pick"]')).toBeNull()
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

  it('STRUCT 规则可编辑：点编辑打开弹窗并回显条件行（不再拒绝）', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    const wrapper = await mountAs(['admin'])
    await wrapper.get('[data-testid="group-res-query"]').trigger('click')
    await flushPromises()

    await wrapper.findAll('[data-testid="group-res-edit"]')[2]!.trigger('click')
    await flushPromises()

    expect(warning).not.toHaveBeenCalled()
    expect(dialogEl().querySelector('[data-testid="struct-cond-editor"]')).not.toBeNull()
    expect(dialogEl().textContent).toContain('9009387')
  })

  it('SQL 存量规则不开放编辑（D2② 已下线）：提示改为新建替代', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    const wrapper = await mountAs(['admin'])
    await wrapper.get('[data-testid="group-res-query"]').trigger('click')
    await flushPromises()

    await wrapper.findAll('[data-testid="group-res-edit"]')[0]!.trigger('click')
    await flushPromises()

    expect(warning).toHaveBeenCalledWith(expect.stringContaining('已停止编辑'))
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
  describe('左右分栏交互：左侧用户组分页与右侧源信息树', () => {
    it('左侧渲染用户组表格，展示名称与编码，有分页范围文本', async () => {
      const wrapper = await mountAs(['admin'], '')
      const tableText = wrapper.find('.dp-left-table-wrap').text()
      expect(tableText).toContain('超级管理员')
      expect(tableText).toContain('90001')
      expect(wrapper.find('.dp-left-pager-custom').exists()).toBe(true)
      expect(wrapper.find('.dp-pager-range').text()).toContain('总计')
    })

    it('左侧搜索框按名称或编码过滤用户组', async () => {
      const wrapper = await mountAs(['admin'], '')
      const searchInput = wrapper.find('.dp-group-search-input input')
      expect(searchInput.exists()).toBe(true)
      await searchInput.setValue('分析师')
      await flushPromises()
      const tableText = wrapper.find('.dp-left-table-wrap').text()
      expect(tableText).toContain('分析师')
      expect(tableText).not.toContain('超级管理员')
    })

    it('左侧用户组来自用户表：组名取该组第一个非空 user_name，distinct GROUP_ID 进列表（仅排除 null）', async () => {
      const user = (userId: number, userName: string, groupId: number | null) => ({
        userId, userLoginName: `u${userId}`, userName, userStatus: 0, groupId,
        roleIds: null, roleNames: null, creator: null, createTime: null, modifier: null, updateTime: null, protectedAccount: false,
      })
      // 90004 两人 → 取第一个非空「张三」；1 是小 ID 也要进；null 不进
      vi.mocked(pagedSysUser).mockResolvedValueOnce({ total: 5, list: [
        user(1, '张三', 90004), user(2, '李四', 90004), user(3, '王五', 90006), user(4, '小名', 1), user(5, '无组', null),
      ] })
      const wrapper = await mountAs(['admin'], '')
      const tableText = wrapper.find('.dp-left-table-wrap').text()
      expect(tableText).toContain('张三')     // 90004 组名 = 第一个成员 user_name
      expect(tableText).toContain('王五')
      expect(tableText).toContain('小名')     // 小 ID 1 也显示（不再被 >90000 过滤）
      expect(tableText).not.toContain('李四') // 同组第二个不覆盖
      expect(tableText).not.toContain('无组') // null 组不进
    })

    it('选中用户组会读取其源数据权限（getGroupSourceScope）', async () => {
      const getScope = vi.spyOn(groupSourceScope, 'getGroupSourceScope').mockResolvedValue({
        accept: { dirIds: [], sourceIds: [] }, reject: { dirIds: [], sourceIds: [] },
      })
      await mountAs(['admin'], '')
      expect(getScope).toHaveBeenCalledWith(90001)
    })

    it('保存权限：确认摘要后走 saveGroupSourceScope 落库', async () => {
      vi.spyOn(groupSourceScope, 'getGroupSourceScope').mockResolvedValue({
        accept: { dirIds: ['9009001'], sourceIds: ['501'] }, reject: { dirIds: [], sourceIds: [] },
      })
      const saveScope = vi.spyOn(groupSourceScope, 'saveGroupSourceScope').mockResolvedValue(undefined)
      vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
      const success = vi.spyOn(ElMessage, 'success')

      const wrapper = await mountAs(['admin'], '')
      await flushPromises()
      await wrapper.find('[data-testid="group-res-save"]').trigger('click')
      await flushPromises()

      expect(saveScope).toHaveBeenCalledWith(90001, expect.objectContaining({
        accept: { dirIds: ['9009001'], sourceIds: ['501'] },
      }))
      expect(success).toHaveBeenCalledWith(expect.stringContaining('保存成功'))
    })

    it('取消确认摘要：不落库', async () => {
      vi.spyOn(groupSourceScope, 'getGroupSourceScope').mockResolvedValue({
        accept: { dirIds: [], sourceIds: [] }, reject: { dirIds: [], sourceIds: [] },
      })
      const saveScope = vi.spyOn(groupSourceScope, 'saveGroupSourceScope')
      vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')

      const wrapper = await mountAs(['admin'], '')
      await wrapper.find('[data-testid="group-res-save"]').trigger('click')
      await flushPromises()
      expect(saveScope).not.toHaveBeenCalled()
    })
  })
})
