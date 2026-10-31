// 组级源数据权限落库编排的单测：钉住「按规则写 sys_group_res」的形状，防止回退。
// 只测编排（get/save 的规则映射、展开、diff、试算拦截），不碰后端鉴权核心。
import { beforeEach, describe, expect, it, vi } from 'vitest'

// expandCategoryIds 来自 api/index 大桶，这里桩掉：选中目录 → 追加一个假后代，验证“展开后代”被调用
vi.mock('./index', () => ({
  expandCategoryIds: vi.fn(async (ids: string[]) => ids.flatMap((i) => [i, `${i}_child`])),
}))

import * as groupRes from './groupRes'
import { expandCategoryIds } from './index'
import { getGroupSourceScope, saveGroupSourceScope, type GroupSourceScope } from './groupSourceScope'

function rule(over: Partial<groupRes.GroupResRule>): groupRes.GroupResRule {
  return {
    id: 1, groupId: 90001, action: 'ACCEPT', resType: 'SOURCE', condType: 'ID',
    resCond: '', condJson: null, remarks: null, isDelete: 0, ...over,
  }
}
const okPreview = { compiledCond: '', condType: '', count: 0, sample: [], error: null }
const scope = (over: Partial<GroupSourceScope> = {}): GroupSourceScope => ({
  accept: { dirIds: [], sourceIds: [] }, reject: { dirIds: [], sourceIds: [] }, ...over,
})

beforeEach(() => {
  vi.restoreAllMocks()
  vi.mocked(expandCategoryIds).mockImplementation(async (ids: string[]) => ids.flatMap((i) => [i, `${i}_child`]))
})

describe('getGroupSourceScope', () => {
  it('归并 SOURCE 规则到 accept/reject × dirIds/sourceIds，STRUCT 优先用 remarks.roots 还原最小目录', async () => {
    vi.spyOn(groupRes, 'pagedGroupRes').mockResolvedValue({ total: 3, list: [
      rule({ id: 1, condType: 'STRUCT', condJson: '[{"field":"CATEGORY_ID","op":"IN","values":["d1","d1_child"]}]', remarks: '{"roots":["d1"]}' }),
      rule({ id: 2, condType: 'ID', resCond: '501,502' }),
      rule({ id: 3, action: 'REJECT', condType: 'ID', resCond: '900' }),
    ] })
    const s = await getGroupSourceScope(90001)
    expect(s.accept.dirIds).toEqual(['d1'])
    expect(s.accept.sourceIds).toEqual(['501', '502'])
    expect(s.reject.sourceIds).toEqual(['900'])
  })

  it('STRUCT 无 remarks.roots（存量/手工规则）时回退 condJson values', async () => {
    vi.spyOn(groupRes, 'pagedGroupRes').mockResolvedValue({ total: 1, list: [
      rule({ id: 1, condType: 'STRUCT', condJson: '[{"field":"CATEGORY_ID","op":"IN","values":["d1","d1a"]}]', remarks: null }),
    ] })
    const s = await getGroupSourceScope(90001)
    expect(s.accept.dirIds).toEqual(['d1', 'd1a'])
  })

  it('忽略非 SOURCE 与已软删规则', async () => {
    vi.spyOn(groupRes, 'pagedGroupRes').mockResolvedValue({ total: 2, list: [
      rule({ id: 1, resType: 'CONFIG', condType: 'ID', resCond: '7' }),
      rule({ id: 2, condType: 'ID', resCond: '8', isDelete: 1 }),
    ] })
    const s = await getGroupSourceScope(90001)
    expect(s.accept.sourceIds).toEqual([])
  })
})

describe('saveGroupSourceScope', () => {
  it('无存量：整目录 add STRUCT（展开后代 + remarks roots），单源 add ID；保存前逐条 preview', async () => {
    vi.spyOn(groupRes, 'pagedGroupRes').mockResolvedValue({ total: 0, list: [] })
    const add = vi.spyOn(groupRes, 'addGroupRes').mockResolvedValue({ ok: true, message: '', data: 9 })
    const preview = vi.spyOn(groupRes, 'previewGroupRes').mockResolvedValue(okPreview)

    await saveGroupSourceScope(90001, scope({ accept: { dirIds: ['d1'], sourceIds: ['501'] } }))

    expect(expandCategoryIds).toHaveBeenCalledWith(['d1'])
    const structCall = add.mock.calls.find((c) => c[0].condType === 'STRUCT')
    expect(structCall?.[0]).toMatchObject({ resType: 'SOURCE', action: 'ACCEPT', condType: 'STRUCT', resCond: '', remarks: '{"roots":["d1"]}' })
    expect(JSON.parse(String(structCall?.[0].condJson))[0]).toMatchObject({ field: 'CATEGORY_ID', op: 'IN', values: ['d1', 'd1_child'] })
    const idCall = add.mock.calls.find((c) => c[0].condType === 'ID')
    expect(idCall?.[0]).toMatchObject({ resType: 'SOURCE', action: 'ACCEPT', condType: 'ID', resCond: '501' })
    expect(preview).toHaveBeenCalledTimes(2)
  })

  it('有存量：改第一条、多余同槽规则删除；本槽清空则全删', async () => {
    vi.spyOn(groupRes, 'pagedGroupRes').mockResolvedValue({ total: 3, list: [
      rule({ id: 10, condType: 'ID', resCond: '1' }),
      rule({ id: 11, condType: 'ID', resCond: '2' }),          // 同槽多余
      rule({ id: 12, action: 'REJECT', condType: 'ID', resCond: '3' }), // 本次 REJECT 空 → 删
    ] })
    const modify = vi.spyOn(groupRes, 'modifyGroupRes').mockResolvedValue(rule({ id: 10 }))
    const del = vi.spyOn(groupRes, 'deleteGroupRes').mockResolvedValue({ ok: true, message: '', data: 0 })
    vi.spyOn(groupRes, 'previewGroupRes').mockResolvedValue(okPreview)

    await saveGroupSourceScope(90001, scope({ accept: { dirIds: [], sourceIds: ['7'] } }))

    expect(modify).toHaveBeenCalledWith(expect.objectContaining({ id: 10, condType: 'ID', resCond: '7' }))
    const deleted = del.mock.calls.flatMap((c) => c[0])
    expect(deleted).toContain(11)
    expect(deleted).toContain(12)
  })

  it('preview 报错：抛出且不写库', async () => {
    vi.spyOn(groupRes, 'pagedGroupRes').mockResolvedValue({ total: 0, list: [] })
    vi.spyOn(groupRes, 'previewGroupRes').mockResolvedValue({ ...okPreview, error: 'ids 只能是逗号分隔的数字' })
    const add = vi.spyOn(groupRes, 'addGroupRes')
    await expect(saveGroupSourceScope(90001, scope({ accept: { dirIds: [], sourceIds: ['x'] } })))
      .rejects.toThrow('源条件试算失败')
    expect(add).not.toHaveBeenCalled()
  })
})
