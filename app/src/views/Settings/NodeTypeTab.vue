<script setup lang="ts">
// 系统设置 → 节点类型（0924-05）。旧平台「配置 → 源类型」（page/config/SourceTypeList.vue）的迁移：
// 名称模糊查询 + 列表（不分页，后端就不分页）+ 详情（右侧抽屉）+ 新建 / 编辑（居中短表单）。
//
// **没有删除**：旧前端注释说被配置或有效源引用时后端会拒删，但这条无法无损验证——只能拿正在用的类型去试，
// 注释若不属实就等于删掉「网页抓取」这类核心字典。等后端确认（0924 方案 B-3）前，删除去旧平台做。
//
// 写操作仅管理员可见（与 ParamTab / DataQueryTab 同口径）；保存后刷新抓取类型字典，画布节点类型下拉立即生效。
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { configApi, type NodeType, type NodeTypeInput } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useDictStore } from '@/stores/dict'

const auth = useAuthStore()
const dict = useDictStore()
const canWrite = computed(() => auth.role === 'admin')

// ---- 列表 ----
const keyword = ref('')
const list = ref<NodeType[]>([])
const loading = ref(false)
let seq = 0

async function load() {
  const id = ++seq
  loading.value = true
  try {
    const rows = await configApi.nodeTypeList(keyword.value)
    if (id === seq) list.value = rows
  } catch (e) {
    if (id !== seq) return
    list.value = []
    ElMessage.error(`加载节点类型失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    if (id === seq) loading.value = false
  }
}
function onReset() {
  keyword.value = ''
  void load()
}
onMounted(load)

// ---- 详情 ----
const detailVisible = ref(false)
const detail = ref<NodeType | null>(null)
function openDetail(row: NodeType) {
  detail.value = row
  detailVisible.value = true
}
const DETAIL_FIELDS: { key: keyof NodeType; label: string }[] = [
  { key: 'sourceType', label: '类型 ID' },
  { key: 'typeName', label: '类型名称' },
  { key: 'downType', label: '配置队列' },
  { key: 'topic', label: '默认消息队列' },
  { key: 'seq', label: '排序' },
  { key: 'procType', label: '处理类型' },
  { key: 'params', label: '参数' },
  { key: 'notes', label: '备注' },
]

// ---- 新建 / 编辑 ----
const editVisible = ref(false)
const editing = ref<NodeType | null>(null)
const saving = ref(false)
const form = reactive({ sourceType: '', typeName: '', downType: '', topic: '', seq: null as number | null, notes: '' })

function openCreate() {
  editing.value = null
  Object.assign(form, { sourceType: '', typeName: '', downType: 'source-config', topic: '', seq: null, notes: '' })
  editVisible.value = true
}
function openEdit(row: NodeType) {
  editing.value = row
  Object.assign(form, { sourceType: row.sourceType, typeName: row.typeName, downType: row.downType, topic: row.topic, seq: row.seq, notes: row.notes })
  editVisible.value = true
}

/** 修改时只发改动过的字段：后端是增量更新，整份发过去会把没动的空值也写进库 */
function changedFields(before: NodeType): NodeTypeInput {
  const patch: NodeTypeInput = {}
  if (form.typeName.trim() !== before.typeName) patch.typeName = form.typeName.trim()
  if (form.downType.trim() !== before.downType) patch.downType = form.downType.trim()
  if (form.topic.trim() !== before.topic) patch.topic = form.topic.trim()
  if (form.seq !== before.seq) patch.seq = form.seq
  if (form.notes.trim() !== before.notes) patch.notes = form.notes.trim()
  return patch
}

async function save() {
  const typeName = form.typeName.trim()
  if (!typeName) {
    ElMessage.warning('请填写类型名称')
    return
  }
  if (form.sourceType.trim() && !/^\d+$/.test(form.sourceType.trim())) {
    ElMessage.warning('类型 ID 只能是数字，不填由系统自动分配')
    return
  }
  saving.value = true
  try {
    if (editing.value) {
      const patch = changedFields(editing.value)
      if (!Object.keys(patch).length) {
        editVisible.value = false
        return
      }
      const ack = await configApi.nodeTypeUpdate(editing.value.sourceType, patch)
      ElMessage.success(ack?.message || '修改成功')
    } else {
      const ack = await configApi.nodeTypeAdd({
        sourceType: form.sourceType.trim() || undefined,
        typeName,
        downType: form.downType.trim() || undefined,
        topic: form.topic.trim() || undefined,
        seq: form.seq ?? undefined,
        notes: form.notes.trim() || undefined,
      })
      ElMessage.success(ack?.message || '新增成功')
    }
    editVisible.value = false
    void load()
    // 画布里节点类型下拉用的是这份字典
    void dict.loadSnatchTypes()
  } catch (e) {
    ElMessage.error(`保存失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="rc-card nt-main" data-testid="settings-node-type">
    <div class="rc-toolbar wrap">
      <el-input v-model="keyword" clearable placeholder="类型名称" style="width: 220px" data-testid="node-type-keyword" @keyup.enter="load" @clear="load" />
      <button class="rc-btn" type="button" @click="load">查询</button>
      <button class="rc-btn" type="button" @click="onReset">重置</button>
      <span class="nt-spacer" />
      <span class="muted">共 {{ list.length }} 个节点类型</span>
      <button v-if="canWrite" class="rc-btn primary" type="button" data-testid="node-type-create" @click="openCreate">新建</button>
    </div>
    <div class="nt-hint">如需删除节点类型，请在旧平台「配置 → 源类型」操作。</div>

    <div v-loading="loading" class="rc-table-scroll nt-table">
      <table class="rc-data-table">
        <thead>
          <tr>
            <th style="width: 90px">类型 ID</th>
            <th style="width: 160px">类型名称</th>
            <th style="width: 180px">配置队列</th>
            <th style="width: 160px">默认消息队列</th>
            <th style="width: 70px">排序</th>
            <th>备注</th>
            <th style="width: 110px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in list" :key="t.sourceType" data-testid="node-type-row">
            <td>{{ t.sourceType }}</td>
            <td>{{ t.typeName || '—' }}</td>
            <td>{{ t.downType || '—' }}</td>
            <td>{{ t.topic || '—' }}</td>
            <td>{{ t.seq ?? '—' }}</td>
            <td class="nt-ellipsis" :title="t.notes">{{ t.notes || '—' }}</td>
            <td>
              <el-button link type="primary" size="small" @click="openDetail(t)">详情</el-button>
              <el-button v-if="canWrite" link type="primary" size="small" data-testid="node-type-edit" @click="openEdit(t)">编辑</el-button>
            </td>
          </tr>
          <tr v-if="!loading && !list.length">
            <td colspan="7" class="nt-empty">{{ keyword.trim() ? '没有匹配的节点类型' : '暂无节点类型' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 详情：实体详情统一右侧抽屉（AGENTS.md 详情弹层约定） -->
    <el-drawer v-model="detailVisible" :title="detail ? `节点类型 · ${detail.typeName}` : '节点类型'" size="420px">
      <dl v-if="detail" class="nt-detail">
        <template v-for="f in DETAIL_FIELDS" :key="f.key">
          <dt>{{ f.label }}</dt>
          <dd>{{ detail[f.key] === '' || detail[f.key] == null ? '—' : detail[f.key] }}</dd>
        </template>
      </dl>
    </el-drawer>

    <!-- 新建 / 编辑：短表单，居中弹窗 -->
    <el-dialog v-model="editVisible" :title="editing ? '编辑节点类型' : '新建节点类型'" width="460px" append-to-body destroy-on-close>
      <el-form label-width="96px" size="default" @submit.prevent>
        <el-form-item label="类型 ID">
          <el-input v-model="form.sourceType" :disabled="!!editing" :placeholder="editing ? '' : '不填由系统自动分配'" />
        </el-form-item>
        <el-form-item label="类型名称" required>
          <el-input v-model="form.typeName" maxlength="50" placeholder="如：网页抓取" />
        </el-form-item>
        <el-form-item label="配置队列">
          <el-input v-model="form.downType" placeholder="如：source-config" />
        </el-form-item>
        <el-form-item label="默认消息队列">
          <el-input v-model="form.topic" placeholder="可不填" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.seq" :controls="false" style="width: 100%" placeholder="可不填" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.notes" type="textarea" :rows="3" maxlength="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" data-testid="node-type-save" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.nt-main { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.nt-spacer { flex: 1; }
.nt-hint { padding: 0 16px 8px; font-size: 12px; color: var(--rc-muted); }
.nt-table { flex: 1; min-height: 0; overflow: auto; }
.nt-ellipsis { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nt-empty { text-align: center; color: var(--rc-faint); padding: 32px 0; }
.nt-detail { display: grid; grid-template-columns: 96px 1fr; gap: 10px 12px; margin: 0; font-size: 13px; }
.nt-detail dt { color: var(--rc-muted); }
.nt-detail dd { margin: 0; color: var(--rc-text); word-break: break-all; white-space: pre-wrap; }
</style>
