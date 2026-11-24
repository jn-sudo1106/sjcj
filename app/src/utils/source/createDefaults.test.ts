import { afterEach, describe, expect, it, vi } from 'vitest'
import * as sourceDirs from '@/api/sourceDirs'
import type { Source } from '@/api'
import { mostUsedFlowSource, siteBizDirSelection } from './createDefaults'

const src = (sourceId: string, flowId?: string) => ({ sourceId, name: sourceId, url: '', configId: '', mainTable: '', owner: '', state: 'C', flowId }) as Source

describe('建源默认值（1123）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('最常用流程：挂源最多的流程上的第一个源；都没流程取第一个源；没有源返回 null', () => {
    expect(mostUsedFlowSource([src('a', 'f1'), src('b', 'f2'), src('c', 'f2')])?.sourceId).toBe('b')
    expect(mostUsedFlowSource([src('a'), src('b', '0')])?.sourceId).toBe('a')
    expect(mostUsedFlowSource([])).toBeNull()
  })

  it('网站业务目录补齐完整路径；路径读取失败用叶子名；没有目录返回 null', async () => {
    vi.spyOn(sourceDirs, 'loadDirPath').mockResolvedValueOnce(['股票数据', '基本资料'])
    expect(await siteBizDirSelection({ dirId: '9', category: '基本资料' })).toEqual({ dirId: '9', category: '基本资料', categoryPath: '/股票数据/基本资料' })
    vi.spyOn(sourceDirs, 'loadDirPath').mockRejectedValueOnce(new Error('x'))
    expect(await siteBizDirSelection({ dirId: '9', category: '', categoryPath: '基本资料' })).toEqual({ dirId: '9', category: '基本资料', categoryPath: '/基本资料' })
    expect(await siteBizDirSelection({ dirId: '0', category: 'x' })).toBeNull()
    expect(await siteBizDirSelection(null)).toBeNull()
  })
})
