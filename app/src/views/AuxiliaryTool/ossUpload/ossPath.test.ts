// OSS 上传页路径规则回归 —— 这页真正会被后端 500 拦下的就是「fileId 不合法」，
// 旧版注释里写过：'/' 这种路径发过去直接 500，所以校验规则要一条条钉住。
import { describe, expect, it } from 'vitest'
import {
  buildAutoFileId,
  buildPreviewUrl,
  generateUuid,
  getDefaultPrefix,
  isValidFileId,
  joinPath,
} from './ossPath'

describe('getDefaultPrefix', () => {
  it('/qinlong/report/YYYYMMDD，月日补零', () => {
    expect(getDefaultPrefix(new Date(2026, 6, 9))).toBe('/qinlong/report/20260709')
    expect(getDefaultPrefix(new Date(2026, 11, 25))).toBe('/qinlong/report/20261225')
  })
})

describe('generateUuid', () => {
  it('形如 uuid v4，且每次不同', () => {
    const a = generateUuid()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a).not.toBe(generateUuid())
  })
})

describe('joinPath', () => {
  it('两侧多余斜杠规范化', () => {
    expect(joinPath('/a/b/', '/c.txt')).toBe('/a/b/c.txt')
    expect(joinPath('', 'c.txt')).toBe('/c.txt')
    expect(joinPath('/a/b', 'c.txt')).toBe('/a/b/c.txt')
  })
})

describe('isValidFileId', () => {
  it('合法：完整文件路径', () => {
    expect(isValidFileId('/qinlong/report/20260709/uuid.txt')).toBe(true)
    expect(isValidFileId('a.txt')).toBe(true)
  })

  it('非法：空 / 纯斜杠 / 目录结尾 / 连续斜杠 / 非字符串', () => {
    expect(isValidFileId('')).toBe(false)
    expect(isValidFileId('   ')).toBe(false)
    expect(isValidFileId('/')).toBe(false)
    expect(isValidFileId('///')).toBe(false)
    expect(isValidFileId('/a/b/')).toBe(false)
    expect(isValidFileId('/a//b.txt')).toBe(false)
    expect(isValidFileId(undefined)).toBe(false)
  })
})

describe('buildPreviewUrl', () => {
  it('基础地址去尾斜杠 + encodeURIComponent', () => {
    expect(buildPreviewUrl('http://oss/read-file?fileId=', '/a/b c.txt')).toBe(
      'http://oss/read-file?fileId=%2Fa%2Fb%20c.txt',
    )
    expect(buildPreviewUrl('http://oss/read-file?fileId=', '')).toBe('')
    expect(buildPreviewUrl('', '/a.txt')).toBe('')
  })
})

describe('buildAutoFileId', () => {
  it('前缀 + UUID + 原扩展名', () => {
    expect(buildAutoFileId('/p', 'uuid', '报告.PDF')).toBe('/p/uuid.PDF')
    expect(buildAutoFileId('/p', 'uuid', 'noext')).toBe('/p/uuid')
  })
})
