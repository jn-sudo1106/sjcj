<script setup lang="ts">
// 系统设置 → 数据权限设置（组级数据权限 / sys_group_res 行级规则）。
//
// 排版布局：
// 左侧：分页展示用户组（来自 sys-user 的 distinct GROUP_ID，组名取成员 user_name）。
// 右侧：可见范围 / 排除范围 / 全部规则明细 三 tab。前两个共用一套内嵌的「双栏范围编辑器」
//       （左目录树、右该目录的源，无弹窗），落库交给 groupSourceScope 服务一次保存整范围。
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Delete,
  Edit,
  Plus,
  Refresh,
  Search,
  View,
} from '@element-plus/icons-vue'
import {
  deleteGroupRes,
  groupResDetail,
  groupResMeta,
  listGroupIds,
  pagedGroupRes,
  type GroupResMeta,
  type GroupResRule,
} from '@/api/groupRes'
import { getGroupSourceScope, saveGroupSourceScope, type GroupSourceScope, type SourceGrant } from '@/api/groupSourceScope'
import { useAuthStore } from '@/stores/auth'
import { groupName, readGroupNames, setGroupName } from '@/utils/groupNames'
import GroupResEditDialog from './GroupResEditDialog.vue'
import GroupResDetailDrawer from './GroupResDetailDrawer.vue'
import SourceScopeEditor from './groupRes/SourceScopeEditor.vue'

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

function optionName(list: { key: string; name: string }[] | undefined, key: string): string {
  return list?.find((o) => o.key === key)?.name ?? key
}

// --------------------------------------------------------------------------
// 左侧：用户组列表与分页
// --------------------------------------------------------------------------
export interface GroupRow {
  groupId: number
  name: string
}

const allGroupIds = ref<number[]>([])
const groupSearchKey = ref('')
const currentGroupId = ref<number | null>(null)
const groupPage = ref(1)
const groupPageSize = ref(20)
const groupLoading = ref(false)
const scopeDirty = ref(false)

const groupList = computed<GroupRow[]>(() => {
  const localNames = readGroupNames()
  const keyword = groupSearchKey.value.trim().toLowerCase()
  return allGroupIds.value
    .map((id) => {
      const name = localNames[String(id)] || groupName(id) || `用户组 ${id}`
      return { groupId: id, name }
    })
    .filter((g) => {
      if (!keyword) return true
      return String(g.groupId).includes(keyword) || g.name.toLowerCase().includes(keyword)
    })
})

const totalGroupCount = computed(() => groupList.value.length)
const totalGroupPages = computed(() => Math.max(1, Math.ceil(totalGroupCount.value / groupPageSize.value)))

const groupPageRangeText = computed(() => {
  const total = totalGroupCount.value
  if (!total) return '第 0 条，总计 0 条'
  const start = (groupPage.value - 1) * groupPageSize.value + 1
  const end = Math.min(start + groupPageSize.value - 1, total)
  return `第 ${start}-${end} 条，总计 ${total} 条`
})

const pagedGroups = computed<GroupRow[]>(() => {
  const start = (groupPage.value - 1) * groupPageSize.value
  return groupList.value.slice(start, start + groupPageSize.value)
})

const currentGroup = computed(() => {
  if (!currentGroupId.value) return null
  return groupList.value.find((g) => g.groupId === currentGroupId.value) ?? {
    groupId: currentGroupId.value,
    name: groupName(currentGroupId.value) || `用户组 ${currentGroupId.value}`,
  }
})

// 左侧用户组：调用 /api/v1/group-res/groups 接口，获取可配置的组 ID 列表（>90000 且存在于 sys_user 或 sys_group_res）。
// 组展示名由前端本地映射（readGroupNames / groupName）或回退默认「用户组 {id}」。
async function fetchGroups() {
  groupLoading.value = true
  try {
    const ids = await listGroupIds()
    allGroupIds.value = ids || []
    if (!currentGroupId.value && allGroupIds.value.length > 0) {
      currentGroupId.value = allGroupIds.value[0]!
    }
  } catch (e) {
    ElMessage.error(`加载用户组列表失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    groupLoading.value = false
  }
}

async function onSelectGroup(row: GroupRow | null) {
  if (!row) return
  if (row.groupId === currentGroupId.value) return
  if (scopeDirty.value) {
    try {
      await ElMessageBox.confirm(
        '当前用户组有未保存的权限配置修改，切换将丢失这些更改。是否继续切换？',
        '未保存提醒',
        {
          confirmButtonText: '放弃修改并切换',
          cancelButtonText: '留在此页',
          type: 'warning',
        },
      )
    } catch {
      return
    }
  }
  scopeDirty.value = false
  currentGroupId.value = row.groupId
  runQuery()
  void loadScope(row.groupId)
}

function prevGroupPage() {
  if (groupPage.value > 1) groupPage.value--
}

function nextGroupPage() {
  if (groupPage.value < totalGroupPages.value) groupPage.value++
}

async function promptRenameGroup(row: GroupRow) {
  try {
    const { value } = await ElMessageBox.prompt('请输入用户组名称', `重命名用户组 #${row.groupId}`, {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputValue: row.name,
      inputPattern: /^.{1,50}$/,
      inputErrorMessage: '名称长度为 1-50 字符',
    })
    if (value && value.trim()) {
      setGroupName(row.groupId, value.trim())
      allGroupIds.value = [...allGroupIds.value]
      ElMessage.success('用户组名称修改成功')
    }
  } catch {
    // 取消
  }
}

async function promptAddGroup() {
  try {
    const { value } = await ElMessageBox.prompt('请输入用户组 ID（必须大于 90000）', '添加用户组', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputPattern: /^[1-9]\d{4,}$/,
      inputErrorMessage: '请输入大于 90000 的数字 ID',
    })
    const id = Number(value.trim())
    if (id <= 90000) {
      ElMessage.warning('用户组 ID 必须大于 90000')
      return
    }
    if (!allGroupIds.value.includes(id)) {
      allGroupIds.value = [...allGroupIds.value, id].sort((a, b) => a - b)
    }
    await onSelectGroup({ groupId: id, name: groupName(id) || `用户组 ${id}` })
    ElMessage.success(`用户组 #${id} 已加入列表`)
  } catch {
    // 取消
  }
}

// --------------------------------------------------------------------------
// 右侧：源数据权限（可见/排除范围，内嵌双栏编辑器；落库走 groupSourceScope 一次保存）
// --------------------------------------------------------------------------
const activeRightTab = ref<'accept' | 'reject' | 'ruleList'>('accept')
const emptyGrant = (): SourceGrant => ({ dirIds: [], sourceIds: [] })
const scope = ref<GroupSourceScope>({ accept: emptyGrant(), reject: emptyGrant() })
const scopeLoading = ref(false)
const savingPermissions = ref(false)

// 编辑器只在 accept|reject 下用；ruleList tab 不渲染编辑器。
const currentKind = computed<'accept' | 'reject'>(() => (activeRightTab.value === 'reject' ? 'reject' : 'accept'))
const currentGrant = computed<SourceGrant>(() => (currentKind.value === 'accept' ? scope.value.accept : scope.value.reject))

async function loadScope(groupId: number | null) {
  if (!groupId) {
    scope.value = { accept: emptyGrant(), reject: emptyGrant() }
    scopeDirty.value = false
    return
  }
  scopeLoading.value = true
  try {
    scope.value = await getGroupSourceScope(groupId)
    scopeDirty.value = false
  } catch (e) {
    ElMessage.error(`加载源数据权限失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    scopeLoading.value = false
  }
}

function onUpdateScopeGrant(kind: 'accept' | 'reject', grant: SourceGrant) {
  scope.value = { ...scope.value, [kind]: grant }
  scopeDirty.value = true
}

async function onSaveScope() {
  if (!currentGroupId.value) {
    ElMessage.warning('请先在左侧选择一个用户组')
    return
  }
  const a = scope.value.accept
  const r = scope.value.reject

  // P1-1: 冲突预检（可见与排除是否有重叠的目录或源）
  const rDirSet = new Set(r.dirIds)
  const rSrcSet = new Set(r.sourceIds)
  const overlapDirs = a.dirIds.filter((d) => rDirSet.has(d))
  const overlapSrcs = a.sourceIds.filter((s) => rSrcSet.has(s))
  const hasConflict = overlapDirs.length > 0 || overlapSrcs.length > 0

  const conflictWarnings: string[] = []
  if (overlapDirs.length > 0) {
    conflictWarnings.push(`⚠️ 目录冲突：目录 [${overlapDirs.join(', ')}] 同时存在于可见与排除范围中（排除规则将优先覆盖）。`)
  }
  if (overlapSrcs.length > 0) {
    conflictWarnings.push(`⚠️ 单源冲突：数据源 [${overlapSrcs.join(', ')}] 同时存在于可见与排除范围中（排除规则将优先覆盖）。`)
  }

  // P1-2: 空可见范围的高危确认
  const isEmptyAccept = a.dirIds.length === 0 && a.sourceIds.length === 0
  const emptyWarning = isEmptyAccept
    ? '⚠️ 警告：当前未配置任何可见范围，保存后该组所有用户将无法查看任何数据源！\n\n'
    : ''

  let confirmMessage = emptyWarning +
    `可见：整目录 ${a.dirIds.length} 个 · 单源 ${a.sourceIds.length} 个\n` +
    `排除：整目录 ${r.dirIds.length} 个 · 单源 ${r.sourceIds.length} 个`
  if (conflictWarnings.length > 0) {
    confirmMessage += `\n\n` + conflictWarnings.join('\n')
  }

  const dialogType = (isEmptyAccept || hasConflict) ? 'warning' : 'info'

  try {
    await ElMessageBox.confirm(confirmMessage, '确认保存数据权限', {
      confirmButtonText: '确认保存',
      cancelButtonText: '返回修改',
      type: dialogType,
    })
  } catch {
    return
  }
  savingPermissions.value = true
  try {
    const saved = await saveGroupSourceScope(currentGroupId.value, scope.value)
    scopeDirty.value = false
    // 展开后的目录数只有后端知道（STRUCT 里存的是自身+全部后代），回报给用户免得以为只生效了一个目录
    const seg = (key: 'accept' | 'reject') => {
      const s = saved?.[key]
      return s ? `整目录 ${s.dirIds} 个（展开 ${s.expandedCategoryIds} 个目录）· 单源 ${s.sourceIds} 个` : '未改动'
    }
    ElMessage.success(`保存成功，用户组 #${currentGroupId.value} 源权限已生效：可见 ${seg('accept')}；排除 ${seg('reject')}`)
    await loadScope(currentGroupId.value)
    void load()
  } catch (e) {
    ElMessage.error(`保存失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    savingPermissions.value = false
  }
}

// --------------------------------------------------------------------------
// 规则列表明细（原有的明细管理与弹窗）
// --------------------------------------------------------------------------
const draft = reactive({ resType: '', action: '' })
const applied = reactive({ resType: '', action: '' })
const rows = ref<GroupResRule[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const DEFAULT_SIZE = 20
const size = ref(DEFAULT_SIZE)
let seq = 0

// 明细查询由左侧选中组驱动（联动）：不再独立输入组 ID，切换左侧用户组即重查该组规则。
async function load() {
  const id = ++seq
  loading.value = true
  try {
    const res = await pagedGroupRes({
      groupId: currentGroupId.value ?? undefined,
      resType: applied.resType,
      action: applied.action,
      page: page.value,
      limit: size.value,
    })
    if (id === seq) {
      rows.value = res.list
      total.value = res.total
      res.list.forEach((r) => {
        if (r.groupId > 90000 && !allGroupIds.value.includes(r.groupId)) {
          allGroupIds.value = [...allGroupIds.value, r.groupId].sort((a, b) => a - b)
        }
      })
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
  applied.resType = draft.resType
  applied.action = draft.action
  page.value = 1
  void load()
}

function onReset() {
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

// 新建 / 编辑弹窗
const dialogRef = ref<InstanceType<typeof GroupResEditDialog>>()
function openCreate() {
  dialogRef.value?.open()
}
function openEdit(row: GroupResRule) {
  dialogRef.value?.open(row)
}
function onSaved() {
  page.value = 1
  void load()
  if (currentGroupId.value) {
    void loadScope(currentGroupId.value)
  }
}

// 详情
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

// 删除
const deleting = ref(0)
async function remove(row: GroupResRule) {
  if (deleting.value) return
  try {
    await ElMessageBox.confirm(
      `是否确认删除规则 [ ${row.id} ] - ${optionName(meta.value?.actions, row.action)} ${optionName(meta.value?.resTypes, row.resType)} ?`,
      '提示',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
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
    if (currentGroupId.value) {
      void loadScope(currentGroupId.value)
    }
  }
}

onMounted(async () => {
  void loadMeta()
  await fetchGroups()
  runQuery()
  if (currentGroupId.value) {
    void loadScope(currentGroupId.value)
  }
})
</script>

<template>
  <div class="dp-shell" data-testid="settings-data-permission">
    <!-- 左右分栏容器 -->
    <div class="dp-split-layout">
      <!-- 左侧：用户组分页列表 -->
      <div class="dp-card dp-left-card">
        <div class="dp-card-header">
          <div class="dp-card-title">
            <span>用户组</span>
            <!-- <el-tooltip content="添加用户组" placement="top">
              <el-button link type="primary" :icon="Plus" class="dp-add-group-btn" @click="promptAddGroup" />
            </el-tooltip> -->
          </div>
          <div class="dp-card-search">
            <el-input
              v-model="groupSearchKey"
              clearable
              size="small"
              placeholder="请输入编码或名称..."
              :prefix-icon="Search"
              class="dp-group-search-input"
            />
          </div>
        </div>

        <div class="dp-left-table-wrap" v-loading="groupLoading">
          <el-table
            :data="pagedGroups"
            size="small"
            highlight-current-row
            :current-row-key="currentGroupId ?? undefined"
            row-key="groupId"
            class="dp-group-table"
            @row-click="onSelectGroup"
          >
            <el-table-column prop="name" label="用户组名称" min-width="120" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="dp-group-name-cell" :class="{ active: currentGroupId === row.groupId }">
                  <span class="dp-group-name-text">{{ row.name }}</span>
                  <el-tooltip content="重命名组" placement="top" :show-after="300">
                    <el-icon class="dp-rename-icon" @click.stop="promptRenameGroup(row)"><Edit /></el-icon>
                  </el-tooltip>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="groupId" label="用户组编码" width="100" align="center">
              <template #default="{ row }">
                <span class="dp-group-code-tag">{{ row.groupId }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- 左侧底部分页 -->
        <div class="dp-left-pager-custom">
          <span class="dp-pager-range">{{ groupPageRangeText }}</span>
          <div class="dp-pager-nav">
            <button
              type="button"
              class="dp-nav-btn"
              :disabled="groupPage <= 1"
              aria-label="上一页"
              @click="prevGroupPage"
            >
              <el-icon :size="12"><ArrowLeft /></el-icon>
            </button>
            <span class="dp-nav-current">{{ groupPage }}</span>
            <button
              type="button"
              class="dp-nav-btn"
              :disabled="groupPage >= totalGroupPages"
              aria-label="下一页"
              @click="nextGroupPage"
            >
              <el-icon :size="12"><ArrowRight /></el-icon>
            </button>
          </div>
          <div class="dp-pager-size-select">
            <select v-model="groupPageSize" class="dp-size-native-select" aria-label="每页条数">
              <option :value="10">10 条/页</option>
              <option :value="20">20 条/页</option>
              <option :value="50">50 条/页</option>
            </select>
          </div>
        </div>
      </div>

      <!-- 右侧：可见/排除/明细 三 tab -->
      <div class="dp-card dp-right-card">
        <div class="dp-tabs-nav">
          <button type="button" class="dp-tab-btn" :class="{ active: activeRightTab === 'accept' }" @click="activeRightTab = 'accept'">
            可见范围
          </button>
          <button type="button" class="dp-tab-btn" :class="{ active: activeRightTab === 'reject' }" @click="activeRightTab = 'reject'">
            排除范围
          </button>
          <button type="button" class="dp-tab-btn" :class="{ active: activeRightTab === 'ruleList' }" @click="activeRightTab = 'ruleList'">
            全部规则明细
          </button>
        </div>

        <!-- Tab 1/2：范围面板（共用一套） -->
        <div v-if="activeRightTab !== 'ruleList'" class="dp-scope-pane" v-loading="scopeLoading">
          <div class="dp-scope-topbar">
            <span v-if="currentGroup" class="dp-current-group-badge">
              当前用户组：<strong>{{ currentGroup.name }}</strong> (ID: {{ currentGroup.groupId }})
            </span>
            <span class="dp-scope-sum" data-testid="group-res-scope-sum">
              {{ currentKind === 'accept' ? '可见' : '排除' }}已选：整目录 {{ currentGrant.dirIds.length }} · 单源 {{ currentGrant.sourceIds.length }}
              <span v-if="scopeDirty" class="dp-scope-dirty-badge">（未保存）</span>
            </span>
            <div class="dp-scope-actions">
              <el-button v-if="canWrite" size="small" :icon="Refresh" @click="loadScope(currentGroupId)">重置</el-button>
              <el-button
                v-if="canWrite"
                type="primary"
                size="small"
                :icon="Check"
                :loading="savingPermissions"
                data-testid="group-res-save"
                @click="onSaveScope"
              >
                保存权限
              </el-button>
            </div>
          </div>
          <SourceScopeEditor
            class="dp-scope-editor"
            :grant="currentKind === 'accept' ? scope.accept : scope.reject"
            :kind="currentKind"
            :disabled="!canWrite"
            data-testid="group-res-scope-editor"
            @update:grant="(g: SourceGrant) => onUpdateScopeGrant(currentKind, g)"
          />
        </div>

        <!-- Tab 3：原有规则明细表格 -->
        <div v-show="activeRightTab === 'ruleList'" class="dp-rule-list-pane" v-loading="loading">
          <el-form :inline="true" class="dp-filter-form" size="small" @submit.prevent>
            <el-form-item label="用户组">
              <span class="dp-cur-group" data-testid="group-res-current-group">
                {{ currentGroup ? `${currentGroup.name} (${currentGroup.groupId})` : '未选择' }}
              </span>
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

          <div class="dp-operator">
            <el-button v-if="canWrite" type="primary" :icon="Plus" data-testid="group-res-create" @click="openCreate">新建规则</el-button>
          </div>

          <div class="dp-table-wrap">
            <el-table :data="rows" border stripe size="small" :row-key="(r: GroupResRule) => r.id">
              <el-table-column prop="id" label="规则 ID" width="80" align="center" />
              <el-table-column label="行为" width="88" align="center">
                <template #default="{ row }">
                  <el-tag :type="row.action === 'ACCEPT' ? 'primary' : 'warning'" size="small">
                    {{ optionName(meta?.actions, row.action) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="内容类型" width="110" align="center" show-overflow-tooltip>
                <template #default="{ row }">{{ optionName(meta?.resTypes, row.resType) }}</template>
              </el-table-column>
              <el-table-column label="条件类型" width="96" align="center" show-overflow-tooltip>
                <template #default="{ row }">{{ optionName(meta?.condTypes, row.condType) }}</template>
              </el-table-column>
              <el-table-column prop="resCond" label="条件内容" min-width="200" align="center" show-overflow-tooltip />
              <el-table-column prop="remarks" label="备注" min-width="120" align="center" show-overflow-tooltip>
                <template #default="{ row }">{{ row.remarks ?? '' }}</template>
              </el-table-column>
              <el-table-column label="操作" :width="canWrite ? 120 : 70" fixed="right" align="center">
                <template #default="{ row }">
                  <div class="dp-row-actions">
                    <el-tooltip content="详情" placement="top">
                      <span class="dp-op-icon" data-testid="group-res-detail" @click="openDetail(row)"><el-icon :size="15"><View /></el-icon></span>
                    </el-tooltip>
                    <el-tooltip v-if="canWrite" content="编辑" placement="top">
                      <span class="dp-op-icon" data-testid="group-res-edit" @click="openEdit(row)"><el-icon :size="15"><Edit /></el-icon></span>
                    </el-tooltip>
                    <el-tooltip v-if="canWrite" content="删除" placement="top">
                      <span
                        class="dp-op-icon dp-op-danger"
                        :class="{ 'dp-op-icon--disabled': deleting === row.id }"
                        data-testid="group-res-delete"
                        @click="remove(row)"
                      ><el-icon :size="15"><Delete /></el-icon></span>
                    </el-tooltip>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <div class="dp-pager">
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
        </div>
      </div>
    </div>

    <!-- 弹窗与抽屉 -->
    <GroupResEditDialog ref="dialogRef" :meta="meta" @saved="onSaved" />
    <GroupResDetailDrawer v-model="detailVisible" :rule="detailRule" :meta="meta" />
  </div>
</template>

<style scoped>
.dp-shell {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
}

.dp-split-layout {
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;
  height: 100%;
}

.dp-card {
  background: #ffffff;
  border-radius: 8px;
  border: 1px solid var(--rc-border, #e2e8f0);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 16px;
}

.dp-left-card {
  width: 380px;
  flex-shrink: 0;
}

.dp-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 8px;
}

.dp-card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
}

.dp-add-group-btn {
  padding: 2px 4px;
}

.dp-card-search {
  flex: 1;
  max-width: 200px;
}

.dp-left-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid #f1f5f9;
  border-radius: 6px;
}

.dp-group-table {
  cursor: pointer;
}

.dp-group-table :deep(.el-table__row) {
  transition: background-color 0.2s;
}

.dp-group-table :deep(.el-table__row.current-row > td.el-table__cell) {
  background-color: #eff6ff !important;
  color: #1d4ed8;
}

.dp-group-name-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dp-group-name-text {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dp-rename-icon {
  font-size: 13px;
  color: #94a3b8;
  opacity: 0;
  cursor: pointer;
  transition: opacity 0.2s, color 0.2s;
}

.dp-group-name-cell:hover .dp-rename-icon {
  opacity: 1;
}

.dp-rename-icon:hover {
  color: var(--rc-primary, #2563eb);
}

.dp-group-code-tag {
  display: inline-block;
  padding: 1px 6px;
  background: #f1f5f9;
  color: #475569;
  border-radius: 4px;
  font-size: 12px;
  font-family: monospace;
}

.dp-left-pager-custom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  font-size: 12px;
  color: #64748b;
  gap: 8px;
}

.dp-pager-range {
  font-size: 12px;
  color: #475569;
  white-space: nowrap;
}

.dp-pager-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dp-nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  border-radius: 4px;
  cursor: pointer;
  color: #64748b;
  transition: all 0.2s;
}

.dp-nav-btn:hover:not(:disabled) {
  border-color: var(--rc-primary, #2563eb);
  color: var(--rc-primary, #2563eb);
}

.dp-nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dp-nav-current {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 4px;
  border: 1px solid var(--rc-primary, #2563eb);
  background: #eff6ff;
  color: var(--rc-primary, #2563eb);
  border-radius: 4px;
  font-weight: 600;
  font-size: 12px;
}

.dp-size-native-select {
  height: 24px;
  padding: 0 4px;
  font-size: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  background: #fff;
  color: #475569;
  outline: none;
  cursor: pointer;
}
.dp-size-native-select:focus {
  border-color: var(--rc-primary, #2563eb);
}

.dp-right-card {
  flex: 1;
  min-width: 0;
}

.dp-tabs-nav {
  display: flex;
  gap: 24px;
  border-bottom: 2px solid #f1f5f9;
  margin-bottom: 12px;
}

.dp-tab-btn {
  background: transparent;
  border: none;
  padding: 6px 4px 10px;
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  position: relative;
  transition: all 0.2s;
}

.dp-tab-btn:hover {
  color: #0f172a;
}

.dp-tab-btn.active {
  color: var(--rc-primary, #2563eb);
  font-weight: 600;
}

.dp-tab-btn.active::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--rc-primary, #2563eb);
  border-radius: 2px;
}

/* 范围面板 tab */
.dp-scope-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.dp-scope-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 12px;
}

.dp-scope-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 内嵌双栏编辑器占满 tab 剩余高度（两栏各自滚动，页面不出现第二层滚动条） */
.dp-scope-editor {
  flex: 1;
  min-height: 360px;
}

.dp-current-group-badge {
  font-size: 12px;
  color: #475569;
  background: #ffffff;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
}

/* 当前 tab 的选择计数（对齐原型顶部摘要） */
.dp-scope-sum {
  font-size: 12px;
  color: #64748b;
}

.dp-scope-dirty-badge {
  color: #ea580c;
  font-weight: 600;
  margin-left: 4px;
}

.dp-current-group-badge strong {
  color: #1e293b;
}

/* 规则列表 Tab */
.dp-rule-list-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 10px;
}

.dp-filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 8px;
}
.dp-filter-form :deep(.el-input),
.dp-filter-form :deep(.el-select) {
  width: 150px;
}
.dp-cur-group {
  display: inline-block;
  min-width: 120px;
  font-weight: 600;
  color: #1e293b;
}
.dp-operator {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dp-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.dp-row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.dp-op-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}
.dp-op-icon:hover {
  background: var(--rc-primary-bg, #eff6ff);
  color: var(--rc-primary, #2563eb);
}
.dp-op-icon--disabled {
  color: var(--rc-muted, #94a3b8);
  pointer-events: none;
}
.dp-op-icon.dp-op-danger {
  color: var(--rc-danger, #dc2626);
}
.dp-op-icon.dp-op-danger:hover {
  background: var(--rc-danger-bg, #fef2f2);
  color: var(--rc-danger, #dc2626);
}
.dp-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
