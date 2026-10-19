<script setup lang="ts">
// 系统设置 → 数据权限设置（组级数据权限 / sys_group_res 行级规则）。
//
// 规则是**按用户组**配的，组 ID 手工输入（后端暂无用户组列表接口）：查询区留空 = 不带 groupId 参数跨组查，
// 填了就原样交给后端（文档要求 >90000，内置组不走本表映射，由后端拒绝）。新建规则的组 ID 在弹窗里自己填，
// 与查询区的组 ID 互不影响；保存后只按当前筛选条件重查列表。
// resType / action / condType 的枚举与中文名一律从 /group-res/meta 取，不硬编码。
//
// 写操作（新增 / 修改 / 删除）只有 admin 能调（文档：7 个接口全部要求 admin，非 admin 后端回 403），
// UI 按 auth.role 收敛；保存成功后后端清该组缓存，权限立即生效。
//
// 列表与分页样式照「基础配置 → 向量表管理」（带 label 的行内查询表单 + 独立操作区 + 图标操作列），
// 而非本目录其余 tab 的 rc-toolbar 文本按钮口径。
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, Plus, Refresh, Search, View } from '@element-plus/icons-vue'
import {
  deleteGroupRes,
  groupResDetail,
  groupResMeta,
  pagedGroupRes,
  type GroupResMeta,
  type GroupResRule,
} from '@/api/groupRes'
import { useAuthStore } from '@/stores/auth'
import GroupResEditDialog from './GroupResEditDialog.vue'
import GroupResDetailDrawer from './GroupResDetailDrawer.vue'

defineOptions({ name: 'DataPermissionTab' })

const auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin')

// ---- 元数据 ----
const meta = ref<GroupResMeta | null>(null)
async function loadMeta() {
  try {
    meta.value = await groupResMeta()
  } catch (e) {
    ElMessage.error(`加载数据权限配置元数据失败：${e instanceof Error ? e.message : String(e)}`)
  }
}
onMounted(() => {
  void loadMeta()
  // 进页面就出第一页规则（组 ID 为空 = 跨组查），不要求先点查询
  void load()
})

function optionName(list: { key: string; name: string }[] | undefined, key: string): string {
  return list?.find((o) => o.key === key)?.name ?? key
}

// ---- 查询条件（草稿 → 已生效两态：只有点查询、翻页或重置才发列表请求）----
const draft = reactive({ groupId: '', resType: '', action: '' })
const applied = reactive({ groupId: '', resType: '', action: '' })
const rows = ref<GroupResRule[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const DEFAULT_SIZE = 20
const size = ref(DEFAULT_SIZE)
let seq = 0

/** 已生效的组 ID 入参：留空或非数字 = 不带该参数；填了就原样交给后端（>90000 由后端校验） */
const groupIdParam = computed(() => (/^\d+$/.test(applied.groupId) ? Number(applied.groupId) : undefined))

async function load() {
  const id = ++seq
  loading.value = true
  try {
    const res = await pagedGroupRes({
      groupId: groupIdParam.value,
      resType: applied.resType,
      action: applied.action,
      page: page.value,
      limit: size.value,
    })
    if (id === seq) {
      rows.value = res.list
      total.value = res.total
    }
  } catch (e) {
    if (id !== seq) return
    rows.value = []
    total.value = 0
    ElMessage.error(`加载数据权限规则失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    if (id === seq) loading.value = false
  }
}

function runQuery() {
  applied.groupId = draft.groupId.trim()
  applied.resType = draft.resType
  applied.action = draft.action
  page.value = 1
  void load()
}

/** 重置 = 三个条件清空、每页条数回默认 20，然后回第一页重查 */
function onReset() {
  draft.groupId = ''
  draft.resType = ''
  draft.action = ''
  size.value = DEFAULT_SIZE
  runQuery()
}

function onPageChange(p: number) {
  page.value = p
  void load()
}
function onSizeChange(s: number) {
  size.value = s
  page.value = 1
  void load()
}

// ---- 新建 / 编辑 ----
const dialogRef = ref<InstanceType<typeof GroupResEditDialog>>()
function openCreate() {
  // 新建不依赖列表当前查询的组：弹窗里用户组 ID 留空由用户自己填
  dialogRef.value?.open()
}
function openEdit(row: GroupResRule) {
  dialogRef.value?.open(row)
}
/** 保存后按当前筛选条件重查列表（不改动用户组 ID 输入框：新建写到哪个组是弹窗里填的，与查询条件无关） */
function onSaved() {
  page.value = 1
  void load()
}

// ---- 详情（点开先回显行数据，再用 /group-res/detail 的完整记录覆盖）----
const detailVisible = ref(false)
const detailRule = ref<GroupResRule | null>(null)
async function openDetail(row: GroupResRule) {
  detailRule.value = row
  detailVisible.value = true
  try {
    const res = await groupResDetail(row.id)
    if (res) detailRule.value = res
  } catch (e) {
    ElMessage.error(`加载规则详情失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

// ---- 删除（后端软删 isDelete=1，成功后立即生效）----
const deleting = ref(0)
async function remove(row: GroupResRule) {
  if (deleting.value) return
  try {
    await ElMessageBox.confirm(`是否确认删除规则 [ ${row.id} ] - ${optionName(meta.value?.actions, row.action)} ${optionName(meta.value?.resTypes, row.resType)} ?`, '提示', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  deleting.value = row.id
  try {
    const ack = await deleteGroupRes([row.id])
    ElMessage.success(ack?.message ? `删除成功：${ack.message}` : '删除成功，该组权限已立即生效')
  } catch (e) {
    ElMessage.error(`删除失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    deleting.value = 0
    void load()
  }
}
</script>

<template>
  <div class="gr-shell rc-card" v-loading="loading" data-testid="settings-data-permission">
    <!-- 查询区：条件全部带 label 的行内表单，点查询才生效（同向量表管理页口径） -->
    <el-form :inline="true" class="gr-filter-form" size="small" @submit.prevent>
      <el-form-item label="用户组 ID">
        <el-input v-model="draft.groupId" clearable placeholder="用户组 ID" data-testid="group-res-group-id" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="内容类型">
        <el-select v-model="draft.resType" placeholder="全部" data-testid="group-res-filter-type">
          <el-option label="全部" value="" />
          <el-option v-for="t in meta?.resTypes ?? []" :key="t.key" :label="t.name" :value="t.key" />
        </el-select>
      </el-form-item>
      <el-form-item label="行为">
        <el-select v-model="draft.action" placeholder="全部" data-testid="group-res-filter-action">
          <el-option label="全部" value="" />
          <el-option v-for="a in meta?.actions ?? []" :key="a.key" :label="a.name" :value="a.key" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" data-testid="group-res-query" @click="runQuery">查询</el-button>
        <el-button :icon="Refresh" data-testid="group-res-reset" @click="onReset">重置</el-button>
      </el-form-item>
    </el-form>

    <div class="gr-operator">
      <el-button v-if="canWrite" type="primary" :icon="Plus" data-testid="group-res-create" @click="openCreate">新建规则</el-button>
    </div>

    <div class="gr-table">
      <el-table :data="rows" border stripe size="small" :row-key="(r: GroupResRule) => r.id">
        <el-table-column prop="id" label="规则 ID" width="80" align="center" />
        <el-table-column label="行为" width="88" align="center">
          <template #default="{ row }">
            <el-tag :type="row.action === 'ACCEPT' ? 'primary' : 'warning'" size="small">{{ optionName(meta?.actions, row.action) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="内容类型" width="110" align="center" show-overflow-tooltip>
          <template #default="{ row }">{{ optionName(meta?.resTypes, row.resType) }}</template>
        </el-table-column>
        <el-table-column label="条件类型" width="96" align="center" show-overflow-tooltip>
          <template #default="{ row }">{{ optionName(meta?.condTypes, row.condType) }}</template>
        </el-table-column>
        <el-table-column prop="resCond" label="条件内容" min-width="220" align="center" show-overflow-tooltip />
        <el-table-column prop="remarks" label="备注" min-width="140" align="center" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remarks ?? '' }}</template>
        </el-table-column>
        <el-table-column label="操作" :width="canWrite ? 120 : 70" fixed="right" align="center">
          <template #default="{ row }">
            <div class="gr-row-actions">
              <el-tooltip content="详情" placement="top">
                <span class="gr-op-icon" data-testid="group-res-detail" @click="openDetail(row)"><el-icon :size="15"><View /></el-icon></span>
              </el-tooltip>
              <el-tooltip v-if="canWrite" content="编辑" placement="top">
                <span class="gr-op-icon" data-testid="group-res-edit" @click="openEdit(row)"><el-icon :size="15"><Edit /></el-icon></span>
              </el-tooltip>
              <el-tooltip v-if="canWrite" content="删除" placement="top">
                <span
                  class="gr-op-icon gr-op-danger"
                  :class="{ 'gr-op-icon--disabled': deleting === row.id }"
                  data-testid="group-res-delete"
                  @click="remove(row)"
                ><el-icon :size="15"><Delete /></el-icon></span>
              </el-tooltip>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="gr-pager">
      <el-pagination
        :current-page="page"
        :page-size="size"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        small
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>

    <GroupResEditDialog ref="dialogRef" :meta="meta" @saved="onSaved" />
    <GroupResDetailDrawer v-model="detailVisible" :rule="detailRule" :meta="meta" />
  </div>
</template>

<style scoped>
/* 布局对齐「基础配置 → 向量表管理」：查询区 / 操作区 / 表格 / 分页 四段纵向排布 */
.gr-shell {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 10px;
  min-height: 0;
  padding: 12px;
}
.gr-filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 8px;
}
.gr-filter-form :deep(.el-input),
.gr-filter-form :deep(.el-select) {
  width: 160px;
}
.gr-operator {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* 唯一的滚动容器：表格自己滚，查询区与分页始终可见（同系统设置其他 tab 口径） */
.gr-table {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.gr-row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.gr-op-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}
.gr-op-icon:hover {
  background: var(--rc-primary-bg, #eff6ff);
  color: var(--rc-primary, #2563eb);
}
.gr-op-icon--disabled {
  color: var(--rc-muted, #94a3b8);
  pointer-events: none;
}
/* 删除保持危险色（同控件强调约定） */
.gr-op-icon.gr-op-danger {
  color: var(--rc-danger, #dc2626);
}
.gr-op-icon.gr-op-danger:hover {
  background: var(--rc-danger-bg, #fef2f2);
  color: var(--rc-danger, #dc2626);
}
.gr-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
