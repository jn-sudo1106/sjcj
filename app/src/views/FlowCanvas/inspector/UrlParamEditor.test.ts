// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import { configApi, paramApi } from '@/api'
import UrlParamEditor from './UrlParamEditor.vue'

describe('UrlParamEditor', () => {
  it('任务配置中的参数编辑区默认展开', () => {
    const wrapper = mount(UrlParamEditor, {
      props: {
        url: 'https://example.com/notice?lang=zh',
        paramValues: {},
      },
      global: { stubs: { 'el-drawer': { template: '<div><slot /><slot name="footer" /></div>' } } },
    })

    expect(wrapper.find('.upe-body').exists()).toBe(true)
    expect(wrapper.text()).toContain('暂无参数配置')
  })

  it('URL 参数写在 # 片段里不再提示改用浏览器抓取（1126：网页抓取 [90] 实际按浏览器执行）', () => {
    const wrapper = mount(UrlParamEditor, {
      props: { url: 'https://basic.10jqka.com.cn/600519/event.html#code=$PARAM$_791000', paramRefs: [], paramValues: {} },
      global: { stubs: { 'el-drawer': { template: '<div><slot /><slot name="footer" /></div>' } } },
    })
    expect(wrapper.text()).not.toContain('片段')
  })

  it('已绑定参数会直接显示在展开内容中', () => {
    const wrapper = mount(UrlParamEditor, {
      props: {
        url: 'https://example.com/notice',
        paramRefs: ['1035', '1036'],
        paramValues: {},
      },
      global: { stubs: { 'el-drawer': { template: '<div><slot /><slot name="footer" /></div>' } } },
    })

    expect(wrapper.findAll('.upe-row')).toHaveLength(2)
  })


  describe('代入后的 URL 预览（1123）', () => {
    afterEach(() => { vi.restoreAllMocks() })
    const stubs = { 'el-drawer': { template: '<div><slot /></div>' } }
    const setup = (values: Record<string, string[]>, defaults: Record<string, string> = {}) => {
      vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({ total: 0, list: [] })
      vi.spyOn(paramApi, 'paramDetail').mockImplementation(async (id: string) => ({ paramId: id, name: id === '1035' ? 'A股-股票ID' : '日期', kind: 'database', defaultValue: defaults[id] ?? '' }) as never)
      vi.spyOn(paramApi, 'genValues').mockImplementation(async (id: string) => values[id] ?? [])
    }
    const url = 'https://basic.10jqka.com.cn/{x}?code=$PARAM$_1035&d=$PARAM$_1036'

    it('没选当前源取值：每个生成值一条 URL，多个参数笛卡尔积，超过 3 条给总数', async () => {
      setup({ '1035': ['600519', '000858'], '1036': ['2026', '2025'] })
      const w = mount(UrlParamEditor, { props: { url, paramRefs: ['1035', '1036'], paramValues: {} }, global: { stubs } })
      await flushPromises()
      const box = w.get('[data-testid="url-param-preview"]')
      expect(box.findAll('.upe-preview-url').map((n) => n.text())).toEqual([
        'https://basic.10jqka.com.cn/{x}?code=600519&d=2026',
        'https://basic.10jqka.com.cn/{x}?code=600519&d=2025',
        'https://basic.10jqka.com.cn/{x}?code=000858&d=2026',
      ])
      expect(box.text()).toContain('共 4 条 URL，仅显示前 3 条')
    })

    it('选了当前源取值只用这一个值；都没有时退到默认值', async () => {
      setup({ '1035': ['600519', '000858'], '1036': [] }, { '1036': '2024' })
      const w = mount(UrlParamEditor, { props: { url, paramRefs: ['1035', '1036'], paramValues: { '1035': '000858' } }, global: { stubs } })
      await flushPromises()
      expect(w.findAll('.upe-preview-url').map((n) => n.text())).toEqual(['https://basic.10jqka.com.cn/{x}?code=000858&d=2024'])
    })

    it('参数没有任何可用取值：说明 URL 里这个位置会是空的，不给带空洞的 URL', async () => {
      setup({ '1035': [], '1036': ['2026'] })
      const w = mount(UrlParamEditor, { props: { url, paramRefs: ['1035', '1036'], paramValues: {} }, global: { stubs } })
      await flushPromises()
      expect(w.get('[data-testid="url-param-preview-missing"]').text()).toContain('A股-股票ID（1035） 没有可用取值')
      expect(w.findAll('.upe-preview-url')).toHaveLength(0)
    })

    it('绑了参数但 URL 里没有占位：明说不会代入 URL', async () => {
      setup({ '1035': ['600519'] })
      const w = mount(UrlParamEditor, { props: { url: 'https://example.com/list', paramRefs: ['1035'], paramValues: {} }, global: { stubs } })
      await flushPromises()
      expect(w.get('[data-testid="url-param-preview-notoken"]').text()).toContain('已绑定的参数不会代入 URL')
    })
  })

  describe('列表里有、配置上没绑定的参数（1126 源 491000036）', () => {
    afterEach(() => { vi.restoreAllMocks() })
    const stubs = { 'el-drawer': { template: '<div><slot /></div>' } }
    const url = 'https://basic.10jqka.com.cn/600519/event.html#code=$PARAM$_791000'
    const setup = () => {
      vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({ total: 0, list: [] })
      vi.spyOn(paramApi, 'paramDetail').mockResolvedValue({ paramId: '791000', name: 'A股-股票ID', kind: 'database' } as never)
      vi.spyOn(paramApi, 'genValues').mockResolvedValue(['600519', '000001'])
    }
    const mountIt = () => mount(UrlParamEditor, { props: { url, configId: '1910082', paramRefs: ['791000'], paramValues: {} }, global: { stubs } })

    it('URL 自动带进来的参数：标「未绑定到配置」、提示发抓取不带值、预览不给假的代入结果', async () => {
      setup()
      vi.spyOn(configApi, 'configParams').mockResolvedValue({ total: 0, list: [] })
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-testid="url-param-not-on-config"]').exists()).toBe(true)
      expect(w.get('[data-testid="url-param-unbound"]').text()).toContain('791000 尚未绑定到配置 #1910082，发起抓取时不会带参数值')
      expect(w.get('[data-testid="url-param-preview-notbound"]').text()).toContain('A股-股票ID（791000） 还没绑定到配置')
      expect(w.findAll('.upe-preview-url')).toHaveLength(0)
    })

    it('点「绑定到配置」真写 configParamAdd，绑上后标记消失、预览出代入结果，列表不重复', async () => {
      setup()
      const params = vi.spyOn(configApi, 'configParams')
        .mockResolvedValueOnce({ total: 0, list: [] })
        .mockResolvedValue({ total: 1, list: [{ id: '45325', paramId: '791000', paramName: 'A股-股票ID', valueShow: '600519' }] })
      const bind = vi.spyOn(configApi, 'bindParam').mockResolvedValue({ ok: true } as never)
      const w = mountIt()
      await flushPromises()
      await w.get('[data-testid="url-param-bind-config"]').trigger('click')
      await flushPromises()
      expect(bind).toHaveBeenCalledWith('1910082', '791000')
      expect(params).toHaveBeenCalledTimes(2)
      expect(w.find('[data-testid="url-param-not-on-config"]').exists()).toBe(false)
      expect(w.find('[data-testid="url-param-unbound"]').exists()).toBe(false)
      expect(w.findAll('.upe-preview-url').map((n) => n.text())).toEqual([
        'https://basic.10jqka.com.cn/600519/event.html#code=600519',
        'https://basic.10jqka.com.cn/600519/event.html#code=000001',
      ])
      expect(w.emitted('update:paramRefs')).toBeUndefined()
    })

    it('读绑定失败时不下结论：不把参数标成未绑定', async () => {
      setup()
      vi.spyOn(configApi, 'configParams').mockRejectedValue(new Error('网络异常'))
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-testid="url-param-not-on-config"]').exists()).toBe(false)
      expect(w.find('[data-testid="url-param-unbound"]').exists()).toBe(false)
    })

    it('新建参数保存后也真正绑到配置上', async () => {
      setup()
      vi.spyOn(configApi, 'configParams').mockResolvedValue({ total: 0, list: [] })
      const bind = vi.spyOn(configApi, 'bindParam').mockResolvedValue({ ok: true } as never)
      const w = mount(UrlParamEditor, { props: { url: 'https://example.com', configId: '1910082', paramRefs: [], paramValues: {} }, global: { stubs } })
      await flushPromises()
      w.findComponent({ name: 'ParamEditorDrawer' }).vm.$emit('saved', { paramId: '800001', name: '新参数', kind: 'list' })
      await flushPromises()
      expect(bind).toHaveBeenCalledWith('1910082', '800001')
      expect(w.emitted('update:paramRefs')!.at(-1)![0]).toEqual(['800001'])
    })
  })

  // 2026-08-26 拍板放开生产写（config/configParamAdd|Del 进白名单）：绑定/解绑必须真写后端。
  // 此前解绑只改内存，刷新后配置里的绑定又被读回来，等于按钮没生效。
  describe('绑定/解绑接真实接口（有 configId 时）', () => {
    afterEach(() => { vi.restoreAllMocks() })

    const mountWithConfig = (paramRefs: string[]) => mount(UrlParamEditor, {
      props: { url: 'https://example.com', configId: '1400774', paramRefs, paramValues: { '730008': 'aaaa' } },
      global: { stubs: { 'el-drawer': { template: '<div><slot /></div>' } } },
    })

    it('解绑：确认后调 configParamDel，成功才把该参数从界面移除', async () => {
      vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({ total: 0, list: [] })
      vi.spyOn(paramApi, 'paramDetail').mockResolvedValue({ paramId: '730008', name: 'baidu-密码' } as never)
      vi.spyOn(paramApi, 'genValues').mockResolvedValue(['aaaa'])
      vi.spyOn(configApi, 'configParams').mockResolvedValue({ total: 1, list: [{ id: '56', paramId: '730008', paramName: 'baidu-密码', valueShow: 'aaaa' }] })
      const del = vi.spyOn(configApi, 'unbindParam').mockResolvedValue({ ok: true, message: '已解绑' })
      vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)

      const wrapper = mountWithConfig(['730008'])
      await flushPromises()
      await wrapper.get('.upe-link.danger').trigger('click')
      await flushPromises()

      expect(del).toHaveBeenCalledWith('56')
      expect(wrapper.emitted('update:paramRefs')!.at(-1)![0]).toEqual([])
    })

    it('解绑：后端失败时不改界面，绑定仍在', async () => {
      vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({ total: 0, list: [] })
      vi.spyOn(paramApi, 'paramDetail').mockResolvedValue({ paramId: '730008', name: 'baidu-密码' } as never)
      vi.spyOn(paramApi, 'genValues').mockResolvedValue(['aaaa'])
      vi.spyOn(configApi, 'configParams').mockResolvedValue({ total: 1, list: [{ id: '56', paramId: '730008', paramName: 'baidu-密码', valueShow: 'aaaa' }] })
      vi.spyOn(configApi, 'unbindParam').mockRejectedValue(new Error('生产环境写保护'))
      vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)

      const wrapper = mountWithConfig(['730008'])
      await flushPromises()
      await wrapper.get('.upe-link.danger').trigger('click')
      await flushPromises()

      expect(wrapper.emitted('update:paramRefs')).toBeUndefined()
    })

    it('解绑：取消二次确认时既不调接口也不改界面', async () => {
      vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({ total: 0, list: [] })
      vi.spyOn(paramApi, 'paramDetail').mockResolvedValue({ paramId: '730008', name: 'baidu-密码' } as never)
      vi.spyOn(paramApi, 'genValues').mockResolvedValue(['aaaa'])
      vi.spyOn(configApi, 'configParams').mockResolvedValue({ total: 1, list: [{ id: '56', paramId: '730008', paramName: 'baidu-密码', valueShow: 'aaaa' }] })
      const del = vi.spyOn(configApi, 'unbindParam')
      vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')

      const wrapper = mountWithConfig(['730008'])
      await flushPromises()
      await wrapper.get('.upe-link.danger').trigger('click')
      await flushPromises()

      expect(del).not.toHaveBeenCalled()
      expect(wrapper.emitted('update:paramRefs')).toBeUndefined()
    })

    it('绑定：调 configParamAdd，失败则不加到界面上', async () => {
      vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({ total: 1, list: [{ paramId: '730003', name: '日期' } as never] })
      vi.spyOn(configApi, 'configParams').mockResolvedValue({ total: 0, list: [] })
      const add = vi.spyOn(configApi, 'bindParam').mockRejectedValue(new Error('生产环境写保护'))

      const wrapper = mountWithConfig([])
      await flushPromises()
      await wrapper.get('select.upe-picker').setValue('730003')
      await wrapper.findAll('.upe-actions button')[0].trigger('click')
      await flushPromises()

      expect(add).toHaveBeenCalledWith('1400774', '730003')
      expect(wrapper.emitted('update:paramRefs')).toBeUndefined()
    })
  })
})
