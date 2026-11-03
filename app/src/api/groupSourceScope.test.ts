// 组级源数据权限读写适配层的单测：钉住「前端只传点选结果、展开与落库交给后端」的契约形状。
// 后端口径见 SysGroupResService.saveSourceScope（SOURCE/STRUCT 目录 + SOURCE/ID 单源，一个事务）。
// 取源按 kind 走 sourcePaged 的 directory 谓词：系统目录与业务目录是两张表，不能用一条 CATEGORY_ID 口径代替。
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client', () => ({ request: vi.fn() }))
vi.mock('./index', () => ({ sourceApi: { sourcePaged: vi.fn() } }))

import { request } from './client'
import { sourceApi } from './index'
import {
  getGroupSourceScope,
  listDirectorySources,
  saveGroupSourceScope,
  type GroupSourceScope,
} from './groupSourceScope'

const called = () => vi.mocked(request).mock.calls
const scope = (over: Partial<GroupSourceScope> = {}): GroupSourceScope => ({
  accept: { dirIds: [], sourceIds: [] }, reject: { dirIds: [], sourceIds: [] }, ...over,
})

beforeEach(() => {
  vi.mocked(request).mockReset()
  vi.mocked(sourceApi.sourcePaged).mockReset()
})

describe('getGroupSourceScope', () => {
  it('按 groupId 读 source-scope，并把后端可能缺失的 accept/reject 归一成两个 Grant', async () => {
    vi.mocked(request).mockResolvedValue({
      accept: { dirIds: ['9009250', '9009250'], sourceIds: ['430001300', ''] },
    })
    const s = await getGroupSourceScope(100001)
    expect(called()[0]).toEqual(['group-res/source-scope', { groupId: 100001 }, { method: 'GET' }])
    expect(s.accept).toEqual({ dirIds: ['9009250'], sourceIds: ['430001300'] })
    expect(s.reject).toEqual({ dirIds: [], sourceIds: [] })
  })

  it('后端整体为空时回两个空 Grant，不让调用方判空', async () => {
    vi.mocked(request).mockResolvedValue(null)
    const s = await getGroupSourceScope(100001)
    expect(s).toEqual({ accept: { dirIds: [], sourceIds: [] }, reject: { dirIds: [], sourceIds: [] } })
  })
})

describe('saveGroupSourceScope', () => {
  it('一次 modify-source-scope：前端只传点选结果，不再自己展开目录或逐条 add/modify', async () => {
    vi.mocked(request).mockResolvedValue({ groupId: 100001 })
    await saveGroupSourceScope(100001, scope({
      accept: { dirIds: ['d1'], sourceIds: ['501', '501', '502'] },
      reject: { dirIds: [], sourceIds: ['900'] },
    }))
    expect(called()).toHaveLength(1)
    expect(called()[0]).toEqual([
      'group-res/modify-source-scope',
      { groupId: 100001, accept: { dirIds: ['d1'], sourceIds: ['501', '502'] }, reject: { dirIds: [], sourceIds: ['900'] } },
      { method: 'POST' },
    ])
  })
})

describe('listDirectorySources', () => {
  it('按 kind 走 sourcePaged 的 directory 谓词，含子级由后端展开（业务目录才不会取到空）', async () => {
    vi.mocked(sourceApi.sourcePaged).mockResolvedValue({
      total: 2,
      list: [{ sourceId: 430001300, name: '中国网财经' }, { sourceId: '', name: '脏行' }],
    } as never)

    const res = await listDirectorySources('biz', '9009253', { keyword: ' 财经 ', limit: 800 })

    expect(sourceApi.sourcePaged).toHaveBeenCalledWith({
      page: 1,
      size: 800,
      name: '财经',
      directory: { kind: 'biz', mode: 'selected', selections: [{ id: '9009253', includeDescendants: true }] },
    })
    expect(res).toEqual({ total: 2, list: [{ id: '430001300', name: '中国网财经' }] })
  })

  it('空 keyword 不发 name；没回 list 时给空数组而不是抛错', async () => {
    vi.mocked(sourceApi.sourcePaged).mockResolvedValue({ total: 0 } as never)

    const res = await listDirectorySources('sys', '9009001', { keyword: '   ' })

    expect(vi.mocked(sourceApi.sourcePaged).mock.calls[0]![0]).not.toHaveProperty('name')
    expect(res).toEqual({ total: 0, list: [] })
  })
})
