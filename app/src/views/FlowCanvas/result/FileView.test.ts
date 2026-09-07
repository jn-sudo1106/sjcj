// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import FileView from './FileView.vue'
import { readSqlConditions } from '@/utils/sqlConditionHistory'
import FileDetailDrawer from './FileDetailDrawer.vue'
import FilePreviewDrawer from './components/FilePreviewDrawer.vue'
import { fileApi, sourceApi, type FileResourceRecord } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { mockSourceDetail, mockSourceSteps } from '@/api/mock/sources'

const table = {
  tableId: 'file-resource',
  tableName: 'sense_data.tb_news_file_resource',
  name: 'news-文件资源表',
  rowCount: 40,
  fields: [],
}
const files: FileResourceRecord[] = [{
  dataId: 'entry-1', sourceId: '391007768', state: 'C', createDt: '2026-07-13 10:00:00',
  values: {
    K1: 'page.html', K2: 'https://files.example.com/page.html', K3: '/data/page.html', K4: 2048,
    K5: 'abc123', K6: 'page.html', K7: 'html', K8: 'page.txt', K9: '/data/page.txt', K10: 512,
  },
}]

// 查询条件不绑回车（2026-08-20）：中文输入法上屏也会发 Enter 的 keyup，Vue 的
// @keyup.enter 不过滤 isComposing，绑了等于打字打到一半就把半截条件查出去。
async function clickQuery(wrapper: { findAll: (s: string) => { text: () => string; trigger: (e: string) => Promise<void> }[] }) {
  await wrapper.findAll('button').find((b) => b.text() === '查询')!.trigger('click')
}

afterEach(() => localStorage.clear())

describe('FileView', () => {
  // 文件列表现在挂在步骤列表之后（先判定是否支持节点筛选），步骤走 mock 通道有 120ms
  // 真实定时器，不打桩的话 flushPromises 追不上，列表会停在未加载态。
  beforeEach(() => vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([]))
  afterEach(() => vi.restoreAllMocks())

  // 节点归属（2026-08-22 生产实测）：文件行的 CONFIG_ID 等于源子步骤的 Step.configId，
  // 画布节点 ID 却是 Step.stepId，必须经步骤列表转一道才对得上。
  // 存量迁移文件的源在平台里查无此人，解析不出节点——轨道要按数据实际情况开合，
  // 不能写死可点（点了没反应）也不能写死只读（数据修好后就成了假的能力缺失）。
  describe('节点轨道', () => {
    async function mountWith(rows: FileResourceRecord[], steps: Awaited<ReturnType<typeof sourceApi.sourceSteps>>) {
      setActivePinia(createPinia())
      const current = mockSourceDetail({ sourceId: '391007768' })!
      useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
      vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(steps)
      vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
      vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
      const query = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ list: rows, total: rows.length })
      const wrapper = shallowMount(FileView, {
        global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, CanvasHeader: true } },
      })
      await flushPromises()
      return { wrapper, query }
    }

    const boundSteps = [
      { stepId: '391007768-s1', sourceId: '391007768', name: '列表抓取', configId: '1400774', enabled: true },
      { stepId: '391007768-s2', sourceId: '391007768', name: '详情解析', configId: '1400765', enabled: true },
    ]

    it('文件的 CONFIG_ID 能对上步骤时轨道可点，首查仍展示该源全部文件', async () => {
      const bound = [{ ...files[0], configId: '1400765' }]
      const { wrapper, query } = await mountWith(bound, boundSteps)

      expect(wrapper.find('[data-testid="file-rail-note"]').text()).toContain('默认展示该源全部文件')
      const rail = wrapper.findComponent({ name: 'ProcessNodeRail' })
      expect((rail.props('selectable') as () => boolean)()).toBe(true)
      expect(query.mock.calls.at(-1)?.[0].configId).toBeUndefined()
    })

    it('点击节点改选中并按该节点的 configId 重查（轨道的 update:modelValue 此前没接，点了没反应）', async () => {
      const bound = [{ ...files[0], configId: '1400765' }]
      const { wrapper, query } = await mountWith(bound, boundSteps)
      const callsBefore = query.mock.calls.length

      wrapper.findComponent({ name: 'ProcessNodeRail' }).vm.$emit('update:modelValue', '391007768-s2')
      await flushPromises()

      expect(query.mock.calls.length).toBe(callsBefore + 1)
      expect(query.mock.calls.at(-1)?.[0]).toMatchObject({ configId: '1400765' })
    })

    it('迁移文件对不上步骤时轨道保持只读，并说明原因而不是谎称没有归属能力', async () => {
      // 源 391002885 在平台里查无此人，步骤接口 500 → steps 为空
      const migrated = [{ ...files[0], configId: '81134' }]
      const { wrapper, query } = await mountWith(migrated, [])

      expect(wrapper.find('[data-testid="file-rail-note"]').text()).toContain('迁移数据')
      const rail = wrapper.findComponent({ name: 'ProcessNodeRail' })
      expect((rail.props('selectable') as () => boolean)()).toBe(false)
      expect(query.mock.calls.at(-1)?.[0].configId).toBeUndefined()
    })

    it('主动按节点筛选后没有文件时不说"迁移数据"——那是另一回事', async () => {
      const { wrapper } = await mountWith([], boundSteps)
      wrapper.findComponent({ name: 'ProcessNodeRail' }).vm.$emit('update:modelValue', '391007768-s1')
      await flushPromises()
      expect(wrapper.find('[data-testid="file-rail-note"]').text()).toBe('该节点下暂无文件记录')
    })
  })

  it('按 file_resource 表目录 + 元数据 + entryDataPaged 查询文件资源', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const tables = vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    const meta = vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    const query = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ list: files, total: 1 })

    const wrapper = shallowMount(FileView, {
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, CanvasHeader: true } },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('文件名')
    expect(wrapper.text()).toContain('展示名')
    expect(wrapper.text()).toContain('文件路径')
    expect(wrapper.text()).toContain('状态（不限）')
    expect(wrapper.text()).toContain('MD5')
    expect(wrapper.find('[data-testid="file-process-rail"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="file-resource-table"]').text()).toContain('数据源：news-文件资源表')
    expect(wrapper.text()).not.toContain('文件记录关联字段待接口确认后再启用节点筛选')
    expect(tables).toHaveBeenCalled()
    expect(meta).toHaveBeenCalledWith('file-resource')
    expect(wrapper.find('input[type="date"]').exists()).toBe(false)
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: 'file-resource', sourceId: current.sourceId }))
  })

  it('已停用源默认仍展示历史文件', async () => {
    setActivePinia(createPinia())
    const source = mockSourceDetail({ sourceId: 'NEWS5522' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

    const wrapper = shallowMount(FileView, {
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 500))
    await flushPromises()

    expect(wrapper.text()).toContain('列表抓取_1')
  })

  it('K2 仅渲染为安全 HTTP(S) 外链，K3/K9 只展示原值', async () => {
    setActivePinia(createPinia())
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ list: files, total: 1 })

    const wrapper = shallowMount(FileView, {
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, CanvasHeader: true } },
    })
    await flushPromises()

    const link = wrapper.find('a[target="_blank"]')
    expect(link.attributes('href')).toBe(files[0].values.K2)
    expect(link.attributes('rel')).toContain('noreferrer')
    expect(wrapper.text()).toContain('/data/page.html')
    expect(wrapper.text()).toContain('/data/page.txt')
  })

  it('补齐文本大小、状态、更新时间，并可打开文件详情', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const row = { ...files[0], updateDt: '2026-08-17 10:00:00' }
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ list: [row], total: 101 })

    const wrapper = shallowMount(FileView, {
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, CanvasHeader: true } },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('文本大小')
    expect(wrapper.text()).toContain('更新时间')
    expect(wrapper.text()).toContain('512 B')
    await wrapper.get('[data-testid="file-detail"]').trigger('click')
    const drawer = wrapper.findComponent(FileDetailDrawer)
    expect(drawer.props('file')).toEqual(row)
    expect(drawer.props('sourceName')).toBe('支付宝评论规则过滤')
    expect(drawer.props('tableId')).toBe('file-resource')
    expect(drawer.props('tableName')).toBe('news-文件资源表')

    // 分页 0902 统一成 el-pagination（原来的「每页」下拉 + 上一页/下一页 + 跳转输入框
    // 六件套换成一个组件）。测试环境没有全局装 Element Plus，它不是真实组件实例、拿不到
    // 也点不动——与 ResultView.test.ts 同一口径，改成断言绑进去的 props。
    const pagination = wrapper.get('[data-testid="file-pagination"]')
    expect(pagination.attributes('page-sizes')).toBe('20,40,100,200')
    expect(pagination.attributes('page-size')).toBe('20')
    expect(pagination.attributes('total')).toBe('101')
  })

  it('具体源文件查询失败时显示失败提示，不伪装成空结果', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(fileApi, 'resourceRows').mockRejectedValue(new Error('500'))

    const wrapper = shallowMount(FileView, {
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, CanvasHeader: true } },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('文件列表查询失败，请重试')
    expect(wrapper.text()).not.toContain('没有匹配的文件')
  })

  it('自定义 SQL 筛选：对齐旧平台 FileList2.vue 的同名筛选项，此前迁移遗漏（补漏）', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    const query = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ list: files, total: 1 })

    const wrapper = shallowMount(FileView, {
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, CanvasHeader: true } },
    })
    await flushPromises()
    const callsAfterMount = query.mock.calls.length

    const sqlInput = wrapper.get('input[aria-label="自定义SQL"]')
    expect(sqlInput.attributes('placeholder')).toBe('自定义SQL, 如 K1 IS NULL')

    // 逐字符打字（未按 Enter）不触发查询——fileName/ext 是模糊匹配、边打边查没问题，
    // 但一段没打完的 SQL 逐字符发出去大概率触发后端语法错误，所以要求先按 Enter。
    await sqlInput.setValue('K1 IS N')
    await flushPromises()
    expect(query).toHaveBeenCalledTimes(callsAfterMount)

    await clickQuery(wrapper)
    await flushPromises()
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ sql: 'K1 IS N' }))
    expect(readSqlConditions(table.tableId)).toEqual(['K1 IS N'])
    query.mockRejectedValueOnce(new Error('SQL syntax'))
    await sqlInput.setValue('bad sql')
    await clickQuery(wrapper)
    await flushPromises()
    expect(readSqlConditions(table.tableId)).toEqual(['K1 IS N'])
  })

  it('检测到多张 file_resource 表时给出手动选择的下拉，而不是报错停住（对齐旧平台 loadEntryTypes1 的表ID选择器）', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const tableB = { tableId: 'file-resource-2', tableName: 'sense_data.tb_ext_file_resource', name: 'ext-文件资源表', rowCount: 5, fields: [] }
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table, tableB])
    vi.spyOn(fileApi, 'resourceMeta').mockImplementation(async (id) => (id === tableB.tableId ? tableB : table))
    const query = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ list: files, total: 1 })

    const wrapper = shallowMount(FileView, {
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, CanvasHeader: true } },
    })
    await flushPromises()

    // 不再是死路："检测到 N 张表，暂不自动选择"这句话不该出现了
    expect(wrapper.text()).not.toContain('暂不自动选择')
    const select = wrapper.get('select[aria-label="表ID"]')
    expect(select.findAll('option')).toHaveLength(2)
    expect(select.findAll('option')[0].text()).toContain('news-文件资源表')
    // 默认选第一张，照样能查到数据
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: 'file-resource' }))

    await select.setValue(tableB.tableId)
    await flushPromises()

    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: 'file-resource-2' }))
  })

  it('只有一张 file_resource 表时不显示下拉，维持原有的纯文本展示', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ list: files, total: 1 })

    const wrapper = shallowMount(FileView, {
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, CanvasHeader: true } },
    })
    await flushPromises()

    expect(wrapper.find('select[aria-label="表ID"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('数据源：news-文件资源表')
  })

  it('点详情关掉预览，点行打开预览则关掉详情', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ list: files, total: 1 })

    const wrapper = shallowMount(FileView, {
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, CanvasHeader: true } },
    })
    await flushPromises()

    await wrapper.get('.fv-row').trigger('click')
    expect(wrapper.findComponent(FilePreviewDrawer).props('modelValue')).toBe(true)
    await wrapper.get('[data-testid="file-detail"]').trigger('click')
    expect(wrapper.findComponent(FileDetailDrawer).props('modelValue')).toBe(true)
    expect(wrapper.findComponent(FilePreviewDrawer).props('modelValue')).toBe(false)
  })
})
