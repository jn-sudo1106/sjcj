// 系统设置 → 节点类型（0924-05）
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
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

  it('列出节点类型；没有删除按钮，并提示去旧平台删除', async () => {
    const { wrapper } = await mountAs(['admin'])
    expect(wrapper.findAll('[data-testid="node-type-row"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('共 2 个节点类型')
    expect(wrapper.text()).not.toContain('删除</')
    expect(wrapper.findAll('button').some((b) => b.text() === '删除')).toBe(false)
    expect(wrapper.text()).toContain('旧平台「配置 → 源类型」')
  })

  it('按名称查询把关键词传给接口', async () => {
    const { wrapper } = await mountAs(['admin'])
    await wrapper.get('input[data-testid="node-type-keyword"]').setValue('抓取')
    await wrapper.findAll('button').find((b) => b.text() === '查询')!.trigger('click')
    await flushPromises()
    expect(configApi.nodeTypeList).toHaveBeenLastCalledWith('抓取')
  })

  it('只读角色看不到新建 / 编辑', async () => {
    const { wrapper } = await mountAs(['read'])
    expect(wrapper.find('[data-testid="node-type-create"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="node-type-edit"]').exists()).toBe(false)
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
})
