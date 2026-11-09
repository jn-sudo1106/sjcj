import { describe, expect, it } from 'vitest'
import { isMissingTableError } from './missingTable'

describe('isMissingTableError', () => {
  it.each([
    "Table 'sense_data.tb_yq' doesn't exist",
    'SQLSyntaxErrorException: 1146',
    'Code: 60. DB::Exception: Table default.x does not exist. (UNKNOWN_TABLE)',
    '实体表 tb_yq 不存在',
  ])('识别：%s', (message) => {
    expect(isMissingTableError(message)).toBe(true)
  })

  it('其他错误不算', () => {
    expect(isMissingTableError('Request timeout')).toBe(false)
    expect(isMissingTableError('源不存在或加载失败')).toBe(false)
  })
})
