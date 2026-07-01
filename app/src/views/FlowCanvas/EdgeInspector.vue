<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '../../stores/flow'
import { entryApi, itemApi, type EntryType } from '../../api'

const flow = useFlowStore()
const edge = computed(() => flow.selectedEdge!)
const fromId = computed(() => flow.selectedEdgeFrom ?? '')
const newCtx = ref('')

// 步骤输入表 / 步骤输出表在 rows 里的行号（对齐 EDGE_CONFIGS / defaultEdgeConfig 的字段顺序）
const INPUT_TABLE_ROW = 1
const OUTPUT_TABLE_ROW = 4

const tables = ref<EntryType[]>([])
onMounted(async () => {
  tables.value = (await entryApi.entryPaged({ size: 100 })).list
})

function addCtx() {
  const v = newCtx.value.trim()
  if (!v) return
  flow.addEdgeContext(fromId.value, v)
  newCtx.value = ''
}
function onRow(i: number, e: Event) {
  flow.setEdgeRow(fromId.value, i, (e.target as HTMLInputElement).value)
}
function onTableSelect(field: 'inputTableId' | 'outputTableId', e: Event) {
  const tableId = (e.target as HTMLSelectElement).value
  const t = tables.value.find((x) => x.tableId === tableId)
  flow.setEdgeTable(fromId.value, field, tableId, t ? `[${t.tableId}] ${t.tableName}` : '')
}
// 出参列候选字段：优先取步骤输出表，未选输出表则退而取输入表
const outcolFields = computed(() => {
  const tid = edge.value.outputTableId || edge.value.inputTableId
  return tables.value.find((t) => t.tableId === tid)?.fields ?? []
})
function outcolLabel(prop: string) {
  const f = outcolFields.value.find((x) => x.prop === prop)
  return f ? `${f.prop} · ${f.desc}` : prop
}
function addOutcol(e: Event) {
  const sel = e.target as HTMLSelectElement
  if (sel.value) flow.toggleEdgeOutcol(fromId.value, sel.value)
  sel.value = ''
}
async function onEnable(e: Event) {
  const enabled = (e.target as HTMLSelectElement).value === '启用'
  flow.setEdgeEnabled(fromId.value, enabled)
  const res = await itemApi.enable(fromId.value, enabled)
  ElMessage.success(res?.message || (enabled ? '子步骤已启用（演示）' : '子步骤已停用（演示）'))
}
async function save() {
  try {
    await ElMessageBox.confirm('保存将映射子步骤 item/next/stepModify，是否继续？', '修改子步骤', {
      type: 'warning',
      confirmButtonText: '确认执行',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  const res = await itemApi.stepModify(fromId.value)
  ElMessage.success(res?.message || '子步骤已保存（演示）')
}
</script>

<template>
  <div class="rc-inspector">
    <div class="rc-insp-head">
      <div>
        <div class="rc-insp-title">{{ edge.title }}</div>
        <div class="rc-insp-sub">{{ edge.sub }}</div>
      </div>
      <span class="rc-status" :class="edge.enabled ? 'ok' : 'muted'">{{ edge.enabled ? '已启用' : '已停用' }}</span>
    </div>

    <div class="rc-inspector-body">
      <div v-for="(row, i) in edge.rows" :key="row[0]" class="rc-field">
        <label>{{ row[0] }}</label>
        <select
          v-if="i === INPUT_TABLE_ROW || i === OUTPUT_TABLE_ROW"
          class="rc-select"
          :value="(i === INPUT_TABLE_ROW ? edge.inputTableId : edge.outputTableId) ?? ''"
          @change="onTableSelect(i === INPUT_TABLE_ROW ? 'inputTableId' : 'outputTableId', $event)"
        >
          <option value="">未选择（沿用左侧文本：{{ row[1] }}）</option>
          <option v-for="t in tables" :key="t.tableId" :value="t.tableId">{{ t.tableId }} · {{ t.tableName }}</option>
        </select>
        <input v-else class="rc-input" :value="row[1]" @input="onRow(i, $event)" />
      </div>

      <div class="rc-field">
        <label>上下文来源（context map）</label>
        <div class="rc-tagchips">
          <span v-for="(c, i) in edge.context" :key="c" class="rc-tagchip">{{ c }} <i @click="flow.removeEdgeContext(fromId, i)">✕</i></span>
          <span v-if="!edge.context.length" class="rc-empty-hint">未配置上下文映射</span>
        </div>
        <input v-model="newCtx" class="rc-input ctx-add" placeholder="新增映射，如 K1 标题 → title，回车添加" @keyup.enter="addCtx" />
      </div>

      <div class="rc-field"><label>出参列（从步骤输出表字段中选择，未选输出表时取输入表）</label>
        <select class="rc-select" value="" @change="addOutcol">
          <option value="">选择字段</option>
          <option v-for="f in outcolFields" :key="f.prop" :value="f.prop" :disabled="edge.outcols.includes(f.prop)">{{ f.prop }} · {{ f.desc }}</option>
        </select>
        <div v-if="edge.outcols.length" class="rc-tagchips">
          <span v-for="p in edge.outcols" :key="p" class="rc-tagchip">{{ outcolLabel(p) }} <i @click="flow.toggleEdgeOutcol(fromId, p)">✕</i></span>
        </div>
        <span v-else class="rc-empty-hint">{{ outcolFields.length ? '未选择出参列' : '先选择步骤输入/输出表后再选字段' }}</span>
      </div>

      <div class="rc-field"><label>启停</label>
        <select class="rc-select" :value="edge.enabled ? '启用' : '停用'" @change="onEnable">
          <option>启用</option><option>停用</option>
        </select>
      </div>

      <div class="rc-help">连线表示子步骤配置，包含适用源、输入表、使用配置、输出表、URL 来源字段、URL 规则、执行条件、上下文来源和出参列。保存即映射 saveItemConfig / stepModify。</div>
      <div class="rc-actions-row"><button class="rc-btn primary" type="button" @click="save">修改当前步骤</button></div>
    </div>
  </div>
</template>

<style scoped>
.rc-inspector { background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: hidden; height: 100%; display: flex; flex-direction: column; }
.rc-insp-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 42px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.rc-insp-title { font-weight: 700; color: var(--rc-text); font-size: 13px; }
.rc-insp-sub { color: var(--rc-faint); font-size: 10px; margin-top: 1px; }
.rc-inspector-body { padding: 12px; overflow: auto; }
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input, .rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-input:focus, .rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.ctx-add { margin-top: 6px; }
.rc-tagchips { display: flex; flex-wrap: wrap; gap: 5px; }
.rc-tagchip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 3px 7px; border-radius: 6px; border: 1px solid #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-tagchip i { cursor: pointer; font-style: normal; opacity: 0.7; }
.rc-tagchip i:hover { opacity: 1; }
.rc-empty-hint { color: var(--rc-faint); font-size: 11px; }
.rc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.5; margin-top: 6px; }
.rc-actions-row { display: flex; gap: 8px; margin-top: 12px; }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; height: 32px; padding: 0 11px; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-btn:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
</style>
