<script setup lang="ts">
// 采集节点运行设置（0711 R5）：代理/断点续爬/登录从 Source 级迁到节点级，各采集节点可独立配置。
// 默认折叠收起（用户口径："在抓取节点配置、折叠起来"）；只在 capability 支持的项上渲染对应控件。
// 缺省值兜底：调用方（NodeInspector）传入的 modelValue 已经是"节点自身值 ?? 旧 Source 同名字段"的 1:1+fallback 结果，
// 本组件只管展示与编辑，不关心 fallback 从哪来。
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { sourceApi, type CredentialRef } from '@/api'
import type { CollectConfig, CollectorCapability } from '@/views/FlowCanvas/canvas/flowModel'
import TaskScheduleSettings from './TaskScheduleSettings.vue'

/** 运行设置涉及的字段子集（复用 CollectConfig，不重复定义类型） */
export type CollectorRuntimeSettings = Pick<CollectConfig, 'useProxy' | 'resume' | 'needLogin' | 'loginUrl' | 'account' | 'credentialRef' | 'scheduleType' | 'scheduleTime' | 'weekdays' | 'cron'>

const props = defineProps<{ modelValue: CollectorRuntimeSettings; capability?: CollectorCapability; showSchedule?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [patch: Partial<CollectorRuntimeSettings>] }>()

const open = ref(false)
const cred = ref<CredentialRef | null>(null)
watch(
  () => props.modelValue.credentialRef,
  async (refId) => {
    if (!refId) { cred.value = null; return }
    // 凭据查询失败时显式 toast + 清空 cred（避免 cred.value 永远 undefined 导致"已绑定凭据"区域显示空）
    try {
      cred.value = await sourceApi.credentialRef(refId)
    } catch (e) {
      cred.value = null
      ElMessage.warning(`凭据 ${refId} 查询失败：${(e as Error).message ?? '未知错误'}`)
    }
  },
  { immediate: true },
)

function patch(p: Partial<CollectorRuntimeSettings>) {
  emit('update:modelValue', p)
}
function onCheck(key: 'useProxy' | 'resume', e: Event) {
  patch({ [key]: (e.target as HTMLInputElement).checked })
}
function onInput(key: 'loginUrl' | 'account', e: Event) {
  patch({ [key]: (e.target as HTMLInputElement).value })
}
function setNeedLogin(v: boolean) {
  // 登录关闭时清理 loginUrl/credentialRef（0711 计划口径），避免残留脏数据误导后续开启
  patch(v ? { needLogin: true } : { needLogin: false, loginUrl: '', account: '', credentialRef: '' })
}
</script>

<template>
  <div v-if="showSchedule || capability?.supportsProxy || capability?.supportsResume || capability?.supportsLogin" class="cs-wrap">
    <button class="cs-toggle" type="button" @click="open = !open">
      {{ open ? '▾' : '▸' }} 运行设置（代理 / 断点续爬 / 登录{{ showSchedule ? ' / 定时' : '' }}）
    </button>
    <div v-if="open" class="cs-body">
      <div v-if="capability?.supportsProxy || capability?.supportsResume" class="rc-field">
        <label>核心参数</label>
        <div class="cs-checks">
          <label v-if="capability?.supportsProxy" class="cs-check">
            <input type="checkbox" :checked="modelValue.useProxy" @change="onCheck('useProxy', $event)" /> 使用代理
          </label>
          <label v-if="capability?.supportsResume" class="cs-check">
            <input type="checkbox" :checked="modelValue.resume" @change="onCheck('resume', $event)" /> 断点续爬
          </label>
        </div>
      </div>
      <template v-if="capability?.supportsLogin">
        <div class="rc-field"><label>是否要求登陆</label>
          <div class="rc-segment">
            <button type="button" :class="{ active: !modelValue.needLogin }" @click="setNeedLogin(false)">不登陆</button>
            <button type="button" :class="{ active: modelValue.needLogin }" @click="setNeedLogin(true)">要求登陆</button>
          </div>
        </div>
        <template v-if="modelValue.needLogin">
          <div class="rc-field"><label>登陆URL</label><input class="rc-input" :value="modelValue.loginUrl" @input="onInput('loginUrl', $event)" /></div>
          <div class="rc-field"><label>登陆用户名</label><input class="rc-input" :value="modelValue.account" @input="onInput('account', $event)" /></div>
          <div class="rc-field"><label>登录凭据（只存引用，明文不回显）</label>
            <div class="cs-cred">
              <span v-if="cred">{{ cred.name }} · {{ cred.account }}</span>
              <span v-else class="cs-cred-empty">未绑定凭据</span>
            </div>
          </div>
        </template>
      </template>
      <TaskScheduleSettings v-if="showSchedule" :model-value="modelValue" @update:model-value="patch" />
    </div>
  </div>
</template>

<style scoped>
.cs-wrap { margin-top: 4px; }
.cs-toggle { display: block; border: 0; background: transparent; color: var(--rc-muted); font-size: 11px; font-weight: 600; cursor: pointer; padding: 2px 0; }
.cs-toggle:hover { color: var(--rc-primary-ink); }
.cs-body { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--rc-border-soft); }

.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-segment { display: inline-flex; border: 1px solid #dbe3ee; border-radius: 7px; overflow: hidden; background: #fff; }
.rc-segment button { border: 0; border-left: 1px solid #dbe3ee; background: #fff; color: var(--rc-text-2); padding: 7px 10px; font-size: 12px; cursor: pointer; }
.rc-segment button:first-child { border-left: 0; }
.rc-segment button.active { background: var(--rc-primary); color: #fff; font-weight: 700; }

.cs-checks { display: flex; gap: 16px; padding: 4px 0; }
.cs-check { display: inline-flex; align-items: center; gap: 6px; color: var(--rc-text-2); font-size: 12px; cursor: pointer; }
.cs-cred { display: flex; align-items: center; gap: 8px; padding: 8px 9px; border: 1px solid #dbe3ee; border-radius: 7px; background: #f8fafc; font-size: 12px; color: var(--rc-text-2); }
.cs-cred-empty { color: var(--rc-faint); }
</style>
