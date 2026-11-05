<script setup lang="ts">
// 系统设置 → 用户管理 → 新建 / 编辑用户（短表单，居中弹窗）。
//
// 新建与编辑能填的东西不一样，都是后端规则决定的，不是 UI 省事：
//   · 登录名：新建必填、编辑不可改——它参与口令哈希（{p} + md5(登录名+明文)），改了等于把密码作废（决策 ⑧A）。
//   · 初始密码：只有新建能设，服务端加密后落库，任何接口都不回显（决策 ①C）。
//   · 所属组：新建时预填当前登录管理员自己的组（决策 ⑤ 的补充口径），可以改；后端在留空时同样兜底成创建人的组。
//   · 角色：编辑时支持选择角色并同步更新 SYS_USER_2_ROLE 绑定；新建账号由服务端默认落到只读（read）角色。
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  addSysUser,
  getSysRoles,
  sysUserFormError,
  updateSysUser,
  type SysRoleOption,
  type SysUserRow,
} from '@/api/sysUser'
import { useAuthStore } from '@/stores/auth'

const emit = defineEmits<{ saved: [] }>()

const auth = useAuthStore()

const visible = ref(false)
const saving = ref(false)
const editing = ref<SysUserRow | null>(null)
const form = reactive({
  userLoginName: '',
  userName: '',
  groupId: '',
  userPassword: '',
  roleId: undefined as number | undefined,
})

const isEdit = computed(() => !!editing.value)
/** 当前登录管理员自己的组：新建时作为所属组的默认值 */
const creatorGroup = computed(() => auth.info?.group)

const roleOptions = ref<SysRoleOption[]>([])
const loadingRoles = ref(false)

const ROLE_NAME_LABELS: Record<string, string> = {
  admin: 'admin（管理员）',
  read: 'read（只读）',
  user: 'user（普通用户）',
  operation: 'operation（操作员）',
}

function roleLabel(item: SysRoleOption): string {
  if (ROLE_NAME_LABELS[item.roleName]) return ROLE_NAME_LABELS[item.roleName]
  return item.roleRemark ? `${item.roleName}（${item.roleRemark}）` : item.roleName
}

const DEFAULT_ROLES: SysRoleOption[] = [
  { roleId: 57, roleName: 'admin', roleRemark: '超级管理员' },
  { roleId: 52, roleName: 'read', roleRemark: '只读用户' },
  { roleId: 55, roleName: 'user', roleRemark: '用户角色' },
  { roleId: 56, roleName: 'operation', roleRemark: '操作人员' },
]

function ensureCurrentRoleInOptions() {
  if (!editing.value || form.roleId === undefined) return
  const found = roleOptions.value.some((r) => r.roleId === form.roleId)
  if (!found && editing.value.roleNames) {
    roleOptions.value.push({
      roleId: form.roleId,
      roleName: editing.value.roleNames,
    })
  }
}

async function loadRoles() {
  loadingRoles.value = true
  try {
    const res = await getSysRoles()
    if (Array.isArray(res) && res.length > 0) {
      roleOptions.value = res
    } else {
      roleOptions.value = [...DEFAULT_ROLES]
    }
  } catch {
    roleOptions.value = [...DEFAULT_ROLES]
  } finally {
    loadingRoles.value = false
    ensureCurrentRoleInOptions()
  }
}

/** 外部调用：传 row = 编辑（登录名跟着原值且不可改），不传 = 新建（组 ID 预填创建人所在组） */
function open(row?: SysUserRow) {
  editing.value = row ?? null
  let initialRoleId: number | undefined = undefined
  if (row?.roleIds) {
    const firstId = Number(row.roleIds.split(',')[0])
    if (!isNaN(firstId)) {
      initialRoleId = firstId
    }
  }
  Object.assign(form, {
    userLoginName: row?.userLoginName ?? '',
    userName: row?.userName ?? '',
    groupId: row ? String(row.groupId ?? '') : String(creatorGroup.value ?? ''),
    userPassword: '',
    roleId: initialRoleId,
  })
  visible.value = true
  if (row) {
    void loadRoles()
  }
}
defineExpose({ open })

async function save() {
  const invalid = sysUserFormError({
    loginName: form.userLoginName,
    userName: form.userName,
    groupId: form.groupId,
    password: form.userPassword,
    originLoginName: editing.value?.userLoginName,
  })
  if (invalid) {
    ElMessage.warning(invalid)
    return
  }
  if (isEdit.value && form.roleId === undefined) {
    ElMessage.warning('请选择角色')
    return
  }
  saving.value = true
  try {
    const userName = form.userName.trim()
    const groupId = Number(form.groupId.trim())
    if (editing.value) {
      await updateSysUser({
        userId: editing.value.userId,
        userLoginName: editing.value.userLoginName,
        userName,
        groupId,
        roleId: form.roleId,
        roleIds: form.roleId !== undefined ? String(form.roleId) : undefined,
      })
    } else {
      await addSysUser({
        userLoginName: form.userLoginName.trim(),
        userName,
        groupId,
        userPassword: form.userPassword,
      })
    }
    ElMessage.success(isEdit.value ? '修改成功' : '新增成功，新账号默认只读（read）')
    visible.value = false
    emit('saved')
  } catch (e) {
    ElMessage.error(`保存失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="editing ? `编辑用户 · ${editing.userLoginName}` : '新建用户'" width="520px" append-to-body destroy-on-close>
    <el-form label-width="96px" size="default" @submit.prevent>
      <el-form-item label="登录名" required>
        <el-input
          v-model="form.userLoginName"
          :disabled="isEdit"
          placeholder="如 zhonghe，登录用的账号名"
          data-testid="sys-user-login-name"
        />
        <div class="su-hint">{{ isEdit ? '登录名创建后不可修改；需要换登录名请关闭后新建' : '不能含空格；admin 是内置账号，不能占用' }}</div>
      </el-form-item>
      <el-form-item label="用户名" required>
        <el-input v-model="form.userName" placeholder="页面上显示的真实姓名" data-testid="sys-user-name" />
      </el-form-item>
      <el-form-item label="所属组 ID" required>
        <el-input v-model="form.groupId" placeholder="如 100001" data-testid="sys-user-group-id" />
        <div class="su-hint">
          {{ isEdit ? '改组会连带改变该账号能看到的数据范围（数据权限按组配置）' : `默认沿用你自己所在的组${creatorGroup === undefined ? '（会话里没取到组，请手工填写）' : ''}；数据权限（来源组、源、目录）都挂在组上` }}
        </div>
      </el-form-item>
      <el-form-item v-if="!isEdit" label="初始密码" required>
        <el-input
          v-model="form.userPassword"
          type="password"
          show-password
          autocomplete="new-password"
          placeholder="交给后端加密存储，页面不回显"
          data-testid="sys-user-password"
        />
        <div class="su-hint">落库形态为 {p} + md5(登录名 + 密码)，与「修改密码」一致，数据库里查不到明文</div>
      </el-form-item>
      <el-form-item label="角色" :required="isEdit">
        <el-select
          v-if="isEdit"
          v-model="form.roleId"
          placeholder="请选择角色"
          :loading="loadingRoles"
          data-testid="sys-user-role-select"
          style="width: 100%"
        >
          <el-option
            v-for="item in roleOptions"
            :key="item.roleId"
            :label="roleLabel(item)"
            :value="item.roleId"
          />
        </el-select>
        <div v-else class="su-hint">
          新账号由服务端自动绑定只读（read）角色；如需其他角色可在创建后通过编辑修改
        </div>
        <div v-if="isEdit" class="su-hint">修改角色会同步更新该账号的系统访问权限</div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" data-testid="sys-user-save" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.su-hint { font-size: 12px; color: var(--rc-muted); line-height: 1.6; }
</style>
