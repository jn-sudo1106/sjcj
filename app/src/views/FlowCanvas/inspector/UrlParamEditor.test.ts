// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import { configApi, paramApi } from '@/api'
import UrlParamEditor from './UrlParamEditor.vue'

describe('UrlParamEditor', () => {
  it('参数配置作为独立 Tab 内容时默认展开', () => {
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
