<script setup lang="ts">
defineProps<{
  selectedCount: number
}>()

const emit = defineEmits<{
  'batchSnatch': []
  'batchDelete': []
  'operate': [cmd: string]
  'monitor': [cmd: string]
  'clearSelection': []
}>()
</script>

<template>
  <transition name="slide-up">
    <div v-if="selectedCount > 0" class="ca-batchbar">
      <span>已选 <b>{{ selectedCount }}</b> 个源</span>
      <button class="rc-btn" type="button" @click="emit('batchSnatch')">发抓取</button>
      <el-dropdown trigger="click" @command="(cmd: string) => emit('operate', cmd)">
        <button class="rc-btn" type="button">操作类 ▾</button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="success">改为成功状态</el-dropdown-item>
            <el-dropdown-item command="enable">启用</el-dropdown-item>
            <el-dropdown-item command="disable">禁用</el-dropdown-item>
            <el-dropdown-item command="schedule" divided>批量定时</el-dropdown-item>
            <el-dropdown-item command="modify">批量改配置</el-dropdown-item>
            <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-dropdown trigger="click" @command="(cmd: string) => emit('monitor', cmd)">
        <button class="rc-btn" type="button">监控类 ▾</button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="freq-日度">频率：日度</el-dropdown-item>
            <el-dropdown-item command="freq-周度">频率：周度</el-dropdown-item>
            <el-dropdown-item command="freq-月度">频率：月度</el-dropdown-item>
            <el-dropdown-item command="normal" divided>人工核验已正常</el-dropdown-item>
            <el-dropdown-item command="abnormal">人工标为异常</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <button class="rc-btn danger" type="button" @click="emit('batchDelete')">批量删除</button>
      <el-button text @click="emit('clearSelection')">清空选择</el-button>
    </div>
  </transition>
</template>

<style scoped>
.ca-batchbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border: 1px solid #bfdbfe;
  border-radius: 10px;
  background: var(--rc-primary-bg);
  font-size: 13px;
  color: var(--rc-text-2);
}
.ca-batchbar b { color: var(--rc-primary-ink); }

.slide-up-enter-active,
.slide-up-leave-active {
  transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
