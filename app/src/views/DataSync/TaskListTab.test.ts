// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElOption, ElSelect } from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import TaskListTab from './TaskListTab.vue'
import SinkOptionsPanel from './SinkOptionsPanel.vue'
import { syncApi, type SyncSinkDetail, type SyncSinkOptions, type SyncTask, type SyncTaskConfig } from '@/api/dataSync'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {} }),
}))

// el-drawer 内容 teleport 到 body，得从 document.body 里找（同 EntryEditorDrawer.test.ts 套路）
const body = () => new DOMWrapper(document.body)

const columns = [
  { key: 1, no: 1, sourceColumn: 'ID', targetColumn: 'id', targetColumnType: 'bigint', distinctFlag: 1 },
  { key: 2, no: 2, sourceColumn: 'CREATE_DT', targetColumn: 'create_dt', targetColumnType: 'datetime(3)' },
]

const row = {
  id: 7, taskName: '持仓明细同步任务', sourceTable: 'gzh_db.t_holding', targetTableName: 'gzh_db.t_holding',
  syncType: 1, status: 0, clientId: 3,
} as unknown as SyncTask

const config = {
  id: 7, taskName: '', syncType: '1', cron: '0 0 1 * * ?', startSql: 'select max(origin_update_time)',
  fromSql: 'from-sql', conditionSql: 'condition-sql', insertSql: 'insert-sql', updateSql: 'update-sql',
} as SyncTaskConfig

const ckSaved: SyncSinkOptions = { ck: { engine: 'ReplacingMergeTree', versionColumn: 'create_dt', orderByColumns: ['id'] }, es: null }

function sinkDetail(overrides: Partial<SyncSinkDetail> = {}): SyncSinkDetail {
  return { taskId: 7, targetDatabaseType: 4, targetSchema: 'gzh_db', targetTable: 't_holding',
    columnMapList: columns, sinkOptions: ckSaved, ...overrides }
}

let wrapper: VueWrapper | undefined

async function mountTab(detail: SyncSinkDetail) {
  setActivePinia(createPinia())
  useAuthStore().info = { name: 'admin', id: 1, roles: [], groups: [], avatar: '', introduction: '', group: 1 } as never
  vi.spyOn(syncApi, 'customers').mockResolvedValue([])
  vi.spyOn(syncApi, 'tasks').mockResolvedValue({ list: [row], total: 1 })
  vi.spyOn(syncApi, 'taskDetail').mockResolvedValue({ ...config })
  const sink = vi.spyOn(syncApi, 'sinkDetail').mockResolvedValue(detail)
  const save = vi.spyOn(syncApi, 'saveTaskDetail').mockResolvedValue({})
  wrapper = mount(TaskListTab, { attachTo: document.body, global: { plugins: [ElementPlus] } })
  await flushPromises()
  const edit = body().findAll('button').find((item) => item.text() === '编辑')
  if (!edit) throw new Error('找不到编辑入口')
  await edit.trigger('click')
  await flushPromises()
  return { sink, save }
}

async function saveButton() {
  const hit = body().findAll('button').find((item) => item.text() === '保存')
  if (!hit) throw new Error('找不到保存按钮')
  await hit.trigger('click')
  await flushPromises()
}

afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})

describe('TaskListTab · 目标端参数编辑', () => {
  it('编辑弹窗按 /sink-detail 回显已落库参数', async () => {
    await mountTab(sinkDetail())
    expect(body().find('.sink-panel').exists()).toBe(true)
    expect(body().find('.sink-preview pre').text()).toContain('ENGINE = ReplacingMergeTree(create_dt)')
    expect(body().find('.sink-preview pre').text()).toContain('ORDER BY (`id`)')
    // 编辑态一定要提示：建表产物不会自动作用于已建好的表
    expect(body().find('p.sink-warn').text()).toContain('不会改动已建好的表')
  })

  it('非 CK/ES 目标端不渲染面板，保存体里也不带 sinkOptions', async () => {
    const { save } = await mountTab(sinkDetail({ targetDatabaseType: 1, sinkOptions: null, columnMapList: [] }))
    expect(body().find('.sink-panel').exists()).toBe(false)
    await saveButton()
    expect(save.mock.calls[0]?.[0]).not.toHaveProperty('sinkOptions')
  })

  it('改引擎后保存：提交体带归一后的参数，原有 SQL 字段原样回传', async () => {
    const { save } = await mountTab(sinkDetail())
    const panel = wrapper!.findAllComponents(SinkOptionsPanel)[0]
    panel.vm.$emit('update:modelValue', { ck: { engine: 'MergeTree', versionColumn: 'create_dt', orderByColumns: ['id'] }, es: null })
    await flushPromises()
    await saveButton()
    expect(save).toHaveBeenCalledTimes(1)
    // 切引擎后面板不清 versionColumn，由服务端归一时剔除，这里只断言提交体本身
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      id: 7, fromSql: 'from-sql', startSql: 'select max(origin_update_time)',
      sinkOptions: { ck: { engine: 'MergeTree', orderByColumns: ['id'] }, es: null },
    })
  })

  it('客户端预检拦住的参数不发请求', async () => {
    const { save } = await mountTab(sinkDetail())
    const panel = wrapper!.findAllComponents(SinkOptionsPanel)[0]
    panel.vm.$emit('update:modelValue', { ck: { engine: 'ReplacingMergeTree', versionColumn: '', orderByColumns: ['ghost'] }, es: null })
    await flushPromises()
    await saveButton()
    expect(save).not.toHaveBeenCalled()
  })
})

describe('TaskListTab · 删除任务', () => {
  async function mountForDelete() {
    setActivePinia(createPinia())
    useAuthStore().info = { name: 'admin', id: 1, roles: [], groups: [], avatar: '', introduction: '', group: 1 } as never
    vi.spyOn(syncApi, 'customers').mockResolvedValue([])
    // 只有暂停态才有「删除」入口
    vi.spyOn(syncApi, 'tasks').mockResolvedValue({ list: [{ ...row, status: 1 } as SyncTask], total: 1 })
    const remove = vi.spyOn(syncApi, 'remove').mockResolvedValue({})
    wrapper = mount(TaskListTab, { attachTo: document.body, global: { plugins: [ElementPlus] } })
    await flushPromises()
    return remove
  }

  async function openDeleteDialog() {
    // el-table 的 hidden-columns 测量区也会渲染一份插槽（row 为空对象），只取真实行的按钮
    const del = body().findAll('.el-table__row button').find((b) => b.text() === '删除')
    if (!del) throw new Error('找不到删除入口')
    await del.trigger('click')
    await flushPromises()
  }

  function deleteSelect() {
    return wrapper!.findAllComponents(ElSelect)
      .find((item) => item.attributes('data-testid') === 'delete-table-operation')!
  }

  it('删除弹窗用下拉框选择目标表处理方式，默认「不处理」', async () => {
    await mountForDelete()
    await openDeleteDialog()

    const dialog = body().findAll('.el-dialog').find((item) => item.text().includes('目标表处理方式'))
    expect(dialog).toBeTruthy()
    expect(deleteSelect()).toBeTruthy()
    expect(deleteSelect().findAllComponents(ElOption).map((item) => item.props('label')))
      .toEqual(['不处理（只删任务，不动目标表）', '备份表后删除', '删除目标表'])
    expect((wrapper!.vm as any).deleteTableOperation).toBe('0')
    // 旧实现是 ElMessageBox.prompt 文本输入
    expect(body().find('.el-message-box').exists()).toBe(false)
  })

  it('默认「不处理」：确认删除不带 tableOperation', async () => {
    const remove = await mountForDelete()
    await openDeleteDialog()
    await body().find('[data-testid="delete-confirm"]').trigger('click')
    await flushPromises()

    expect(remove).toHaveBeenCalledWith(7, 3, 'gzh_db.t_holding', undefined)
    expect(document.querySelector<HTMLElement>('.el-overlay')?.style.display).toBe('none')
  })

  it('选「备份表」后确认：tableOperation 传 1', async () => {
    const remove = await mountForDelete()
    await openDeleteDialog()
    deleteSelect().vm.$emit('update:modelValue', '1')
    await flushPromises()
    await body().find('[data-testid="delete-confirm"]').trigger('click')
    await flushPromises()

    expect(remove).toHaveBeenCalledWith(7, 3, 'gzh_db.t_holding', '1')
  })
})
