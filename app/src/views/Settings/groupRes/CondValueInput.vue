<script setup lang="ts">
// 数据权限条件值输入：按后端 meta 的 valueFrom 分发到具体控件（接口文档 §2.2 的控件建议表）。
//
// v-model 统一是 string[]（后端 condJson.values 就是字符串数组）：
// - multiple（op=IN）→ RemoteIdSelect 多选 / 原生多选 tag
// - 单值 → 按字段类型走 bool 下拉、日期选择、数字框、文本框；picker 类 valueFrom 走 RemoteIdSelect 单选
//
// picker 数据源（全部复用现成 API，2026-10-28 Explore 核过签名）：
// - sourcePicker   → sourceApi.sourcePaged（name 搜索 / sourceIds 反查）
// - categoryTree   → sourceDirs.searchDirs('biz', kw)（平铺搜索结果，未做树形——权限条件是 ID 集合，树形交互收益低）
// - sitePicker     → siteApi.sitePaged 全量（后端不支持按 siteIds 反查，一次拉 2000 条客户端过滤）
// - configPicker   → configApi.configPaged（keyword 名称/ID 双路，configId 精确反查）
// - entryTypePicker→ entryApi.searchTables（名称+ID 双路合并去重）
// - userPicker     → pagedSysUser（userName 搜索 / userId 逐个精确反查）
// - groupPicker    → listGroupIds 全量 + 本地组名映射（utils/groupNames，用户自录；旁边铅笔按钮登记名称）
//
// 任何 picker 加载失败都降级为 allow-create 手输 ID（RemoteIdSelect 内建），不阻断规则保存。
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { EditPen } from '@element-plus/icons-vue'
import { configApi, entryApi, siteApi, sourceApi } from '@/api'
import { searchDirs } from '@/api/sourceDirs'
import { listGroupIds, type GroupResField } from '@/api/groupRes'
import { pagedSysUser } from '@/api/sysUser'
import { groupLabel, readGroupNames, setGroupName } from '@/utils/groupNames'
import RemoteIdSelect, { type CondOption } from './RemoteIdSelect.vue'

const props = defineProps<{
  modelValue: string[]
  field: GroupResField
  /** op=IN 时多选；单值操作符 false */
  multiple?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [values: string[]] }>()

/** 单值控件的字符串代理（bool/date/num/text 用；空串 = 未填） */
const single = computed({
  get: () => props.modelValue[0] ?? '',
  set: (value: string) => emit('update:modelValue', value === '' ? [] : [value]),
})

const numProxy = computed({
  get: () => (single.value === '' ? undefined : Number(single.value)),
  set: (value: number | undefined) => single.value = value === undefined || value === null ? '' : String(value),
})

const pickerKind = computed(() => {
  const kind = props.field.valueFrom
  return kind === 'sourcePicker' || kind === 'categoryTree' || kind === 'sitePicker' || kind === 'configPicker'
    || kind === 'entryTypePicker' || kind === 'userPicker' || kind === 'groupPicker'
    ? kind
    : null
})

// ---- 各 picker 的 search / resolveIds ----
// 所有 search 适配器内建 catch → []：数据接口挂掉时静默降级为 allow-create 手输 ID，
// 不弹全局错误、不留未处理 rejection（resolveIds 的兜底在 RemoteIdSelect 里）。

const sourceSearch = (kw: string) =>
  sourceApi.sourcePaged({ name: kw || undefined, page: 1, size: 20 }).then((r) =>
    r.list.map((s): CondOption => ({ value: String(s.sourceId), label: `${s.name}（${s.sourceId}）` }))).catch(() => [] as CondOption[])
const sourceResolve = (ids: string[]) =>
  sourceApi.sourcePaged({ sourceIds: ids.join(','), page: 1, size: ids.length }).then((r) =>
    r.list.map((s): CondOption => ({ value: String(s.sourceId), label: `${s.name}（${s.sourceId}）` })))

const categorySearch = (kw: string) =>
  searchDirs('biz', kw).then((rows) => rows.map((d): CondOption => ({ value: String(d.id), label: `${d.name}（${d.id}）` }))).catch(() => [] as CondOption[])

/** 站点：后端 sitePaged 不认 siteIds 反查，全量拉一次客户端过滤（同 MoreSourcesDialog 的用法） */
let siteAllCache: Promise<CondOption[]> | null = null
function siteAll(): Promise<CondOption[]> {
  siteAllCache ??= siteApi.sitePaged({ page: 1, size: 2000 }).then((r) =>
    r.list.map((s): CondOption => ({ value: String(s.siteId), label: `${s.name}（${s.siteId}）` }))).catch((e: unknown) => {
    siteAllCache = null // 失败不缓存，下次还能重试
    throw e
  })
  return siteAllCache
}
const siteSearch = (kw: string) => siteAll().then((all) => all.filter((o) => o.label.includes(kw))).catch(() => [] as CondOption[])

const configSearch = (kw: string) =>
  configApi.configPaged({ keyword: kw, page: 1, size: 20 }).then((r) =>
    r.list.map((c): CondOption => ({ value: String(c.configId), label: `${c.name}（${c.configId}）` }))).catch(() => [] as CondOption[])
const configResolve = (ids: string[]) =>
  Promise.all(ids.map((id) =>
    configApi.configPaged({ configId: id, page: 1, size: 5 }).then((r) =>
      r.list.find((c) => String(c.configId) === id)).catch(() => undefined))).then((hits) =>
    hits.filter((c) => !!c).map((c): CondOption => ({ value: String(c!.configId), label: `${c!.name}（${c!.configId}）` })))

const entryTypeSearch = (kw: string) =>
  entryApi.searchTables(kw, 20).then((rows) =>
    rows.map((t): CondOption => ({ value: String(t.tableId), label: `${t.name || t.tableName}（${t.tableId}）` }))).catch(() => [] as CondOption[])

const userSearch = (kw: string) =>
  pagedSysUser({ userName: kw || undefined, page: 1, limit: 20 }).then((r) =>
    r.list.map((u): CondOption => ({ value: String(u.userId), label: `${u.userName}（${u.userLoginName}·${u.userId}）` }))).catch(() => [] as CondOption[])
// userPicker 不给 resolveIds：RemoteIdSelect 缺省按 ID 逐个走 search（searchTables 同款双路口径不适用于用户，
// 纯数字关键字会按 userName 搜，搜不到就以裸 ID tag 展示，可接受）

// ---- 用户组：ID 全量 + 本地组名映射（组名全后端无数据，由用户自录） ----

const groupNamesVersion = ref(0)
const groupAll = () => {
  void groupNamesVersion.value
  return listGroupIds().then((ids) => ids.map((id): CondOption => ({ value: String(id), label: groupLabel(id) })))
}
const groupSearch = (kw: string) => groupAll().then((all) => all.filter((o) => o.label.includes(kw) || o.value.includes(kw))).catch(() => [] as CondOption[])

/** 登记组名：选中一个组后点铅笔录入展示名（localStorage，仅本机展示用） */
async function editGroupName() {
  const id = props.modelValue[0]
  if (!id) {
    ElMessage.info('先选择一个用户组，再登记名称')
    return
  }
  try {
    const { value } = await ElMessageBox.prompt('组名只存在本机浏览器，用于展示（后端没有组名数据）', `登记组名 · ${id}`, {
      inputValue: readGroupNames()[id] ?? '',
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValidator: (text: string) => (text.trim().length <= 50 ? true : '名称不能超过 50 字符'),
    })
    setGroupName(id, value)
    groupNamesVersion.value++
  } catch {
    // 取消
  }
}
</script>

<template>
  <div class="cvi-root">
    <!-- picker 类：远程/全量 ID 选择 -->
    <template v-if="pickerKind">
      <RemoteIdSelect
        :model-value="modelValue"
        :multiple="multiple"
        :disabled="disabled"
        :search="
          pickerKind === 'sourcePicker' ? sourceSearch
            : pickerKind === 'categoryTree' ? categorySearch
            : pickerKind === 'sitePicker' ? siteSearch
            : pickerKind === 'configPicker' ? configSearch
            : pickerKind === 'entryTypePicker' ? entryTypeSearch
            : pickerKind === 'userPicker' ? userSearch
            : groupSearch
        "
        :resolve-ids="
          pickerKind === 'sourcePicker' ? sourceResolve
            : pickerKind === 'configPicker' ? configResolve
            : undefined
        "
        @update:model-value="emit('update:modelValue', $event)"
      />
      <el-button
        v-if="pickerKind === 'groupPicker'"
        class="cvi-group-edit"
        :icon="EditPen"
        size="small"
        text
        title="登记组名（本机展示用）"
        data-testid="group-name-edit"
        @click="editGroupName"
      />
    </template>

    <!-- bool：0/1 下拉 -->
    <el-select v-else-if="field.valueFrom === 'bool'" v-model="single" :disabled="disabled" placeholder="请选择">
      <el-option label="是（1）" value="1" />
      <el-option label="否（0）" value="0" />
    </el-select>

    <!-- 原生类型：多选走 tag，单值按 type 分发 -->
    <template v-else>
      <el-select
        v-if="multiple"
        :model-value="modelValue"
        multiple
        filterable
        allow-create
        default-first-option
        :reserve-keyword="false"
        :disabled="disabled"
        placeholder="输入后回车添加，可多个"
        @update:model-value="emit('update:modelValue', ($event as string[]).map(String))"
      />
      <el-date-picker
        v-else-if="field.type === 'date'"
        v-model="single"
        type="datetime"
        value-format="YYYY-MM-DD HH:mm:ss"
        :disabled="disabled"
        placeholder="选择时间"
      />
      <el-input-number
        v-else-if="field.type === 'num'"
        v-model="numProxy"
        :controls="false"
        :disabled="disabled"
        placeholder="数字"
      />
      <el-input v-else v-model="single" :disabled="disabled" placeholder="值" />
    </template>
  </div>
</template>

<style scoped>
.cvi-root { display: flex; align-items: center; gap: 4px; width: 100%; }
.cvi-root > :first-child { flex: 1; min-width: 0; }
.cvi-group-edit { flex-shrink: 0; }
</style>
