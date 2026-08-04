// @vitest-environment jsdom
// 编排配置 Tab · 路径 A 覆盖（0801 方案 §6.2/§7.2）：本 PR 只做「新增业务规则→保存元数据拿 ruleId」，
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
  vi.spyOn(ruleApi, 'orchestrationPaged').mockResolvedValue({ total: 0, list: [] })
  // Path B 回灌默认空操作，避免干扰既有用例；覆盖回灌行为的用例再单独 mock
  vi.spyOn(ruleApi, 'orchestrationDetail').mockResolvedValue({ mode: 'ref', describe: '' })
  vi.spyOn(ruleApi, 'orchestrationLoadScript').mockResolvedValue('')
  // 0803：表来源换成跨租户搜索，默认空数组；client.ts 的 mock 路径有 120ms 人为延迟，
  // 用例里要用到真实数据时必须显式 spy 覆盖，不能指望走内置 mock 注册表（见下方用例注释）。
  vi.spyOn(ruleApi, 'orchestrationTableSearch').mockResolvedValue([])
  vi.spyOn(ruleApi, 'orchestrationTableFields').mockResolvedValue([])
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

describe('RuleOrchestrationTab · 路径 A（新增业务规则）', () => {
  it('未保存时展示表/字段绑定表单，不展示只读摘要', async () => {
    mockAssets()
    const { wrapper } = mountOnRuleNode()
    await flushPromises()

    expect(wrapper.text()).toContain('保存业务规则')
    expect(wrapper.text()).not.toContain('修改表字段')
  })

  it('未填必填项就保存：不调用接口，停留在表单', async () => {
    mockAssets()
    vi.spyOn(ruleApi, 'orchestrationSaveMeta')
    const { wrapper } = mountOnRuleNode()
    await flushPromises()

    await wrapper.find('button.rc-btn.primary').trigger('click')
    await flushPromises()

    expect(ruleApi.orchestrationSaveMeta).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('保存业务规则')
  })

  it('选表勾字段填名称后保存：拿到 ruleId，同步 NodeConfig 输入表，转为只读摘要', async () => {
    mockAssets()
    // client.ts 的 mock 路径有人为 120ms delay 模拟网络；直接 spy 具体方法绕开它，测试才能确定性地在
    // 一次 flushPromises 后拿到结果（其余走 mockAssets() 的资产加载调用同理，均已直接 spy）。
    vi.spyOn(ruleApi, 'orchestrationSaveMeta').mockResolvedValue({ ruleId: 'orch-999', message: '业务规则已保存' })
    // 0803：表来源换成跨租户搜索（RuleTableFieldBinder 内部直调 ruleApi），这里给一条真实感数据
    vi.spyOn(ruleApi, 'orchestrationTableSearch').mockResolvedValue([
      { tableId: '2102154', tableName: 'JD-商品基础', dbTableName: 'sense_data.TB_JD_SKU_BASE', keyField: 'K1,K2', ownerUserCode: 'ht_poc' },
    ])
    vi.spyOn(ruleApi, 'orchestrationTableFields').mockResolvedValue([
      { itemCode: 'sku_id', itemName: '商品ID', columnName: 'K1', dataType: 'string', seq: 1 },
      { itemCode: 'sku_name', itemName: '商品名称', columnName: 'K2', dataType: 'string', seq: 2 },
    ])
    const { flow, wrapper } = mountOnRuleNode()
    await flushPromises()

    // 规则名称：新建态是 el-select combobox（模糊搜索已有规则 / 新建二合一，0803 会议），
    // 未匹配到已有项时 change 事件即视为新建名称（见 RuleTableFieldBinder#onNameSelect）
    const nameSelect = wrapper.findAllComponents({ name: 'ElSelect' })[0]
    await nameSelect.vm.$emit('change', '邮箱附件转换指标数据规则')
    // 输入表：0803 起是跨租户远程搜索（remote + remote-method），先触发 visible-change 拉一次初始结果，
    // 再通过组件事件选中；名称 combobox 排在它前面，索引 +1
    const tableSelects = wrapper.findAllComponents({ name: 'ElSelect' })
    expect(tableSelects.length).toBeGreaterThanOrEqual(2)
    await tableSelects[1].vm.$emit('visible-change', true)
    await flushPromises()
    await tableSelects[1].vm.$emit('update:modelValue', '2102154')
    await flushPromises()

    // 展开入参/出参可选池并各选一个字段（toggle 文案含「可选」，避开「显示系统字段」）
    const expandButtons = wrapper.findAll('button.rc-tag-toggle').filter((b) => b.text().includes('可选'))
    expect(expandButtons).toHaveLength(2)
    await expandButtons[0].trigger('click')
    await expandButtons[1].trigger('click')
    const tags = wrapper.findAll('.rc-tag-pool .rc-tag')
    await tags[0].trigger('click') // 入参池第一个字段
    const outputTags = wrapper.findAll('.rc-tag-pool')[1].findAll('.rc-tag')
    await outputTags[0].trigger('click') // 出参池第一个字段

    await wrapper.find('button.rc-btn.primary').trigger('click')
    await flushPromises()

    expect(flow.configs['rule-1'].ruleCfg?.ruleId).toBeTruthy()
    expect(flow.configs['rule-1'].ruleCfg?.mode).toBe('ref')
    // 表相关字段同步到 NodeConfig：节点侧存 tableId，不是物理表名（0801 方案 §4.6）
    expect(flow.configs['rule-1'].inputTable).toBe('2102154')
    expect(wrapper.text()).toContain('修改表字段')
    expect(wrapper.text()).toContain('邮箱附件转换指标数据规则')
    // 0803 追加：输入表选中项自带 ownerUserCode，保存时应传给 saveMeta 而不是登录账号
    expect(flow.configs['rule-1'].ruleCfg?.userCode).toBe('ht_poc')
    expect(ruleApi.orchestrationSaveMeta).toHaveBeenCalledWith(expect.anything(), 'ht_poc')
  })

  it('切换数据源清空已选表/字段/租户归属', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      inputTableId: '2102154', inputTable: 'sense_data.TB_JD_SKU_BASE', userCode: 'ht_poc',
      inputFields: ['sku_id'], outputFields: ['sku_name'],
    })
    await flushPromises()

    const dsButtons = wrapper.findAll('.rc-segment button')
    const newsButton = dsButtons.find((b) => b.text() === '资讯库')!
    await newsButton.trigger('click')
    await flushPromises()

    expect(flow.configs['rule-1'].ruleCfg?.inputTableId).toBe('')
    expect(flow.configs['rule-1'].ruleCfg?.inputFields).toEqual([])
    expect(flow.configs['rule-1'].ruleCfg?.outputFields).toEqual([])
    expect(flow.configs['rule-1'].ruleCfg?.userCode).toBeUndefined()
  })

  it('保存后点击「修改表字段」回到可编辑态', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'ref', ruleId: 'orch-173', name: '已有规则',
      dataSource: 'dp-wwdata', inputTable: 'sense_data.TB_JD_SKU_BASE', inputTableId: '2102154',
      inputFields: ['sku_id'], outputFields: ['sku_name'],
    })
    await flushPromises()

    expect(wrapper.text()).toContain('修改表字段')
    await wrapper.find('button.rc-btn').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('保存业务规则')
  })
})

// 0803 会议追加：编排列表整页仍后置，但规则名称 combobox 支持模糊搜索已有规则并引用（不依赖整页列表，
// 只需 orchestrationPaged + orchestrationDetail 两个已有接口）
describe('RuleOrchestrationTab · 规则名称引用已有规则', () => {
  const EXISTING_DETAIL = {
    mode: 'ref' as const, ruleId: '173', name: '邮箱附件转换指标数据规则', describe: '既有描述',
    dataSource: 'dp-wwdata' as const, inputTable: 'sense_data.TB_JD_SKU_BASE',
    inputFields: ['sku_id'], outputFields: ['sku_name'],
  }

  // 0803：反查 tableId 换成跨租户搜索，测试里给一条 dbTableName 与 EXISTING_DETAIL.inputTable 一致的记录，
  // tableId 沿用旧夹具的 '2102154' 保持断言不变
  const MATCHED_TABLE = {
    tableId: '2102154', tableName: 'JD-商品基础', dbTableName: 'sense_data.TB_JD_SKU_BASE',
    keyField: 'K1,K2', ownerUserCode: 'ht_poc',
  }

  function mockAssetsWithExisting() {
    mockAssets()
    vi.spyOn(ruleApi, 'orchestrationPaged').mockResolvedValue({
      total: 1,
      list: [{ ...EXISTING_DETAIL, script: '', scriptPath: '/code01/173.py', enabled: true, createdAt: '2026-07-21' }],
    })
    vi.spyOn(ruleApi, 'orchestrationTableSearch').mockResolvedValue([MATCHED_TABLE])
  }

  it('模糊搜索命中已有规则并选中：拉详情落地为只读摘要，mode 转 ref，NodeConfig 表同步', async () => {
    mockAssetsWithExisting()
    vi.spyOn(ruleApi, 'orchestrationDetail').mockResolvedValue({ ...EXISTING_DETAIL, systemPrompt: '既有提示词', scriptPath: '/code01/173.py' })
    vi.spyOn(ruleApi, 'orchestrationLoadScript').mockResolvedValue('def main(sku_id):\n    return {}')
    const { flow, wrapper } = mountOnRuleNode()
    await flushPromises()

    const nameSelect = wrapper.findAllComponents({ name: 'ElSelect' })[0]
    await nameSelect.vm.$emit('change', '邮箱附件转换指标数据规则')
    await flushPromises()

    expect(ruleApi.orchestrationDetail).toHaveBeenCalledWith('173')
    expect(flow.configs['rule-1'].ruleCfg?.mode).toBe('ref')
    expect(flow.configs['rule-1'].ruleCfg?.ruleId).toBe('173')
    expect(flow.configs['rule-1'].ruleCfg?.script).toContain('def main')
    expect(flow.configs['rule-1'].inputTable).toBe('2102154')
    expect(wrapper.text()).toContain('修改表字段')
  })

  it('引用规则的输入表与当前节点已选表冲突：弹确认框，取消则保持原状态不覆盖', async () => {
    mockAssetsWithExisting()
    vi.spyOn(ruleApi, 'orchestrationDetail').mockResolvedValue(EXISTING_DETAIL)
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', { inputTableId: 'other-table-id', inputTable: 'sense_data.OTHER' })
    await flushPromises()

    const nameSelect = wrapper.findAllComponents({ name: 'ElSelect' })[0]
    await nameSelect.vm.$emit('change', '邮箱附件转换指标数据规则')
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
    expect(flow.configs['rule-1'].ruleCfg?.mode).toBe('new')
    expect(flow.configs['rule-1'].ruleCfg?.ruleId).toBeUndefined()
    expect(flow.configs['rule-1'].ruleCfg?.inputTableId).toBe('other-table-id')
  })

  it('引用规则表冲突，确认覆盖后应用引用规则的表/字段配置', async () => {
    mockAssetsWithExisting()
    vi.spyOn(ruleApi, 'orchestrationDetail').mockResolvedValue(EXISTING_DETAIL)
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', { inputTableId: 'other-table-id', inputTable: 'sense_data.OTHER' })
    await flushPromises()

    const nameSelect = wrapper.findAllComponents({ name: 'ElSelect' })[0]
    await nameSelect.vm.$emit('change', '邮箱附件转换指标数据规则')
    await flushPromises()

    expect(flow.configs['rule-1'].ruleCfg?.mode).toBe('ref')
    expect(flow.configs['rule-1'].ruleCfg?.inputTableId).toBe('2102154')
    expect(flow.configs['rule-1'].inputTable).toBe('2102154')
  })

  it('输入未匹配任何已有规则的新名称：仅新建，不触发引用', async () => {
    mockAssetsWithExisting()
    vi.spyOn(ruleApi, 'orchestrationDetail')
    const { flow, wrapper } = mountOnRuleNode()
    await flushPromises()

    const nameSelect = wrapper.findAllComponents({ name: 'ElSelect' })[0]
    await nameSelect.vm.$emit('change', '一个全新的规则名')
    await flushPromises()

    expect(ruleApi.orchestrationDetail).not.toHaveBeenCalled()
    expect(flow.configs['rule-1'].ruleCfg?.name).toBe('一个全新的规则名')
    expect(flow.configs['rule-1'].ruleCfg?.mode).toBe('new')
  })

  it('已绑定 ruleId 后点「修改表字段」：名称仍是可搜索下拉，选中别的已有规则即整体切换引用目标', async () => {
    mockAssetsWithExisting()
    vi.spyOn(ruleApi, 'orchestrationDetail').mockResolvedValue(EXISTING_DETAIL)
    // 旧规则的表（other-table-id）与新选规则的表（173 → 2102154）不一致，会触发表冲突确认
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'ref', ruleId: 'orch-old', name: '旧规则',
      dataSource: 'dp-wwdata', inputTable: 'sense_data.OLD', inputTableId: 'other-table-id',
      inputFields: ['x'], outputFields: ['y'],
    })
    await flushPromises()

    await wrapper.find('button.rc-btn').trigger('click') // 修改表字段 → 回到 showBinder 态
    await flushPromises()

    // 编辑态下名称也是 el-select，而非纯输入框
    const nameSelect = wrapper.findAllComponents({ name: 'ElSelect' })[0]
    expect(nameSelect.exists()).toBe(true)
    await nameSelect.vm.$emit('change', '邮箱附件转换指标数据规则')
    await flushPromises()

    expect(ruleApi.orchestrationDetail).toHaveBeenCalledWith('173')
    expect(flow.configs['rule-1'].ruleCfg?.ruleId).toBe('173')
    expect(flow.configs['rule-1'].ruleCfg?.name).toBe('邮箱附件转换指标数据规则')
    expect(flow.configs['rule-1'].ruleCfg?.mode).toBe('ref')
    expect(wrapper.text()).toContain('修改表字段') // 已切回只读摘要（editingMeta 被重置）
  })

  // REVIEW-2026-08-04 P1：反查表失败时不再"半应用"（inputTableId 空 + mode='ref' + 引用成功提示）——
  // 下面两个用例分别覆盖 matchedTable 落空的两条路径：search 抛错、search 正常返回但无匹配项。
  it('反查表失败（search 抛错）：不引用，保持原草稿状态', async () => {
    mockAssetsWithExisting()
    vi.spyOn(ruleApi, 'orchestrationDetail').mockResolvedValue(EXISTING_DETAIL)
    vi.spyOn(ruleApi, 'orchestrationTableSearch').mockRejectedValue(new Error('网络超时'))
    const { flow, wrapper } = mountOnRuleNode()
    await flushPromises()

    const nameSelect = wrapper.findAllComponents({ name: 'ElSelect' })[0]
    await nameSelect.vm.$emit('change', '邮箱附件转换指标数据规则')
    await flushPromises()

    expect(ruleApi.orchestrationDetail).toHaveBeenCalledWith('173')
    expect(flow.configs['rule-1'].ruleCfg?.mode).toBe('new')
    expect(flow.configs['rule-1'].ruleCfg?.ruleId).toBeUndefined()
    expect(flow.configs['rule-1'].ruleCfg?.inputTableId).toBeFalsy()
  })

  it('反查表成功但搜不到匹配的表：不引用，保持原草稿状态', async () => {
    mockAssetsWithExisting()
    vi.spyOn(ruleApi, 'orchestrationDetail').mockResolvedValue(EXISTING_DETAIL)
    vi.spyOn(ruleApi, 'orchestrationTableSearch').mockResolvedValue([]) // 搜索本身没报错，只是空结果
    const { flow, wrapper } = mountOnRuleNode()
    await flushPromises()

    const nameSelect = wrapper.findAllComponents({ name: 'ElSelect' })[0]
    await nameSelect.vm.$emit('change', '邮箱附件转换指标数据规则')
    await flushPromises()

    expect(flow.configs['rule-1'].ruleCfg?.mode).toBe('new')
    expect(flow.configs['rule-1'].ruleCfg?.ruleId).toBeUndefined()
    expect(flow.configs['rule-1'].ruleCfg?.inputTableId).toBeFalsy()
  })

  // REVIEW-2026-08-04 P1（补 6）：script/scriptPath 都空 + scriptPath 读取失败这两个分支之前没测
  it('引用规则的 script 与 scriptPath 都为空：不拉脚本，仍正常完成引用', async () => {
    mockAssetsWithExisting()
    vi.spyOn(ruleApi, 'orchestrationDetail').mockResolvedValue({ ...EXISTING_DETAIL, script: '', scriptPath: '' })
    const { flow, wrapper } = mountOnRuleNode()
    await flushPromises()

    const nameSelect = wrapper.findAllComponents({ name: 'ElSelect' })[0]
    await nameSelect.vm.$emit('change', '邮箱附件转换指标数据规则')
    await flushPromises()

    expect(ruleApi.orchestrationLoadScript).not.toHaveBeenCalled()
    expect(flow.configs['rule-1'].ruleCfg?.mode).toBe('ref')
    expect(flow.configs['rule-1'].ruleCfg?.ruleId).toBe('173')
    expect(flow.configs['rule-1'].ruleCfg?.script).toBe('')
  })

  it('引用规则时 scriptPath 读脚本失败：静默吞错，仍正常完成引用（script 留空）', async () => {
    mockAssetsWithExisting()
    vi.spyOn(ruleApi, 'orchestrationDetail').mockResolvedValue({ ...EXISTING_DETAIL, script: '', scriptPath: '/code01/173.py' })
    vi.spyOn(ruleApi, 'orchestrationLoadScript').mockRejectedValue(new Error('读取失败'))
    const { flow, wrapper } = mountOnRuleNode()
    await flushPromises()

    const nameSelect = wrapper.findAllComponents({ name: 'ElSelect' })[0]
    await nameSelect.vm.$emit('change', '邮箱附件转换指标数据规则')
    await flushPromises()

    expect(ruleApi.orchestrationLoadScript).toHaveBeenCalledWith('/code01/173.py')
    expect(flow.configs['rule-1'].ruleCfg?.mode).toBe('ref')
    expect(flow.configs['rule-1'].ruleCfg?.ruleId).toBe('173')
    expect(flow.configs['rule-1'].ruleCfg?.script).toBe('')
  })
})

// 0801 方案 §6.4：有 ruleId 后同屏展开的「查看业务编排」——描述/生成脚本/全屏查看/编辑系统提示词/保存脚本
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

    const textarea = wrapper.find('textarea.rspd-textarea')
    await textarea.setValue('新的系统提示词')
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存' && b.classes().includes('primary'))!
    await saveBtn.trigger('click')
    await flushPromises()

    expect(flow.configs['rule-1'].ruleCfg?.systemPrompt).toBe('新的系统提示词')
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

    const radio = wrapper.find('input[type="radio"]')
    await radio.trigger('change')
    await flushPromises()

    // fields prop 只含 sku_id（inputFieldOptions 来自 ruleCfg.inputFields=['sku_id']），columnName 未知时回退原样，
    // 这里断言入参表单已用选中行数据初始化（K1 对应 EntryType 里未声明 columnName 的字段时回退空串是预期行为，
    // 关键是确认「选行即回填」这条主链路：表单值来自 mapRowToInputFields，而非手动敲入）。
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

  it('筛选输入框查询：sql 条件透传给 rowQueryPaged', async () => {
    const { wrapper } = mountWithScript()
    await flushPromises()
    const rowSpy = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })

    await wrapper.findAll('button').find((b) => b.text() === '测试脚本')!.trigger('click')
    await flushPromises()

    await wrapper.find('input[placeholder*="筛选"]').setValue("K1='2025'")
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
    await wrapper.find('input[type="radio"]').trigger('change')
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
