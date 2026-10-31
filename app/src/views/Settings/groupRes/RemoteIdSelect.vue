<script setup lang="ts">
// 通用「ID 候选」选择器：远程搜索（search）或一次性全量（loadAll + 客户端过滤）。
//
// 为数据权限条件值选择服务（groupRes/CondValueInput 的各 picker 分支共用）：
// - 受控回填：挂载时若已有选中 ID，用 resolveIds 反查名称；反查失败/查不到的 ID
//   不丢——el-select 开 allow-create，未知 ID 以裸值 tag 展示，保存链路不受影响。
// - 降级：search 抛错只清空候选（allow-create 仍可手输 ID），不弹全局错误。
import { computed, onMounted, ref } from 'vue'

export interface CondOption {
  value: string
  label: string
}

const props = defineProps<{
  modelValue: string[]
  multiple?: boolean
  placeholder?: string
  /** 关键字搜索；与 loadAll 二选一 */
  search?: (keyword: string) => Promise<CondOption[]>
  /** 一次性全量加载（候选量小的 picker 用，如站点/用户组），关键字在客户端过滤 */
  loadAll?: () => Promise<CondOption[]>
  /** 已有 ID 反查名称（编辑回显）；缺省时用 search 按 ID 逐个查 */
  resolveIds?: (ids: string[]) => Promise<CondOption[]>
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [values: string[]] }>()

const options = ref<CondOption[]>([])
const allOptions = ref<CondOption[] | null>(null)
const loading = ref(false)

/** 下拉实际候选：全量模式过滤结果 ∪ 已解析选项（保证回填的 label 不丢） */
const visibleOptions = computed(() => {
  const base = allOptions.value ?? options.value
  const known = new Set(base.map((o) => o.value))
  return [...base, ...options.value.filter((o) => !known.has(o.value))]
})

const selectModel = computed({
  get: () => (props.multiple ? props.modelValue : (props.modelValue[0] ?? '')),
  set: (value: string | string[]) => {
    const next = Array.isArray(value) ? value.map(String) : value === '' ? [] : [String(value)]
    emit('update:modelValue', next)
  },
})

async function runSearch(keyword: string) {
  if (props.loadAll) {
    if (!allOptions.value) {
      loading.value = true
      try {
        allOptions.value = await props.loadAll()
      } catch {
        allOptions.value = []
      } finally {
        loading.value = false
      }
    }
    return
  }
  if (!props.search) return
  loading.value = true
  try {
    options.value = await props.search(keyword)
  } catch {
    options.value = []
  } finally {
    loading.value = false
  }
}

/** 全量模式下 el-select 不做远程，关键字在候选里客户端过滤 */
function onFilterChange(keyword: string) {
  if (props.loadAll) {
    if (!allOptions.value) void runSearch('')
    return
  }
  void runSearch(keyword)
}

async function resolveSelected() {
  const ids = props.modelValue.filter(Boolean)
  if (!ids.length) return
  try {
    const resolved = props.resolveIds
      ? await props.resolveIds(ids)
      : props.search
        ? (await Promise.all(ids.map((id) => props.search!(id).catch(() => [] as CondOption[])))).flat()
        : []
    const known = new Set(options.value.map((o) => o.value))
    for (const option of resolved) {
      if (!known.has(option.value)) {
        options.value = [...options.value, option]
        known.add(option.value)
      }
    }
  } catch {
    // 反查失败：裸 ID 以 allow-create tag 展示，不阻断编辑
  }
}

onMounted(async () => {
  if (props.loadAll) await runSearch('')
  await resolveSelected()
})

defineExpose({ refresh: runSearch })
</script>

<template>
  <el-select
    v-model="selectModel"
    class="ris-root"
    :multiple="multiple"
    filterable
    remote
    allow-create
    default-first-option
    :reserve-keyword="false"
    :remote-method="onFilterChange"
    :loading="loading"
    :disabled="disabled"
    :placeholder="placeholder ?? (multiple ? '搜索选择，可多个；可直接输入 ID 回车' : '搜索选择，可直接输入 ID 回车')"
    @focus="props.loadAll && !allOptions ? runSearch('') : undefined"
  >
    <el-option v-for="o in visibleOptions" :key="o.value" :label="o.label" :value="o.value" />
  </el-select>
</template>

<style scoped>
.ris-root { width: 100%; }
</style>
