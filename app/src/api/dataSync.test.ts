// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateSyncSql, mapSyncColumns, submitSyncColumns, syncApi } from './dataSync'

afterEach(() => vi.unstubAllGlobals())

function response(data: unknown, count?: number) {
  return { ok: true, text: async () => JSON.stringify({ code: '0', data, ...(count === undefined ? {} : { count }) }) }
}

describe('旧数据同步契约', () => {
  it('分页、目标数据库和执行任务请求沿用 sync-platform 的路径与参数', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(response([{ id: 1 }], 25))
      .mockResolvedValueOnce(response([{ id: 9, name: 'test' }]))
      .mockResolvedValueOnce(response(null))
    vi.stubGlobal('fetch', fetchSpy)
    expect(await syncApi.tasks({ pageNo: 2, pageSize: 10 })).toEqual({ list: [{ id: 1 }], total: 25 })
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/sync-platform/task-overview/page')
    expect(JSON.parse(fetchSpy.mock.calls[0]?.[1].body)).toEqual({ pageNo: 2, pageSize: 10 })
    expect(await syncApi.customerDatabases(5, 0)).toEqual([{ id: 9, name: 'test' }])
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('/api/sync-platform/customer/database/list?customerId=5&type=0')
    await syncApi.run([{ taskId: 4, clientId: 7 }], { startId: 1, endId: 8 })
    expect(JSON.parse(fetchSpy.mock.calls[2]?.[1].body)).toEqual({ taskSchemeDTOList: [{ taskId: 4, clientId: 7 }], startId: 1, endId: 8 })
  })

  it('非分页列表带 count:null 时仍返回数组（同步服务真实响应形状）', async () => {
    const list = [{ entryTypeId: 900, tableName: 'sense_data.TB_CNEWS', typeName: '新闻' }]
    const fetchSpy = vi.fn().mockImplementation(async () => response(list, null as unknown as number))
    vi.stubGlobal('fetch', fetchSpy)
    expect(await syncApi.tables(405)).toEqual(list)
    expect(await syncApi.customers()).toEqual(list)
    expect(await syncApi.customerDatabases(405, 0)).toEqual(list)
    expect(await syncApi.tableColumns(900)).toEqual(list)
    fetchSpy.mockImplementation(async () => response(null, null as unknown as number))
    expect(await syncApi.taskChoices({ name: '同步' })).toEqual([])
  })

  it('启停使用旧 PUT query 契约', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(response(null))
    vi.stubGlobal('fetch', fetchSpy)
    await syncApi.stop([1, 2])
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/sync-platform/task-config/stop?ids=1%2C2')
    expect(fetchSpy.mock.calls[0]?.[1].method).toBe('PUT')
  })

  it('源表字段映射保留旧字段与 SQL 模板口径', () => {
    const rows = mapSyncColumns([{ itemId: 7, itemCode: 'id', columnName: 'ID', itemName: '主键', dataType: 'string', width: 64 }])
    expect(rows[0]).toMatchObject({ targetColumn: 'id', targetColumnType: 'varchar', fileColumn: 'source_id', distinct: true })
    expect(submitSyncColumns(rows)[0]).toMatchObject({ targetColumnType: 'varchar(64)', distinctFlag: 1 })
    expect(generateSyncSql('sense_data.tb_x', rows)).toContain('ID as startId')
    expect(generateSyncSql('sense_data.tb_x', rows, true)).toContain("'sense_data.tb_x' as source_table")
  })
})
