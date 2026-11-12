<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LoginConfigRef } from '@/views/FlowCanvas/canvas/flowModel'

const props = defineProps<{
  open: boolean
  configs: LoginConfigRef[]
  defaultId?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: [configId: string]
  cancel: []
}>()

const selectedId = ref('')
const enabledConfigs = computed(() => props.configs.filter((config) => config.enabled))
const selectedConfig = computed(() => enabledConfigs.value.find((config) => config.id === selectedId.value))

function resetSelection() {
  selectedId.value = enabledConfigs.value.some((config) => config.id === props.defaultId)
    ? props.defaultId!
    : enabledConfigs.value[0]?.id || ''
}

watch(() => [props.open, props.defaultId, props.configs] as const, () => {
  if (props.open) resetSelection()
}, { immediate: true })

function close() {
  emit('update:open', false)
  emit('cancel')
}

function confirm() {
  if (!selectedId.value) return
  emit('update:open', false)
  emit('confirm', selectedId.value)
}
</script>

<template>
  <div v-if="open" class="lc-dialog-mask" role="presentation" @click.self="close">
    <section class="lc-dialog" role="dialog" aria-modal="true" aria-labelledby="login-config-select-title">
      <div class="lc-dialog-head">
        <div>
          <h3 id="login-config-select-title">选择登录配置</h3>
          <p>本次选择只对当前任务生效，不会修改节点默认配置。</p>
        </div>
        <button class="lc-dialog-close" type="button" aria-label="关闭" @click="close">×</button>
      </div>

      <div class="lc-dialog-body">
        <label class="lc-field-label" for="login-config-run-select">登录配置</label>
        <select id="login-config-run-select" v-model="selectedId" class="rc-select">
          <option v-for="config in enabledConfigs" :key="config.id" :value="config.id">
            {{ config.loginName || '未填写用户名' }} · {{ config.newLoginConfig === '0' ? `已有登录 ${config.authConfig}` : config.loginUrl }}
          </option>
        </select>
        <div v-if="selectedConfig" class="lc-config-summary">
          <div><span>登录 URL</span><b>{{ selectedConfig.loginUrl || '未填写' }}</b></div>
          <div><span>用户名</span><b>{{ selectedConfig.loginName || '未填写' }}</b></div>
          <div><span>已有登录</span><b>{{ selectedConfig.authConfig || '新建登录' }}</b></div>
        </div>
        <p class="lc-dialog-tip">确认后由执行器检测该配置的会话；会话有效时跳过登录，失效时重新登录。</p>
      </div>

      <div class="lc-dialog-actions">
        <button class="rc-btn" type="button" @click="close">取消</button>
        <button class="rc-btn primary" type="button" :disabled="!selectedId" @click="confirm">按此配置发起</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.lc-dialog-mask { position: fixed; inset: 0; z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(15, 23, 42, .34); }
.lc-dialog { width: min(520px, 100%); border: 1px solid var(--rc-border); border-radius: 12px; background: #fff; box-shadow: 0 18px 50px rgba(15, 23, 42, .22); overflow: hidden; }
.lc-dialog-head { display: flex; justify-content: space-between; gap: 12px; padding: 16px 18px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.lc-dialog-head h3 { margin: 0; color: var(--rc-text); font-size: 15px; }
.lc-dialog-head p { margin: 5px 0 0; color: var(--rc-muted); font-size: 11px; }
.lc-dialog-close { width: 26px; height: 26px; border: 0; border-radius: 6px; background: transparent; color: var(--rc-muted); font-size: 20px; line-height: 1; cursor: pointer; }
.lc-dialog-close:hover { background: #f1f5f9; color: var(--rc-text); }
.lc-dialog-body { padding: 16px 18px 10px; }
.lc-field-label { display: block; margin-bottom: 6px; color: var(--rc-muted); font-size: 11px; }
.lc-config-summary { display: grid; gap: 6px; margin-top: 12px; padding: 10px 12px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #f8fafc; font-size: 11px; }
.lc-config-summary div { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 8px; }
.lc-config-summary span { color: var(--rc-muted); }
.lc-config-summary b { overflow: hidden; color: var(--rc-text); font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.lc-dialog-tip { margin: 12px 0 0; color: var(--rc-faint); font-size: 10px; line-height: 1.5; }
.lc-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px 16px; }
</style>
