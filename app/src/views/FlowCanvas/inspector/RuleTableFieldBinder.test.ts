// @vitest-environment jsdom
// 0805 改判：表来源从 vrule 搜索改回 entryApi（跟采集中心其他节点的表配置同源，见组件顶部注释）。
// entryApi.entryPaged 不支持外部 AbortSignal，快速连打字时靠 requestSeq 丢弃过期结果（不是真正
// abort 网络请求）——下面第一个 describe 块覆盖这条防护，取代旧版基于 AbortController 的用例。
// 不使用 vi.useFakeTimers（debounce 用 setTimeout，与 fake timers 配合不稳），改用真实等待 + 直接调组件实例的方法。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { ElMessage } from 'element-plus'
import RuleTableFieldBinder from './RuleTableFieldBinder.vue'
import TableEditDialog from './TableEditDialog.vue'
import { entryApi } from '@/api'
import type { EntryType, RuleFieldOption, RuleOrchestration } from '@/api'

function mountBinder(modelValue: Partial<RuleOrchestration> = {}) {
  setActivePinia(createPinia())
  const fullModel = {
    inputFields: [],
    outputFields: [],
    ...modelValue,
  }
  const inputFieldOptions: RuleFieldOption[] = []
  const outputFieldOptions: RuleFieldOption[] = []
  const wrapper = mount(RuleTableFieldBinder, {
    global: { plugins: [ElementPlus] },
    props: {
      modelValue: fullModel,
      inputFieldOptions,
      outputFieldOptions,
    },
  })
  return wrapper
}

afterEach(() => vi.restoreAllMocks())

describe('RuleTableFieldBinder · runSearch 防止旧请求覆盖新结果（requestSeq）', () => {
  it('快速连打字：先发的请求比后发的晚 resolve 时，旧结果不会覆盖新结果', async () => {
    const resolvers: Array<(v: { total: number; list: EntryType[] }) => void> = []
    vi.spyOn(entryApi, 'entryPaged').mockImplementation(
      () => new Promise((resolve) => { resolvers.push(resolve) }),
    )

    const wrapper = mountBinder()
    await flushPromises()

    // onInputTableFilter 是 el-select :remote-method 的 prop 函数，<script setup> 自动暴露
    // 在 wrapper.vm 上；调它能直接触发 debouncedSearch，不依赖 el-select 内部行为。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vm = wrapper.vm as any

    // 第一次输入：触发 debouncedSearch（300ms 防抖）
    vm.onInputTableFilter('em')
    await new Promise((r) => setTimeout(r, 320))
    await flushPromises()
    // 第二次输入：debouncedSearch 再次触发，requestSeq 递增
    vm.onInputTableFilter('ema')
    await new Promise((r) => setTimeout(r, 320))
    await flushPromises()
    expect(resolvers.length).toBe(2)

    // 新请求先 resolve
    resolvers[1]({ total: 1, list: [{ tableId: 'new', tableName: 'sense_data.T_NEW', name: '新结果', fields: [] }] })
    await flushPromises()
    // 旧请求（更早发出，网络更慢）后 resolve——结果应被丢弃，不覆盖已生效的新结果
    resolvers[0]({ total: 1, list: [{ tableId: 'old', tableName: 'sense_data.T_OLD', name: '旧结果', fields: [] }] })
    await flushPromises()

    expect(vm.inputTableSearch.results.value.map((t: EntryType) => t.tableId)).toEqual(['new'])
  })

  it('搜索失败时弹出错误提示', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({ close: () => {} }))
    vi.spyOn(entryApi, 'entryPaged').mockRejectedValue(new Error('网络错误'))

    const wrapper = mountBinder()
    await flushPromises()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vm = wrapper.vm as any
    vm.onInputTableFilter('em')
    await new Promise((r) => setTimeout(r, 320))
    await flushPromises()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('网络错误'))
  })
})

// 回读历史流程时「输入表」框直接显示裸 tableId（如 6200026）——因为 selected 只在用户
// 这次会话里搜过/选过才有值，modelValue 自带的 inputTableId 从没被拿去填 selected，
// renderOptions 里找不到对应 el-option，el-select 只能把裸值当文本兜底显示。
describe('RuleTableFieldBinder · 回读历史流程不显示裸 tableId', () => {
  afterEach(() => vi.restoreAllMocks())

  // 2026-09-23 起 label 统一成「ID · 库.表」（与网页抓取等节点的表配置一致），不再带业务名；
  // 本条要防的"回读只显示裸 ID"仍然成立：兜底阶段就是完整 label，entryDetail 回来后也不变样。
  it('挂载即用 modelValue 自带的物理表名兜底，不是裸 ID；entryDetail 到位后 label 保持「ID · 库.表」', async () => {
    let resolveDetail!: (v: EntryType) => void
    vi.spyOn(entryApi, 'entryDetail').mockImplementation(
      () => new Promise((resolve) => { resolveDetail = resolve }),
    )

    const wrapper = mountBinder({ inputTableId: '6200026', inputTable: 'sense_data.TB_RULE_IN' })
    await flushPromises()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vm = wrapper.vm as any
    const inputSelect = () => wrapper.findAll('.rc-field').find((r) => r.find('label').text() === '输入表 *')!.find('.el-select')

    expect(vm.inputTableSearch.selected.value.tableId).toBe('6200026')
    expect(vm.inputTableSearch.selected.value.tableName).toBe('sense_data.TB_RULE_IN')
    // 兜底阶段就已经不再是裸 ID——数据层面和实际渲染都要看
    expect(vm.tableOptionLabel(vm.inputTableSearch.selected.value)).not.toBe('6200026')
    expect(inputSelect().text()).not.toBe('6200026')

    resolveDetail({ tableId: '6200026', tableName: 'sense_data.TB_RULE_IN', name: '规则输入表', fields: [] })
    await flushPromises()

    expect(vm.tableOptionLabel(vm.inputTableSearch.selected.value)).toBe('6200026 · sense_data.TB_RULE_IN')
    // 实测坑（2026-09-01）：<el-option> 的 :key 只挂 tableId 时，Vue 复用同一个 vnode，
    // el-select 内部缓存的显示文案不会跟着刷新——光测 selected.value 这个数据层面测不出这个问题，
    // 必须断言真实渲染出来的文字。
    expect(inputSelect().text()).toBe('6200026 · sense_data.TB_RULE_IN')
  })

  it('entryDetail 查询失败：保留兜底的物理表名，不回退成裸 ID', async () => {
    vi.spyOn(entryApi, 'entryDetail').mockRejectedValue(new Error('网络错误'))

    const wrapper = mountBinder({ inputTableId: '6200026', inputTable: 'sense_data.TB_RULE_IN' })
    await flushPromises()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vm = wrapper.vm as any
    expect(vm.inputTableSearch.selected.value.tableName).toBe('sense_data.TB_RULE_IN')
  })
})

describe('RuleTableFieldBinder · 新建表（0804 拍板：共用表配置的 TableEditDialog/entryApi）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('输入表只支持选择已有表，输出表仍保留新建入口', async () => {
    const wrapper = mountBinder()
    await flushPromises()

    const inputRow = wrapper.findAll('.rc-field').find((row) => row.find('label').text() === '输入表 *')
    const outputRow = wrapper.findAll('.rc-field').find((row) => row.find('label').text().startsWith('输出表'))
    expect(inputRow?.find('button').exists()).toBe(false)
    expect(outputRow?.text()).toContain('新建表')
  })

  it('点输出表旁的新建表：保存后选中到输出表，不影响输入表', async () => {
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue({
      tableId: 'new-2', tableName: 'sense_data.TB_OUT', name: '输出新表', fields: [],
    })

    const wrapper = mountBinder()
    await flushPromises()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vm = wrapper.vm as any
    vm.openNewTable()
    await flushPromises()
    await wrapper.findComponent(TableEditDialog).vm.$emit('saved', 'new-2')
    await flushPromises()

    const updates = wrapper.emitted('update:modelValue') as Array<[Record<string, unknown>]> | undefined
    const last = updates![updates!.length - 1][0]
    expect(last.outputTableId).toBe('new-2')
    expect(last.outputTable).toBe('sense_data.TB_OUT')
    expect(last.inputTableId).toBeUndefined()
  })
})

// 入参字段默认全选；出参字段从空选择开始，必须由用户明确勾选。
describe('RuleTableFieldBinder · 字段默认选择', () => {
  const FIELDS: RuleFieldOption[] = [
    { itemCode: 'sku_id', itemName: '商品ID', columnName: 'K1', dataType: 'string', seq: 1 },
    { itemCode: 'sku_name', itemName: '商品名称', columnName: 'K2', dataType: 'string', seq: 2 },
    { itemCode: 'ID', itemName: '主键', columnName: 'ENTRY_ID', dataType: 'string', seq: -100 },
  ]

  function lastEmittedPatch(wrapper: ReturnType<typeof mountBinder>) {
    const updates = wrapper.emitted('update:modelValue') as Array<[Partial<RuleOrchestration>]> | undefined
    return updates?.[updates.length - 1]?.[0]
  }

  it('字段异步到位后自动全选非系统字段（系统字段 seq<0 不进默认选择）', async () => {
    const wrapper = mountBinder({ inputTableId: 't1' })
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined() // 字段还没到，不该发任何 patch

    await wrapper.setProps({ inputFieldOptions: FIELDS })
    await flushPromises()

    expect(lastEmittedPatch(wrapper)).toEqual({ inputFields: ['sku_id', 'sku_name'] })
  })

  it('输出表未单独选（沿用输入表）：输出字段池到位后仍保持空选', async () => {
    const wrapper = mountBinder({ inputTableId: 't1' })
    await flushPromises()

    // 输出表为空时父级传入的 outputFieldOptions 就是输入字段池本身（组合逻辑见 useRuleTableFields）
    await wrapper.setProps({ inputFieldOptions: FIELDS, outputFieldOptions: FIELDS })
    await flushPromises()

    const updates = (wrapper.emitted('update:modelValue') as Array<[Partial<RuleOrchestration>]>).map((c) => c[0])
    expect(updates).toContainEqual({ inputFields: ['sku_id', 'sku_name'] })
    expect(updates.some((patch) => 'outputFields' in patch)).toBe(false)
  })

  it('已有 inputFields（历史流程回读）：字段池到位后不覆盖既有选择', async () => {
    const wrapper = mountBinder({ inputTableId: 't1', inputFields: ['sku_id'] })
    await flushPromises()

    await wrapper.setProps({ inputFieldOptions: FIELDS })
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('用户手动清空已选字段后，字段池不变的情况下不会被重新勾上', async () => {
    const wrapper = mountBinder({ inputTableId: 't1' })
    await wrapper.setProps({ inputFieldOptions: FIELDS })
    await flushPromises()
    expect(lastEmittedPatch(wrapper)).toEqual({ inputFields: ['sku_id', 'sku_name'] })

    // 模拟父级把自动全选的结果写回 store 后又整体清空（用户手动取消）：inputFields 变 []，
    // 但 inputFieldOptions 这个字段池引用没变——不应该触发新一轮自动全选。
    await wrapper.setProps({ modelValue: { inputTableId: 't1', inputFields: [], outputFields: [] } })
    await flushPromises()

    // 没有新的 emit（还是只有前面那一次自动全选的记录）
    expect((wrapper.emitted('update:modelValue') as unknown[]).length).toBe(1)
  })
})

// 2026-09-23：入参 / 出参统一成网页抓取那种勾选墙（代码 · 中文名 + 全选 / 清空）
describe('RuleTableFieldBinder · 勾选墙（与网页抓取表配置统一）', () => {
  const fields: RuleFieldOption[] = [
    { itemCode: 'URLTITLE', itemName: '标题' },
    { itemCode: 'video_minio', itemName: '视频minio地址' },
    { itemCode: 'SYS_ID', itemName: '系统ID', seq: -1 } as RuleFieldOption,
  ]
  function mountWithFields(model: Partial<RuleOrchestration>) {
    setActivePinia(createPinia())
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue({ tableId: '2101720', tableName: 'sense_data.TB_YOUTUBE', fields: [] })
    return mount(RuleTableFieldBinder, {
      global: { plugins: [ElementPlus] },
      props: {
        modelValue: { inputTableId: '2101720', inputTable: 'sense_data.TB_YOUTUBE', inputFields: [], outputFields: [], ...model },
        inputFieldOptions: fields,
        outputFieldOptions: fields,
      },
    })
  }
  const lastPatch = (w: ReturnType<typeof mountWithFields>) =>
    (w.emitted('update:modelValue') ?? []).at(-1)?.[0] as Partial<RuleOrchestration>

  it('字段显示成「代码 · 中文名」，系统字段默认不显示；已选中的系统字段照样显示', async () => {
    const w = mountWithFields({ inputFields: ['URLTITLE'], outputFields: ['SYS_ID'] })
    await flushPromises()
    expect(w.get('[data-testid="rule-input-fields"]').text()).toContain('URLTITLE · 标题')
    expect(w.get('[data-testid="rule-input-fields"]').text()).not.toContain('SYS_ID')
    // 出参里 SYS_ID 已选中：虽是系统字段也要显示，否则勾着却看不见、取消不了
    expect(w.get('[data-testid="rule-output-fields"]').text()).toContain('SYS_ID · 系统ID')
  })

  it('全选 = 可选池全勾上；清空 = 一个不留', async () => {
    const w = mountWithFields({ inputFields: ['URLTITLE'] })
    await flushPromises()
    await w.get('[data-testid="rule-input-select-all"]').trigger('click')
    expect(lastPatch(w).inputFields).toEqual(['URLTITLE', 'video_minio'])
    await w.get('[data-testid="rule-input-clear"]').trigger('click')
    expect(lastPatch(w).inputFields).toEqual([])
    await w.get('[data-testid="rule-output-select-all"]').trigger('click')
    expect(lastPatch(w).outputFields).toEqual(['URLTITLE', 'video_minio'])
  })

  it('全选保留已选中的系统字段，不因为它藏着就被静默取消', async () => {
    const w = mountWithFields({ outputFields: ['SYS_ID'] })
    await flushPromises()
    await w.get('[data-testid="rule-output-select-all"]').trigger('click')
    expect(lastPatch(w).outputFields).toEqual(['SYS_ID', 'URLTITLE', 'video_minio'])
  })

  it('只看已选：默认只铺已选字段，可切换显示全部；一个没选（出参新建）时显示全部', async () => {
    const w = mountWithFields({ inputFields: ['URLTITLE'], outputFields: [] })
    await flushPromises()
    const inputShown = () => w.get('[data-testid="rule-input-fields"]').findAll('.rc-tag').map((t) => t.text())

    expect(inputShown()).toEqual(['URLTITLE · 标题'])
    await w.get('[data-testid="rule-input-only-selected"]').trigger('click')
    expect(inputShown()).toEqual(['URLTITLE · 标题', 'video_minio · 视频minio地址'])

    // 出参一个没选：直接看到全部可选项，没有切换按钮
    expect(w.get('[data-testid="rule-output-fields"]').findAll('.rc-tag')).toHaveLength(2)
    expect(w.find('[data-testid="rule-output-only-selected"]').exists()).toBe(false)
  })
})
