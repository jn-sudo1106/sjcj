<script setup lang="ts">
// 详情抽屉里的「下游数据」面板（0904）。与上游面板（rv-parent-panel）对称：
// 抽屉里的顺序是 上游 → 本行 → 下游，**视觉顺序就是数据流方向**。
//
// 数据全部来自 `entryDetail` 自己（`subs` + `subsCnt`），**不额外发请求**——
// 子行是完整详情对象，自带 showItems 与 entryTypeId/entryTypeName。旧平台 BaseDetail.vue
// 也是直接渲染它，只是把每条摊成一张「字段ID/编码/注释/列名/值」五列表格全展开。
//
// 这里**刻意不照搬那种展开**，两点原因：
//   ① 会上明确担心过：「如果它太多了，比如说 50 条，那你就攒攒攒的就麻烦了」。
//      6 条 × 24 字段 = 144 行，在 560px 的抽屉里会把本行字段整个挤没。
//      所以默认整块折叠，展开后也只自动展开第一条。
//   ② 那五列里的「字段ID / 字段编码 / 列名」是给运维看元数据的。本平台详情一直是
//      「字段名 + 值」两列，物理列名已经在列头（`标题-K1`）和「列」弹窗里给过了。
import { computed, ref, watch } from 'vue'
import type { EntrySubRow } from '@/api'
import RowDetailFields from './RowDetailFields.vue'
import { fieldsFromShowItems } from './rowDetailFields'

const props = withDefaults(defineProps<{
  subs?: EntrySubRow[]
  /** 子行**总数**；大于 subs.length 说明详情只带回了一部分 */
  subsCnt?: number
  /** 与本行共用同一个「显示空字段」开关，不在这里另设一个 */
  showEmpty?: boolean
  /** 能不能"查看全部"——需要调用方有下钻能力（跳后继节点 + 带父 ID） */
  canViewAll?: boolean
}>(), { subs: () => [], subsCnt: undefined, showEmpty: false, canViewAll: false })

const emit = defineEmits<{ viewAll: [] }>()

const open = ref(false)
/** 展开的子行 id 集合。整块展开时默认只放第一条，避免一次刷屏 */
const expanded = ref<Set<string>>(new Set())

const total = computed(() => props.subsCnt ?? props.subs.length)
/** 详情只带回了一部分——旧平台界面上写的就是「本页展示子数据 3/6 条」 */
const partial = computed(() => total.value > props.subs.length)
/** 子表名：同一批子行都在同一张表，取第一条的即可 */
const tableName = computed(() => props.subs[0]?.tableName || props.subs[0]?.tableId || '')

function toggleOpen() {
  open.value = !open.value
  if (open.value && !expanded.value.size && props.subs[0]) {
    expanded.value = new Set([props.subs[0].row.dataId])
  }
}
function toggleSub(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}
// 换行看详情时收起，别把上一行的展开状态带过来
watch(() => props.subs, () => { open.value = false; expanded.value = new Set() })
</script>

<template>
  <div v-if="subs.length" class="rds" data-testid="data-subs-panel">
    <div class="rds-head">
      <span class="rds-title">
        下级数据<template v-if="tableName"> · {{ tableName }}</template> ·
        <b>{{ partial ? `${subs.length} / ${total}` : total }}</b> 条
      </span>
      <button class="rc-btn ghost" type="button" data-testid="data-subs-toggle" @click="toggleOpen">
        {{ open ? '收起' : '展开' }}
      </button>
    </div>

    <template v-if="open">
      <div v-for="sub in subs" :key="sub.row.dataId" class="rds-item">
        <button class="rds-item-head" type="button" data-testid="data-subs-item" @click="toggleSub(sub.row.dataId)">
          <span class="rds-caret">{{ expanded.has(sub.row.dataId) ? '▾' : '▸' }}</span>
          <span class="rds-item-id">{{ sub.row.dataId }}</span>
        </button>
        <RowDetailFields
          v-if="expanded.has(sub.row.dataId)"
          compact
          :fields="fieldsFromShowItems(sub.showItems)"
          :show-empty="showEmpty"
        />
      </div>

      <!-- 详情只带回一部分时的出口：交给列表层去看全部（Y1 的下钻），
           详情层只负责"顺手看两眼"。正好回应会上"太多了展开麻烦"那个顾虑。 -->
      <div v-if="partial" class="rds-more" data-testid="data-subs-partial">
        详情只带回前 {{ subs.length }} 条，共 {{ total }} 条<template v-if="canViewAll">
          · <button class="rds-link" type="button" data-testid="data-subs-view-all" @click="emit('viewAll')">查看全部 →</button>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rds { margin-top: 12px; padding: 10px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #f8fafc; }
.rds-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.rds-title { color: var(--rc-text-2); font-size: 12px; }
.rds-title b { color: var(--rc-text); }
.rds-item { margin-top: 8px; border-top: 1px solid var(--rc-border-soft); padding-top: 8px; }
.rds-item:first-of-type { border-top: 0; }
.rds-item-head { display: flex; align-items: center; gap: 6px; width: 100%; padding: 2px 0; border: 0; background: transparent; color: var(--rc-text-2); font-size: 12px; text-align: left; cursor: pointer; }
.rds-item-head:hover { color: var(--rc-primary-ink); }
.rds-caret { flex: none; width: 10px; color: var(--rc-faint); }
.rds-item-id { font-family: var(--rc-mono, monospace); }
.rds-more { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--rc-border-soft); color: var(--rc-faint); font-size: 11.5px; }
.rds-link { border: 0; background: transparent; color: var(--rc-primary); font-size: 11.5px; cursor: pointer; padding: 0; }
.rds-link:hover { text-decoration: underline; }
</style>
