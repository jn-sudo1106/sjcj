// 系统设置 → 节点类型（0924-05）
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import NodeTypeTab from './NodeTypeTab.vue'
import { configApi, type NodeType } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useDictStore } from '@/stores/dict'

const ROWS: NodeType[] = [
  { sourceType: '90', typeName: '网页抓取', downType: 'source-config', topic: '', seq: 0, notes: '', procType: '200', params: '' },
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
  })

  it('列出节点类型；管理员每行有详情 / 编辑 / 删除', async () => {
    const { wrapper } = await mountAs(['admin'])
    expect(wrapper.findAll('[data-testid="node-type-row"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('共 2 个节点类型')
    expect(wrapper.findAll('[data-testid="node-type-delete"]')).toHaveLength(2)
  })

  it('按名称查询把关键词传给接口', async () => {
    const { wrapper } = await mountAs(['admin'])
    await wrapper.get('input[data-testid="node-type-keyword"]').setValue('抓取')
    await wrapper.findAll('button').find((b) => b.text() === '查询')!.trigger('click')
    await flushPromises()
    expect(configApi.nodeTypeList).toHaveBeenLastCalledWith('抓取')
  })

  it('只读角色看不到新建 / 编辑 / 删除', async () => {
    const { wrapper } = await mountAs(['read'])
    expect(wrapper.find('[data-testid="node-type-create"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="node-type-edit"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="node-type-delete"]').exists()).toBe(false)
  })

  it('新建不填类型 ID 时不带 sourceType；成功后刷新列表和抓取类型字典', async () => {
    const add = vi.spyOn(configApi, 'nodeTypeAdd').mockResolvedValue({ ok: true, message: '新增成功, sourceType=801' })
    const { wrapper, reload } = await mountAs(['admin'])
    await wrapper.get('[data-testid="node-type-create"]').trigger('click')
    await flushPromises()

    await typeInto(dialogInputs()[1]!, '新类型') // 类型名称
    await clickSave()

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ typeName: '新类型', sourceType: undefined, downType: 'source-config' }))
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
