// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import type { ConfigDiffResult } from '@/api/types/flowCenterCenter'
import ConfigDiffDrawer from './ConfigDiffDrawer.vue'

const { fetchInstanceDiff, messageError } = vi.hoisted(() => ({
  fetchInstanceDiff: vi.fn(),
  messageError: vi.fn(),
}))

vi.mock('@/api/flowCenterCenter', () => ({ fetchInstanceDiff }))
// 抽屉内容 append-to-body 后会 teleport 到 document.body，所以保留真实的 Element Plus 组件（要渲染 el-drawer /
// el-tag / el-alert），只把 ElMessage.error 换成本地 spy：断言提示调用同时不往 jsdom 里真的弹提示。
vi.mock('element-plus', async (importOriginal) => ({
  ...await importOriginal<typeof import('element-plus')>(),
  ElMessage: { error: messageError },
}))

enableAutoUnmount(afterEach)

afterEach(() => {
  document.body.innerHTML = ''
  document.body.removeAttribute('class')
  document.body.style.removeProperty('overflow')
})

function makeDiff(over: Partial<ConfigDiffResult> = {}): ConfigDiffResult {
  return {
    base: { id: '3812', name: '证监会公告·沪深' },
    compare: { id: '3901', name: '深交所公告·列表' },
    baseSourceCount: 86,
    compareSourceCount: 8,
    changedCount: 3,
    sections: [
      {
        title: '全局配置',
        items: [
          { label: '输出表（一）', base: 'tb_announcement', compare: 'tb_sse_raw' },
          { label: '写入模式', base: '增量写入', compare: '增量写入' },
          { label: '增量字段', base: 'NOTICE_ID', compare: 'PUBLISH_TIME' },
        ],
      },
      {
        title: '步骤级配置',
        items: [
          { label: '详情采集 · 请求头', base: '含 Referer', compare: '未配置 Referer' },
          { label: '规则处理 · 清洗规则', base: '3 条规则', compare: '3 条规则' },
        ],
      },
    ],
    schedules: [{ sourceName: '证监会公告·沪深', taskName: '公告抓取 A', at: '每天 06:00' }],
    ...over,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function mountDrawer(over: Partial<{ visible: boolean; baseId: string; compareId: string }> = {}) {
  const wrapper = mount(ConfigDiffDrawer, {
    props: { visible: true, baseId: '3812', compareId: '3901', ...over },
    global: { plugins: [ElementPlus] },
    attachTo: document.body,
  })
  // el-drawer 在 onMounted 里才把内部 visible 置 true，并且差异请求需要一轮微任务，内容要到下一个 tick 才渲染
  await flushPromises()
  return wrapper
}

/** el-drawer 的 DOM 在 body 上（teleport），查询统一走 body 而不是 wrapper */
function body() {
  return new DOMWrapper(document.body)
}

beforeEach(() => {
  fetchInstanceDiff.mockReset()
  messageError.mockReset()
})

describe('ConfigDiffDrawer', () => {
  it('用 el-drawer 承载：右侧 620px、无内置标题栏、挂到 body 外', async () => {
    fetchInstanceDiff.mockResolvedValue(makeDiff())
    const wrapper = await mountDrawer()

    const drawer = wrapper.findComponent({ name: 'ElDrawer' })
    expect(drawer.props('direction')).toBe('rtl')
    expect(drawer.props('size')).toBe('620px')
    expect(drawer.props('withHeader')).toBe(false)
    expect(drawer.props('appendToBody')).toBe(true)
    // 内容 teleport 出组件树，说明不是盖在页面容器里的自绘浮层
    expect(wrapper.find('[data-testid="config-diff-drawer"]').exists()).toBe(false)
    expect(body().find('[data-testid="config-diff-drawer"]').exists()).toBe(true)
    // 自绘标题栏仍在：标题 + 关闭按钮
    expect(body().get('[data-testid="config-diff-drawer"]').text()).toContain('配置差异')
  })

  it('visible 时拉差异，并渲染身份卡 / 全局差异 / 步骤表格 / 源调度', async () => {
    fetchInstanceDiff.mockResolvedValue(makeDiff())
    await mountDrawer()

    expect(fetchInstanceDiff).toHaveBeenCalledWith('3812', '3901')

    // 基准 / 对比卡：名称 + 覆盖源数
    const base = body().get('[data-testid="config-diff-base"]')
    expect(base.text()).toContain('证监会公告·沪深')
    expect(base.text()).toContain('覆盖 86 个源')
    const compare = body().get('[data-testid="config-diff-compare"]')
    expect(compare.text()).toContain('深交所公告·列表')
    expect(compare.text()).toContain('覆盖 8 个源')

    // 全局配置只列变化项：「写入模式」相同被折叠
    const globalRows = body().findAll('[data-testid="config-diff-global-row"]')
    expect(globalRows).toHaveLength(2)
    expect(globalRows[0]!.text()).toContain('输出表（一）')
    expect(globalRows[0]!.text()).toContain('tb_sse_raw')
    expect(body().get('[data-testid="config-diff-global"]').text()).not.toContain('写入模式')
    // 差异行仍保留 .chg 钩子，改标签由 el-tag 承载
    expect(globalRows[0]!.classes()).toContain('chg')
    expect(globalRows[0]!.find('.el-tag').text()).toBe('改')

    // 步骤级表格：步骤 / 项拆列；变化行高亮，相同行保留
    const stepRows = body().findAll('[data-testid="config-diff-step-row"]')
    expect(stepRows).toHaveLength(2)
    const cells = stepRows[0]!.findAll('td')
    expect(cells[0]!.text()).toBe('详情采集')
    expect(cells[1]!.text()).toContain('请求头')
    expect(cells[2]!.text()).toBe('含 Referer')
    expect(stepRows[0]!.classes()).toContain('chg')
    expect(stepRows[1]!.classes()).not.toContain('chg')
    expect(stepRows[1]!.findAll('td')[1]!.find('.el-tag').text()).toBe('同')

    // 实例自身没有调度：单独只读表 + 口径说明
    const sched = body().get('[data-testid="config-diff-schedules"]')
    expect(sched.text()).toContain('公告抓取 A')
    expect(sched.text()).toContain('每天 06:00')
    expect(sched.text()).toContain('调度按源执行，不属于实例配置')
    expect(body().text()).toContain('差异 3 项')
  })

  it('步骤级差异没有具体步骤时，「步骤」列写「全局」而不是破折号', async () => {
    fetchInstanceDiff.mockResolvedValue(makeDiff({
      sections: [
        {
          title: '步骤级配置',
          items: [{ label: '重试次数', base: '2', compare: '3' }],
        },
      ],
    }))
    await mountDrawer()

    const rows = body().findAll('[data-testid="config-diff-step-row"]')
    expect(rows).toHaveLength(1)
    // 不落具体步骤的差异归到「全局」，避免用「—」表达
    expect(rows[0]!.findAll('td')[0]!.text()).toBe('全局')
    expect(rows[0]!.text()).not.toContain('—')
    expect(rows[0]!.findAll('td')[1]!.find('.el-tag').text()).toBe('改')
  })

  it('切换 compareId 时只渲染最新结果，旧响应回来也不覆盖', async () => {
    const oldRequest = deferred<ConfigDiffResult>()
    const newRequest = deferred<ConfigDiffResult>()
    fetchInstanceDiff
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise)

    const wrapper = await mountDrawer({ compareId: '3901' })
    await flushPromises()
    expect(fetchInstanceDiff).toHaveBeenCalledTimes(1)

    // 旧请求还挂着就切到 3902
    await wrapper.setProps({ compareId: '3902' })
    await flushPromises()
    expect(fetchInstanceDiff).toHaveBeenCalledTimes(2)
    expect(fetchInstanceDiff).toHaveBeenLastCalledWith('3812', '3902')

    // 新请求先回
    newRequest.resolve(makeDiff({ compare: { id: '3902', name: '新对比实例' } }))
    await flushPromises()
    expect(body().get('[data-testid="config-diff-compare"]').text()).toContain('新对比实例')

    // 旧请求后回：不得把界面退回 3901
    oldRequest.resolve(makeDiff({ compare: { id: '3901', name: '旧对比实例' } }))
    await flushPromises()
    expect(body().get('[data-testid="config-diff-compare"]').text()).toContain('新对比实例')
    expect(body().text()).not.toContain('旧对比实例')
  })

  it('请求失败时抽屉内显示错误，点「重试」可重新拉取', async () => {
    fetchInstanceDiff
      .mockRejectedValueOnce(new Error('接口 500'))
      .mockResolvedValueOnce(makeDiff())

    await mountDrawer()

    expect(messageError).toHaveBeenCalledTimes(1)
    const errorBox = body().get('[data-testid="config-diff-error"]')
    expect(errorBox.text()).toContain('接口 500')
    expect(body().find('[data-testid="config-diff-drawer"]').exists()).toBe(true)

    await errorBox.get('[data-testid="config-diff-retry"]').trigger('click')
    await flushPromises()

    expect(fetchInstanceDiff).toHaveBeenCalledTimes(2)
    expect(body().find('[data-testid="config-diff-error"]').exists()).toBe(false)
    expect(body().get('[data-testid="config-diff-base"]').text()).toContain('证监会公告·沪深')
  })

  it('主按钮 emit open-instance，参数是基准实例 ID', async () => {
    fetchInstanceDiff.mockResolvedValue(makeDiff())
    const wrapper = await mountDrawer({ baseId: '3812' })
    await flushPromises()

    await body().get('[data-testid="config-diff-open"]').trigger('click')
    expect(wrapper.emitted('open-instance')).toEqual([['3812']])
  })

  it('关闭时清空结果，重新打开会重新拉取', async () => {
    fetchInstanceDiff.mockResolvedValue(makeDiff())
    const wrapper = await mountDrawer()
    expect(wrapper.findComponent({ name: 'ElDrawer' }).props('modelValue')).toBe(true)

    await wrapper.setProps({ visible: false })
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ElDrawer' }).props('modelValue')).toBe(false)

    await wrapper.setProps({ visible: true })
    await flushPromises()
    expect(fetchInstanceDiff).toHaveBeenCalledTimes(2)
    expect(body().get('[data-testid="config-diff-base"]').text()).toContain('证监会公告·沪深')
  })

  it('关闭按钮 emit close', async () => {
    fetchInstanceDiff.mockResolvedValue(makeDiff())
    const wrapper = await mountDrawer()

    await body().get('[data-testid="config-diff-close"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})