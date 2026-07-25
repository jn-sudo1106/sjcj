<script setup lang="ts">
// 表配置 Tab（P1-1 Step 4 · 从 NodeInspector.vue 拆出）。
// 内容：输出表管理（采集类固定/可选）+ 非采集类产物明细三元表 + 表结构编辑弹窗。
// 行为与原内联实现 1:1；tables 经 useNodeInspectorAssets 注入（onTableSaved 保存后刷新同一份缓存）。
import { computed, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { collectorCapabilityOf, type NodeConfig, type TripleField } from '@/views/FlowCanvas/canvas/flowModel'
import { entryApi } from '@/api'
import TableEditDialog from '../TableEditDialog.vue'
import { useNodeInspectorAssets } from '../useNodeInspectorAssets'

const flow = useFlowStore()
const { tables } = useNodeInspectorAssets()

const cfg = computed<NodeConfig | undefined>(() => flow.selectedNode)
const id = computed<string>(() => flow.selectedId)
const cc = computed(() => cfg.value?.collectCfg)

const nodeCapability = computed(() => (cfg.value ? collectorCapabilityOf(cfg.value) : undefined))

// 当前节点输出表（统一口径：采集类取 collectCfg.outputTable，非采集类取 cfg.outputTable）
const nodeTableId = computed(() => cc.value?.outputTable || cfg.value?.outputTable || '')
function onOutputTableChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  if (cc.value) flow.patchCollect(id.value, { outputTable: v })
  else flow.setOutputTable(id.value, v)
}

function onTripleCell(field: TripleField, i: number, col: 0 | 1 | 2, e: Event) {
  flow.setTripleCell(id.value, field, i, col, (e.target as HTMLInputElement).value)
}

// ---- 数据表编辑弹窗（T2）----
const tableDlg = reactive<{ open: boolean; tableId: string }>({ open: false, tableId: '' })
function openNewTable() {
  tableDlg.tableId = ''
  tableDlg.open = true
}
function openEditTable() {
  if (!nodeTableId.value) {
    ElMessage.info('请先选择一个输出表，或点「＋」新建')
    return
  }
  tableDlg.tableId = nodeTableId.value
  tableDlg.open = true
}
async function onTableSaved(tableId: string) {
  tables.value = (await entryApi.entryPaged({ size: 100 })).list
  if (id.value) {
    if (cc.value) flow.patchCollect(id.value, { outputTable: tableId })
    else flow.setOutputTable(id.value, tableId)
  }
}
</script>

<template>
  <!-- 表配置：保留输出表管理入口，表结构通过「查看/编辑表」查看维护 -->
  <div class="rc-field"><label>输出表{{ nodeCapability?.outputMode === 'fixed' ? `（固定 · ${nodeCapability.label}，不可更改）` : (cc ? '' : '（本节点处理结果落此表，默认继承上游节点；结果视图可查数据）') }}</label>
    <div class="rc-input-group">
      <select class="rc-select grow" :value="nodeTableId" :disabled="nodeCapability?.outputMode === 'fixed'" @change="onOutputTableChange">
        <option v-if="!cc" value="" disabled>请选择输出表</option>
        <!-- 源步骤回填的表可能不在实体表清单里，补一个当前值选项避免下拉显示为空 -->
        <option v-if="nodeTableId && !tables.some((t) => t.tableId === nodeTableId)" :value="nodeTableId">{{ nodeTableId }}（来自源步骤）</option>
        <option v-for="t in tables" :key="t.tableId" :value="t.tableId">{{ t.tableId }} · {{ t.tableName }}</option>
      </select>
      <button class="rc-input-btn" type="button" @click="openEditTable">查看/编辑表</button>
      <button class="rc-input-btn" type="button" @click="openNewTable">新建表</button>
    </div>
  </div>
  <!-- 非采集类的产物明细表（采集类的产物即上方所选输出表，不重复维护一份 output 三元表） -->
  <template v-if="!cc">
    <table class="rc-mini-table rc-edit-table">
      <thead><tr><th>产物</th><th>类型</th><th>说明</th><th></th></tr></thead>
      <tbody>
        <tr v-for="(row, i) in cfg?.output ?? []" :key="i">
          <td><input class="rc-cell-input" :value="row.name" @input="onTripleCell('output', i, 0, $event)" /></td>
          <td><input class="rc-cell-input" :value="row.type" @input="onTripleCell('output', i, 1, $event)" /></td>
          <td><input class="rc-cell-input" :value="row.desc" @input="onTripleCell('output', i, 2, $event)" /></td>
          <td><button class="rc-row-del" type="button" title="删除该行" @click="flow.removeTripleRow(id, 'output', i)">✕</button></td>
        </tr>
      </tbody>
    </table>
    <button class="rc-btn" type="button" @click="flow.addTripleRow(id, 'output')">+ 添加行</button>
    <div class="rc-help">输出进入实体表/原始文件/规则 Trace/邮件审计，经 run_id 供 Skill Run 追溯。</div>
  </template>

  <TableEditDialog v-model:open="tableDlg.open" :table-id="tableDlg.tableId" @saved="onTableSaved" />
</template>

<style scoped>
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input-group { display: flex; align-items: stretch; width: 100%; }
.rc-input-group .rc-select.grow { border-radius: 7px 0 0 7px; flex: 1; }
.rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-input-btn { white-space: nowrap; padding: 0 12px; border: 1px solid #dbe3ee; border-left: 0; background: #fff; color: var(--rc-primary); cursor: pointer; font-size: 12px; font-weight: 600; }
.rc-input-btn:last-child { border-radius: 0 7px 7px 0; }
.rc-input-btn:hover { background: var(--rc-primary-bg); }
.rc-mini-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.rc-mini-table th { text-align: left; color: var(--rc-muted); font-weight: 600; padding: 6px 5px; border-bottom: 1px solid #eef2f7; }
.rc-mini-table td { padding: 7px 5px; border-bottom: 1px solid var(--rc-border-soft); color: var(--rc-text-2); }
.rc-edit-table th:last-child, .rc-edit-table td:last-child { width: 26px; padding: 4px 2px; }
.rc-cell-input { width: 100%; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--rc-text-2); font-size: 11px; padding: 4px 5px; outline: none; }
.rc-cell-input:hover { border-color: #dbe3ee; }
.rc-cell-input:focus { border-color: #60a5fa; background: #fff; box-shadow: 0 0 0 2px #dbeafe; }
.rc-row-del { width: 20px; height: 20px; border: 0; background: transparent; color: var(--rc-faint); font-size: 12px; cursor: pointer; border-radius: 4px; }
.rc-row-del:hover { background: var(--rc-error-bg); color: #b91c1c; }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 11px; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-btn:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.5; margin-top: 6px; }
</style>
