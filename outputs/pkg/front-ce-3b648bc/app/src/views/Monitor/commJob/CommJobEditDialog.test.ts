// @vitest-environment jsdom
// 新增 / 编辑自定义告警（旧 modules/BaseEdit.vue + CommJobList.vue 的 addCallback/updateCallback）。
// 这一层要守住的是**提交体口径**：旧版会先把每个列字段置 null、再把整条记录 Object.assign 进来，
// 最后在回调里删掉 createDt/updateDt（新增）以及额外的 lastRun/nextRun（编辑）。
// 字段多一个少一个都会打到真实后端，所以逐项断言。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import CommJobEditDialog from './CommJobEditDialog.vue'
import * as commApi from '../../../api/commJob'
import type { CommJob } from '../../../api'

const stubs = {
  ElDialog: { name: 'ElDialog', props: ['modelValue'], template: '<div class="stub-dialog"><slot /><slot name="footer" /></div>' },
  ElDescriptions: { name: 'ElDescriptions', template: '<div class="stub-desc"><slot /></div>' },
  ElDescriptionsItem: { name: 'ElDescriptionsItem', props: ['label', 'span'], template: '<div class="stub-cell"><slot /></div>' },
}

function mountDialog() {
  return mount(CommJobEditDialog, { global: { plugins: [ElementPlus], stubs } })
}
const btn = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll('button').find((b) => b.text().trim() === text)!

const RECORD: CommJob = {
  jobId: '1003',
  jobType: 'sqlCheck',
  jobName: '支付失败率告警',
  lastMsg: '2026-10-13 08:40:00---正常, 失败率 0.31%',
  sqlDef: "select rate from t_pay where dt = current_date",
  ruleDef: 'rate > 3',
  jobParam: '{"mail":"pay@demo.com"}',
  schedule: '0 */10 * * * ?',
  nextRun: '2026-10-13 10:50:00',
  runCnt: 512,
  successCnt: 512,
  lastRun: '2026-10-13 08:40:00',
  isDelete: 0,
  createDt: '2026-07-02 14:05:00',
  updateDt: '2026-10-13 08:40:00',
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('自定义告警 · 新增/编辑弹窗提交体', () => {
  it('新增：字段集来自 addCols，剔除 createDt/updateDt，isDelete 预填 0', async () => {
    const add = vi.spyOn(commApi, 'addCommJobCheck').mockResolvedValue({} as never)
    const wrapper = mountDialog()

    wrapper.vm.openDialog(null, { jobName: '订单积压告警', isDelete: 0 })
    await flushPromises()
    await btn(wrapper, '保存').trigger('click')
    await flushPromises()

    expect(add).toHaveBeenCalledTimes(1)
    const payload = add.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual(expect.objectContaining({ jobName: '订单积压告警', isDelete: 0 }))
    // 旧 addCallback：删 createDt / updateDt
    expect('createDt' in payload).toBe(false)
    expect('updateDt' in payload).toBe(false)
    // noAdd 的列（下次运行 / 总运行次 / 成功次 / 上次运行 / 操作）不进新增表单
    for (const key of ['nextRun', 'runCnt', 'successCnt', 'lastRun', 'action']) {
      expect(key in payload, `${key} 不该出现在新增表单`).toBe(false)
    }
  })

  it('编辑：带回记录上的原始字段（含 jobId），剔除 createDt/updateDt/lastRun/nextRun', async () => {
    const update = vi.spyOn(commApi, 'updateCommJobCheck').mockResolvedValue({} as never)
    const wrapper = mountDialog()

    wrapper.vm.openDialog(RECORD)
    await flushPromises()
    await btn(wrapper, '保存').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledTimes(1)
    const payload = update.mock.calls[0][0] as Record<string, unknown>
    // 编辑要靠 jobId 定位记录
    expect(payload.jobId).toBe('1003')
    expect(payload.jobName).toBe('支付失败率告警')
    expect(payload.schedule).toBe('0 */10 * * * ?')
    // noEdit 的列不进编辑表单，但会随 extra 原样带回（旧 Object.assign(this.form, record) 的效果）
    expect(payload.runCnt).toBe(512)
    expect(payload.successCnt).toBe(512)
    // 旧 updateCallback 的剔除项
    for (const key of ['createDt', 'updateDt', 'lastRun', 'nextRun']) {
      expect(key in payload, `${key} 应被剔除`).toBe(false)
    }
  })

  it('保存成功后发出 saved 事件（父级据此重查列表）', async () => {
    vi.spyOn(commApi, 'addCommJobCheck').mockResolvedValue({} as never)
    const wrapper = mountDialog()

    wrapper.vm.openDialog(null, { jobName: 'x', isDelete: 0 })
    await flushPromises()
    await btn(wrapper, '保存').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('类型列是 SELECT 控件、禁用列是 INT_BOOL 控件（编辑列集里两个下拉）', async () => {
    const wrapper = mountDialog()
    wrapper.vm.openDialog(RECORD)
    await flushPromises()

    // 编辑列集里的下拉控件：类型（SELECT）+ 禁用（INT_BOOL），其余都是文本/多行输入
    expect(wrapper.findAllComponents({ name: 'ElSelect' })).toHaveLength(2)
    // 「类型」的选项来自列定义的 values，控件存在即说明没有退化成纯文本输入
    const textareas = wrapper.findAllComponents({ name: 'ElInput' }).filter((i) => i.props('type') === 'textarea')
    expect(textareas.length).toBe(3) // SQL定义 / 告警条件 / 运行参数
  })
})
