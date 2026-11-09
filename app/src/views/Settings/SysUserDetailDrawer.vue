<script setup lang="ts">
// 系统设置 → 用户管理 → 用户详情（右侧抽屉，AGENTS.md 详情弹层约定）。
// 字段就是 SYS_USER 一行 + SYS_USER_2_ROLE 的角色回显；口令永远不出现在任何出参里。
import { computed } from 'vue'
import { statusText, type SysUserRow } from '@/api/sysUser'
import { readGroupNames } from '@/utils/groupNames'

const props = defineProps<{ modelValue: boolean; user: SysUserRow | null }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const roleIds = computed(() => (props.user?.roleIds ?? '').split(',').filter(Boolean))

const displayGroupName = computed(() => {
  if (!props.user) return '—'
  if (props.user.groupName && !props.user.groupName.startsWith('用户组_')) {
    return props.user.groupName
  }
  if (props.user.groupId != null) {
    const local = readGroupNames()[String(props.user.groupId)]
    if (local) return local
  }
  return props.user.groupName || (props.user.groupId ? `用户组_${props.user.groupId}` : '—')
})
</script>

<template>
  <el-drawer v-model="visible" :title="user ? `用户 · ${user.userLoginName}` : '用户'" size="460px" data-testid="sys-user-drawer">
    <dl v-if="user" class="su-detail">
      <dt>用户 ID</dt>
      <dd>{{ user.userId }}</dd>
      <dt>登录名</dt>
      <dd>{{ user.userLoginName }}</dd>
      <dt>用户名</dt>
      <dd>{{ user.userName }}</dd>
      <dt>用户组</dt>
      <dd>{{ displayGroupName }}</dd>
      <dt>状态</dt>
      <dd>{{ statusText(user.userStatus) }}</dd>
      <dt>已绑角色</dt>
      <dd>
        <span v-if="roleIds.length">{{ user.roleNames }}（ID {{ roleIds.join('、') }}）</span>
        <span v-else class="su-warn">无角色——启用会被后端拒绝，因为空角色账号登录后会被当成管理员</span>
      </dd>
      <dt>登录名可改</dt>
      <dd>否（登录名参与口令哈希，改了等于作废密码）</dd>
      <dt>口令</dt>
      <dd>已设置（{p} + md5 形态落库，任何接口都不回显明文；要换口令请用「重置密码」）</dd>
      <dt>创建人</dt>
      <dd>{{ user.creator || '—' }}</dd>
      <dt>创建时间</dt>
      <dd>{{ user.createTime || '—' }}</dd>
      <dt>最后修改</dt>
      <dd>{{ user.modifier || '—' }}{{ user.updateTime ? ` · ${user.updateTime}` : '' }}</dd>
    </dl>
    <p v-if="user?.protectedAccount" class="su-note">内置 admin 账号：本页只能查看，编辑 / 停用 / 重置密码都会被后端拒绝。</p>
  </el-drawer>
</template>

<style scoped>
.su-detail { display: grid; grid-template-columns: 104px 1fr; gap: 10px 12px; margin: 0; font-size: 13px; }
.su-detail dt { color: var(--rc-muted); }
.su-detail dd { margin: 0; color: var(--rc-text); word-break: break-all; }
.su-warn { color: var(--rc-danger, #dc2626); }
.su-note { margin: 16px 0 0; font-size: 12px; color: var(--rc-muted); background: #f8fafc; border-radius: 6px; padding: 8px 10px; }
</style>
