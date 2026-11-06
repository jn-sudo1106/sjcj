// 系统设置 → 节点类型（0924-05）
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessage, ElMessageBox, ElSelect, ElOption } from 'element-plus'
import NodeTypeTab from './NodeTypeTab.vue'
import { configApi, type NodeType } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useDictStore } from '@/stores/dict'
import { nodePromptApi } from '@/api/nodePrompts'

const ROWS: NodeType[] = [
  { sourceType: '90', typeName: '网页抓取', typeGroup: '采集类', downType: 'source-config', topic: '', seq: 0, notes: '', procType: '200', params: '' },
  { sourceType: '160', typeName: 'Mail抓取', downType: 'source-config-mail', topic: '', seq: -1, notes: '', procType: '700', params: '' },
]

// 弹窗 append-to-body，不在组件树的 DOM 里，从 body 上找
function dialogEl(): HTMLElement {
  const el = [...document.querySelectorAll<HTMLElement>('.el-dialog')].find((d) => d.offsetParent !== null || d.style.display !== 'none')
  if (!el) throw new Error('dialog not open')
  return el
}
function dialogInputs(): HTMLInputElement[] {
  return [...dialogEl().querySelectorAll<HTMLInputElement>('input')]
}
async function typeInto(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}
async function clickSave() {
  dialogEl().querySelector<HTMLElement>('[data-testid="node-type-save"]')!.click()
  await flushPromises()
}

function groupSelect(wrapper: VueWrapper, testId: string) {
  const select = wrapper.findAllComponents(ElSelect).find((s) => s.attributes('data-testid') === testId)
  if (!select) throw new Error(`select not found: ${testId}`)
  return select
}

async function chooseGroup(wrapper: VueWrapper, testId: string, value: string) {
  groupSelect(wrapper, testId).vm.$emit('update:modelValue', value)
  await flushPromises()
}

async function mountAs(roles: string[]) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().roles = roles
  const reload = vi.spyOn(useDictStore(), 'loadSnatchTypes').mockResolvedValue()
  vi.spyOn(useDictStore(), 'loadNodeTypeTopics').mockResolvedValue()
  const wrapper = mount(NodeTypeTab, { global: { plugins: [pinia, ElementPlus] } })
  await flushPromises()
  return { wrapper, reload }
}

describe('节点类型页面', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.spyOn(configApi, 'nodeTypeList').mockResolvedValue(ROWS.map((r) => ({ ...r })))
    vi.spyOn(configApi, 'nodeTypeGroups').mockResolvedValue(['采集类', '规则类'])
  })
  it('提示词模板入口在节点类型抽屉中按当前类型加载', async () => {
    vi.stubEnv('VITE_FLOW_PROXY_TARGET', 'http://127.0.0.1:8090')
    const list = vi.spyOn(nodePromptApi, 'list').mockResolvedValue([])
    const { wrapper } = await mountAs(['admin'])
    await wrapper.findAll('[data-testid="node-type-prompts"]')[0]!.trigger('click'); await flushPromises()
    expect(list).toHaveBeenCalledWith({ sourceType: '90', templateUse: 'script' })
    expect(wrapper.findComponent({ name: 'NodePromptTemplates' }).text()).toContain('生成 Python 代码')
    wrapper.unmount()
    vi.unstubAllEnvs()
  })
  it('部署构建未配置独立流程后端也显示提示词模板入口，按需加载', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_FLOW_PROXY_TARGET', '')
    const list = vi.spyOn(nodePromptApi, 'list').mockResolvedValue([])
    const { wrapper } = await mountAs(['admin'])
    expect(wrapper.findAll('[data-testid="node-type-prompts"]')).toHaveLength(2)
    expect(list).not.toHaveBeenCalled()
    await wrapper.findAll('[data-testid="node-type-prompts"]')[0]!.trigger('click'); await flushPromises()
    expect(list).toHaveBeenCalledWith({ sourceType: '90', templateUse: 'script' })
    wrapper.unmount()
    vi.unstubAllEnvs()
  })

  it('列出节点类型；管理员每行有详情 / 编辑 / 删除', async () => {
    const { wrapper } = await mountAs(['admin'])
    expect(wrapper.findAll('[data-testid="node-type-row"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('共 2 个节点类型')
    expect(wrapper.text()).toContain('采集类')
    expect(wrapper.text()).toContain('未分组')
    expect(wrapper.findAll('[data-testid="node-type-delete"]')).toHaveLength(2)
  })

  it('按名称查询把关键词传给接口', async () => {
    const { wrapper } = await mountAs(['admin'])
    await wrapper.get('input[data-testid="node-type-keyword"]').setValue('抓取')
    await wrapper.findAll('button').find((b) => b.text() === '查询')!.trigger('click')
    await flushPromises()
    expect(configApi.nodeTypeList).toHaveBeenLastCalledWith('抓取', '')
  })

  it('名称和分组同时查询，重置清空两个条件', async () => {
    const { wrapper } = await mountAs(['admin'])
    await wrapper.get('input[data-testid="node-type-keyword"]').setValue('抓取')
    await chooseGroup(wrapper, 'node-type-group-filter', '采集类')
    await wrapper.findAll('button').find((b) => b.text() === '查询')!.trigger('click')
    await flushPromises()
    expect(configApi.nodeTypeList).toHaveBeenLastCalledWith('抓取', '采集类')
    await wrapper.findAll('button').find((b) => b.text() === '重置')!.trigger('click')
    await flushPromises()
    expect(configApi.nodeTypeList).toHaveBeenLastCalledWith('', '')
  })

  it('只读角色看不到新建 / 编辑 / 删除', async () => {
    const { wrapper } = await mountAs(['read'])
    expect(wrapper.find('[data-testid="node-type-create"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="node-type-edit"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="node-type-delete"]').exists()).toBe(false)
  })

  // 1030：配置队列只给旧「发配置」用，新建不再预填 source-config
  it('新建不填类型 ID 时不带 sourceType；成功后刷新列表和抓取类型字典', async () => {
    const add = vi.spyOn(configApi, 'nodeTypeAdd').mockResolvedValue({ ok: true, message: '新增成功, sourceType=801' })
    const { wrapper, reload } = await mountAs(['admin'])
    await wrapper.get('[data-testid="node-type-create"]').trigger('click')
    await flushPromises()

    await typeInto(dialogInputs()[1]!, '新类型') // 类型名称
    await chooseGroup(wrapper, 'node-type-group-edit', '规则类')
    await clickSave()

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ typeName: '新类型', typeGroup: '规则类', sourceType: undefined, downType: undefined }))
    expect(configApi.nodeTypeList).toHaveBeenCalledTimes(2)
    expect(reload).toHaveBeenCalled()
  })

  it('编辑只提交改动过的字段（后端增量更新）；没改动直接关掉不发请求', async () => {
    const update = vi.spyOn(configApi, 'nodeTypeUpdate').mockResolvedValue({ ok: true, message: '更新成功' })
    const { wrapper } = await mountAs(['admin'])

    await wrapper.findAll('[data-testid="node-type-edit"]')[1]!.trigger('click')
    await flushPromises()
    await clickSave()
    expect(update).not.toHaveBeenCalled()

    await wrapper.findAll('[data-testid="node-type-edit"]')[1]!.trigger('click')
    await flushPromises()
    expect(dialogInputs()[0]!.disabled).toBe(true) // 类型 ID 只读
    await typeInto(dialogInputs()[1]!, 'Mail 抓取')
    await clickSave()
    expect(update).toHaveBeenCalledWith('160', { typeName: 'Mail 抓取' })
  })

  it('类型名称为空不提交', async () => {
    const add = vi.spyOn(configApi, 'nodeTypeAdd')
    const { wrapper } = await mountAs(['admin'])
    await wrapper.get('[data-testid="node-type-create"]').trigger('click')
    await flushPromises()
    await clickSave()
    expect(add).not.toHaveBeenCalled()
  })

  // 2026-10-16：旧 `column.config` 的 `SOURCE_TYPE.other` 还有「处理类型」(procType) 与
  // 「参数(JSON)」(params) 两项，新端表单漏迁，这两条钉住它们已经接回来。
  // 表单 input 顺序（备注 / 参数是 textarea，不计入 inputs）：0 类型ID、1 类型名称、
  // 2 分组类型、3 配置队列、4 默认消息队列、5 排序、6 处理类型。
  it('新建：处理类型与参数(JSON) 一并提交', async () => {
    const add = vi.spyOn(configApi, 'nodeTypeAdd').mockResolvedValue({ ok: true, message: '新增成功' })
    const { wrapper } = await mountAs(['admin'])
    await wrapper.get('[data-testid="node-type-create"]').trigger('click')
    await flushPromises()

    await typeInto(dialogInputs()[1]!, '新类型')
    await typeInto(dialogEl().querySelector<HTMLInputElement>('input[data-testid="node-type-proc-edit"]')!, '200')
    const textareas = [...dialogEl().querySelectorAll<HTMLTextAreaElement>('textarea')]
    expect(textareas).toHaveLength(2) // 备注 + 参数(JSON)
    textareas[1]!.value = '{"a":1}'
    textareas[1]!.dispatchEvent(new Event('input'))
    await flushPromises()
    await clickSave()

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ typeName: '新类型', procType: '200', params: '{"a":1}' }),
    )
  })

  it('编辑：回填处理类型 / 参数，只改处理类型时按增量提交', async () => {
    const update = vi.spyOn(configApi, 'nodeTypeUpdate').mockResolvedValue({ ok: true, message: '更新成功' })
    const { wrapper } = await mountAs(['admin'])

    await wrapper.findAll('[data-testid="node-type-edit"]')[0]!.trigger('click')
    await flushPromises()

    const proc = dialogEl().querySelector<HTMLInputElement>('input[data-testid="node-type-proc-edit"]')!
    expect(proc.value).toBe('200') // ROWS[0].procType 回填
    await typeInto(proc, '210')
    await clickSave()

    expect(update).toHaveBeenCalledWith('90', { procType: '210' })
  })

  it('回显分组；清除只提交显式空串，不覆盖其他字段', async () => {
    const update = vi.spyOn(configApi, 'nodeTypeUpdate').mockResolvedValue({ ok: true })
    const { wrapper } = await mountAs(['admin'])
    await wrapper.findAll('[data-testid="node-type-edit"]')[0]!.trigger('click')
    await flushPromises()
    expect(groupSelect(wrapper, 'node-type-group-edit').props('modelValue')).toBe('采集类')
    await chooseGroup(wrapper, 'node-type-group-edit', '')
    await clickSave()
    expect(update).toHaveBeenCalledWith('90', { typeGroup: '' })
  })

  it('从配置刷新选项，新增和筛选共用选项且不能自由创建分组', async () => {
    const add = vi.spyOn(configApi, 'nodeTypeAdd').mockResolvedValue({ ok: true })
    const { wrapper } = await mountAs(['admin'])
    vi.mocked(configApi.nodeTypeGroups).mockResolvedValue(['处理类'])
    await wrapper.get('[data-testid="node-type-create"]').trigger('click')
    await flushPromises()
    const editor = groupSelect(wrapper, 'node-type-group-edit')
    const filter = groupSelect(wrapper, 'node-type-group-filter')
    expect(editor.props('allowCreate')).toBe(false)
    expect(editor.findAllComponents(ElOption).map((o) => o.props('value'))).toEqual(['处理类'])
    expect(filter.findAllComponents(ElOption).map((o) => o.props('value'))).toEqual(['处理类'])
    await typeInto(dialogInputs()[1]!, '新类型')
    await chooseGroup(wrapper, 'node-type-group-edit', '处理类')
    await clickSave()
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ typeGroup: '处理类' }))
  })

  it('移出选项的旧分组保留显示，修改其他字段不覆盖分类', async () => {
    vi.mocked(configApi.nodeTypeGroups).mockResolvedValue(['规则类'])
    const update = vi.spyOn(configApi, 'nodeTypeUpdate').mockResolvedValue({ ok: true })
    const { wrapper } = await mountAs(['admin'])
    await wrapper.findAll('[data-testid="node-type-edit"]')[0]!.trigger('click')
    await flushPromises()
    const old = groupSelect(wrapper, 'node-type-group-edit').findAllComponents(ElOption).find((o) => o.props('value') === '采集类')!
    expect(old.props('disabled')).toBe(true)
    await typeInto(dialogInputs()[1]!, '网页采集')
    await clickSave()
    expect(update).toHaveBeenCalledWith('90', { typeName: '网页采集' })
  })

  it('选项加载失败不丢列表或原分组，其他字段仍能保存', async () => {
    vi.mocked(configApi.nodeTypeGroups).mockRejectedValue(new Error('配置格式错误'))
    const update = vi.spyOn(configApi, 'nodeTypeUpdate').mockResolvedValue({ ok: true })
    const { wrapper } = await mountAs(['admin'])
    expect(wrapper.findAll('[data-testid="node-type-row"]')).toHaveLength(2)
    await wrapper.findAll('[data-testid="node-type-edit"]')[0]!.trigger('click')
    await flushPromises()
    expect(groupSelect(wrapper, 'node-type-group-edit').props('disabled')).toBe(true)
    await typeInto(dialogInputs()[1]!, '网页采集')
    await clickSave()
    expect(update).toHaveBeenCalledWith('90', { typeName: '网页采集' })
  })

  describe('删除（2026-10-14）', () => {
    it('二次确认文案同旧平台；确认后删除，成功提示并刷新列表和抓取类型字典', async () => {
      const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
      const del = vi.spyOn(configApi, 'nodeTypeDelete').mockResolvedValue({ ok: true, message: '删除成功' })
      const success = vi.spyOn(ElMessage, 'success')
      const { wrapper, reload } = await mountAs(['admin'])

      await wrapper.findAll('[data-testid="node-type-delete"]')[1]!.trigger('click')
      await flushPromises()

      expect(confirm).toHaveBeenCalledWith('是否确认删除源类型 [ 160 ] - Mail抓取 ?', '提示', expect.objectContaining({ confirmButtonText: '删除' }))
      expect(del).toHaveBeenCalledWith('160')
      expect(success).toHaveBeenCalledWith('删除成功：删除成功')
      expect(configApi.nodeTypeList).toHaveBeenCalledTimes(2)
      expect(reload).toHaveBeenCalled()
    })

    it('取消确认：不调删除接口，也不刷新', async () => {
      vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
      const del = vi.spyOn(configApi, 'nodeTypeDelete')
      const { wrapper } = await mountAs(['admin'])

      await wrapper.findAll('[data-testid="node-type-delete"]')[0]!.trigger('click')
      await flushPromises()

      expect(del).not.toHaveBeenCalled()
      expect(configApi.nodeTypeList).toHaveBeenCalledTimes(1)
    })

    it('被配置引用时后端拒绝：原样提示后端原因，列表照旧刷新（旧平台同口径）', async () => {
      vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
      vi.spyOn(configApi, 'nodeTypeDelete').mockRejectedValue(new Error('该源类型已被配置引用，无法删除'))
      const error = vi.spyOn(ElMessage, 'error')
      const { wrapper } = await mountAs(['admin'])

      await wrapper.findAll('[data-testid="node-type-delete"]')[0]!.trigger('click')
      await flushPromises()

      expect(error).toHaveBeenCalledWith('删除失败：该源类型已被配置引用，无法删除')
      expect(configApi.nodeTypeList).toHaveBeenCalledTimes(2)
    })
  })
})
