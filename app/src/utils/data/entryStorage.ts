// 表存储设置（库类型 / 读写类型 / 引擎 / 排序列 / 分区）的公共口径。
//
// 数据中心「数据表编辑」抽屉（EntryEditorDrawer）与源上表配置「新建数据表」弹窗（TableEditDialog）
// 共用，两处默认值、切换规则、提交字段必须一致——它们走的是同一个 entrySave → config/entryTypeAddAll。
// 后端口径（1117 设计方案 3.1，186 bee-config.jar 核对）：新建选 CK 只在 ClickHouse 建物理表；
// 编辑时改 dsKind 只改标记、不建表，所以两处编辑态都不允许换库。
import type { EntryType } from '@/api'

export type DsKind = 'MYSQL' | 'CK'

export interface EntryStorageForm {
  dsKind: DsKind
  opType: 'wr' | 'r'
  storageEngine: string
  sorted: string
  partColumn: string
}

/** 两处表单的存储字段形状不完全一样（抽屉用 EntryType，可选字段多），读写都按这个宽松形状 */
export interface StorageLike {
  dsKind?: string
  opType?: string
  storageEngine?: string
  sorted?: string
  partColumn?: string
}

export const CK_ENGINE_OPTIONS = [
  { value: 'ReplacingMergeTree', label: 'ReplacingMergeTree（推荐，按版本去重）' },
  { value: 'MergeTree', label: 'MergeTree（基础明细）' },
  { value: 'SummingMergeTree', label: 'SummingMergeTree（数值汇总）' },
  { value: 'AggregatingMergeTree', label: 'AggregatingMergeTree（物化聚合）' },
  { value: 'VersionedCollapsingMergeTree', label: 'VersionedCollapsingMergeTree（折叠树）' },
] as const

export const MYSQL_ENGINE_OPTIONS = [
  { value: 'InnoDB', label: 'InnoDB（默认）' },
  { value: 'MyISAM', label: 'MyISAM' },
  { value: 'MEMORY', label: 'MEMORY' },
] as const

const CK_ENGINES = new Set<string>(CK_ENGINE_OPTIONS.map((o) => o.value))
const MYSQL_ENGINES = new Set<string>(MYSQL_ENGINE_OPTIONS.map((o) => o.value))

/**
 * 从表记录取存储设置；entry 为空即新建：MYSQL + wr + InnoDB。
 * 编辑老记录：dsKind 未返回归一 MYSQL；opType 未配置时历史 CK 回退 r、其余回退 wr。
 */
export function storageFromEntry(entry?: Partial<EntryType> | null): EntryStorageForm {
  const isCk = entry?.dsKind === 'CK'
  return {
    dsKind: isCk ? 'CK' : 'MYSQL',
    opType: entry ? (entry.opType ?? (isCk ? 'r' : 'wr')) : 'wr',
    storageEngine: entry?.storageEngine ?? (isCk ? 'ReplacingMergeTree' : 'InnoDB'),
    sorted: entry?.sorted ?? (isCk ? 'ENTRY_ID' : ''),
    partColumn: entry?.partColumn ?? '',
  }
}

/** 切换库类型后，把另一种库的引擎换成本库默认值；用户填过的排序列不覆盖 */
export function applyDsKindDefaults(form: StorageLike): void {
  if (form.dsKind === 'CK') {
    if (!CK_ENGINES.has(form.storageEngine ?? '')) form.storageEngine = 'ReplacingMergeTree'
    if (!form.sorted) form.sorted = 'ENTRY_ID'
  } else if (!MYSQL_ENGINES.has(form.storageEngine ?? '')) {
    form.storageEngine = 'InnoDB'
  }
}

/** 提交给 entrySave 的存储字段（含 tableConfig JSON，后端两处都读） */
export function storagePayload(form: StorageLike): Pick<EntryType, 'dsKind' | 'opType' | 'storageEngine' | 'sorted' | 'partColumn' | 'tableConfig'> {
  const isCk = form.dsKind === 'CK'
  const storageEngine = form.storageEngine?.trim() || (isCk ? 'ReplacingMergeTree' : 'InnoDB')
  const sorted = isCk ? (form.sorted?.trim() || 'ENTRY_ID') : form.sorted
  const partColumn = isCk ? (form.partColumn?.trim() || undefined) : undefined
  return {
    dsKind: isCk ? 'CK' : 'MYSQL',
    opType: form.opType === 'r' ? 'r' : 'wr',
    storageEngine,
    sorted,
    partColumn,
    tableConfig: JSON.stringify({ storageEngine, sorted: sorted || '', partColumn: partColumn || '' }),
  }
}

/** 收起态的一行摘要，如「读写 · ReplacingMergeTree · ORDER BY ENTRY_ID」 */
export function storageSummary(form: StorageLike): string {
  const isCk = form.dsKind === 'CK'
  const parts = [form.opType === 'r' ? '只读' : '读写', form.storageEngine || (isCk ? 'ReplacingMergeTree' : 'InnoDB')]
  if (isCk) {
    parts.push(`ORDER BY ${form.sorted?.trim() || 'ENTRY_ID'}`)
    if (form.partColumn?.trim()) parts.push(`PARTITION BY ${form.partColumn.trim()}`)
  }
  return parts.join(' · ')
}
