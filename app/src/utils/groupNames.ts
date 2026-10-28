// 组 ID → 组名 的前端本地映射（localStorage）。
//
// 全后端没有任何组名数据（sys_user / sys_group_res 及各 migration 均无 GROUP_NAME 列，
// /group-res/groups 只回 ID），所以展示名由使用者在页面上自行录入，存本机浏览器。
// 只做展示增强：拿不到名字的组一律回退显示裸 ID，不影响任何提交值与权限逻辑。
// 存储口径照 utils/sqlConditionHistory.ts：try/catch 全包，存储不可用时静默降级。

const KEY = 'groupRes.groupNames.v1'
const NAME_MAX = 50

type NameMap = Record<string, string>

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
  return read()
}

/** 单个组的展示名：有录过回「名称」，没录过回空串（调用方自行回退裸 ID） */
export function groupName(groupId: number | string): string {
  return read()[String(groupId)] ?? ''
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
  if (trimmed) map[id] = trimmed
  else delete map[id]
  write(map)
}

/** 清空全部组名映射 */
export function clearGroupNames() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // 与读写一致：存储不可用时静默。
  }
}
