<script setup lang="ts">
defineProps<{ loading: boolean; error: string; empty: boolean; unavailable?: boolean }>()
defineEmits<{ retry: [] }>()
</script>
<template>
  <div v-if="loading" class="wb-state" role="status" aria-label="加载中">
    <div v-for="n in 4" :key="n" class="wb-skeleton"><span /><span /></div>
  </div>
  <div v-else-if="error" class="wb-state" :role="unavailable ? 'status' : 'alert'">
    <strong>{{ unavailable ? '接口未就绪' : '加载失败' }}</strong>
    <p>{{ error }}</p>
    <button v-if="!unavailable" type="button" @click="$emit('retry')">重新加载</button>
  </div>
  <div v-else-if="empty" class="wb-state"><strong>暂无内容</strong><p><slot name="empty">当前没有可访问的内容。</slot></p></div>
  <slot v-else />
</template>
<style scoped>
.wb-state{min-height:260px;padding:32px 24px;display:flex;flex-direction:column;justify-content:center;align-items:center;color:#8090aa;text-align:center;font-size:12px}.wb-state strong{font-size:14px;color:#48607e}.wb-state p{max-width:380px;line-height:1.7}.wb-state button{background:white;border:1px solid #d9e5f6;border-radius:8px;padding:7px 14px;color:#2563eb;cursor:pointer}.wb-skeleton{width:100%;height:48px;border-bottom:1px solid #f0f3f8;display:flex;flex-direction:column;justify-content:center;gap:8px}.wb-skeleton span{width:65%;height:10px;border-radius:4px;background:#eef3fa;animation:pulse 1.4s infinite}.wb-skeleton span+span{width:40%;height:7px}@keyframes pulse{50%{opacity:.4}}@media(prefers-reduced-motion:reduce){.wb-skeleton span{animation:none}}
</style>
