// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import SqlTaskTab from './SqlTaskTab.vue'
import { syncApi, type SyncSqlTask, type SyncTableTask } from '@/api/dataSync'
import { useAuthStore } from '@/stores/auth'

const sqlRow = (extra: Partial<SyncSqlTask> = {}): SyncSqlTask => ({
  id: 101, clientId: 3, sourceCode: 'target_mysql',
  content: 'update t_order set status = 1 where id = 10;',
  result: null, status: 0, createTime: '2026-10-08 10:12:33', updateTime: '2026-10-08 10:12:33',
  ...extra,
})

const tableRow = (extra: Partial<SyncTableTask> = {}): SyncTableTask => ({
  id: 205, clientId: 4, taskId: 5001, sourceCode: 'target_ora',
  content: 'create table t_order (id bigint primary key, status tinyint);',
  result: null, status: 3, createTime: '2026-10-08 10:20:01', updateTime: '2026-10-08 10:20:01',
  ...extra,
})

function mockApis() {
  // 已存在的 spy（测试里提前覆盖的）不重复建，避免把测试实现冲掉
  const spy = (obj: object, key: string, impl: unknown) => {
    const o = obj as Record<string, unknown>
    if (!vi.isMockFunction(o[key])) {
      const s = vi.spyOn(o, key as never) as unknown as { mockResolvedValue(v: unknown): void }
      s.mockResolvedValue(impl)
    }
  }
  spy(syncApi, 'customers', [
    { id: 7, customerName: '客户 205' },
    { id: 9, customerName: '客户 300' },
  ])
  spy(syncApi, 'clients', {
    list: [
      { id: 3, customerId: 7, clientName: '客户端A', timingSync: 'off', fileSync: 'off' },
      { id: 4, customerId: 7, clientName: '客户端B', timingSync: 'off', fileSync: 'off' },
    ],
    total: 2,
  })
  spy(syncApi, 'databases', {
    list: [
      { id: 1, customerId: 7, name: '目标库', sourceCode: 'target_mysql', dbSchema: 'xcrms_ods', databaseType: 1, type: 1, appId: 3 },
      { id: 2, customerId: 7, name: '另一库', sourceCode: 'target_ora', dbSchema: 'ods', databaseType: 3, type: 1, appId: 4 },
    ],
    total: 2,
  })
  spy(syncApi, 'sqlPage', { list: [sqlRow()], total: 1 })
  spy(syncApi, 'tablePage', { list: [tableRow()], total: 1 })
  spy(syncApi, 'sqlAdd', { ok: true, message: '请求成功', data: 101 })
  spy(syncApi, 'tableAdd', { ok: true, message: '请求成功', data: 205 })
}

async function mountTab(page: 'sql' | 'table' = 'sql') {
  setActivePinia(createPinia())
  useAuthStore().info = { name: 'admin', id: 1, roles: ['admin'], groups: [], avatar: '', introduction: '', group: 1 } as never
  mockApis()
  const w = mount(SqlTaskTab, {
    props: { page },
    global: {
      // 行内操作改图标后需要真实的 el-tooltip / el-icon（v-loading 也随插件注册）；其余控件仍走下面的 stubs
      plugins: [ElementPlus],
      stubs: {
        'el-drawer': { props: ['modelValue', 'title'], template: '<div v-if="modelValue" data-testid="stt-drawer" :title="title"><slot/></div>' },
        'el-dialog': { props: ['modelValue', 'title'], template: '<div v-if="modelValue" data-testid="stt-dialog" :title="title"><slot/><slot name="footer"/></div>' },
        'el-select': {
          props: ['modelValue'],
          emits: ['update:modelValue', 'change'],
          template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)"><slot/></select>',
        },
        'el-option': { props: ['value', 'label'], template: '<option :value="value">{{ label }}</option>' },
        'el-pagination': { props: ['total'], template: '<div data-testid="stt-pager" :total="total" />' },
        'el-button': { props: ['type', 'loading'], template: '<button type="button" :disabled="loading"><slot/></button>' },
      },
    },
  })
  await flushPromises()
  return w
}

afterEach(() => vi.restoreAllMocks())

describe('SqlTaskTab · SQL 执行页', () => {
  it('挂载即拉 sqlPage + 全量客户端，渲染状态/结果/客户端列', async () => {
    const w = await mountTab('sql')
    expect(syncApi.sqlPage).toHaveBeenCalledWith(expect.objectContaining({ pageNo: 1, pageSize: 20, status: undefined }))
    // 客户端单元格：名称 + 客户名·#ID
    expect(w.text()).toContain('客户端A')
    expect(w.text()).toContain('客户 205 · #3')
    // 状态标签：status 0 → 待执行
    expect(w.text()).toContain('待执行')
    // 结果：result null → —
    expect(w.text()).toContain('—')
  })

  it('执行结果判定：success→成功、ORA-→失败、其他原样', async () => {
    vi.spyOn(syncApi, 'sqlPage').mockResolvedValue({
      list: [
        sqlRow({ id: 1, result: 'success' }),
        sqlRow({ id: 2, result: 'ORA-00054: resource busy' }),
        sqlRow({ id: 3, result: '3' }),
      ],
      total: 3,
    })
    const w = await mountTab('sql')
    expect(w.text()).toContain('成功')
    expect(w.text()).toContain('失败：ORA-00054: resource busy')
    expect(w.text()).toContain('3')
  })

  it('筛选：选客户联动拉客户端，查询带筛选参数', async () => {
    const w = await mountTab('sql')
    const selects = w.findAll('select')
    // 客户下拉（索引 0）：选 7 → 拉该客户客户端
    await selects[0].setValue('7')
    await flushPromises()
    expect(syncApi.clients).toHaveBeenCalledWith(expect.objectContaining({ customerId: '7' }))
    // 状态（索引 2）+ 数据源编码
    await w.get('[data-testid="stt-source"]').setValue('target')
    await selects[2].setValue('3')
    await w.get('[data-testid="stt-query"]').trigger('click')
    await flushPromises()
    expect(syncApi.sqlPage).toHaveBeenLastCalledWith(expect.objectContaining({ customerId: '7', sourceCode: 'target', status: 3 }))
  })

  it('详情抽屉：点详情显示字段、SQL 内容、执行结果', async () => {
    const w = await mountTab('sql')
    await w.get('[data-testid="stt-detail"]').trigger('click')
    await flushPromises()
    const drawer = w.get('[data-testid="stt-drawer"]')
    expect(drawer.attributes('title')).toBe('SQL 执行任务 #101')
    expect(drawer.text()).toContain('客户端A')
    expect(drawer.text()).toContain('target_mysql')
    expect(drawer.text()).toContain('update t_order set status = 1 where id = 10;')
    expect(drawer.text()).toContain('客户端还没有回写结果')
  })

  it('新增弹窗：选客户端拉数据源候选（按 appId 过滤），提交走二次确认后 sqlAdd', async () => {
    const w = await mountTab('sql')
    // admin 停在「全部客户」也要有候选：客户取所选客户端自己的 customerId（7）
    await w.get('[data-testid="stt-add"]').trigger('click')
    await flushPromises()
    const selects = w.findAll('select')
    // 顺序：0 客户 / 1 客户端 / 2 状态 / 3 页大小 / 4 新增客户端 / 5 新增数据源
    await selects[4].setValue('3')
    await flushPromises()
    expect(syncApi.databases).toHaveBeenCalledWith(expect.objectContaining({ customerId: 7 }))
    // 数据源候选只有 appId=3 的 target_mysql
    await selects[5].setValue('target_mysql')
    // 填 SQL
    await w.find('[data-testid="stt-add-sql"]').setValue('update t_order set status = 1 where id = 10;')
    await w.get('[data-testid="stt-add-submit"]').trigger('click')
    await flushPromises()
    // 二次确认
    const confirmDlg = w.findAll('[data-testid="stt-dialog"]').at(-1)!
    expect(confirmDlg.attributes('title')).toBe('确认下发执行')
    expect(confirmDlg.text()).toContain('返回修改')
    expect(confirmDlg.text()).toContain('target_mysql')
    await w.get('[data-testid="stt-confirm-submit"]').trigger('click')
    await flushPromises()
    expect(syncApi.sqlAdd).toHaveBeenCalledWith({ clientId: 3, sourceCode: 'target_mysql', content: 'update t_order set status = 1 where id = 10;' })
  })
})

describe('SqlTaskTab · 建表 SQL 页', () => {
  it('走 tablePage 带 taskId，渲染任务 ID 列；状态 3 → 执行完成', async () => {
    const w = await mountTab('table')
    expect(syncApi.tablePage).toHaveBeenCalledWith(expect.objectContaining({ taskId: undefined }))
    expect(w.text()).toContain('任务 ID')
    expect(w.text()).toContain('5001')
    expect(w.text()).toContain('执行完成')
  })

  it('建表筛选含任务 ID；新增弹窗有任务 ID 输入 + tableAdd', async () => {
    const w = await mountTab('table')
    await w.get('[data-testid="stt-taskid"]').setValue('5001')
    await w.get('[data-testid="stt-query"]').trigger('click')
    await flushPromises()
    expect(syncApi.tablePage).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: '5001' }))

    await w.get('[data-testid="stt-add"]').trigger('click')
    await flushPromises()
    await w.get('[data-testid="stt-add-taskid"]').setValue('5001')
    await w.find('[data-testid="stt-add-sql"]').setValue('create table t_order (id bigint primary key);')
    const selects = w.findAll('select')
    await selects[0].setValue('7') // 客户（数据源按客户 + appId 筛）
    await flushPromises()
    await selects[4].setValue('3') // 新增客户端（0 客户/1 客户端/2 状态/3 页大小/4 新增客户端/5 数据源）
    await flushPromises()
    await selects[5].setValue('target_mysql') // 数据源
    await w.get('[data-testid="stt-add-submit"]').trigger('click')
    await flushPromises()
    await w.get('[data-testid="stt-confirm-submit"]').trigger('click')
    await flushPromises()
    expect(syncApi.tableAdd).toHaveBeenCalledWith({ clientId: 3, sourceCode: 'target_mysql', content: 'create table t_order (id bigint primary key);', taskId: 5001 })
  })
})
