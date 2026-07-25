<script setup lang="ts">
// 顶栏（P3 收尾 · AppShell 拆分）
// 职责：品牌标识 + 帮助/通知入口 + 账号下拉菜单（修改密码 / 退出登录）
// 退出登录带二次确认，文案对齐旧 UserMenu.vue（计划 §11.2 红线 4）
import { computed, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { Bell, QuestionFilled, SwitchButton, User } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import ChangePasswordDialog from './ChangePasswordDialog.vue'
import companyLogo from '@/assets/brand/company-logo.png'

const router = useRouter()
const auth = useAuthStore()

async function handleLogout() {
  try {
    await ElMessageBox.confirm('真的要注销登录吗 ?', '提示', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
  } catch {
    return // 取消：不动会话
  }
  await auth.logout()
  void router.push('/user/login')
}

const accountName = computed(() => auth.name || '未登录')
const accountAvatarLabel = computed(() => accountName.value.slice(0, 4))
const changePwdVisible = ref(false)

function handleAccountCommand(command: string) {
  if (command === 'logout') {
    void handleLogout()
    return
  }
  if (command === 'change-password') {
    changePwdVisible.value = true
  }
}
</script>

<template>
  <header class="rc-topbar">
    <div class="rc-brand">
      <span class="rc-brand-mark">
        <img :src="companyLogo" alt="" />
      </span>
      <strong>青龙智能采集中心</strong>
    </div>
    <div class="rc-top-actions">
      <button class="rc-icon-btn" type="button" aria-label="帮助">
        <el-icon><QuestionFilled /></el-icon><span>帮助</span>
      </button>
      <button class="rc-icon-btn rc-notice" type="button" aria-label="通知">
        <el-icon><Bell /></el-icon>
      </button>
      <el-dropdown
        trigger="click"
        popper-class="rc-account-popper"
        placement="bottom-end"
        @command="handleAccountCommand"
      >
        <button class="rc-user" type="button" :aria-label="`${accountName}，打开账号菜单`">
          <span class="rc-avatar">
            {{ accountAvatarLabel }}
          </span>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="change-password">
              <el-icon><User /></el-icon>
              修改密码
            </el-dropdown-item>
            <el-dropdown-item command="logout">
              <el-icon><SwitchButton /></el-icon>
              退出登录
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </header>

  <ChangePasswordDialog v-model="changePwdVisible" />
</template>

<style scoped>
.rc-topbar {
  position: relative;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  height: 56px;
  min-height: 56px;
  padding: 0 20px;
  border-bottom: 1px solid #e2e8f0;
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(12px);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.6) inset;
}

.rc-topbar::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(37, 99, 235, 0.55), rgba(6, 182, 212, 0.55), transparent);
  background-size: 50% 100%;
  background-repeat: no-repeat;
  animation: rc-sheen 7s linear infinite;
}

.rc-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 220px;
  flex: none;
}

.rc-brand strong {
  color: var(--rc-text);
  font-size: 15px;
  font-weight: 600;
}

.rc-brand-mark {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
}

.rc-brand-mark img {
  display: block;
  width: 30px;
  height: 30px;
  object-fit: contain;
}

.rc-brand-mark::before {
  content: '';
  position: absolute;
  inset: -4px;
  z-index: -1;
  border-radius: 12px;
  background: radial-gradient(circle, rgba(37, 99, 235, 0.3), transparent 68%);
  animation: rc-glow-pulse 3.8s ease-in-out infinite;
}

.rc-top-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.rc-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--rc-text-2);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.rc-icon-btn span {
  display: none;
}

.rc-icon-btn:hover {
  background: #eff6ff;
  color: var(--rc-primary-ink);
}

.rc-user {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #3b75e8;
  color: #fff;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.22);
  cursor: pointer;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.rc-user:hover {
  background: #2563db;
  color: #fff;
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(37, 99, 235, 0.28);
}

.rc-user:focus-visible {
  outline: 3px solid rgba(37, 99, 235, 0.18);
  outline-offset: 2px;
}

.rc-notice {
  position: relative;
}

.rc-notice::after {
  content: '';
  position: absolute;
  top: 7px;
  right: 6px;
  width: 7px;
  height: 7px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: var(--rc-error);
}

.rc-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: -0.2px;
}

:global(.rc-account-popper.el-popper) {
  min-width: 156px;
  overflow: hidden;
  border: 1px solid #dce3ec;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
}

:global(.rc-account-popper .el-dropdown-menu) {
  padding: 0;
}

:global(.rc-account-popper .el-dropdown-menu__item) {
  height: 48px;
  gap: 12px;
  padding: 0 20px;
  color: #303744;
  font-size: 14px;
}

:global(.rc-account-popper .el-dropdown-menu__item + .el-dropdown-menu__item) {
  border-top: 1px solid #e5e9f0;
}

:global(.rc-account-popper .el-dropdown-menu__item .el-icon) {
  margin: 0;
  color: #285ed0;
  font-size: 19px;
}

:global(.rc-account-popper .el-popper__arrow) {
  display: none;
}
</style>
