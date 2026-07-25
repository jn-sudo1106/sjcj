// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import EditParamSourceDialog from './EditParamSourceDialog.vue'
import { useFlowStore } from '../../../stores/flow'
import { sourceApi, paramApi, type Param, type Source } from '../../../api'

const param913: Param = { paramId: '913', name: '页码', kind: 'sequence', seq: { start: 1, end: 100, step: 1 }, usedBy: 0 }
const param912: Param = { paramId: '912', name: '栏目', kind: 'list', values: ['a', 'b', 'c'], usedBy: 0 }

function paramSourceFixture(): Source {
  return {
    sourceId: 's-param', name: '参数源测试', url: '', configId: '', mainTable: 'T1', owner: 'a', state: 'C',
    kind: 'param', baseUrl: 'http://base', urlTemplate: 'http://base-$PARAM$_913',
    paramRefs: [{ paramId: '913', group: null }],
  }
}

afterEach(() => vi.restoreAllMocks())

describe('EditParamSourceDialog（0721 会议 S4）', () => {
  it('打开时预填当前源的 baseUrl/urlTemplate/参数列表', async () => {
    vi.spyOn(paramApi, 'paramDetail').mockImplementation(async (id) => ({ 913: param913, 912: param912 }[id] ?? null))
    vi.spyOn(paramApi, 'genValues').mockResolvedValue(['1'])
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.loadFromSource(paramSourceFixture(), [])

    const wrapper = mount(EditParamSourceDialog, {
      props: { modelValue: true },
      global: { stubs: { 'el-drawer': { template: '<div><slot /><slot name="footer" /></div>' } } },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('$PARAM$_913')
    const template = wrapper.get<HTMLInputElement>('[data-testid="param-source-template"]')
    expect(template.element.value).toBe('http://base-$PARAM$_913')
  })

  it('保存：调用 sourceUpdate 落库，并把新模板同步回写首个采集节点', async () => {
    vi.spyOn(paramApi, 'paramDetail').mockImplementation(async (id) => ({ 913: param913, 912: param912 }[id] ?? null))
    vi.spyOn(paramApi, 'genValues').mockImplementation(async (id) => (id === '913' ? Array.from({ length: 100 }, (_, i) => String(i + 1)) : ['a', 'b', 'c']))
    vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({ total: 2, list: [param913, param912] })
    vi.spyOn(sourceApi, 'sourceUpdate').mockResolvedValue({ ok: true, message: '已保存' })

    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.loadFromSource(paramSourceFixture(), [])
    const firstId = flow.insertAfter('start', 'web')!
    expect(flow.configs[firstId].collectCfg?.url).toBe('http://base-$PARAM$_913')

    const wrapper = mount(EditParamSourceDialog, {
      props: { modelValue: true },
      global: { stubs: { 'el-drawer': { template: '<div><slot /><slot name="footer" /></div>' } } },
    })
    await flushPromises()

    // 加一个新参数，模板会自动带出第二个占位符
    await wrapper.get('[data-testid="param-source-pick"]').trigger('click')
    await flushPromises()
    const item = wrapper.findAll('.ssw-picker-item').find((el) => el.text().includes('$PARAM$_912'))!
    await item.trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="edit-param-source-save"]').trigger('click')
    await flushPromises()

    expect(sourceApi.sourceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 's-param',
      baseUrl: 'http://base',
      urlTemplate: 'http://base-$PARAM$_913-$PARAM$_912',
      paramRefs: [{ paramId: '913', group: null }, { paramId: '912', group: null }],
    }))
    expect(flow.sourceCfg?.urlTemplate).toBe('http://base-$PARAM$_913-$PARAM$_912')
    expect(flow.configs[firstId].collectCfg?.url).toBe('http://base-$PARAM$_913-$PARAM$_912')
    expect(flow.configs[firstId].collectCfg?.urlParamRefs).toEqual(['913', '912'])
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('未添加参数时提示并阻止保存', async () => {
    vi.spyOn(sourceApi, 'sourceUpdate').mockResolvedValue({ ok: true })
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.loadFromSource({ ...paramSourceFixture(), paramRefs: [] }, [])

    const wrapper = mount(EditParamSourceDialog, {
      props: { modelValue: true },
      global: { stubs: { 'el-drawer': { template: '<div><slot /><slot name="footer" /></div>' } } },
    })
    await flushPromises()
    await wrapper.get('[data-testid="edit-param-source-save"]').trigger('click')

    expect(sourceApi.sourceUpdate).not.toHaveBeenCalled()
  })
})
