// 组级「源数据权限」的读写编排 —— 系统设置 → 数据权限设置 的可见/排除范围面板用。
//
// 只负责按规则落库 sys_group_res，不碰后端鉴权核心（AuthContext/InfoSourceController 的过滤逻辑）。
// 后端源列表只认 SOURCE 规则解析出的 sourceIds（见 bee/auth/AuthResEnum.java、InfoSourceController.java），
// 所以这里把「整目录 / 单源」两类选择都落成 resType=SOURCE 的规则：
//   · 整目录（含子级）→ SOURCE / ACCEPT|REJECT / STRUCT，condJson=[{field:CATEGORY_ID, op:IN, values:展开后代}]
//       - values 用 expandCategoryIds 把选中目录展开成「自身+全部后代 CATEGORY_ID」，
//         因为后端 STRUCT 只跑 `SELECT SOURCE_ID from cs_source where CATEGORY_ID IN (values)`，不自动级联子目录。
//       - remarks 存 {roots:[选中目录ID]} 供回显还原成最小目录集（否则回显会把每个后代都当成一个整目录）。
//   · 单源 → SOURCE / ACCEPT|REJECT / ID，resCond=逗号 SOURCE_ID 串。
// 一个组本面板最多维护 4 条规则（可见/排除 × 目录/源）；其它 resType（CONFIG/ENTRY_TYPE/PARAM/CATEGORY）
// 以及 SOURCE/SQL 存量规则不归本面板管，保存时不动它们。
import {
  pagedGroupRes,
  addGroupRes,
  modifyGroupRes,
  deleteGroupRes,
  previewGroupRes,
  stringifyCondJson,
  parseCondJson,
  type GroupResRule,
} from './groupRes'
import { expandCategoryIds } from './index'

export interface SourceGrant {
  /** 用户选中的“整目录”CATEGORY_ID（最小集，未展开） */
  dirIds: string[]
  /** 用户选中的单个源 SOURCE_ID */
  sourceIds: string[]
}

export interface GroupSourceScope {
  accept: SourceGrant
  reject: SourceGrant
}

const emptyGrant = (): SourceGrant => ({ dirIds: [], sourceIds: [] })

const uniq = (arr: string[]): string[] => Array.from(new Set(arr.filter(Boolean)))

/** STRUCT 规则里 CATEGORY_ID IN 的 values（回显兜底用；优先走 remarks.roots） */
function categoryIdsFromCondJson(condJson: string | null | undefined): string[] {
  const hit = parseCondJson(condJson ?? null).find((i) => i.field === 'CATEGORY_ID')
  return hit ? hit.values : []
}

/** 回显“整目录”最小集：优先 remarks.roots，没有（存量/手工规则）再退回 condJson values */
function rootsFromRule(r: GroupResRule): string[] {
  const raw = (r.remarks ?? '').trim()
  if (raw.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { roots?: unknown }).roots)) {
        return uniq((parsed as { roots: unknown[] }).roots.map(String))
      }
    } catch {
      // 落到 condJson 兜底
    }
  }
  return uniq(categoryIdsFromCondJson(r.condJson))
}

/** 读某组的源数据权限，归成 { accept, reject } × { dirIds, sourceIds } */
export async function getGroupSourceScope(groupId: number): Promise<GroupSourceScope> {
  const res = await pagedGroupRes({ groupId, limit: 200 })
  const scope: GroupSourceScope = { accept: emptyGrant(), reject: emptyGrant() }
  res.list
    .filter((r) => r.resType === 'SOURCE' && r.isDelete === 0)
    .forEach((r) => {
      const grant = r.action === 'REJECT' ? scope.reject : scope.accept
      if (r.condType === 'ID') {
        if (r.resCond) grant.sourceIds.push(...r.resCond.split(',').map((s) => s.trim()))
      } else if (r.condType === 'STRUCT') {
        grant.dirIds.push(...rootsFromRule(r))
      }
    })
  scope.accept.dirIds = uniq(scope.accept.dirIds)
  scope.accept.sourceIds = uniq(scope.accept.sourceIds)
  scope.reject.dirIds = uniq(scope.reject.dirIds)
  scope.reject.sourceIds = uniq(scope.reject.sourceIds)
  return scope
}

/** 写一个“整目录”槽（STRUCT）：空则删；非空展开后代 + 试算 + add/modify，多余旧规则删掉 */
async function writeStructSlot(groupId: number, action: 'ACCEPT' | 'REJECT', dirIds: string[], existing: GroupResRule[]): Promise<void> {
  if (!dirIds.length) {
    if (existing.length) await deleteGroupRes(existing.map((r) => r.id))
    return
  }
  const values = await expandCategoryIds(dirIds)
  const condJson = stringifyCondJson([{ field: 'CATEGORY_ID', op: 'IN', values }])
  const preview = await previewGroupRes({ resType: 'SOURCE', condType: 'STRUCT', resCond: '', condJson })
  if (preview.error) throw new Error(`目录条件试算失败：${preview.error}`)
  const remarks = JSON.stringify({ roots: dirIds })
  const payload = { groupId, resType: 'SOURCE', action, condType: 'STRUCT', resCond: '', condJson, remarks }
  if (existing.length) {
    await modifyGroupRes({ ...payload, id: existing[0].id })
    if (existing.length > 1) await deleteGroupRes(existing.slice(1).map((r) => r.id))
  } else {
    await addGroupRes(payload)
  }
}

/** 写一个“单源”槽（ID）：空则删；非空试算 + add/modify，多余旧规则删掉 */
async function writeIdSlot(groupId: number, action: 'ACCEPT' | 'REJECT', sourceIds: string[], existing: GroupResRule[]): Promise<void> {
  if (!sourceIds.length) {
    if (existing.length) await deleteGroupRes(existing.map((r) => r.id))
    return
  }
  const resCond = uniq(sourceIds).join(',')
  const preview = await previewGroupRes({ resType: 'SOURCE', condType: 'ID', resCond })
  if (preview.error) throw new Error(`源条件试算失败：${preview.error}`)
  const payload = { groupId, resType: 'SOURCE', action, condType: 'ID', resCond }
  if (existing.length) {
    await modifyGroupRes({ ...payload, id: existing[0].id })
    if (existing.length > 1) await deleteGroupRes(existing.slice(1).map((r) => r.id))
  } else {
    await addGroupRes(payload)
  }
}

/** 保存某组的源数据权限：只重建 SOURCE 的 ID/STRUCT 四个槽，其它规则原样保留 */
export async function saveGroupSourceScope(groupId: number, scope: GroupSourceScope): Promise<void> {
  const existing = (await pagedGroupRes({ groupId, limit: 200 })).list.filter(
    (r) => r.resType === 'SOURCE' && r.isDelete === 0 && (r.condType === 'ID' || r.condType === 'STRUCT'),
  )
  const slot = (action: string, condType: string) => existing.filter((r) => r.action === action && r.condType === condType)

  await writeStructSlot(groupId, 'ACCEPT', uniq(scope.accept.dirIds), slot('ACCEPT', 'STRUCT'))
  await writeIdSlot(groupId, 'ACCEPT', uniq(scope.accept.sourceIds), slot('ACCEPT', 'ID'))
  await writeStructSlot(groupId, 'REJECT', uniq(scope.reject.dirIds), slot('REJECT', 'STRUCT'))
  await writeIdSlot(groupId, 'REJECT', uniq(scope.reject.sourceIds), slot('REJECT', 'ID'))
}
