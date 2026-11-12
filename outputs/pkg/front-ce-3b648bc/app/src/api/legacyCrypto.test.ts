import { describe, expect, it } from 'vitest'
import { decryptLegacyPayload, encryptLegacyPayload } from './legacyCrypto'

describe('旧平台 AES 请求体兼容', () => {
  it('使用固定密钥、ECB 和 PKCS7，能无损还原查询参数', () => {
    const query = { page: 1, limit: 20, entryType: '2000042', sourceId: '301230472' }
    const encrypted = encryptLegacyPayload(query)

    expect(encrypted).not.toContain('entryType')
    expect(JSON.parse(decryptLegacyPayload(encrypted))).toEqual(query)
  })
})
