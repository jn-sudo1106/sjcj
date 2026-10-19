// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  autoEsIndexName, isEsIndexNameValid, isSinkTarget, parseSinkOptions, renderSinkDefaults,
  sanitizeSinkOptions, sinkOptionsProblem, sinkPreviewLines,
  generateSyncSql, mapEntityCopyColumns, mapSyncColumns, submitSyncColumns, syncApi, WATERMARK_COLUMN,
  type SyncColumnMap, type SyncSinkDetail, type SyncSinkOptions,
} from './dataSync'

afterEach(() => vi.unstubAllGlobals())

function response(data: unknown, count?: number) {
  return { ok: true, text: async () => JSON.stringify({ code: '0', data, ...(count === undefined ? {} : { count }) }) }
}

describe('旧数据同步契约', () => {
  it('分页、目标数据库和执行任务请求沿用 sync-platform 的路径与参数', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(response([{ id: 1 }], 25))
      .mockResolvedValueOnce(response([{ id: 9, name: 'test' }]))
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response({ taskId: 4, targetDatabaseType: 4, columnMapList: [] }))
    vi.stubGlobal('fetch', fetchSpy)
    expect(await syncApi.tasks({ pageNo: 2, pageSize: 10 })).toEqual({ list: [{ id: 1 }], total: 25 })
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/sync-platform/task-overview/page')
    expect(JSON.parse(fetchSpy.mock.calls[0]?.[1].body)).toEqual({ pageNo: 2, pageSize: 10 })
    expect(await syncApi.customerDatabases(5, 0)).toEqual([{ id: 9, name: 'test' }])
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('/api/sync-platform/customer/database/list?customerId=5&type=0')
    await syncApi.run([{ taskId: 4, clientId: 7 }], { startId: 1, endId: 8 })
    expect(JSON.parse(fetchSpy.mock.calls[2]?.[1].body)).toEqual({ taskSchemeDTOList: [{ taskId: 4, clientId: 7 }], startId: 1, endId: 8 })
    expect(await syncApi.sinkDetail(4)).toMatchObject({ taskId: 4, targetDatabaseType: 4 })
    expect(fetchSpy.mock.calls[3]?.[0]).toBe('/api/sync-platform/task-config/sink-detail?taskId=4')
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

  it('配置管理写接口：ids 走 query 不带 body，新增客户端回读一次性密钥', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response({ id: 1201, clientName: 'sense-data', secretKey: 'KEY-ONCE' }))
      .mockResolvedValueOnce(response(null))
    vi.stubGlobal('fetch', fetchSpy)
    await syncApi.removeCustomers([3, 4])
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/sync-platform/customer/delete?ids=3%2C4')
    expect(fetchSpy.mock.calls[0]?.[1].method).toBe('DELETE')
    // 与 PUT 启停同一口径：ids 只进 query，不发一个空 JSON body
    expect(fetchSpy.mock.calls[0]?.[1].body).toBeUndefined()
    await syncApi.removeDatabases([9])
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('/api/sync-platform/customer/database/delete?ids=9')
    expect(await syncApi.saveClient({ customerId: 5, clientName: 'sense-data', timingSync: 'on', fileSync: 'off', realtimeSync: 'off' }))
      .toMatchObject({ id: 1201, secretKey: 'KEY-ONCE' })
    await syncApi.saveDatabase({ customerId: 5, appId: 1201, name: 'ES 目标', sourceCode: 'es_target', databaseType: 5, dbSchema: '', type: 0 })
    expect(JSON.parse(fetchSpy.mock.calls[3]?.[1].body)).toMatchObject({ appId: 1201, sourceCode: 'es_target', databaseType: 5 })
  })

  it('源表字段映射保留旧字段与 SQL 模板口径', () => {
    const rows = mapSyncColumns([{ itemId: 7, itemCode: 'id', columnName: 'ID', itemName: '主键', dataType: 'string', width: 64 }])
    expect(rows[0]).toMatchObject({ targetColumn: 'id', targetColumnType: 'varchar', fileColumn: 'source_id', distinct: true })
    expect(submitSyncColumns(rows)[0]).toMatchObject({ targetColumnType: 'varchar(64)', distinctFlag: 1 })
    expect(generateSyncSql('sense_data.tb_x', rows)).toContain('ID as startId')
    expect(generateSyncSql('sense_data.tb_x', rows, true)).toContain("'sense_data.tb_x' as source_table")
  })
})

describe('SQL 执行 / 建表任务（1008-10，接口文档第二版）', () => {
  it('sqlPage / tablePage：POST 到各自路径，参数带全筛选字段', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(response({ list: [{ id: 101 }], total: 1 }, 1))
    vi.stubGlobal('fetch', fetchSpy)

    await syncApi.sqlPage({ pageNo: 2, pageSize: 20, customerId: 7, clientId: 3, sourceCode: 'target', status: 0 })
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/sync-platform/sql-execute/page')
    expect(fetchSpy.mock.calls[0]?.[1].method).toBe('POST')
    expect(JSON.parse(fetchSpy.mock.calls[0]?.[1].body)).toEqual({ pageNo: 2, pageSize: 20, customerId: 7, clientId: 3, sourceCode: 'target', status: 0 })

    await syncApi.tablePage({ pageNo: 1, pageSize: 10, taskId: 5001, status: 3 })
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('/api/sync-platform/table-definition/page')
    expect(JSON.parse(fetchSpy.mock.calls[1]?.[1].body)).toEqual({ pageNo: 1, pageSize: 10, taskId: 5001, status: 3 })
  })

  it('sqlAdd / tableAdd：POST 新增，标量 data 是新增记录 id（带回 data 字段）', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(response(101))
      .mockResolvedValueOnce(response(205))
    vi.stubGlobal('fetch', fetchSpy)

    const sqlRes = await syncApi.sqlAdd({ clientId: 3, sourceCode: 'target_mysql', content: 'update t_order set status=1;' })
    expect(sqlRes).toMatchObject({ ok: true, data: 101 })
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/sync-platform/sql-execute/add')
    expect(JSON.parse(fetchSpy.mock.calls[0]?.[1].body)).toEqual({ clientId: 3, sourceCode: 'target_mysql', content: 'update t_order set status=1;' })

    const tableRes = await syncApi.tableAdd({ clientId: 3, taskId: 5001, sourceCode: 'target_mysql', content: 'create table t_order (...);' })
    expect(tableRes).toMatchObject({ ok: true, data: 205 })
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('/api/sync-platform/table-definition/add')
    expect(JSON.parse(fetchSpy.mock.calls[1]?.[1].body)).toEqual({ clientId: 3, taskId: 5001, sourceCode: 'target_mysql', content: 'create table t_order (...);' })
  })
})

// 面板预览的是「服务端会渲染成什么」，这组断言锁住两端同口径
describe('同步实体的列全集与水位列', () => {
  // 服务端 /database/physical-columns 直接回 SyncColumnMap 形状，key/no 由前端补齐
  function physical(column: string, type: string, remark = ''): SyncColumnMap {
    return { key: column, no: 0, sourceColumn: column, targetColumn: column, targetColumnType: type, remark }
  }

  it('物理列一同名映射，末尾追加取 UPDATE_DT 供值的水位列', () => {
    const rows = mapEntityCopyColumns([
      physical('ENTRY_ID', 'bigint(20)', '批次号'), physical('UPDATE_DT', 'datetime', '更新时间'),
    ])
    expect(rows.map((item) => `${item.sourceColumn}=>${item.targetColumn}`))
      .toEqual(['ENTRY_ID=>ENTRY_ID', 'UPDATE_DT=>UPDATE_DT', 'UPDATE_DT=>origin_update_time'])
    const watermark = rows[rows.length - 1]
    expect(watermark).toMatchObject({ targetColumnType: 'varchar', typeLength: 50, fileColumn: 'origin_update_time' })
    expect(submitSyncColumns(rows)[rows.length - 1]).toMatchObject({ targetColumnType: 'varchar(50)', distinctFlag: 0 })
    // 物理列的类型串自带长度，不能再被拼一次
    expect(submitSyncColumns(rows)[0]).toMatchObject({ targetColumnType: 'bigint(20)' })
  })

  it('源表已有同名列就直接当水位列，不重复追加', () => {
    const rows = mapEntityCopyColumns([physical('id', 'bigint'), physical('origin_update_time', 'varchar(50)')])
    expect(rows.filter((item) => item.targetColumn === WATERMARK_COLUMN)).toHaveLength(1)
    expect(rows.find((item) => item.targetColumn === WATERMARK_COLUMN)?.fileColumn).toBe(WATERMARK_COLUMN)
  })

  it('既无 UPDATE_DT 也无 origin_update_time 时交不出水位列，由调用方拦下', () => {
    const rows = mapEntityCopyColumns([physical('ENTRY_ID', 'bigint'), physical('name', 'varchar(64)')])
    expect(rows.some((item) => item.targetColumn === WATERMARK_COLUMN)).toBe(false)
  })

  it('去重列与文件列沿用实体配置，不因为换成物理列而丢失', () => {
    const baseline: SyncColumnMap[] = [
      { key: 1, no: 1, sourceColumn: 'ENTRY_ID', targetColumn: 'id', targetColumnType: 'bigint', distinct: true, fileColumn: 'source_id' },
      { key: 2, no: 2, sourceColumn: 'FILE_PATH', targetColumn: 'file_path', targetColumnType: 'varchar', fileColumn: 'file_path' },
    ]
    const rows = mapEntityCopyColumns(
      [physical('ENTRY_ID', 'bigint(20)'), physical('FILE_PATH', 'varchar(255)'), physical('UPDATE_DT', 'datetime')],
      baseline)
    expect(rows[0]).toMatchObject({ distinct: true, fileColumn: 'source_id' })
    expect(rows[1]).toMatchObject({ fileColumn: 'file_path' })
  })

  it('物理列走 sync-platform 的只读接口', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(response([{ targetColumn: 'id' }]))
    vi.stubGlobal('fetch', fetchSpy)
    await syncApi.physicalColumns('sense_data.tb_holding')
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/sync-platform/database/physical-columns?table=sense_data.tb_holding')
  })

  it('实体复制的 SELECT 带出全部物理列与水位列', () => {
    const rows = mapEntityCopyColumns([
      physical('ENTRY_ID', 'bigint(20)'), physical('secu_code', 'varchar(30)'), physical('UPDATE_DT', 'datetime'),
    ])
    const sql = generateSyncSql('sense_data.tb_holding', rows)
    expect(sql).toContain('ENTRY_ID as startId')
    expect(sql).toContain('secu_code as `secu_code`')
    expect(sql).toContain("DATE_FORMAT(UPDATE_DT, '%Y-%m-%d %H:%i:%s') as origin_update_time")
  })
})

describe('CK / ES 目标端参数镜像', () => {
  const mapped: SyncColumnMap[] = [
    { key: 1, no: 1, sourceColumn: 'ID', targetColumn: 'id', targetColumnType: 'bigint', distinct: true },
    { key: 2, no: 2, sourceColumn: 'ENTRY_ID', targetColumn: 'entry_id', targetColumnType: 'varchar', remark: '批次', distinct: true },
    { key: 3, no: 3, sourceColumn: 'NAME', targetColumn: 'name', targetColumnType: 'varchar' },
    { key: 4, no: 4, sourceColumn: 'UPDATE_DT', targetColumn: 'origin_update_time', targetColumnType: 'varchar' },
  ]

  it('只有 ClickHouse / Elasticsearch 有目标端参数', () => {
    for (const type of [1, 2, 3]) {
      expect(isSinkTarget(type)).toBe(false)
      expect(renderSinkDefaults(type, mapped)).toBeNull()
    }
    expect(renderSinkDefaults(4, mapped)?.ck).toMatchObject({ engine: 'ReplacingMergeTree', orderByColumns: [] })
    expect(renderSinkDefaults(5, mapped)?.es).toMatchObject({
      shards: 1, replicas: 1, dynamic: 'strict', indexPartition: 'none', timeField: 'origin_update_time',
    })
  })

  it('预览的引擎与排序键等于服务端渲染口径', () => {
    const lines = sinkPreviewLines(renderSinkDefaults(4, mapped), 4, 'db', 't', mapped)
    expect(lines[0]).toBe('ENGINE = ReplacingMergeTree(update_time)')
    expect(lines[1]).toBe('ORDER BY (`id`, `entry_id`)')
    expect(sinkPreviewLines({ ck: { engine: 'MergeTree', versionColumn: 'name', orderByColumns: [] }, es: null },
      4, 'db', 't', mapped)[0]).toBe('ENGINE = MergeTree()')
  })

  it('ES 索引名清洗与合法性判定跟后端同一套规则', () => {
    expect(autoEsIndexName('gzh_db', 'T_Holding_Detail')).toBe('gzh_db_t_holding_detail')
    expect(autoEsIndexName('a b', 'c.d')).toBe('a_b_c_d')
    expect(isEsIndexNameValid('my_alias-2026')).toBe(true)
    expect(['My_Index', 'a*b', '_lead', '', 'a__b'].map(isEsIndexNameValid)).toEqual([false, false, false, false, false])
  })

  it('提交体里空值一律按未配置处理', () => {
    const dirty: SyncSinkOptions = { ck: null, es: { index: '  my_alias  ', shards: 3, replicas: 0, dynamic: 'strict',
      indexPartition: 'day', timeField: 'origin_update_time', idColumns: ['id', '  '],
      fieldOverrides: [{ column: ' name ', type: 'text', keyword: false, format: undefined as unknown as string },
        { column: '', type: 'date', keyword: true, format: '' }] } }
    expect(sanitizeSinkOptions(dirty, 5)).toEqual({ ck: null, es: {
      index: 'my_alias', shards: 3, replicas: 0, dynamic: 'strict', indexPartition: 'day',
      timeField: 'origin_update_time', idColumns: ['id'],
      fieldOverrides: [{ column: 'name', type: 'text', keyword: false, format: '' }],
    } })
    expect(sanitizeSinkOptions(renderSinkDefaults(1, mapped), 1)).toBeNull()
  })

  it('客户端预检只挡服务端一定会拒的', () => {
    expect(sinkOptionsProblem(sanitizeSinkOptions(renderSinkDefaults(4, mapped), 4), mapped)).toBe('')
    expect(sinkOptionsProblem({ ck: { engine: 'CollapsingMergeTree', versionColumn: '', orderByColumns: ['id'] }, es: null }, mapped))
      .toContain('ClickHouse 引擎只支持')
    expect(sinkOptionsProblem({ ck: { engine: 'MergeTree', versionColumn: '', orderByColumns: [] }, es: null },
      [{ key: 1, no: 1, sourceColumn: 'NAME', targetColumn: 'name', targetColumnType: 'varchar' }]))
      .toContain('去重')
    expect(sinkOptionsProblem({ ck: null, es: { ...(renderSinkDefaults(5, mapped) as SyncSinkOptions).es!, index: 'Bad Name' } }, mapped))
      .toContain('索引名不合法')
    expect(sinkOptionsProblem({ ck: null, es: { ...(renderSinkDefaults(5, mapped) as SyncSinkOptions).es!, timeField: 'ghost' } }, mapped))
      .toContain('水位列 ghost')
  })

  it('老任务 extend_config 为空时回显成当前默认值', () => {
    expect(parseSinkOptions(null, 4, mapped)?.ck).toMatchObject({ engine: 'ReplacingMergeTree', versionColumn: '' })
    const saved = JSON.stringify({ ck: null, es: { index: 'my_alias', idColumns: ['id'], fieldOverrides: [] } })
    expect(parseSinkOptions(saved, 5, mapped)?.es).toMatchObject({
      index: 'my_alias', shards: 1, replicas: 1, dynamic: 'strict', idColumns: ['id'],
    })
    expect(parseSinkOptions('{ 坏数据', 5, mapped)?.es?.index).toBe('')
  })

  it('/sink-detail 返回的对象形态可直接回显，缺字段补当前默认', () => {
    const rsp: SyncSinkDetail = {
      taskId: 7, targetDatabaseType: 5, targetSchema: 'gzh_db', targetTable: 't_holding', columnMapList: mapped,
      sinkOptions: { ck: null, es: { index: 'gzh_hold', shards: 3, replicas: 2, dynamic: 'true',
        indexPartition: 'day', timeField: 'origin_update_time', idColumns: ['id'], fieldOverrides: [] } },
    }
    const echo = parseSinkOptions(rsp.sinkOptions, rsp.targetDatabaseType, rsp.columnMapList ?? [])
    expect(echo?.es).toMatchObject({ index: 'gzh_hold', shards: 3, replicas: 2, dynamic: 'true', indexPartition: 'day' })
    // 服务端只存了一半参数（早期落库）时缺的用默认补齐，提交体仍是完整对象，不会把 undefined 发回去
    const partial = parseSinkOptions({ ck: null, es: { index: 'gzh_hold' } as never }, 5, mapped)?.es
    expect(partial).toMatchObject({ index: 'gzh_hold', shards: 1, replicas: 1, dynamic: 'strict', indexPartition: 'none' })
    expect(sanitizeSinkOptions({ ck: null, es: partial! }, 5)?.es).toMatchObject({ index: 'gzh_hold', idColumns: [] })
  })
})
