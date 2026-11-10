import { describe, expect, it } from 'vitest'
import {
  MISSING_TABLE_HINT,
  PHYSICAL_TABLE_MISSING_LABEL,
  PHYSICAL_TABLE_UNKNOWN_LABEL,
  isMissingTableError,
} from './missingTable'

/** 造一个 app/src/api/client.ts ApiError 形态的错误：cause.body 是解析后的响应信封 */
function apiError(body: unknown) {
  const cause = new Error('request failed') as Error & { body: unknown; status: number }
  cause.body = body
  cause.status = 400
  return { endpoint: 'config/preview', message: 'Gateway Error', cause }
}

describe('isMissingTableError（§10.1/§10.2 结构化口径，不匹配异常文本）', () => {
  it.each([
    ['MySQL 1146 code', { code: 1146 }],
    ['字符串 1146', { code: '1146' }],
    ['UNKNOWN_TABLE', { code: 'UNKNOWN_TABLE' }],
    ['TABLE_NOT_EXIST', { code: 'TABLE_NOT_EXIST' }],
    ['data.missingTable 标记', { code: 0, data: { missingTable: true } }],
    ['tableState=missing', { tableState: 'missing' }],
    ['data.tableState=missing', { data: { tableState: 'missing' } }],
  ])('结构化信号命中：%s', (_name, body) => {
    expect(isMissingTableError(apiError(body))).toBe(true)
  })

  it('文本里带数据库异常特征但没有结构化字段 → 不算缺表', () => {
    expect(isMissingTableError(new Error("Table 'sense_data.tb_yq' doesn't exist"))).toBe(false)
    expect(isMissingTableError(new Error('Code: 60. DB::Exception: Table default.x (UNKNOWN_TABLE)'))).toBe(false)
    expect(isMissingTableError(new Error('SQLSyntaxErrorException: 1146'))).toBe(false)
    expect(isMissingTableError(new Error('实体表 tb_yq 不存在'))).toBe(false)
  })

  it('非缺表的结构化错误（超时/无权限）不算缺表', () => {
    expect(isMissingTableError(apiError({ code: 500, msg: 'Request timeout' }))).toBe(false)
    expect(isMissingTableError(apiError({ code: 403, msg: '无权限' }))).toBe(false)
    expect(isMissingTableError(apiError({ data: { missingTable: false }, tableState: 'unknown' }))).toBe(false)
  })

  it('cause 只是普通 Error / 空值时安全返回 false', () => {
    const network = new Error('Network Error') as Error & { cause?: unknown }
    network.cause = new Error('connect ECONNREFUSED')
    expect(isMissingTableError(network)).toBe(false)
    expect(isMissingTableError(undefined)).toBe(false)
    expect(isMissingTableError('1146')).toBe(false)
  })

  it('状态文案与提示不把缺表说成「暂无数据」', () => {
    expect(PHYSICAL_TABLE_MISSING_LABEL).toBe('物理表不存在')
    expect(PHYSICAL_TABLE_UNKNOWN_LABEL).toBe('状态待检查')
    expect(MISSING_TABLE_HINT).not.toContain('暂无数据')
  })
})