// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import SourceCronDialog from './SourceCronDialog.vue'
import * as monitorApi from '../../../api/monitor'
import { sourceApi } from '@/api'

// 「定时」弹窗（迁移旧 SourceCron.vue 的 ids === '-1' 形态）
describe('SourceCronDialog · 定时弹窗', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  function mountDialog(cron?: string) {
    vi.spyOn(monitorApi, 'checkCron').mockResolvedValue(['2026-10-13 06:00:00', '2026-10-13 07:00:00'])
    wrapper = mount(SourceCronDialog, {
      attachTo: document.body,
      props: { modelValue: false, cron },
      global: { plugins: [ElementPlus] },
    })
    return wrapper
  }

  const cronInput = () => document.body.querySelector('.scd-cron input') as HTMLInputElement

  it('打开时回填表达式并自动预览最近运行时间', async () => {
    const w = mountDialog('0 0 6-22 * * ?')
    await w.setProps({ modelValue: true })
    await flushPromises()

    expect(cronInput().value).toBe('0 0 6-22 * * ?')
    expect(monitorApi.checkCron).toHaveBeenCalledWith('0 0 6-22 * * ?')
    expect(document.body.textContent).toContain('2026-10-13 06:00:00')
    // 编辑器同步解析出小时区间
    const cells = [...document.body.querySelectorAll('.cb-preview td .cell')].map((el) => el.textContent?.trim())
    expect(cells).toEqual(['0', '0', '6-22', '*', '*', '?', '0 0 6-22 * * ?'])
  })

  it('传入非 cron（如 AFTER:30）时按空处理，落到编辑器默认值', async () => {
    const w = mountDialog('AFTER:30')
    await w.setProps({ modelValue: true })
    await flushPromises()
    // 旧版 show('-1', '') 就是空表达式 → 编辑器默认值回填进输入框
    expect(cronInput().value).toBe('0 0 * * * ?')
    expect(monitorApi.checkCron).toHaveBeenCalledWith('0 0 * * * ?')
  })

  it('「仅提交」把输入框的值交出去；空输入不提交', async () => {
    const w = mountDialog('0 0 3 * * ?')
    await w.setProps({ modelValue: true })
    await flushPromises()

    const submit = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === '仅提交') as HTMLButtonElement
    await submit.click()
    await flushPromises()
    expect(w.emitted('submit')?.at(-1)).toEqual(['0 0 3 * * ?'])

    // 清空后不提交
    const input = cronInput()
    input.value = ''
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    await submit.click()
    await flushPromises()
    expect(w.emitted('submit')).toHaveLength(1)
  })

  it('「常用定时」下拉点「每天3点」→ 输入框与编辑器同步并刷新预览', async () => {
    const w = mountDialog('0 0 6-22 * * ?')
    await w.setProps({ modelValue: true })
    await flushPromises()
    vi.mocked(monitorApi.checkCron).mockClear()

    const trigger = document.body.querySelector('.el-dropdown') as HTMLElement
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    const item = [...document.body.querySelectorAll('.el-dropdown-menu__item')].find(
      (el) => el.textContent?.trim() === '每天3点',
    ) as HTMLElement
    expect(item).toBeTruthy()
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(cronInput().value).toBe('0 0 3 * * ?')
    expect(monitorApi.checkCron).toHaveBeenCalledWith('0 0 3 * * ?')
  })

  describe('批量形态（旧 ids !== \'-1\'，源列表「批量配定时」）', () => {
    const flows = [{ id: '402330', name: 'test' }] as never

    async function mountBatch() {
      vi.spyOn(monitorApi, 'checkCron').mockResolvedValue([])
      wrapper = mount(SourceCronDialog, {
        attachTo: document.body,
        props: { modelValue: false, sourceIds: ['430023165', '391008041'], flows },
        global: { plugins: [ElementPlus] },
      })
      await wrapper.setProps({ modelValue: true })
      await flushPromises()
      return wrapper
    }
    const button = (text: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement

    it('显示源ID（只读逗号串）/ 加监控 / 执行流程，标题「批量配定时」', async () => {
      await mountBatch()
      expect((document.body.querySelector('input[data-testid="scd-ids"], [data-testid="scd-ids"] input') as HTMLInputElement).value).toBe('430023165,391008041')
      expect(document.body.querySelector('[data-testid="scd-monitor"]')).toBeTruthy()
      expect(document.body.querySelector('[data-testid="scd-flow"]')).toBeTruthy()
      expect(document.body.textContent).toContain('留空使用来源默认流程；所选流程须与每个来源关联。')
      expect(document.body.querySelector('.el-dialog__title')?.textContent).toBe('批量配定时')
      expect(button('提交并启用')).toBeTruthy()
    })

    it('「提交并启用」enable=true、「仅提交」enable=false；默认不加监控、30 分钟、跟随默认流程', async () => {
      const create = vi.spyOn(sourceApi, 'createJobs').mockResolvedValue({ ok: true })
      const w = await mountBatch()
      const input = cronInput()
      input.value = '0 0 3 * * ?'
      input.dispatchEvent(new Event('input'))
      await flushPromises()

      button('提交并启用').click()
      await flushPromises()
      expect(create).toHaveBeenLastCalledWith({
        sourceIds: ['430023165', '391008041'], cron: '0 0 3 * * ?', enable: true, monitorEnable: false, monitorAfter: 30, flowId: '',
      })
      expect(w.emitted('saved')).toHaveLength(1)
      expect(document.body.textContent).toContain('提交定时任务成功，已启用')

      await w.setProps({ modelValue: true })
      await flushPromises()
      const again = cronInput()
      again.value = '0 0 4 * * ?'
      again.dispatchEvent(new Event('input'))
      await flushPromises()
      button('仅提交').click()
      await flushPromises()
      expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ cron: '0 0 4 * * ?', enable: false }))
      expect(document.body.textContent).toContain('提交定时任务成功，[未启用]')
    })

    it('后端失败：提示「提交定时任务失败」带原因，不关闭', async () => {
      const cause = new Error('以下源无法按所选流程调度（未关联或ROOT缺失），未创建任何调度：430023165')
      vi.spyOn(sourceApi, 'createJobs').mockRejectedValue(Object.assign(new Error('请求异常 [source/createJobs]: x'), { cause }))
      const w = await mountBatch()
      const input = cronInput()
      input.value = '0 0 3 * * ?'
      input.dispatchEvent(new Event('input'))
      await flushPromises()
      button('仅提交').click()
      await flushPromises()
      expect(document.body.textContent).toContain('提交定时任务失败：以下源无法按所选流程调度')
      expect(w.emitted('saved')).toBeUndefined()
      expect(w.emitted('update:modelValue')).toBeUndefined()
    })
  })
})
