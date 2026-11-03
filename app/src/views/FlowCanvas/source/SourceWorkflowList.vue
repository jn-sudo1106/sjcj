<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { workflowBindingApi, type FlowRecord, type WorkflowBinding, type WorkflowBindingRole } from '@/api'
import { pickFlowTemplate } from '@/utils/flow/createFromTemplate'
import CanvasHeader from '../shared/CanvasHeader.vue'
import ReplaceFlowDialog from '../shared/ReplaceFlowDialog.vue'

const props = defineProps<{ sourceId: string }>()
const route = useRoute()
const router = useRouter()
const loading = ref(false)
const rows = ref<WorkflowBinding[]>([])
const bindOpen = ref(false)
// 入组的源只走来源组的流程（1021-02）：只列组流程、只读，不给关联 / 新增；要单独配置先退出来源组。
// 组还没绑流程时 rows 是空的，所以组 ID 单独记（workflowBindingApi.load 带回）
const groupId = ref('')
const inGroup = computed(() => !!groupId.value)
/** 本源自己绑定的行（来源组段里也可能有本源同时绑的） */
const isOwn = (row: WorkflowBinding) => !row.inherited || !!row.own

const roleText: Record<WorkflowBindingRole, string> = {
  MAIN: '主流程',
  BACKFILL: '补数据',
  AUX: '辅助流程',
}

async function load() {
  loading.value = true
  try {
    const loaded = await workflowBindingApi.load(props.sourceId)
    rows.value = loaded.rows
    groupId.value = loaded.sourceGroupId ?? ''
  } catch (error) {
    ElMessage.error(`流程列表加载失败：${(error as Error)?.message ?? String(error)}`)
  } finally {
    loading.value = false
  }
}

async function openFlow(row: WorkflowBinding) {
  await router.replace({
    query: {
      ...route.query,
      view: 'flow',
      flowMode: 'canvas',
      workflowId: row.workflowId,
      flowId: row.draftFlowId ?? row.publishedFlowId ?? row.workflowId,
    },
  })
}

async function bindFlow(flow: FlowRecord) {
  try {
    await workflowBindingApi.bind({ sourceId: props.sourceId, workflowId: flow.id })
    bindOpen.value = false
    ElMessage.success(`已关联流程「${flow.name}」`)
    await load()
  } catch (error) {
    ElMessage.error(`关联失败：${(error as Error)?.message ?? String(error)}`)
  }
}

async function createFlow() {
  try {
    const result = await ElMessageBox.prompt('新流程会自动创建空白入口节点，并关联到当前源。', '新增流程', {
      inputValue: `新流程-${new Date().toISOString().slice(0, 10)}`,
      inputPlaceholder: '流程名称',
      inputValidator: value => value.trim() ? true : '请输入流程名称',
      confirmButtonText: '创建',
      cancelButtonText: '取消',
    })
    const templateId = await pickFlowTemplate()
    const created = await workflowBindingApi.createForSource({
      templateId,
      sourceId: props.sourceId,
      name: result.value.trim(),
      primary: !rows.value.some(isOwn),
    })
    ElMessage.success('流程已创建')
    await router.replace({
      query: {
        ...route.query,
        view: 'flow',
        flowMode: 'canvas',
        workflowId: created.workflowId,
        flowId: created.draftFlowId ?? created.publishedFlowId ?? created.workflowId,
      },
    })
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(`新建流程失败：${(error as Error)?.message ?? String(error)}`)
  }
}

async function setPrimary(row: WorkflowBinding) {
  try {
    await ElMessageBox.confirm(
      `设置「${row.workflowName}」为主流程后，处理机后续会从这条流程启动。`,
      '设置主流程',
      { type: 'warning', confirmButtonText: '设置', cancelButtonText: '取消' },
    )
    await workflowBindingApi.setPrimary(props.sourceId, row.workflowId)
    ElMessage.success('主流程已更新')
    await load()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(`设置失败：${(error as Error)?.message ?? String(error)}`)
  }
}

async function unbind(row: WorkflowBinding) {
  try {
    await ElMessageBox.confirm(`解除当前源与「${row.workflowName}」的关联？流程本身不会删除。`, '解除关联', {
      type: 'warning', confirmButtonText: '解除', cancelButtonText: '取消',
    })
    await workflowBindingApi.unbind(props.sourceId, row.workflowId)
    ElMessage.success('已解除关联')
    await load()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(`解除失败：${(error as Error)?.message ?? String(error)}`)
  }
}

onMounted(load)
</script>

<template>
  <div class="swl-page">
    <CanvasHeader />
    <div class="swl-body">
      <div class="swl-toolbar">
        <div>
          <h2>流程列表</h2>
          <p>一个源可关联多条流程；其中一条是默认（主）流程，正常运行时从它启动。</p>
        </div>
        <div class="swl-actions">
          <template v-if="!inGroup">
            <button class="rc-btn" type="button" @click="bindOpen = true">关联已有</button>
            <button class="rc-btn primary" type="button" @click="createFlow"><el-icon><Plus /></el-icon> 新增流程</button>
          </template>
          <button class="swl-refresh" type="button" title="刷新" aria-label="刷新" @click="load"><el-icon><Refresh /></el-icon></button>
        </div>
      </div>

      <div v-if="inGroup" class="swl-inherit" data-testid="workflow-group-locked">
        当前源已加入来源组 #{{ groupId }}：组内源统一使用来源组的流程，这里只能查看；要改请到来源组里配置，要单独配置请先退出来源组。
      </div>

      <el-table v-loading="loading" :data="rows" :empty-text="inGroup ? '来源组还没有配置流程' : '当前源尚未关联流程'" class="swl-table">
        <el-table-column label="流程" min-width="260">
          <template #default="{ row }">
            <button class="swl-link" type="button" @click="openFlow(row)">{{ row.workflowName }}</button>
            <span class="swl-id">#{{ row.workflowId }}</span>
            <div v-if="row.description" class="swl-desc">{{ row.description }}</div>
          </template>
        </el-table-column>
        <el-table-column label="用途" width="110">
          <template #default="{ row }"><span class="swl-role-tag">{{ roleText[row.role as WorkflowBindingRole] }}</span></template>
        </el-table-column>
        <el-table-column label="来源" width="130">
          <template #default="{ row }"><span :class="{ inherited: row.inherited }">{{ row.inherited ? (row.own ? '来源组 + 当前源' : '来源组') : '当前源' }}</span><span v-if="row.groupDefault" class="swl-group-default">组默认</span></template>
        </el-table-column>
        <el-table-column label="运行入口" width="100" align="center">
          <template #default="{ row }"><span v-if="row.primary" class="swl-primary">主流程</span><span v-else>—</span></template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <button class="swl-op" type="button" @click="openFlow(row)">打开</button>
            <button v-if="isOwn(row) && !row.primary" class="swl-op" type="button" @click="setPrimary(row)">设为主流程</button>
            <button v-if="isOwn(row) && !row.primary" class="swl-op danger" type="button" @click="unbind(row)">解除</button>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <ReplaceFlowDialog v-if="bindOpen" v-model="bindOpen" purpose="bind" @pick="bindFlow" />
  </div>
</template>

<style scoped>
.swl-page { height: 100%; overflow: auto; background: #f6f8fb; }
.swl-body { margin: 14px; padding: 16px; border: 1px solid var(--rc-border-soft); border-radius: 10px; background: #fff; }
.swl-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.swl-toolbar h2 { margin: 0; color: var(--rc-text); font-size: 17px; }
.swl-toolbar p { margin: 5px 0 0; color: var(--rc-muted); font-size: 12px; }
.swl-actions { display: flex; align-items: center; gap: 7px; }
.swl-refresh { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-muted); cursor: pointer; }
.swl-inherit { margin-bottom: 12px; padding: 8px 10px; border: 1px solid #bfdbfe; border-radius: 7px; background: #eff6ff; color: #1e40af; font-size: 12px; }
.swl-link, .swl-op { padding: 0; border: 0; background: transparent; color: var(--rc-primary); cursor: pointer; }
.swl-link { font-weight: 650; }
.swl-id { margin-left: 7px; padding: 1px 5px; border-radius: 4px; background: var(--rc-primary-bg); color: var(--rc-primary-ink); font: 600 10px/16px ui-monospace, monospace; }
.swl-desc { max-width: 480px; margin-top: 4px; overflow: hidden; color: var(--rc-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.swl-role-tag, .swl-primary { padding: 2px 7px; border-radius: 10px; background: #f1f5f9; color: var(--rc-text-2); font-size: 11px; }
.swl-primary { background: #dcfce7; color: #166534; }
.inherited { color: #7c3aed; }
.swl-group-default { margin-left: 5px; padding: 1px 5px; border-radius: 4px; background: #ede9fe; color: #6d28d9; font-size: 10px; }
.swl-op { margin-right: 12px; font-size: 12px; }
.swl-op.danger { color: #b91c1c; }
.rc-btn { display: inline-flex; align-items: center; gap: 4px; }
@media (max-width: 980px) { .swl-toolbar { align-items: flex-start; flex-direction: column; } .swl-actions { flex-wrap: wrap; } }
</style>
