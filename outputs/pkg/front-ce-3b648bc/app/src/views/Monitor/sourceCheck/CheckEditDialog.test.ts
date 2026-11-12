// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import CheckEditDialog from './CheckEditDialog.vue'
import { dataApi } from '../../../api'
import * as monitorApi from '../../../api/monitor'

// 新增 / 修改监控（迁移旧 CheckAdd.vue）
describe('CheckEditDialog · 新增/修改监控', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  function mountDialog() {
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue({
      sourceName: '支付宝评论规则过滤',
      list1: [
        { tableId: '2102157', tableName: 'sense_data.TB_ZFB_COMMENT', fields: [] },
        { tableId: '2102158', tableName: 'sense_data.TB_ZFB_DETAIL', fields: [] },
      ],
      list2: [],
      list3: [],
    } as never)
    vi.spyOn(monitorApi, 'addSourceCheck').mockResolvedValue({ ok: true } as never)
    vi.spyOn(monitorApi, 'updateSourceCheck').mockResolvedValue({ ok: true } as never)
    vi.spyOn(monitorApi, 'checkOneManual').mockResolvedValue({ message: 'ok' } as never)
    wrapper = mount(CheckEditDialog, {
      attachTo: document.body,
      props: { sourceId: '391007768' },
      global: { plugins: [ElementPlus] },
    })
    return wrapper as VueWrapper & { vm: { openDialog: (r?: unknown) => void } }
  }

  const openDialog = (w: VueWrapper) =>
    (w.vm as unknown as { openDialog: (r?: unknown) => void }).openDialog
  const btn = (text: string) =>
    [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement
  /** 按 label 前缀找 el-form-item 元素（表名是 el-select，读 textContent 而不是 input.value） */
  const itemByLabel = (label: string) =>
    [...document.body.querySelectorAll('.el-form-item')].find((el) =>
      el.querySelector('.el-form-item__label')?.textContent?.trim().startsWith(label),
    )
  const inputByLabel = (label: string) => itemByLabel(label)?.querySelector('input') as HTMLInputElement

  it('新增：按源加载实体表、自动填表名与「源名-日增量」，并预置检查项JSON', async () => {
    const w = mountDialog()
    openDialog(w)(null)
    await flushPromises()

    expect(dataApi.entryTypesGroup).toHaveBeenCalledWith('391007768')
    expect(document.body.textContent).toContain('新增监控')
    expect(itemByLabel('表名')?.textContent).toContain('sense_data.TB_ZFB_COMMENT')
    expect(inputByLabel('监控名').value).toBe('支付宝评论规则过滤-日增量')
    expect(inputByLabel('定时').value).toBe('0 0 6-22 * * ?')
    expect(inputByLabel('检查项JSON').value).toBe('{"timeType":"C","notifyOn":"error","notifyType":"mail"}')    // 默认不展开自定义告警配置（旧版首次新增也是收起的）
    expect(document.body.textContent).not.toContain('自定义条件SQL')
  })

  it('「延时」写入 AFTER:30；「自定义配置」展开告警配置；「验证」透出校验结果', async () => {
    const w = mountDialog()
    openDialog(w)(null)
    await flushPromises()

    await btn('延时').click()
    await flushPromises()
    expect(inputByLabel('定时').value).toBe('AFTER:30')

    await btn('自定义配置').click()
    await flushPromises()
    expect(document.body.textContent).toContain('自定义条件SQL')
    expect(document.body.textContent).toContain('校验失败时推送')

    // 改一个子字段 → checkConf 跟着变（旧版深度 watch formSub）
    const ruleInput = [...document.body.querySelectorAll('input')].find(
      (el) => (el as HTMLInputElement).placeholder.includes('cnt > 100'),
    ) as HTMLInputElement
    ruleInput.value = 'cnt > 100'
    ruleInput.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(JSON.parse(inputByLabel('检查项JSON').value).checkRule).toBe('cnt > 100')

    await btn('验证').click()
    await flushPromises()
    expect(monitorApi.checkOneManual).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: '391007768',
        tableName: 'sense_data.TB_ZFB_COMMENT',
        checkConf: expect.stringContaining('"checkRule":"cnt > 100"'),
      }),
    )
    expect(document.body.textContent).toContain('规则校验->返回成功')
  })

  it('修改：回填 checkConf 并展开配置，提交时剔除 lastRun/nextRun/createDt/updateDt', async () => {
    const w = mountDialog()
    openDialog(w)({
      id: 'ck-9',
      isDelete: 0,
      state: 'E',
      name: '旧监控',
      lastMsg: 'x',
      tableName: 'sense_data.TB_ZFB_COMMENT',
      schedule: '0 0 3 * * ?',
      nextRun: '2026-09-09 12:00:00',
      lastRun: '2026-09-09 11:00:19',
      createDt: '2026-09-01 00:00:00',
      updateDt: '2026-09-02 00:00:00',
      sourceId: '391007768',
      checkConf: '{"timeType":"U","minSize":"2","notifyOn":"all","notifyType":"mail"}',
    })
    await flushPromises()

    expect(document.body.textContent).toContain('修改监控')
    expect(document.body.textContent).toContain('自定义条件SQL')
    // checkConf 被规范化后回写（缺失字段按旧版口径被 JSON.stringify 丢弃，顺序沿用旧 formSub）
    const confBeforeSubmit = inputByLabel('检查项JSON').value
    expect(JSON.parse(confBeforeSubmit)).toEqual({
      timeType: 'U',
      minSize: '2',
      notifyOn: 'all',
      notifyType: 'mail',
    })
    expect(confBeforeSubmit).toBe('{"timeType":"U","minSize":"2","notifyOn":"all","notifyType":"mail"}')

    await btn('保存').click()
    await flushPromises()
    const payload = vi.mocked(monitorApi.updateSourceCheck).mock.calls[0][0] as Record<string, unknown>
    expect(payload.id).toBe('ck-9')
    expect(payload.state).toBe('E') // 旧 Object.assign(this.form, record)：record 字段原样带回
    expect(payload.checkConf).toBe(confBeforeSubmit)
    for (const key of ['lastRun', 'nextRun', 'createDt', 'updateDt']) {
      expect(payload).not.toHaveProperty(key)
    }
  })

  it('新增提交走 addSourceCheck 且不带 id', async () => {
    const w = mountDialog()
    openDialog(w)(null)
    await flushPromises()
    await btn('保存').click()
    await flushPromises()

    const payload = vi.mocked(monitorApi.addSourceCheck).mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('id')
    expect(payload.sourceId).toBe('391007768')
    expect(payload.isDelete).toBe(0)
  })
})
