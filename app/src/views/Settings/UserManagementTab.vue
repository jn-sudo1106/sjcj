<script setup lang="ts">
// 系统设置 → 用户管理（SYS_USER 账号维护，后端 /api/v1/sys-user，MyBatis-Plus）。
//
// 只维护账号本身：新建（初始口令）、改用户名与所属组、启用/停用、重置口令。
// 角色不在本页维护——admin 是唯一的系统超管，只有他能进这一页；新账号由服务端自动落到只读（read）
// 角色，要给谁 admin 权限，由管理员直接改后台数据库的 SYS_USER_2_ROLE。本页只回显角色。
//
// 状态开关就是「启用/停用」入口，沿用项目的轻量滑动开关 + 旁置状态文字。
// 停用只改状态、不动角色绑定（2026-10-28 改判）；确认框与提示都只讲状态本身。
// 唯一会被后端拒绝的方向：启用一个没有任何角色绑定的账号（空角色一登录就会被
// ShiroDbRealm 兜底成 admin），届时按后端文案透出，先补绑定再启用。
//
// 内置 admin 账号照常出现在列表里，但操作列只渲染「详情」（决策 ③B：不参与本页写操作），
// 状态开关置灰；后端对同一批操作也会再拒一次。
//
// 列表与分页样式照同目录「数据权限设置」（带 label 的行内查询表单 + 独立操作区 + 图标操作列）。
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Edit, Key, Plus, Refresh, Search, View } from '@element-plus/icons-vue'
import {
  changeSysUserStatus,
  pagedSysUser,
  resetSysUserPassword,
  statusText,
  sysUserDetail,
  STATUS_INVALID,
  STATUS_VALID,
  type SysUserRow,
} from '@/api/sysUser'
import { useAuthStore } from '@/stores/auth'
import SysUserEditDialog from './SysUserEditDialog.vue'
import SysUserDetailDrawer from './SysUserDetailDrawer.vue'

defineOptions({ name: 'UserManagementTab' })

const auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin')

onMounted(() => {
  // 进页面就出第一页账号，不要求先点查询
  void load()
})

// ---- 查询条件（草稿 → 已生效两态：只有点查询、翻页或重置才发列表请求） ----
const draft = reactive({ loginName: '', userName: '', groupId: '', userStatus: '' as '' | '0' | '1' })
const applied = reactive({ loginName: '', userName: '', groupId: '', userStatus: '' as '' | '0' | '1' })
const rows = ref<SysUserRow[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const DEFAULT_SIZE = 20
const size = ref(DEFAULT_SIZE)
let seq = 0

/** 组 ID 入参：留空或非数字 = 不带该参数（跨组查） */
const groupIdParam = computed(() => (/^\d+$/.test(applied.groupId.trim()) ? Number(applied.groupId.trim()) : undefined))

async function load() {
  const id = ++seq
  loading.value = true
  try {
    const res = await pagedSysUser({
      loginName: applied.loginName,
      userName: applied.userName,
      groupId: groupIdParam.value,
      // 下拉里存的是字符串（el-option 的 value 好比对），交给 API 前转成后端要的 Bigint
      userStatus: applied.userStatus === '' ? '' : Number(applied.userStatus),
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
    ElMessage.error(`加载用户列表失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    if (id === seq) loading.value = false
  }
}

function runQuery() {
  applied.loginName = draft.loginName.trim()
  applied.userName = draft.userName.trim()
  applied.groupId = draft.groupId.trim()
  applied.userStatus = draft.userStatus
  page.value = 1
  void load()
}

/** 重置 = 四个条件清空、每页条数回默认 20，然后回第一页重查 */
function onReset() {
  draft.loginName = ''
  draft.userName = ''
  draft.groupId = ''
  draft.userStatus = ''
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
const dialogRef = ref<InstanceType<typeof SysUserEditDialog>>()
function openCreate() {
  dialogRef.value?.open()
}
function openEdit(row: SysUserRow) {
  if (lockWrite(row)) return
  dialogRef.value?.open(row)
}
function onSaved() {
  page.value = 1
  void load()
}

// ---- 详情（先回显行数据，再用 /sys-user/detail 的完整记录覆盖） ----
const detailVisible = ref(false)
const detailUser = ref<SysUserRow | null>(null)
async function openDetail(row: SysUserRow) {
  detailUser.value = row
  detailVisible.value = true
  try {
    const res = await sysUserDetail(row.userId)
    if (res) detailUser.value = res
  } catch (e) {
    ElMessage.error(`加载用户详情失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

// ---- 重置口令（口令只进不出：填了就交给后端加密，页面不留任何回显） ----
const pwdSavingId = ref(0)
async function resetPassword(row: SysUserRow) {
  if (lockWrite(row)) return
  let value = ''
  try {
    const result = await ElMessageBox.prompt(
      `为账号 ${row.userLoginName} 设置新口令。服务端按 {p} + md5(登录名 + 口令) 落库，数据库与接口都查不到明文。`,
      '重置密码',
      { confirmButtonText: '重置', cancelButtonText: '取消', inputType: 'password', inputPlaceholder: '新密码' },
    )
    value = String(result.value ?? '')
  } catch {
    return
  }
  if (!value.trim()) {
    ElMessage.warning('新密码不能为空')
    return
  }
  pwdSavingId.value = row.userId
  try {
    const ack = await resetSysUserPassword(row.userId, value)
    ElMessage.success(ack?.message ? `${ack.message}，该账号下次登录即用新密码` : '密码重置成功')
  } catch (e) {
    ElMessage.error(`重置密码失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    pwdSavingId.value = 0
    void load()
  }
}

// ---- 启用 / 停用（开关走 before-change：失败不翻转，成功后重查列表拿准确的状态） ----
const statusSavingId = ref(0)
async function toggleStatus(row: SysUserRow): Promise<boolean> {
  if (lockWrite(row)) return false
  const target = row.userStatus === STATUS_VALID ? STATUS_INVALID : STATUS_VALID
  const disabling = target === STATUS_INVALID
  if (disabling) {
    try {
      await ElMessageBox.confirm(
        `停用后 ${row.userLoginName} 将无法登录；角色绑定保持不变，重新启用即可恢复。仍要停用吗？`,
        '提示',
        { confirmButtonText: '停用', cancelButtonText: '取消', type: 'warning' },
      )
    } catch {
      return false
    }
  }
  statusSavingId.value = row.userId
  try {
    const ack = await changeSysUserStatus(row.userId, target)
    ElMessage.success(ack?.message || (disabling ? '已失效' : '已启用'))
    return true
  } catch (e) {
    ElMessage.error(`状态更新失败：${e instanceof Error ? e.message : String(e)}`)
    return false
  } finally {
    statusSavingId.value = 0
    void load()
  }
}

/** 内置 admin 不提供任何写入口（③B）：点了就给原因，不静默 */
function lockWrite(row: SysUserRow): boolean {
  if (row.protectedAccount) {
    ElMessage.warning(`内置 ${row.userLoginName} 账号不允许在此修改`)
    return true
  }
  return false
}
</script>

<template>
  <div class="su-shell rc-card" v-loading="loading" data-testid="settings-user-management">
    <!-- 查询区：条件全部带 label 的行内表单，点查询才生效（同数据权限设置口径） -->
    <el-form :inline="true" class="su-filter-form" size="small" @submit.prevent>
      <el-form-item label="登录名">
        <el-input v-model="draft.loginName" clearable placeholder="模糊匹配" data-testid="sys-user-filter-login" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="用户名">
        <el-input v-model="draft.userName" clearable placeholder="模糊匹配" data-testid="sys-user-filter-name" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="所属组 ID">
        <el-input v-model="draft.groupId" clearable placeholder="如 100001" data-testid="sys-user-filter-group" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="draft.userStatus" placeholder="全部" data-testid="sys-user-filter-status">
          <el-option label="全部" value="" />
          <el-option :label="statusText(STATUS_VALID)" :value="String(STATUS_VALID)" />
          <el-option :label="statusText(STATUS_INVALID)" :value="String(STATUS_INVALID)" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" data-testid="sys-user-query" @click="runQuery">查询</el-button>
        <el-button :icon="Refresh" data-testid="sys-user-reset" @click="onReset">重置</el-button>
      </el-form-item>
    </el-form>

    <div class="su-operator">
      <el-button v-if="canWrite" type="primary" :icon="Plus" data-testid="sys-user-create" @click="openCreate">新建用户</el-button>
      <!-- <span class="su-operator-hint">账号的增删改只影响登录与角色归属；数据可见范围仍由「数据权限设置」按用户组配置</span> -->
    </div>

    <div class="su-table">
      <el-table :data="rows" border stripe size="small" :row-key="(r: SysUserRow) => r.userId">
        <el-table-column prop="userId" label="用户 ID" width="80" align="center" />
        <el-table-column prop="userLoginName" label="登录名" min-width="130" align="center" show-overflow-tooltip />
        <el-table-column prop="userName" label="用户名" min-width="110" align="center" show-overflow-tooltip />
        <el-table-column label="所属组" width="96" align="center">
          <template #default="{ row }">{{ row.groupId ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="角色" min-width="160" align="center" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.roleNames">{{ row.roleNames }}</span>
            <span v-else class="su-warn">无角色</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="112" align="center">
          <template #default="{ row }">
            <div class="su-status">
              <el-switch
                :model-value="row.userStatus === STATUS_VALID"
                size="small"
                inline-prompt
                active-text="有效"
                inactive-text="失效"
                :disabled="!canWrite || loading || statusSavingId !== 0 || row.protectedAccount"
                :loading="statusSavingId === row.userId"
                :before-change="() => toggleStatus(row)"
                :aria-label="`${row.userLoginName}启用状态`"
                :data-testid="`sys-user-status-${row.userId}`"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="createTime" label="创建时间" width="150" align="center" show-overflow-tooltip>
          <template #default="{ row }">{{ row.createTime || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" :width="canWrite ? 140 : 70" fixed="right" align="center">
          <template #default="{ row }">
            <div class="su-row-actions">
              <el-tooltip content="详情" placement="top">
                <span class="su-op-icon" data-testid="sys-user-detail" @click="openDetail(row)"><el-icon :size="15"><View /></el-icon></span>
              </el-tooltip>
              <!-- 内置 admin 不参与本页任何写操作（③B）：整行只留「详情」一个图标。
                   置灰展示编辑/重置密码会多占两个槽位，把这行挤得跟其他行不对齐，且点了也只得到一句拒绝。 -->
              <template v-if="canWrite && !row.protectedAccount">
                <el-tooltip content="编辑" placement="top">
                  <span class="su-op-icon" data-testid="sys-user-edit" @click="openEdit(row)"><el-icon :size="15"><Edit /></el-icon></span>
                </el-tooltip>
                <el-tooltip content="重置密码" placement="top">
                  <span class="su-op-icon" data-testid="sys-user-password" @click="resetPassword(row)"><el-icon :size="15"><Key /></el-icon></span>
                </el-tooltip>
              </template>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="su-pager">
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

    <SysUserEditDialog ref="dialogRef" @saved="onSaved" />
    <SysUserDetailDrawer v-model="detailVisible" :user="detailUser" />
  </div>
</template>

<style scoped>
/* 布局对齐同目录「数据权限设置」：查询区 / 操作区 / 表格 / 分页 四段纵向排布 */
.su-shell {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 10px;
  min-height: 0;
  padding: 12px;
}
.su-filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 8px;
}
.su-filter-form :deep(.el-input),
.su-filter-form :deep(.el-select) {
  width: 150px;
}
.su-operator {
  display: flex;
  align-items: center;
  gap: 8px;
}
.su-operator-hint {
  font-size: 12px;
  color: var(--rc-muted);
}
/* 唯一的滚动容器：表格自己滚，查询区与分页始终可见（同系统设置其他 tab 口径） */
.su-table {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.su-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.su-row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.su-op-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}
.su-op-icon:hover {
  background: var(--rc-primary-bg, #eff6ff);
  color: var(--rc-primary, #2563eb);
}
.su-warn {
  color: var(--rc-danger, #dc2626);
}
.su-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
