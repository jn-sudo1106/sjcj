// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import TaskWizard from './TaskWizard.vue'
import { syncApi, type SyncCustomer, type SyncTable } from '@/api/dataSync'
import { useAuthStore } from '@/stores/auth'

const { routeQuery } = vi.hoisted(() => ({ routeQuery: {} as Record<string, string> }))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: routeQuery }),
}))

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  Object.keys(routeQuery).forEach((key) => delete routeQuery[key])
  vi.restoreAllMocks()
})

async function mountWizard(
  loadTables?: (...args: Parameters<typeof syncApi.tables>) => Promise<SyncTable[]>,
) {
  setActivePinia(createPinia())
  useAuthStore().info = { name: 'admin', id: 1, roles: [], groups: [], avatar: '', introduction: '', group: 1 } as never
  vi.spyOn(syncApi, 'customers').mockResolvedValue([{ id: 1, customerName: '万微' }] as SyncCustomer[])
  vi.spyOn(syncApi, 'customerDatabases').mockResolvedValue([])
  vi.spyOn(syncApi, 'tables').mockImplementation(loadTables ?? (async () => []))
  wrapper = mount(TaskWizard, { attachTo: document.body, global: { plugins: [ElementPlus] } })
  await flushPromises()
  return wrapper
}

/** 按网格子项顺序读回标签：左列目标、右列源，源端无对应项时读成空占位 */
async function cellLabels(root: VueWrapper) {
  await flushPromises()
  const grid = root.find('.sync-grid').element as HTMLElement
  return Array.from(grid.children).map((child) => child.classList.contains('sync-cell-blank')
    ? ''
    : child.querySelector('.el-form-item__label')?.textContent?.trim() ?? '')
}

/** <script setup> 的顶层绑定在测试环境自动暴露到 vm 上，这里声明用到的那几个 */
type WizardVm = {
  form: Record<string, unknown>
  step: number
  busy: boolean
  tables: SyncTable[]
  taskList: Array<{ taskName: string; cron: string; fromSql: string; type?: string }>
  nextTable: () => Promise<void>
  searchTables: (name: string) => Promise<void>
  selectTable: (id: string | number) => void
  selectTarget: (id: string | number) => void
  selectFileTarget: (id: string | number) => void
  submit: () => Promise<void>
}
const vm = (root: VueWrapper) => root.vm as unknown as WizardVm

describe('同步表配置的目标/源成对布局', () => {
  it('每行左列是目标端、右列是源端，无对应项留空', async () => {
    const root = await mountWizard()
    expect(await cellLabels(root)).toEqual([
      '客户 / 环境', '',
      '目标数据库类型', '源数据库类型',
      '目标数据库', '源数据库',
      '目标 Schema', '源 Schema',
      '目标表名称', '源数据表',
      '同步文件', '',
    ])
  })

  it('打开同步文件后追加一对文件库配置', async () => {
    const root = await mountWizard()
    await root.find('.el-switch').trigger('click')
    const labels = await cellLabels(root)
    expect(labels.slice(-2)).toEqual(['目标文件库', '源文件库类型'])
    expect(labels.filter((item) => item === '')).toHaveLength(2)
  })

  it('非管理员没有客户行，第一对直接是数据库类型', async () => {
    setActivePinia(createPinia())
    useAuthStore().info = { name: 'leo', id: 9, roles: [], groups: [], avatar: '', introduction: '', group: 1 } as never
    vi.spyOn(syncApi, 'customerDatabases').mockResolvedValue([])
    vi.spyOn(syncApi, 'tables').mockResolvedValue([])
    wrapper = mount(TaskWizard, { attachTo: document.body, global: { plugins: [ElementPlus] } })
    const labels = await cellLabels(wrapper)
    expect(labels.slice(0, 2)).toEqual(['目标数据库类型', '源数据库类型'])
    expect(labels).not.toContain('客户 / 环境')
  })
})

function entry(id: number, tableName: string): SyncTable {
  return { entryTypeId: id, tableName, typeName: `${tableName}中文名` } as SyncTable
}

describe('源数据表的动态搜索', () => {
  /** 接口只回前 10 条，选项必须跟着关键词走服务端 LIKE */
  it('关键词去掉首尾空格后交给服务端，不在前端过滤已加载的那一页', async () => {
    const root = await mountWizard()
    const spy = vi.spyOn(syncApi, 'tables').mockResolvedValue([entry(11, 'TB_CNEWS')])
    await vm(root).searchTables('  cnews  ')
    expect(spy).toHaveBeenCalledWith('', 'cnews')
    expect(vm(root).tables.map((item) => item.tableName)).toEqual(['TB_CNEWS'])
  })

  /** el-select 展开下拉、清空关键词都会回调一次 ''，这时候不该再打后台 */
  it('没有关键词时不发请求，直接回选完客户那一页', async () => {
    const root = await mountWizard(async (_groupId, name) => (name ? [entry(11, 'TB_CNEWS')] : [entry(1, 'TB_A')]))
    vm(root).form.customerId = 1
    await flushPromises()
    const spy = vi.spyOn(syncApi, 'tables').mockResolvedValue([entry(11, 'TB_CNEWS')])
    spy.mockClear()
    await vm(root).searchTables('cnews')
    await vm(root).searchTables('   ')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(vm(root).tables.map((item) => item.tableName)).toEqual(['TB_A'])
  })

  it('空关键词作废在途的搜索，慢响应回来也不盖掉那一页', async () => {
    const root = await mountWizard(async (_groupId, name) => (name ? [] : [entry(1, 'TB_A')]))
    vm(root).form.customerId = 1
    await flushPromises()
    let resolveLate: ((v: SyncTable[]) => void) | undefined
    vi.spyOn(syncApi, 'tables').mockImplementation(() => new Promise((resolve) => { resolveLate = resolve }))
    void vm(root).searchTables('late')
    await vm(root).searchTables('')
    resolveLate?.([entry(2, 'TB_LATE')])
    await flushPromises()
    expect(vm(root).tables.map((item) => item.tableName)).toEqual(['TB_A'])
  })

  it('慢的旧响应后到也不覆盖新关键词的结果', async () => {
    const root = await mountWizard()
    const resolvers: Array<(v: SyncTable[]) => void> = []
    vi.spyOn(syncApi, 'tables').mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve) }))
    void vm(root).searchTables('old')
    void vm(root).searchTables('new')
    resolvers[1]?.([entry(2, 'TB_NEW')])
    await flushPromises()
    resolvers[0]?.([entry(1, 'TB_OLD')])
    await flushPromises()
    expect(vm(root).tables.map((item) => item.tableName)).toEqual(['TB_NEW'])
  })

  it('已选表不在新一页结果里时留在选项首位，标签不退化成裸 ID', async () => {
    const root = await mountWizard()
    vi.spyOn(syncApi, 'tables').mockResolvedValue([entry(1, 'TB_A')])
    await vm(root).searchTables('a')
    // el-select 选中是先回写 v-model 再触发 change，两步都要走
    vm(root).form.entryTypeId = 1
    vm(root).selectTable(1)
    vi.spyOn(syncApi, 'tables').mockResolvedValue([entry(2, 'TB_B')])
    await vm(root).searchTables('b')
    expect(vm(root).tables.map((item) => item.tableName)).toEqual(['TB_A', 'TB_B'])
    expect(vm(root).form.entryTypeId).toBe(1)
    expect(vm(root).form.sourceTable).toBe('tb_a')
  })

  it('深链带的表不在首屏那一页时按表名再捞一次', async () => {
    routeQuery.tableName = 'sense_data.TB_CNEWS'
    const root = await mountWizard(async (_groupId, name) =>
      (name ? [entry(11, 'sense_data.TB_CNEWS')] : [entry(1, 'TB_A')]))
    // admin 要先选客户，选完才会去载表并套深链
    vm(root).form.customerId = 1
    await flushPromises()
    expect(vm(root).form.entryTypeId).toBe(11)
    expect(vm(root).form.sourceTable).toBe('sense_data.tb_cnews')
    expect(vm(root).form.targetTable).toBe('cnews')
    expect(vm(root).tables.map((item) => item.tableName)).toEqual(['sense_data.TB_CNEWS', 'TB_A'])
  })
})

describe('第一步的下一步门槛', () => {
  /** 按真实点选顺序把客户、目标库、源表、文件库都落到 form 上 */
  async function fillStep0(root: VueWrapper, withFile: boolean) {
    vi.spyOn(syncApi, 'customerDatabases').mockImplementation(async (_customerId, type) =>
      (type === 0
        ? [{ id: 7, name: 'xz_db', sourceCode: 'ck_xz', dbSchema: 'xz_db', databaseType: 1, type: 0, appId: 3 }]
        : [{ id: 9, name: 'minio_xz', sourceCode: 'minio', dbSchema: '', databaseType: 0, type: 1, appId: 3 }]) as never)
    vi.spyOn(syncApi, 'tables').mockResolvedValue([entry(3, 'sense_data.TB_CNEWS')])
    vi.spyOn(syncApi, 'tableColumns').mockResolvedValue([
      { itemId: 1, columnName: 'id', itemCode: 'id', itemName: '主键', dataType: 'bigint' },
    ] as never)
    vm(root).form.customerId = 1
    await flushPromises()
    vm(root).form.targetDatabase = 7
    vm(root).selectTarget(7)
    vm(root).form.entryTypeId = 3
    vm(root).selectTable(3)
    if (withFile) {
      vm(root).form.fileSyncFlag = true
      vm(root).form.targetFileDatabase = 9
      vm(root).selectFileTarget(9)
    }
    await flushPromises()
  }

  it('开着同步文件、各项齐备时能进第二步', async () => {
    const root = await mountWizard()
    await fillStep0(root, true)
    const warn = vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({} as never))
    await vm(root).nextTable()
    expect(warn).not.toHaveBeenCalled()
    expect(vm(root).step).toBe(1)
  })

  /** 整句笼统提示等于没提示：缺哪项就点名哪项 */
  it('只缺目标文件库时提示里只出现这一项', async () => {
    const root = await mountWizard()
    await fillStep0(root, false)
    vm(root).form.fileSyncFlag = true
    const warn = vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({} as never))
    await vm(root).nextTable()
    expect(warn.mock.calls[0]?.[0]).toBe('请完成：目标文件库')
    expect(vm(root).step).toBe(0)
  })

  it('非管理员的会话缺客户 ID 时不再要求去选看不见的客户', async () => {
    setActivePinia(createPinia())
    useAuthStore().info = { name: 'leo', id: 0, roles: [], groups: [], avatar: '', introduction: '', group: 1 } as never
    vi.spyOn(syncApi, 'customerDatabases').mockResolvedValue([])
    vi.spyOn(syncApi, 'tables').mockResolvedValue([])
    wrapper = mount(TaskWizard, { attachTo: document.body, global: { plugins: [ElementPlus] } })
    await flushPromises()
    const warn = vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({} as never))
    await vm(wrapper).nextTable()
    expect(String(warn.mock.calls[0]?.[0])).toContain('登录会话里的客户 ID')
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('客户 / 环境')
  })
})

describe('提交防重', () => {
  it('同一轮里连点两次提交只发一次创建请求', async () => {
    const root = await mountWizard()
    Object.assign(vm(root), {
      step: 2,
      taskList: [{ taskName: '通用新闻列表同步任务', cron: '0 0 1 * * ?', fromSql: 'select 1' }],
    })
    vm(root).form.sourceTable = 'sense_data.tb_cnews'
    vm(root).form.targetTable = 'cnews'
    await flushPromises()
    const save = vi.spyOn(syncApi, 'saveTask').mockResolvedValue({})
    void vm(root).submit()
    void vm(root).submit()
    expect(save).toHaveBeenCalledTimes(1)
    await flushPromises()
  })
})
