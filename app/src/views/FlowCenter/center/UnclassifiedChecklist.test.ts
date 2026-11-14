// @vitest-environment jsdom
// 「未归类 / 结构待核对」清单（1109 原型 #frame5 / 方案 R04 §5.4）。测契约不测样式：
//   ① active 时拉取并渲染 5 列 + 操作列，页脚「共 27 条 · 第 1/2 页」
//   ② 「忽略」调 setUnclassifiedStatus 并把状态 pill 更新成「已忽略」
//   ③ 建议为空的行「归集…」禁用并提示「需先核对结构」
//   ④ 「导出清单」在 jsdom 下不抛错（mock URL.createObjectURL）
//   ⑤ 单条归集走二次确认 → assignUnclassified → 刷新
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import UnclassifiedChecklist from './UnclassifiedChecklist.vue'
import {
  assignUnclassified,
  fetchTemplateMetas,
  fetchUnclassified,
  setUnclassifiedStatus,
} from '@/api/flowCenterCenter'
import type { TemplateMeta, UnclassifiedResult } from '@/api/types/flowCenterCenter'

// 归集菜单、搜索框、分页器要按真实 Element Plus 渲染（含 teleport），所以只把提示类 API 换成本地 spy。
vi.mock('element-plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('element-plus')>()),
  ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn(), alert: vi.fn() },
}))
vi.mock('@/api/flowCenterCenter', () => ({
  fetchUnclassified: vi.fn(),
  fetchTemplateMetas: vi.fn(),
  assignUnclassified: vi.fn(),
  setUnclassifiedStatus: vi.fn(),
}))

const loadMock = vi.mocked(fetchUnclassified)
const statusMock = vi.mocked(setUnclassifiedStatus)
const assignMock = vi.mocked(assignUnclassified)
const templatesMock = vi.mocked(fetchTemplateMetas)
const confirmMock = vi.mocked(ElMessageBox.confirm)
const errorMsg = vi.mocked(ElMessage.error)

/** 与 mock 一致：total 27、返回 5 行、扫描时间 11-10 09:31、2301 无建议模板 */
const RESULT: UnclassifiedResult = {
  total: 27,
  scannedAt: '11-10 09:31',
  list: [
    {
      id: '2001',
      name: '公告_沪深_2025',
      oldTemplate: '公告模板（旧）',
      chain: '列表采集→详情采集→规则处理',
      suggestedTemplateId: '5101',
      suggestedTemplateName: '公告列表→详情',
      reason: '结构一致，仅配置不同',
      status: 'pending',
    },
    {
      id: '2180',
      name: '公告_北交所_2025',
      oldTemplate: '公告模板（旧）',
      chain: '列表采集→详情采集',
      suggestedTemplateId: '5102',
      suggestedTemplateName: '公告列表→详情（简）',
      reason: '节点数与连接不同',
      status: 'pending',
    },
    {
      id: '2301',
      name: '问询_深交所_2024',
      oldTemplate: '问询函模板（旧）',
      chain: '列表采集→详情采集→规则处理→导出',
      suggestedTemplateId: null,
      suggestedTemplateName: '—',
      reason: '边信息不完整',
      status: 'pending',
    },
    {
      id: '2450',
      name: '公告_上交所_2025',
      oldTemplate: '公告模板（旧2）',
      chain: '列表采集→详情采集',
      suggestedTemplateId: '5101',
      suggestedTemplateName: '公告列表→详情',
      reason: '结构一致，仅配置不同',
      status: 'pending',
    },
    {
      id: '2512',
      name: '公告_港交所_2025',
      oldTemplate: '公告模板（旧3）',
      chain: '列表采集→详情采集→规则处理',
      suggestedTemplateId: '5103',
      suggestedTemplateName: '公告列表→详情（港）',
      reason: '结构待核对',
      status: 'pending',
    },
  ],
}

function tpl(id: string, name: string): TemplateMeta {
  return {
    id,
    name,
    sourceCount: 0,
    instanceCount: 0,
    updatedAt: '2026-11-10 09:00',
    structure: { nodes: [], branches: [], fingerprint: id },
  }
}

const createObjectURL = vi.fn((_blob: Blob) => 'blob:mock-url')
const revokeObjectURL = vi.fn()

/** 归集菜单 teleport 到 body（不被表格滚动容器裁剪），查询统一走 body 而不是 wrapper */
function body() {
  return new DOMWrapper(document.body)
}

function mountComp(active = true) {
  return mount(UnclassifiedChecklist, {
    props: { active },
    global: { plugins: [ElementPlus] },
    attachTo: document.body,
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  loadMock.mockResolvedValue(RESULT)
  templatesMock.mockResolvedValue([tpl('5101', '公告列表→详情'), tpl('5102', '公告列表→详情（简）')])
  assignMock.mockResolvedValue(undefined)
  statusMock.mockResolvedValue(undefined)
  confirmMock.mockResolvedValue('confirm' as never)
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
  document.body.innerHTML = ''
})

describe('UnclassifiedChecklist · 加载与渲染', () => {
  it('active 时加载，渲染 5 列 + 操作列与本地分页信息', async () => {
    const wrapper = mountComp()
    await flushPromises()

    expect(loadMock).toHaveBeenCalledTimes(1)
    expect(loadMock).toHaveBeenCalledWith({})

    const headers = wrapper.get('[data-testid="uc-table"]').findAll('thead th').map((th) => th.text())
    expect(headers).toEqual(['旧归集模板', '实例', '节点类型及边', '建议模板', '原因 / 状态', '操作'])

    const rows = wrapper.findAll('[data-testid="uc-row"]')
    expect(rows).toHaveLength(5)
    expect(rows[0].text()).toContain('公告模板（旧）')
    expect(rows[0].text()).toContain('#2001')
    expect(rows[0].get('[data-testid="uc-status"]').text()).toBe('待确认')
    expect(rows[2].text()).toContain('无匹配模板')

    // 技术口径在表格上方，不在分页器旁
    expect(wrapper.get('[data-testid="uc-tech-note"]').text()).toContain('不改 flowId / stepId / configId 与源绑定')
    expect(wrapper.get('[data-testid="uc-scanned"]').text()).toContain('11-10 09:31')
    expect(wrapper.get('[data-testid="uc-page-info"]').text()).toBe('共 27 条 · 第 1/2 页')
    // 通知父级角标
    expect(wrapper.emitted('count-change')?.[0]).toEqual([27])

    wrapper.unmount()
  })

  it('active=false 挂载时不拉取', async () => {
    const wrapper = mountComp(false)
    await flushPromises()
    expect(loadMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('加载失败时错误可见并可重试', async () => {
    loadMock.mockRejectedValueOnce(new Error('扫描服务不可用'))
    const wrapper = mountComp()
    await flushPromises()

    expect(errorMsg).toHaveBeenCalled()
    expect(wrapper.get('[data-testid="uc-error"]').text()).toContain('扫描服务不可用')

    await wrapper.get('[data-testid="uc-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-testid="uc-row"]')).toHaveLength(5)
    wrapper.unmount()
  })
})

describe('UnclassifiedChecklist · 行操作', () => {
  it('「忽略」调 setUnclassifiedStatus 并更新状态', async () => {
    const wrapper = mountComp()
    await flushPromises()

    const row = wrapper.findAll('[data-testid="uc-row"]')[0]
    expect(row.get('[data-testid="uc-status"]').text()).toBe('待确认')

    await row.get('[data-testid="uc-ignore"]').trigger('click')
    await flushPromises()

    expect(statusMock).toHaveBeenCalledWith('2001', 'skipped')
    expect(row.get('[data-testid="uc-status"]').text()).toBe('已忽略')
    wrapper.unmount()
  })

  it('建议为空的行「归集…」禁用并提示需先核对结构', async () => {
    const wrapper = mountComp()
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="uc-row"]')
    const noSuggest = rows[2].get('[data-testid="uc-assign"]')
    expect(noSuggest.attributes('disabled')).toBeDefined()
    expect(noSuggest.attributes('title')).toContain('需先核对结构')
    expect(rows[0].get('[data-testid="uc-assign"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('「查看结构」emit go-flow 带实例 id', async () => {
    const wrapper = mountComp()
    await flushPromises()

    await wrapper.findAll('[data-testid="uc-row"]')[1].get('[data-testid="uc-structure"]').trigger('click')
    expect(wrapper.emitted('go-flow')?.[0]).toEqual(['2180'])
    wrapper.unmount()
  })

  it('单条归集：二次确认 → assignUnclassified → 刷新', async () => {
    const wrapper = mountComp()
    await flushPromises()

    await wrapper.findAll('[data-testid="uc-row"]')[0].get('[data-testid="uc-assign"]').trigger('click')
    await flushPromises()

    expect(templatesMock).toHaveBeenCalledTimes(1)
    // 菜单在 body 上的 el-dropdown 浮层里，不在表格容器内
    const menu = body().get('[data-testid="uc-menu"]')
    expect(menu.text()).toContain('公告列表→详情')

    await body().get('[data-testid="uc-assign-option-5101"]').trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(assignMock).toHaveBeenCalledWith('2001', '5101')
    expect(loadMock).toHaveBeenCalledTimes(2)
    expect(body().find('[data-testid="uc-menu"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('二次确认取消时不写归属', async () => {
    confirmMock.mockRejectedValueOnce('cancel')
    const wrapper = mountComp()
    await flushPromises()

    await wrapper.findAll('[data-testid="uc-row"]')[0].get('[data-testid="uc-assign"]').trigger('click')
    await flushPromises()
    await body().get('[data-testid="uc-assign-option-5101"]').trigger('click')
    await flushPromises()

    expect(assignMock).not.toHaveBeenCalled()
    expect(errorMsg).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('UnclassifiedChecklist · 导出', () => {
  it('导出清单生成 CSV 且不抛错', async () => {
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })
    const wrapper = mountComp()
    await flushPromises()

    await wrapper.get('[data-testid="uc-export"]').trigger('click')

    expect(errorMsg).not.toHaveBeenCalled()
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob)
    expect(clicked).toHaveLength(1)
    // 列：旧归集模板 / 实例 / 节点类型及边 / 建议模板 / 原因 → 文件名带时间戳
    expect(clicked[0].download).toMatch(/^未归类核对清单-\d{8}-\d{4}\.csv$/)
    expect(clicked[0].href).toBe('blob:mock-url')
    wrapper.unmount()
  })
})