// @vitest-environment jsdom
// 流程中心「模板 → 实例」壳层组件（1109 方案 §5.1/§5.2；交互原型 frame1）。
//
// 只测我自己写的三块：左栏模板列表、结构预览、实例列表。新建向导 / 配置差异 / 批量绑定 /
// 未归类清单各有自己的测试文件（委派给 teammate 的部分）。
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import TemplateRail from './TemplateRail.vue'
import StructurePreview from './StructurePreview.vue'
import InstanceTable from './InstanceTable.vue'
import type { InstanceRow, TemplateMeta } from '@/api/types/flowCenterCenter'

const TEMPLATE: TemplateMeta = {
  id: 'tpl-announce-detail',
  name: '公告列表→详情',
  sourceCount: 86,
  instanceCount: 312,
  updatedAt: '2026-11-10 09:31',
  structure: {
    nodes: [
      { id: 'n1', kind: 'start', label: '开始' },
      { id: 'n2', kind: 'capture', label: '列表采集' },
      { id: 'n3', kind: 'capture', label: '详情采集' },
      { id: 'n4', kind: 'out', label: '入库' },
      { id: 'n5', kind: 'end', label: '结束' },
    ],
    branches: ['分支：失败回退'],
    fingerprint: 'fp-1',
  },
}

const ROW: InstanceRow = {
  id: '3812',
  name: '证监会公告·沪深',
  templateId: 'tpl-announce-detail',
  templateName: '公告列表→详情',
  sites: ['上市公司网站', '深交所网站'],
  summary: ['tb_sse_notice', '脚本 v3'],
  sourceCount: 86,
  defaultSourceCount: 86,
  updatedAt: '2026-11-10 09:31',
}

const DRAFT: InstanceRow = {
  id: '3601',
  name: '上交所公告（草稿）',
  templateId: 'tpl-announce-detail',
  templateName: '公告列表→详情',
  sites: ['上交所网站'],
  summary: ['待补齐配置'],
  sourceCount: 0,
  defaultSourceCount: 0,
  updatedAt: '2026-11-10 10:02',
  draft: true,
  scopeIntentCount: 12,
}

const mountOpts = { global: { plugins: [ElementPlus] } }

describe('流程中心 · 左栏模板列表', () => {
  it('列出模板并显示实例数 / 源数，选中态跟随 selectedId', () => {
    const w = mount(TemplateRail, {
      ...mountOpts,
      props: { templates: [TEMPLATE], allCount: 1024, unclassifiedCount: 27, selectedId: TEMPLATE.id, view: 'template' },
    })
    const item = w.get('[data-testid="flow-template-tpl-announce-detail"]')
    expect(item.text()).toContain('公告列表→详情')
    expect(item.text()).toContain('312')
    expect(item.text()).toContain('86')
    expect(item.classes()).toContain('on')
    // 结构链只取非 start/end 节点
    expect(item.text()).toContain('列表采集')
    expect(item.text()).not.toContain('开始')
    expect(w.get('[data-testid="flow-center-all"]').text()).toContain('1,024')
    expect(w.get('[data-testid="flow-center-unclassified"]').text()).toContain('27')
  })

  it('点击模板 / 全部流程 / 未归类分别派发事件', async () => {
    const w = mount(TemplateRail, {
      ...mountOpts,
      props: { templates: [TEMPLATE], allCount: 0, unclassifiedCount: 0, selectedId: '', view: 'all' },
    })
    await w.get('[data-testid="flow-template-tpl-announce-detail"]').trigger('click')
    await w.get('[data-testid="flow-center-all"]').trigger('click')
    await w.get('[data-testid="flow-center-unclassified"]').trigger('click')
    expect(w.emitted('select-template')?.[0]).toEqual([TEMPLATE.id])
    expect(w.emitted('select-all')).toBeTruthy()
    expect(w.emitted('select-unclassified')).toBeTruthy()
    expect(w.get('[data-testid="flow-center-all"]').classes()).toContain('on')
  })
})

describe('流程中心 · 结构预览', () => {
  it('按模板结构渲染节点链，并声明只读', () => {
    const w = mount(StructurePreview, { ...mountOpts, props: { template: TEMPLATE } })
    const chain = w.get('[data-testid="flow-center-structure"]')
    expect(chain.text()).toContain('5 个节点')
    expect(chain.text()).toContain('1 条分支')
    expect(chain.text()).toContain('只读 · 来自模板，实例内不可改')
    expect(w.findAll('.node')).toHaveLength(5)
    // 规则类节点单独着色（原型 .node.rule）
    expect(w.findAll('.node.rule')).toHaveLength(0)
  })

  it('没有选中模板时不渲染（避免空壳卡片）', () => {
    const w = mount(StructurePreview, { ...mountOpts, props: { template: null } })
    expect(w.find('[data-testid="flow-center-structure"]').exists()).toBe(false)
  })
})

describe('流程中心 · 实例列表', () => {
  it('渲染实例行：名称、覆盖网站、配置摘要、覆盖源数、被设为默认', () => {
    const w = mount(InstanceTable, {
      ...mountOpts,
      props: { rows: [ROW], total: 1, showSites: true, page: 1, pageSize: 20 },
    })
    const row = w.get('[data-testid="flow-instance-3812"]')
    expect(row.text()).toContain('证监会公告·沪深')
    expect(row.text()).toContain('#3812')
    expect(row.text()).toContain('被 86 个源设为默认')
    expect(row.text()).toContain('上市公司网站')
    expect(row.text()).toContain('+1 个网站')
    expect(row.text()).toContain('tb_sse_notice')
    expect(row.text()).toContain('86')
    expect(w.get('[data-testid="flow-center-instances"]').text()).toContain('流程实例 1')
  })

  it('草稿行标「草稿 · 不可执行」，覆盖源数不显示数字，操作是补齐配置 / 关联源', () => {
    const w = mount(InstanceTable, {
      ...mountOpts,
      props: { rows: [DRAFT], total: 1, showSites: true, page: 1, pageSize: 20 },
    })
    const row = w.get('[data-testid="flow-instance-3601"]')
    expect(row.text()).toContain('草稿 · 不可执行')
    expect(row.text()).toContain('目标范围 12 个源，未绑定')
    expect(w.find('[data-testid="instance-go-config"]').exists()).toBe(true)
    expect(w.find('[data-testid="instance-bind-draft"]').exists()).toBe(true)
    // 草稿不能走「配置差异」（还没有可比的配置）
    expect(w.find('[data-testid="instance-diff"]').exists()).toBe(false)
  })

  it('点击操作派发对应事件（绑定源 / 配置差异 / 编辑）', async () => {
    const w = mount(InstanceTable, {
      ...mountOpts,
      props: { rows: [ROW], total: 1, showSites: true, page: 1, pageSize: 20 },
    })
    await w.get('[data-testid="instance-bind-source"]').trigger('click')
    await w.get('[data-testid="instance-diff"]').trigger('click')
    await w.get('[data-testid="instance-edit"]').trigger('click')
    expect(w.emitted('bind-source')?.[0]).toEqual([ROW])
    expect(w.emitted('diff')?.[0]).toEqual([ROW])
    expect(w.emitted('edit')?.[0]).toEqual([ROW])
  })

  it('空态与错误态各自有提示，错误态可重试', async () => {
    const empty = mount(InstanceTable, { ...mountOpts, props: { rows: [], total: 0, showSites: true } })
    expect(empty.text()).toContain('这个模板下还没有实例')

    const failed = mount(InstanceTable, {
      ...mountOpts,
      props: { rows: [], total: 0, showSites: true, error: '实例列表接口未就绪（C02）' },
    })
    expect(failed.get('[data-testid="flow-center-instances-error"]').text()).toContain('实例列表接口未就绪')
    await failed.get('[data-testid="flow-center-instances-error"] button').trigger('click')
    expect(failed.emitted('retry')).toBeTruthy()
  })

  it('分页信息与翻页事件（共 N 条 / 第 x/y 页）', async () => {
    const w = mount(InstanceTable, {
      ...mountOpts,
      props: { rows: [ROW], total: 45, showSites: true, page: 1, pageSize: 20 },
    })
    expect(w.text()).toContain('共 45 条 · 第 1/3 页')
    await w.findAll('.pager button')[1].trigger('click')
    expect(w.emitted('page-change')?.[0]).toEqual([2])
  })
})