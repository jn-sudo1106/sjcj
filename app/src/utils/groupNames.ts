// 组 ID → 组名的前端映射。
// 优先使用来自数据库 sys_user_group 表的组名与编码；
// 同时保留前端本地存储（localStorage）作为回退与存量兼容。
// 存储口径照 utils/sqlConditionHistory.ts：try/catch 全包，存储不可用时静默降级。

const KEY = 'groupRes.groupNames.v1'
const NAME_MAX = 50

type NameMap = Record<string, string>

/** 来自 sys_user_group 表的内存缓存 */
const dbGroupMap: Record<string, { name: string; code?: string }> = {}

export function setDbUserGroups(groups: Array<{ id: number | string; name?: string; label?: string; code?: string }>) {
  groups.forEach((g) => {
    const id = String(g.id)
    const name = (g.name || g.label || '').trim()
    if (id && name) {
      dbGroupMap[id] = { name, code: g.code }
    }
  })
}

export function clearDbUserGroups() {
  for (const key of Object.keys(dbGroupMap)) {
    delete dbGroupMap[key]
  }
}

function read(): NameMap {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) || '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const result: NameMap = {}
    for (const [id, name] of Object.entries(raw as NameMap)) {
      if (/^\d+$/.test(id) && typeof name === 'string' && name.trim()) result[id] = name.trim()
    }
    return result
  } catch {
    return {}
  }
}

function write(map: NameMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    // 浏览器禁用存储或容量不足：组名只是展示增强，丢了不阻断配置。
  }
}

/** 全量映射（响应式场景外只读使用；组件里建议各自 ref 一份） */
export function readGroupNames(): NameMap {
  const merged: NameMap = {}
  for (const [id, info] of Object.entries(dbGroupMap)) {
    if (info.name) merged[id] = info.name
  }
  const local = read()
  for (const [id, name] of Object.entries(local)) {
    if (name) merged[id] = name
  }
  return merged
}

/** 单个组的展示名：用户显式修改优先，其次 sys_user_group 表，没录过回空串（调用方自行回退裸 ID） */
export function groupName(groupId: number | string): string {
  const id = String(groupId)
  return read()[id] || dbGroupMap[id]?.name || ''
}

/** 单个组的编码：优先 sys_user_group 表的 group_code */
export function groupCode(groupId: number | string): string {
  const id = String(groupId)
  return dbGroupMap[id]?.code || ''
}

/** 展示文案：有名回「名称（ID）」，无名回裸 ID —— 用户要求 ID 与名称同时显示 */
export function groupLabel(groupId: number | string): string {
  const name = groupName(groupId)
  return name ? `${name}（${groupId}）` : String(groupId)
}

/** 录入 / 更新组名；空名等于删除该组的映射。超长截断到 50 字符 */
export function setGroupName(groupId: number | string, name: string) {
  const id = String(groupId)
  if (!/^\d+$/.test(id)) return
  const map = read()
  const trimmed = name.trim().slice(0, NAME_MAX)
  if (trimmed) {
    map[id] = trimmed
    dbGroupMap[id] = { name: trimmed }
  } else {
    delete map[id]
    delete dbGroupMap[id]
  }
  write(map)
}

/** 清空全部组名映射 */
export function clearGroupNames() {
  clearDbUserGroups()
  try {
    localStorage.removeItem(KEY)
  } catch {
    // 与读写一致：存储不可用时静默。
  }
}
