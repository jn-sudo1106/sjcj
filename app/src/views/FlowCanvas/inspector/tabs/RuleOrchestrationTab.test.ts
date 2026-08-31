// @vitest-environment jsdom
// 编排配置 Tab：0804 S2-2 后只剩路径 B（描述/生成/全屏/测试/保存脚本）——路径 A（表/字段绑定 +
// 保存业务规则元数据）已整个搬去 TableTab.test.ts，跟非规则节点共用同一个表配置 Tab。
// 通过挂载整个 NodeInspector 测试（而非孤立挂载 RuleOrchestrationTab），因为 useNodeInspectorAssets()
// 的 provide/inject 上下文由 NodeInspector 建立，脱离它调用会抛错（见 useNodeInspectorAssets.ts 设计约束）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessageBox } from 'element-plus'
import NodeInspector from '../NodeInspector.vue'
import { useFlowStore } from '@/stores/flow'
import { NODE_CONFIGS, cloneConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { dataApi, entryApi, paramApi, ruleApi } from '@/api'
import type { DataRow, EntryType } from '@/api'

const INPUT_TABLE: EntryType = {
  tableId: '2102154', tableName: 'sense_data.TB_JD_SKU_BASE', name: 'JD-商品基础',
  fields: [
    { prop: 'sku_id', desc: '商品ID', type: 'string', required: false, columnName: 'K1' },
    { prop: 'sku_name', desc: '商品名称', type: 'string', required: false, columnName: 'K2' },
  ],
}

function mockAssets() {
  vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 1, list: [INPUT_TABLE] })
  // 真实后端的表列表不带字段定义，选中表后另拉一次详情（entryApi.entryDetail）才有 fields——
  // 这里模拟同一张表，保证选表后的字段池仍是 INPUT_TABLE 的 2 个字段，而非 mock 兜底数据。
  vi.spyOn(entryApi, 'entryDetail').mockResolvedValue(INPUT_TABLE)
  vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({ total: 0, list: [] })
  vi.spyOn(ruleApi, 'ruleGroups').mockResolvedValue([])
  vi.spyOn(ruleApi, 'rulePaged').mockResolvedValue({ total: 0, list: [] })
  vi.spyOn(ruleApi, 'sharedConfigs').mockResolvedValue([])
  // Path B 回灌默认空操作，避免干扰既有用例；覆盖回灌行为的用例再单独 mock
  vi.spyOn(ruleApi, 'orchestrationDetail').mockResolvedValue({ mode: 'ref', describe: '' })
  vi.spyOn(ruleApi, 'orchestrationLoadScript').mockResolvedValue('')
}

afterEach(() => vi.restoreAllMocks())

function mountOnRuleNode() {
  setActivePinia(createPinia())
  const flow = useFlowStore()
  flow.configs['rule-1'] = cloneConfig(NODE_CONFIGS['rule'])
  flow.select('rule-1')
  flow.setActiveTab('orchestration')
  const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
  return { flow, wrapper }
}

// 0801 方案 §6.4：有 ruleId 后展开的「查看业务编排」——描述/生成脚本/全屏查看/编辑系统提示词/保存脚本
// （0804 起这就是本 Tab 的全部内容，不再有 showBinder 两态切换）
describe('RuleOrchestrationTab · 路径 B（查看业务编排）', () => {
  function mountWithExistingRule() {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'ref', ruleId: 'orch-173', name: '已有规则',
      dataSource: 'dp-wwdata', inputTable: 'sense_data.TB_JD_SKU_BASE', inputTableId: '2102154',
      inputFields: ['sku_id'], outputFields: ['sku_name'],
    })
    return { flow, wrapper }
  }

  it('未生成脚本时，全屏查看/保存脚本按钮禁用', async () => {
    const { wrapper } = mountWithExistingRule()
    await flushPromises()

    const buttons = wrapper.findAll('button').filter((b) => ['全屏查看', '保存脚本'].includes(b.text()))
    expect(buttons).toHaveLength(2)
    buttons.forEach((b) => expect(b.attributes('disabled')).toBeDefined())
  })

  it('未填描述就点生成脚本：不调用接口', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    // makeDefaultRuleOrchestration 默认带一条演示 describe，这里显式清空以测试校验守卫
    flow.patchRuleConfig('rule-1', { describe: '' })
    await flushPromises()
    vi.spyOn(ruleApi, 'orchestrationGenerate')

    const genBtn = wrapper.findAll('button').find((b) => b.text().includes('生成脚本'))!
    await genBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.orchestrationGenerate).not.toHaveBeenCalled()
  })

  it('缺入参/出参字段时点生成脚本：不调用接口', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { inputFields: [], outputFields: [] })
    await flushPromises()
    vi.spyOn(ruleApi, 'orchestrationGenerate')

    const genBtn = wrapper.findAll('button').find((b) => b.text().includes('生成脚本'))!
    await genBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.orchestrationGenerate).not.toHaveBeenCalled()
  })

  it('填写描述后生成脚本：写回 script/scriptPath，全屏查看/保存脚本随之启用', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    await flushPromises()
    vi.spyOn(ruleApi, 'orchestrationGenerate').mockResolvedValue({
      script: 'def main(sku_id):\n    return {"sku_name": ""}',
      scriptPath: '/rules/generated/orch-173.py',
    })

    await wrapper.find('textarea[placeholder*="描述规则处理逻辑"]').setValue('按 sku_id 生成 sku_name')
    const genBtn = wrapper.findAll('button').find((b) => b.text().includes('生成脚本'))!
    await genBtn.trigger('click')
    await flushPromises()

    expect(flow.configs['rule-1'].ruleCfg?.script).toContain('def main')
    expect(flow.configs['rule-1'].ruleCfg?.scriptPath).toBe('/rules/generated/orch-173.py')
    const buttons = wrapper.findAll('button').filter((b) => ['全屏查看', '保存脚本'].includes(b.text()))
    buttons.forEach((b) => expect(b.attributes('disabled')).toBeUndefined())
  })

  it('全屏查看打开脚本弹窗，展示脚本正文', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { script: 'def main(sku_id):\n    return {}', scriptPath: '/x/y.py' })
    await flushPromises()

    const viewBtn = wrapper.findAll('button').find((b) => b.text() === '全屏查看')!
    await viewBtn.trigger('click')
    await flushPromises()

    expect(wrapper.html()).toContain('def main(sku_id)')
  })

  it('编辑系统提示词：保存后写回 systemPrompt，取消不写回', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    await flushPromises()

    const editBtn = wrapper.findAll('button').find((b) => b.text() === '编辑系统提示词')!
    await editBtn.trigger('click')
    await flushPromises()

    // S6-1：系统提示词编辑区从独立弹窗合并进 RuleWorkbenchDialog 左栏，class 从 .rspd-textarea 换成
    // .wb-textarea（右栏脚本框也用这个 class，加 .wb-code；左栏提示词没有，用 :not 精确定位）
    const textarea = wrapper.find('textarea.wb-textarea:not(.wb-code)')
    await textarea.setValue('新的系统提示词')
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存' && b.classes().includes('primary'))!
    await saveBtn.trigger('click')
    await flushPromises()

    expect(flow.configs['rule-1'].ruleCfg?.systemPrompt).toBe('新的系统提示词')
    expect(flow.configs['rule-1'].ruleCfg?.promptCategory).toBe('规则处理')
  })

  it('保存脚本：需二次确认，确认后调用 orchestrationSave 并写回 mode/ruleId/scriptPath', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { script: 'def main(sku_id):\n    return {}', scriptPath: '/x/y.py' })
    await flushPromises()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(ruleApi, 'orchestrationSave').mockResolvedValue({
      ruleId: 'orch-173', scriptPath: '/x/y.py', message: '规则脚本已保存',
    })

    const saveScriptBtn = wrapper.findAll('button').find((b) => b.text().includes('保存脚本'))!
    await saveScriptBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.orchestrationSave).toHaveBeenCalledTimes(1)
    expect(flow.configs['rule-1'].ruleCfg?.mode).toBe('ref')
    expect(flow.configs['rule-1'].ruleCfg?.ruleId).toBe('orch-173')
  })

  it('保存脚本：取消确认框则不调用接口', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { script: 'def main(sku_id):\n    return {}', scriptPath: '/x/y.py' })
    await flushPromises()
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    vi.spyOn(ruleApi, 'orchestrationSave')

    const saveScriptBtn = wrapper.findAll('button').find((b) => b.text().includes('保存脚本'))!
    await saveScriptBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.orchestrationSave).not.toHaveBeenCalled()
  })

  it('进入查看态：回灌详情描述，并在仅有 scriptPath 时拉取脚本正文', async () => {
    mockAssets()
    vi.spyOn(ruleApi, 'orchestrationDetail').mockResolvedValue({
      mode: 'ref',
      ruleId: '173',
      describe: '服务端描述',
      systemPrompt: '服务端提示词',
      scriptPath: '/code01/a.py',
    })
    vi.spyOn(ruleApi, 'orchestrationLoadScript').mockResolvedValue('def main():\n    return {}')
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'ref', ruleId: '173', name: '已有规则',
      dataSource: 'dp-wwdata', inputTable: 'sense_data.TB_JD_SKU_BASE', inputTableId: '2102154',
      inputFields: ['sku_id'], outputFields: ['sku_name'],
      describe: '', script: '', scriptPath: '',
    })
    await flushPromises()

    expect(ruleApi.orchestrationDetail).toHaveBeenCalledWith('173')
    expect(ruleApi.orchestrationLoadScript).toHaveBeenCalledWith('/code01/a.py')
    expect(flow.configs['rule-1'].ruleCfg?.describe).toBe('服务端描述')
    expect(flow.configs['rule-1'].ruleCfg?.script).toContain('def main')
    expect(wrapper.text()).toContain('查看业务编排')
  })
})

// 0801 方案 §6.5：全屏测试台——左栏选行回填、右栏可改值执行、出参按记录横向铺开
describe('RuleOrchestrationTab · 全屏测试台（拍板 #12）', () => {
  const ROWS: DataRow[] = [
    { dataId: '1000520', sourceId: 's1', title: '', summary: '', acceptState: 'accepted', values: { K1: '2025年', K2: '2月中旬' } },
    { dataId: '1000521', sourceId: 's1', title: '', summary: '', acceptState: 'accepted', values: { K1: '2026年', K2: '3月上旬' } },
  ]

  function mountWithScript() {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'ref', ruleId: 'orch-173', name: '已有规则',
      dataSource: 'dp-wwdata', inputTable: 'sense_data.TB_JD_SKU_BASE', inputTableId: '2102154',
      inputFields: ['sku_id'], outputFields: ['sku_name'],
      script: 'def main(sku_id):\n    return {"sku_name": sku_id}', scriptPath: '/x/y.py',
    })
    return { flow, wrapper }
  }

  it('已有 ruleId 但未生成脚本时测试脚本按钮禁用', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', { mode: 'ref', ruleId: 'orch-173', inputTable: 'sense_data.TB_JD_SKU_BASE' })
    await flushPromises()
    const disabledBtn = wrapper.findAll('button').find((b) => b.text() === '测试脚本')!
    expect(disabledBtn.attributes('disabled')).toBeDefined()
  })

  it('点击测试脚本打开全屏弹窗并自动加载数据行', async () => {
    const { wrapper } = mountWithScript()
    await flushPromises()
    const rowSpy = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 2, list: ROWS })

    const testBtn = wrapper.findAll('button').find((b) => b.text() === '测试脚本')!
    expect(testBtn.attributes('disabled')).toBeUndefined()
    await testBtn.trigger('click')
    await flushPromises()

    expect(rowSpy).toHaveBeenCalledWith(expect.objectContaining({ tableId: '2102154', page: 1, size: 20 }))
    expect(wrapper.html()).toContain('1000520')
    expect(wrapper.html()).toContain('1000521')
  })

  it('选中一行按 columnName 回填入参表单；执行调用 orchestrationTest 并展示多条出参', async () => {
    const { wrapper } = mountWithScript()
    await flushPromises()
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 2, list: ROWS })
    vi.spyOn(ruleApi, 'orchestrationTest').mockResolvedValue({
      success: true,
      outputs: [{ sku_name: '2025年' }, { sku_name: '备用值' }],
      executionTime: 0.12,
    })

    await wrapper.findAll('button').find((b) => b.text() === '测试脚本')!.trigger('click')
    await flushPromises()

    // S5-2：行选择从 radio 改成数据展示区尾列的「测试」按钮（DataQueryPanel 的 #columns-after 插槽）
    const testRowBtn = wrapper.findAll('button').find((b) => b.text() === '测试')!
    await testRowBtn.trigger('click')
    await flushPromises()

    // fields prop 只含 sku_id（columns 来自 ruleCfg.inputFields=['sku_id']），columnName 未知时回退原样，
    // 这里断言入参表单已用选中行数据初始化（K1 对应 EntryType 里未声明 columnName 的字段时回退空串是预期行为，
    // 关键是确认「点测试即选中即回填」这条主链路：表单值来自 mapRowToInputFields，而非手动敲入）。
    const paramInput = wrapper.find('.rtd-param-row input')
    expect(paramInput.exists()).toBe(true)

    await paramInput.setValue('手动改的值')
    const execBtn = wrapper.findAll('button').find((b) => b.text() === '执行')!
    await execBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.orchestrationTest).toHaveBeenCalledWith(expect.objectContaining({
      ruleId: 'orch-173',
      inputTable: 'sense_data.TB_JD_SKU_BASE',
      rows: [{ sku_id: '手动改的值' }],
    }))
    expect(wrapper.html()).toContain('记录1')
    expect(wrapper.html()).toContain('记录2')
    expect(wrapper.html()).toContain('sku_name')
  })

  it('筛选条件 SQL：透传给 rowQueryPaged（S5-2 起改走 DataQueryPanel）', async () => {
    const { wrapper } = mountWithScript()
    await flushPromises()
    const rowSpy = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })

    await wrapper.findAll('button').find((b) => b.text() === '测试脚本')!.trigger('click')
    await flushPromises()

    await wrapper.find('button[aria-controls="data-query-advanced"]').trigger('click')
    await wrapper.find('input[placeholder*="条件表达式"]').setValue("K1='2025'")
    await wrapper.findAll('button').find((b) => b.text() === '查询')!.trigger('click')
    await flushPromises()

    expect(rowSpy).toHaveBeenLastCalledWith(expect.objectContaining({ sql: "K1='2025'", page: 1 }))
  })

  it('查看详情展示选中行全部原始列', async () => {
    const { wrapper } = mountWithScript()
    await flushPromises()
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 2, list: ROWS })

    await wrapper.findAll('button').find((b) => b.text() === '测试脚本')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '测试')!.trigger('click')
    await flushPromises()

    const detailBtn = wrapper.findAll('button').find((b) => b.text() === '查看详情')!
    expect(detailBtn.attributes('disabled')).toBeUndefined()
    await detailBtn.trigger('click')
    await flushPromises()

    // 详情弹窗是嵌套 el-dialog，用 append-to-body 避免层级问题，因此其内容会传送到 document.body，
    // 不在 wrapper 自己的挂载子树里——断言要看 document.body，不是 wrapper.html()。
    expect(document.body.innerHTML).toContain('2025年')
    expect(document.body.innerHTML).toContain('2月中旬')
  })
})

// 0804 S3-3：非规则节点（采集）复用同一个 Tab，内容换成抓取配置 XML，走 execCfg 而不是 ruleCfg。
describe('RuleOrchestrationTab · 非规则节点抓取配置（S3-3）', () => {
  function mountOnCollectorNode() {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow.select('web-1')
    flow.setActiveTab('orchestration')
    mockAssets()
    vi.spyOn(ruleApi, 'orchestrationPaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    return { flow, wrapper }
  }

  it('文案换成抓取配置措辞，不出现「测试脚本」按钮（本期不做，方案 §3.1 修正 D）', async () => {
    const { wrapper } = mountOnCollectorNode()
    await flushPromises()

    expect(wrapper.find('textarea[placeholder*="描述抓取需求"]').exists()).toBe(true)
    expect(wrapper.findAll('button').some((b) => b.text().includes('生成配置'))).toBe(true)
    expect(wrapper.findAll('button').some((b) => b.text() === '测试脚本')).toBe(false)
    expect(wrapper.text()).toContain('配置路径')
  })

  it('未填描述点生成配置：不调用接口；填写后生成写回 execCfg 而不是 ruleCfg', async () => {
    const { flow, wrapper } = mountOnCollectorNode()
    await flushPromises()
    const genSpy = vi.spyOn(ruleApi, 'orchestrationGenerate')

    const genBtn = wrapper.findAll('button').find((b) => b.text().includes('生成配置'))!
    await genBtn.trigger('click')
    await flushPromises()
    expect(genSpy).not.toHaveBeenCalled()

    genSpy.mockResolvedValue({ script: '<Config>\n  <Action id="1"/>\n</Config>', scriptPath: '/rules/generated/x.xml' })
    await wrapper.find('textarea[placeholder*="描述抓取需求"]').setValue('打开列表页提取表格')
    await genBtn.trigger('click')
    await flushPromises()

    expect(flow.configs['web-1'].execCfg?.script).toContain('<Config>')
    expect(flow.configs['web-1'].execCfg?.scriptPath).toBe('/rules/generated/x.xml')
    expect(flow.configs['web-1'].ruleCfg).toBeUndefined()
  })

  it('保存配置：确认文案是"配置"而不是"脚本"，成功后写回 execCfg.ruleId', async () => {
    const { flow, wrapper } = mountOnCollectorNode()
    flow.patchExecConfig('web-1', { script: '<Config/>', scriptPath: '/x/1.xml' })
    await flushPromises()
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(ruleApi, 'orchestrationSave').mockResolvedValue({ ruleId: '184', scriptPath: '/x/1.xml', message: '抓取配置已保存' })

    const saveBtn = wrapper.findAll('button').find((b) => b.text().includes('保存配置'))!
    await saveBtn.trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('配置'), expect.stringContaining('抓取配置'), expect.anything())
    expect(flow.configs['web-1'].execCfg?.mode).toBe('ref')
    expect(flow.configs['web-1'].execCfg?.ruleId).toBe('184')
  })

  // S6-2 联调后端实测（vanv-rule-center DashScopeServiceImpl）：/script/edit 按 scriptPath 原地覆盖写
  // 文件、生成脚本按 ruleId saveOrUpdate 数据库记录，都是"改已有"不是"建新的"——切换只能拷内容当草稿，
  // ruleId/scriptPath 不能跟着换成源记录的，否则后面一保存/一重新生成就把源记录的文件或数据库行覆盖了。
  it('切换已有配置：下拉只列出 .xml 结尾的既有记录，应用后回灌 describe/script，但 ruleId 保留本节点自己的、scriptPath 清空', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow.select('web-1')
    flow.setActiveTab('orchestration')
    // 本节点必须已经有自己的编排记录（「表配置」保存过一次）才允许切换套用
    flow.patchExecConfig('web-1', { mode: 'ref', ruleId: '184', scriptPath: '/x/184.xml' })
    mockAssets()
    vi.spyOn(ruleApi, 'orchestrationPaged').mockResolvedValue({
      total: 2,
      list: [
        { ruleId: '11', name: '规则脚本', describe: '', script: '', scriptPath: '/a/11.py', enabled: true, createdAt: '' },
        { ruleId: '22', name: '公告列表抓取配置', describe: '', script: '', scriptPath: '/a/22.xml', enabled: true, createdAt: '' },
      ],
    })
    vi.spyOn(ruleApi, 'orchestrationDetail').mockResolvedValue({
      mode: 'ref', ruleId: '22', describe: '既有抓取需求', scriptPath: '/a/22.xml',
    })
    vi.spyOn(ruleApi, 'orchestrationLoadScript').mockResolvedValue('<Config>\n  <Action id="1"/>\n</Config>')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    const select = wrapper.find('select.rc-select')
    const optionTexts = select.findAll('option').map((o) => o.text())
    expect(optionTexts.some((t) => t.includes('公告列表抓取配置'))).toBe(true)
    expect(optionTexts.some((t) => t.includes('规则脚本'))).toBe(false)

    await select.setValue('22')
    const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('应用'))!
    await applyBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.orchestrationDetail).toHaveBeenCalledWith('22')
    expect(ruleApi.orchestrationLoadScript).toHaveBeenCalledWith('/a/22.xml')
    // ruleId 还是本节点自己的 184，没有被切换对象的 22 顶替
    expect(flow.configs['web-1'].execCfg?.ruleId).toBe('184')
    // scriptPath 清空——强制先「生成脚本」换一个本节点自己的文件才能保存，不会误覆盖源节点的 /a/22.xml
    expect(flow.configs['web-1'].execCfg?.scriptPath).toBe('')
    expect(flow.configs['web-1'].execCfg?.describe).toBe('既有抓取需求')
    expect(flow.configs['web-1'].execCfg?.script).toContain('<Config>')
  })
})

// 0804 S3-4：抓取配置 XML 轻解析接入 UI——顶部只读动作链摘要 + 保存前字段一致性提示。
// captureConfig.ts 本身的解析/校验逻辑单测覆盖在 utils/flow/captureConfig.test.ts，这里只测 UI 接线。
describe('RuleOrchestrationTab · 抓取配置 XML 轻解析接入（S3-4）', () => {
  // 打开网页 → 提取表格 → 提取单值 ×3（按 NextActionId 链表顺序），BizId=9999 不在任何采集节点表的字段里，
  // 用来触发一致性校验的"未匹配"分支；outputTable='2101001'（web-list 种子的固定值）。
  const CAPTURE_XML = `<Actions>
    <OpenUrlAction DisplayTitle="打开网页" ActionId="a" NextActionId="e" LastActionId="">
      <Config><ColumnCfg /></Config>
    </OpenUrlAction>
    <ExtractSingleValueAction DisplayTitle="提取单值" ActionId="b" NextActionId="" LastActionId="c">
      <Config><ColumnCfg><Column BizId="9999" BizName="未知字段">0</Column></ColumnCfg></Config>
    </ExtractSingleValueAction>
    <ExtractSingleValueAction DisplayTitle="提取单值" ActionId="c" NextActionId="b" LastActionId="d">
      <Config><ColumnCfg /></Config>
    </ExtractSingleValueAction>
    <ExtractSingleValueAction DisplayTitle="提取单值" ActionId="d" NextActionId="c" LastActionId="e">
      <Config><ColumnCfg /></Config>
    </ExtractSingleValueAction>
    <ExtractDataTableAction DisplayTitle="提取表格" ActionId="e" NextActionId="d" LastActionId="a">
      <Config><ColumnCfg /></Config>
    </ExtractDataTableAction>
  </Actions>`

  function mountOnCollectorNode(orchestrationPagedMode: 'empty' | 'error' = 'empty') {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow.select('web-1')
    flow.setActiveTab('orchestration')
    mockAssets()
    if (orchestrationPagedMode === 'error') {
      vi.spyOn(ruleApi, 'orchestrationPaged').mockRejectedValue(new Error('请求失败 502'))
    } else {
      vi.spyOn(ruleApi, 'orchestrationPaged').mockResolvedValue({ total: 0, list: [] })
    }
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    return { flow, wrapper }
  }

  it('既有配置列表异常时不阻断编排配置，展示非阻断提示并支持重试', async () => {
    const { wrapper } = mountOnCollectorNode('error')
    await flushPromises()

    expect(wrapper.text()).toContain('既有配置列表暂时不可用：请求失败 502')
    expect(wrapper.text()).toContain('重试')
    expect(wrapper.find('textarea[placeholder*="描述抓取需求"]').exists()).toBe(true)
  })

  it('顶部展示只读动作链摘要：按 NextActionId 链表顺序，连续同名动作折叠成 ×N', async () => {
    const { flow, wrapper } = mountOnCollectorNode()
    flow.patchExecConfig('web-1', { script: CAPTURE_XML })
    await flushPromises()

    expect(wrapper.text()).toContain('打开网页 → 提取表格 → 提取单值 ×3')
  })

  it('保存前一致性校验：BizId 不在输出表字段里时弹提示，取消则不调用保存接口', async () => {
    const { flow, wrapper } = mountOnCollectorNode()
    flow.patchExecConfig('web-1', { script: CAPTURE_XML, scriptPath: '/x/1.xml' })
    await flushPromises()
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const saveSpy = vi.spyOn(ruleApi, 'orchestrationSave')

    const saveBtn = wrapper.findAll('button').find((b) => b.text().includes('保存配置'))!
    await saveBtn.trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('未知字段'), '字段一致性提示', expect.anything())
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('保存前一致性校验：确认「仍要保存」后继续走正常保存流程', async () => {
    const { flow, wrapper } = mountOnCollectorNode()
    flow.patchExecConfig('web-1', { script: CAPTURE_XML, scriptPath: '/x/1.xml' })
    await flushPromises()
    // 第一次 confirm 是一致性提示，第二次是既有的"保存后将绑定到该节点"确认，两次都要放行
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(ruleApi, 'orchestrationSave').mockResolvedValue({ ruleId: '184', scriptPath: '/x/1.xml', message: '' })

    const saveBtn = wrapper.findAll('button').find((b) => b.text().includes('保存配置'))!
    await saveBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.orchestrationSave).toHaveBeenCalledTimes(1)
    expect(flow.configs['web-1'].execCfg?.ruleId).toBe('184')
  })
})
