// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import QuickCkSyncDialog from './QuickCkSyncDialog.vue'
import {
  syncApi, type SyncColumnMap, type SyncCustomer, type SyncDatabase,
  type SyncSinkOptions, type SyncTableColumn,
} from '@/api/dataSync'
import { useAuthStore } from '@/stores/auth'
import type { EntryType } from '@/api'

// 设计文档 1021-快速同步到CK §七 契约测试：弹窗是 append-to-body 的 teleport，
// 用 attachTo: document.body + document 查询（同 WordSegmentConfigEditDialog.test.ts），不要 stub teleport。
const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
}))

const ENTRY: EntryType = { tableId: 't3', tableName: 'sense_data.TB_CNEWS', name: '通用新闻', fields: [] }

// 目标库混合一个 MySQL：只该留 databaseType === 4 的 CK 库
const CK_DB: SyncDatabase = { id: 9, name: 'ck_xz', sourceCode: 'ck_src', dbSchema: 'xz_db', databaseType: 4, type: 0, appId: 3 }
const MY_DB: SyncDatabase = { id: 7, name: 'mysql_xz', sourceCode: 'my_src', dbSchema: 'xz_db', databaseType: 1, type: 0, appId: 3 }
const CONFIGURED: SyncTableColumn[] = [
  { itemId: 1, columnName: 'id', itemCode: 'id', itemName: '主键', dataType: 'bigint' },
]
// 物理列要含 id（CK 去重校验）与 UPDATE_DT（增量水位），缺一都会拦在确认前
const PHYSICAL: SyncColumnMap[] = [
  { targetColumn: 'id', targetColumnType: 'bigint', remark: '主键' } as SyncColumnMap,
  { targetColumn: 'title', targetColumnType: 'varchar' } as SyncColumnMap,
  { targetColumn: 'UPDATE_DT', targetColumnType: 'datetime' } as SyncColumnMap,
]

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function stubSyncApi() {
  const customers = vi.spyOn(syncApi, 'customers').mockResolvedValue([{ id: 1, customerName: '万微' }] as SyncCustomer[])
  const customerDatabases = vi.spyOn(syncApi, 'customerDatabases').mockResolvedValue([MY_DB, CK_DB])
  const tableColumns = vi.spyOn(syncApi, 'tableColumns').mockResolvedValue(CONFIGURED)
  const physicalColumns = vi.spyOn(syncApi, 'physicalColumns').mockResolvedValue(PHYSICAL)
  const saveTask = vi.spyOn(syncApi, 'saveTask').mockResolvedValue({})
  return { customers, customerDatabases, tableColumns, physicalColumns, saveTask }
}

async function mountDialog(asAdmin = true) {
  setActivePinia(createPinia())
  useAuthStore().info = {
    name: asAdmin ? 'admin' : 'leo', id: asAdmin ? 1 : 9, roles: [], groups: [],
    avatar: '', introduction: '', group: 1,
  } as never
  wrapper = mount(QuickCkSyncDialog, {
    props: { modelValue: false, entry: ENTRY },
    global: { plugins: [ElementPlus] },
    attachTo: document.body,
  })
  // 打开才触发 loadAll（watch modelValue），也才渲染 teleport 内容
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
  return wrapper
}

const body = () => new DOMWrapper(document.body)
const el = (testid: string) => body().find(`[data-testid="${testid}"]`)
const confirmDisabled = () => (el('qck-confirm').element as HTMLButtonElement).disabled
/** el-input 的 $attrs 落在内层 input 上，取到真正的输入元素再断言值与禁用态 */
function inputOf(testid: string): HTMLInputElement {
  const found = el(testid)
  return (found.element.tagName === 'INPUT' ? found.element : found.find('input').element) as HTMLInputElement
}

/** <script setup> 顶层绑定在测试环境自动暴露到 vm 上 */
type QckVm = {
  customerId: number | string
  ckTargets: SyncDatabase[]
  columns: SyncColumnMap[]
  baselineColumns: SyncColumnMap[]
  entityCopy: boolean
  entryConfig: boolean
  form: Record<string, unknown>
  submit: () => Promise<void>
}
const vm = (root: VueWrapper) => root.vm as unknown as QckVm

describe('快速同步 弹窗', () => {
  it('管理员渲染客户下拉：未选客户时不加载 CK 库、确认禁用；切换客户只重拉 CK 库（列不重拉）', async () => {
    const { customerDatabases, tableColumns } = stubSyncApi()
    const root = await mountDialog()
    // 未选客户：loadAll 阶段不发 customerDatabases，确认被拦
    expect(el('qck-customer').exists()).toBe(true)
    expect(customerDatabases).not.toHaveBeenCalled()
    expect(el('qck-block').text()).toContain('请选择客户后再创建')
    expect(confirmDisabled()).toBe(true)

    vm(root).customerId = 1
    await flushPromises()
    expect(customerDatabases).toHaveBeenCalledTimes(1)
    expect(customerDatabases).toHaveBeenCalledWith(1, 0)
    expect(vm(root).ckTargets.map((item) => item.id)).toEqual([9])
    expect(confirmDisabled()).toBe(false)
    // 列是全局 cfg 表数据，与客户无关：不重拉
    expect(tableColumns).toHaveBeenCalledTimes(1)
  })

  it('非管理员无客户下拉，customerId 固定 auth.info?.id', async () => {
    const { customers, customerDatabases } = stubSyncApi()
    await mountDialog(false)
    expect(el('qck-customer').exists()).toBe(false)
    expect(customers).not.toHaveBeenCalled()
    expect(vm(wrapper!).customerId).toBe(9)
    expect(customerDatabases).toHaveBeenCalledWith(9, 0)
  })

  it('目标库只留 databaseType === 4 的 CK 库；仅一个时自动选中，多个时清掉旧选择', async () => {
    const { customerDatabases } = stubSyncApi()
    const root = await mountDialog()
    vm(root).customerId = 1
    await flushPromises()
    expect(vm(root).ckTargets.map((item) => item.id)).toEqual([9])
    expect(vm(root).form.targetDatabase).toBe(9)
    expect(vm(root).form.targetSchema).toBe('xz_db')

    // 多个 CK 库且旧选择不在其中：不自动选，清掉旧选择
    const CK2: SyncDatabase = { id: 10, name: 'ck_other', sourceCode: 'ck2', dbSchema: 'o_db', databaseType: 4, type: 0, appId: 4 }
    const CK3: SyncDatabase = { id: 11, name: 'ck_third', sourceCode: 'ck3', dbSchema: 't_db', databaseType: 4, type: 0, appId: 5 }
    customerDatabases.mockResolvedValue([MY_DB, CK2, CK3])
    vm(root).customerId = 2
    await flushPromises()
    expect(vm(root).ckTargets.map((item) => item.id)).toEqual([10, 11])
    expect(vm(root).form.targetDatabase).toBe('')
    expect(vm(root).form.targetSchema).toBe('')
  })

  it('目标 Schema / 目标表名称只读，表名固定与源表同名（去 schema、保留 tb_ 前缀）', async () => {
    const { customerDatabases } = stubSyncApi()
    const root = await mountDialog()
    vm(root).customerId = 1
    await flushPromises()
    expect(customerDatabases).toHaveBeenCalled()

    const schemaInput = inputOf('qck-target-schema')
    const tableInput = inputOf('qck-target-table')
    expect(schemaInput.disabled).toBe(true)
    expect(schemaInput.value).toBe('xz_db')
    expect(tableInput.disabled).toBe(true)
    // 源表 sense_data.tb_cnews → 目标表 tb_cnews，不再剥 tb_ 前缀
    expect(tableInput.value).toBe('tb_cnews')
  })

  it('该客户没有 CK 库：提示并禁用确认，不调 saveTask', async () => {
    const { customerDatabases, saveTask } = stubSyncApi()
    customerDatabases.mockResolvedValue([MY_DB])
    const root = await mountDialog()
    vm(root).customerId = 1
    await flushPromises()
    expect(el('qck-block').text()).toContain('该客户没有 ClickHouse 目标库')
    expect(confirmDisabled()).toBe(true)
    await el('qck-confirm').trigger('click')
    await flushPromises()
    expect(saveTask).not.toHaveBeenCalled()
  })

  it('源表缺增量水位列：拦截文案与向导逐字一致，确认禁用', async () => {
    const { physicalColumns, saveTask } = stubSyncApi()
    physicalColumns.mockResolvedValue(PHYSICAL.slice(0, 2))
    const root = await mountDialog()
    vm(root).customerId = 1
    await flushPromises()
    expect(el('qck-block').text()).toBe(
      '源表 sense_data.tb_cnews 既没有 UPDATE_DT 也没有 origin_update_time 列，同步实体无法确定增量水位')
    expect(confirmDisabled()).toBe(true)
    await el('qck-confirm').trigger('click')
    await flushPromises()
    expect(saveTask).not.toHaveBeenCalled()
  })

  it('提交 payload 与向导同一契约：默认同步实体、entryConfig false、CK 目标端参数、物理列全集', async () => {
    const { saveTask } = stubSyncApi()
    const root = await mountDialog()
    vm(root).customerId = 1
    await flushPromises()
    await el('qck-confirm').trigger('click')
    await flushPromises()

    expect(saveTask).toHaveBeenCalledTimes(1)
    const payload = saveTask.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).toMatchObject({
      customerId: 1,
      entryTypeId: 't3',
      sourceTable: 'sense_data.tb_cnews',
      sourceTableComment: '通用新闻',
      sourceCode: 'source_mysql_source',
      sourceSchema: 'sense_data',
      sourceDatabase: 1,
      sourceDatabaseType: 1,
      sourceFileCode: 'minio',
      syncType: '1',
      fileSyncFlag: false,
      targetDatabase: 9,
      targetSourceCode: 'ck_src',
      targetDatabaseType: 4,
      targetSchema: 'xz_db',
      targetTable: 'tb_cnews',
      clientId: 3,
      entityCopy: true,
      entryConfig: false,
      params: [],
    })
    const columnMapList = payload.columnMapList as SyncColumnMap[]
    expect(columnMapList.map((item) => item.targetColumn)).toEqual(['id', 'title', 'UPDATE_DT', 'origin_update_time'])
    // submitSyncColumns 形态：去重列带 distinctFlag，水位列带长度
    expect(columnMapList[0].distinctFlag).toBe(1)
    expect(columnMapList[3].targetColumnType).toBe('varchar(50)')
    expect((payload.sinkOptions as SyncSinkOptions)?.ck).toMatchObject({
      engine: 'ReplacingMergeTree', versionColumn: '', orderByColumns: [],
    })
    const taskList = payload.taskList as Array<Record<string, unknown>>
    expect(taskList).toHaveLength(1)
    expect(taskList[0]).toMatchObject({ taskName: '通用新闻同步CK任务' })
    expect(String(taskList[0].cron)).toMatch(/^\d+ \d+ 0\/1 \* \* \?$/)
    expect(String(taskList[0].fromSql)).toContain('id as startId')
    expect(String(taskList[0].fromSql)).toContain('`title`')
    expect(String(taskList[0].fromSql)).toContain('DATE_FORMAT(UPDATE_DT')
    expect(String(taskList[0].fromSql)).toContain('from sense_data.tb_cnews')
  })

  it('关「同步实体」：列退回配置字段基线，水位拦截解除', async () => {
    stubSyncApi()
    const root = await mountDialog()
    vm(root).customerId = 1
    await flushPromises()
    expect(vm(root).columns.map((item) => item.targetColumn)).toEqual(['id', 'title', 'UPDATE_DT', 'origin_update_time'])

    await el('qck-entity-copy').trigger('click')
    await flushPromises()
    expect(vm(root).entityCopy).toBe(false)
    expect(vm(root).columns.map((item) => item.targetColumn)).toEqual(['id'])
    expect(el('qck-block').exists()).toBe(false)
    expect(confirmDisabled()).toBe(false)
    expect(body().text()).toContain('配置字段')
  })

  it('同一轮连点两次提交只发一次 saveTask', async () => {
    const { saveTask } = stubSyncApi()
    const root = await mountDialog()
    vm(root).customerId = 1
    await flushPromises()
    void vm(root).submit()
    void vm(root).submit()
    await flushPromises()
    expect(saveTask).toHaveBeenCalledTimes(1)
  })

  it('成功进入完成态并 emit created；「查看任务列表」关闭弹窗并跳 /sync', async () => {
    const { saveTask } = stubSyncApi()
    const root = await mountDialog()
    vm(root).customerId = 1
    await flushPromises()
    await el('qck-confirm').trigger('click')
    await flushPromises()

    expect(saveTask).toHaveBeenCalledTimes(1)
    expect(body().find('.el-result').exists()).toBe(true)
    expect(root.emitted('created')).toHaveLength(1)
    await el('qck-goto-list').trigger('click')
    await flushPromises()
    expect(routerPush).toHaveBeenCalledWith('/sync')
    expect(root.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })
})
