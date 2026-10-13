// @vitest-environment jsdom
// 新增 / 编辑队列校验配置（旧 modules/BaseEdit.vue + QueueCheck.vue 的 addCallback/updateCallback）。
// 这一层要守住的是**提交体口径**：旧版会先把每个列字段置 null、再把整条记录 Object.assign 进来，
// 最后在回调里删掉 createDt/updateDt（新增）以及额外的 lastRun/nextRun（编辑）。
// 字段多一个少一个都会打到真实后端，所以逐项断言。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import QueueEditDialog from './QueueEditDialog.vue'
import * as queueApi from '../../../api/queueCheck'
import type { MqCheck } from '../../../api'

const stubs = {
  ElDialog: { name: 'ElDialog', props: ['modelValue'], template: '<div class="stub-dialog"><slot /><slot name="footer" /></div>' },
  ElDescriptions: { name: 'ElDescriptions', template: '<div class="stub-desc"><slot /></div>' },
  ElDescriptionsItem: { name: 'ElDescriptionsItem', props: ['label', 'span'], template: '<div class="stub-cell"><slot /></div>' },
}

function mountDialog() {
  return mount(QueueEditDialog, { global: { plugins: [ElementPlus], stubs } })
}
const btn = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll('button').find((b) => b.text().trim() === text)!

const RECORD: MqCheck = {
  queueId: 'mq-9',
  queueName: 'rule-eval',
  state: 'E',
  lastMsg: '2026-10-13 08:12:33---[X]:失败堆积 3 条',
  queueDesc: '规则引擎求值队列',
  maxSize: 500,
  minConsumer: 2,
  minRate: 20,
  maxRate: 3000,
  check: 'cnt > 100',
  checkMsg: '规则求值队列消费过慢',
  isDelete: 0,
  createDt: '2026-09-02 11:20:00',
  updateDt: '2026-10-13 08:12:33',
  lastRun: '2026-10-13 08:12:33',
  nextRun: '2026-10-13 09:12:00',
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('队列告警 · 新增/编辑弹窗提交体', () => {
  it('新增：字段集来自 addCols，剔除 createDt/updateDt，isDelete 预填 0', async () => {
    const add = vi.spyOn(queueApi, 'addQueueCheck').mockResolvedValue({} as never)
    const wrapper = mountDialog()

    wrapper.vm.openDialog(null, { queueName: 'snatch-task', isDelete: 0 })
    await flushPromises()
    await btn(wrapper, '保存').trigger('click')
    await flushPromises()

    expect(add).toHaveBeenCalledTimes(1)
    const payload = add.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual(expect.objectContaining({ queueName: 'snatch-task', isDelete: 0 }))
    // 旧 addCallback：删 createDt / updateDt
    expect('createDt' in payload).toBe(false)
    expect('updateDt' in payload).toBe(false)
    // noAdd 的列（状态/执行结果/操作/生成时间）不进新增表单
    expect('state' in payload).toBe(false)
    expect('lastMsg' in payload).toBe(false)
    expect('action' in payload).toBe(false)
  })

  it('编辑：带回记录上的原始字段（含 queueId），剔除 createDt/updateDt/lastRun/nextRun', async () => {
    const update = vi.spyOn(queueApi, 'updateQueueCheck').mockResolvedValue({} as never)
    const wrapper = mountDialog()

    wrapper.vm.openDialog(RECORD)
    await flushPromises()
    await btn(wrapper, '保存').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledTimes(1)
    const payload = update.mock.calls[0][0] as Record<string, unknown>
    // 编辑要靠 queueId 定位记录
    expect(payload.queueId).toBe('mq-9')
    expect(payload.queueName).toBe('rule-eval')
    expect(payload.maxSize).toBe(500)
    // noEdit 的列不进编辑表单，但会随 extra 原样带回（旧 Object.assign(this.form, record) 的效果）
    expect(payload.state).toBe('E')
    expect(payload.lastMsg).toBe(RECORD.lastMsg)
    // 旧 updateCallback 的剔除项
    for (const key of ['createDt', 'updateDt', 'lastRun', 'nextRun']) {
      expect(key in payload, `${key} 应被剔除`).toBe(false)
    }
  })

  it('保存成功后发出 saved 事件（父级据此重查列表）', async () => {
    vi.spyOn(queueApi, 'addQueueCheck').mockResolvedValue({} as never)
    const wrapper = mountDialog()

    wrapper.vm.openDialog(null, { queueName: 'x', isDelete: 0 })
    await flushPromises()
    await btn(wrapper, '保存').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('saved')).toHaveLength(1)
  })
})
