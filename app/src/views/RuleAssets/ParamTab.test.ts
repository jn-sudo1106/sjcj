// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessageBox } from 'element-plus'
import ParamTab from './ParamTab.vue'
import { useAuthStore } from '../../stores/auth'
import { paramApi, type Param } from '../../api'

// D3（0717 参数方案）：read 角色隐藏参数页写操作，直接置 auth store state 模拟角色，不经登录接口
describe('ParamTab 角色权限', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  function mountTab() {
    wrapper = mount(ParamTab, { global: { plugins: [ElementPlus] } })
    return wrapper
  }

  // mock 适配层用真实 setTimeout 模拟延迟（client.ts delay(120)），flushPromises 不够，需真等待
  async function waitForLoad() {
    await flushPromises()
    await new Promise((r) => setTimeout(r, 200))
    await flushPromises()
  }

  it('admin 角色可见新建/编辑/复制/批量删除；"清除缓存"入口已下线（0721 会议 §六-2）', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    mountTab()
    await waitForLoad()

    expect(wrapper.text()).toContain('新建参数')
    expect(wrapper.text()).not.toContain('清除缓存')
    expect(wrapper.text()).toContain('批量删除')
    expect(wrapper.find('th input[type="checkbox"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('编辑')
    expect(wrapper.text()).toContain('复制')
  })

  it('read 角色隐藏写操作，仅保留详情', async () => {
    const auth = useAuthStore()
    auth.roles = ['read']
    mountTab()
    await waitForLoad()

    expect(wrapper.text()).not.toContain('新建参数')
    expect(wrapper.text()).not.toContain('批量删除')
    expect(wrapper.find('th input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('编辑')
    expect(wrapper.text()).not.toContain('复制')
    expect(wrapper.text()).toContain('详情')
  })

  it('批量删除成功后静默补一次 config/clear（0721 会议 §六-2：UI 去入口，写操作后自动清缓存）', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const deleteSpy = vi.spyOn(paramApi, 'deleteParams').mockResolvedValue({ ok: true })
    const clearSpy = vi.spyOn(paramApi, 'clearParams').mockResolvedValue({ ok: true })
    mountTab()
    await waitForLoad()

    await wrapper.get('th input[type="checkbox"]').setValue(true)
    await wrapper.get('.rc-btn.danger').trigger('click')
    await flushPromises()

    expect(deleteSpy).toHaveBeenCalled()
    expect(clearSpy).toHaveBeenCalledWith(deleteSpy.mock.calls[0][0])
  })

  it('admin 角色可见「绑定参数子源」列，且 mock 派生出的 paramSourceRefs 正常渲染', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({
      total: 1,
      list: [{
        paramId: '913', name: '页码', kind: 'sequence', seq: { start: 1, end: 100, step: 1 },
        paramSourceRefs: [{ sourceId: 'src-x', sourceName: '测试参数子源' }],
      } as Param],
    })
    mountTab()
    await waitForLoad()

    expect(wrapper.text()).toContain('绑定参数子源')
    expect(wrapper.text()).toContain('测试参数子源')
  })

  it('新建参数（onParamSaved）：保存后静默补一次 clearParams（0721 会议 §六-2）', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(paramApi, 'paramCreate').mockResolvedValue({
      ok: true,
      param: { paramId: 'p-new-1', name: '新参数', kind: 'list', values: [] } as Param,
    })
    const clearSpy = vi.spyOn(paramApi, 'clearParams').mockResolvedValue({ ok: true })
    mountTab()
    await waitForLoad()

    const drawer = wrapper.findComponent({ name: 'ParamEditorDrawer' })
    drawer.vm.$emit('saved', { paramId: 'p-new-1', name: '新参数', kind: 'list' } as Param)
    await flushPromises()

    expect(clearSpy).toHaveBeenCalledWith(['p-new-1'])
  })

  it('复制参数（onCopy）：复制成功后静默补一次 clearParams', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(paramApi, 'paramCopy').mockResolvedValue({ ok: true, message: '复制成功', param: { paramId: 'p-copy' } as Param })
    const clearSpy = vi.spyOn(paramApi, 'clearParams').mockResolvedValue({ ok: true })
    mountTab()
    await waitForLoad()

    const copyBtn = wrapper.findAll('button').find((b) => b.text() === '复制')!
    await copyBtn.trigger('click')
    await flushPromises()

    expect(clearSpy).toHaveBeenCalled()
  })

  it('list 类型新增参数值（onAddValues）：新增后清该参数缓存', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '北京\n上海' } as never)
    vi.spyOn(paramApi, 'addParamValues').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({
      total: 1,
      list: [{ paramId: 'p-list-1', name: '城市', kind: 'list', values: ['北京'] } as Param],
    })
    vi.spyOn(paramApi, 'paramDetail').mockResolvedValue({
      paramId: 'p-list-1', name: '城市', kind: 'list', values: ['北京', '上海'],
    } as Param)
    const clearSpy = vi.spyOn(paramApi, 'clearParams').mockResolvedValue({ ok: true })
    mountTab()
    await waitForLoad()

    const nameBtn = wrapper.findAll('button.pt-name').find((b) => b.text() === '城市')!
    await nameBtn.trigger('click')
    await flushPromises()

    // el-drawer append-to-body 会把内容 teleport 到 document.body，脱离 wrapper 的可查询范围，需单独用 DOMWrapper 找
    const addBtn = new DOMWrapper(document.body).findAll('button').find((b) => b.text() === '新增参数值')!
    await addBtn.trigger('click')
    await flushPromises()

    expect(clearSpy).toHaveBeenCalledWith(['p-list-1'])
  })

  it('list 类型删除参数值（onDeleteValue）：删除后清该参数缓存', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({
      total: 1,
      list: [{ paramId: 'p-list-1', name: '城市', kind: 'list', values: ['北京'] } as Param],
    })
    vi.spyOn(paramApi, 'paramDetail').mockResolvedValue({
      paramId: 'p-list-1', name: '城市', kind: 'list', values: ['北京'],
      valueItems: [{ valueId: 'v-1', seq: 1, value: '北京' }],
    } as Param)
    vi.spyOn(paramApi, 'deleteParamValue').mockResolvedValue({ ok: true, message: 'ok' })
    const clearSpy = vi.spyOn(paramApi, 'clearParams').mockResolvedValue({ ok: true })
    mountTab()
    await waitForLoad()

    const nameBtn = wrapper.findAll('button.pt-name').find((b) => b.text() === '城市')!
    await nameBtn.trigger('click')
    await flushPromises()

    const delBtn = new DOMWrapper(document.body).findAll('button').find((b) => b.text() === '删除')!
    await delBtn.trigger('click')
    await flushPromises()

    expect(clearSpy).toHaveBeenCalledWith(['p-list-1'])
  })
})
