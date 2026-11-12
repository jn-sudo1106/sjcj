<script setup lang="ts">
// 采集节点运行设置（0711 R5）：代理/断点续爬/登录从 Source 级迁到节点级，各采集节点可独立配置。
// 默认折叠收起（用户口径："在抓取节点配置、折叠起来"）；只在 capability 支持的项上渲染对应控件。
// 缺省值兜底：调用方（NodeInspector）传入的 modelValue 已经是"节点自身值 ?? 旧 Source 同名字段"的 1:1+fallback 结果，
// 本组件只管展示与编辑，不关心 fallback 从哪来。
import { computed, ref } from 'vue'
import type { CollectConfig, CollectorCapability } from '@/views/FlowCanvas/canvas/flowModel'

/** 运行设置涉及的字段子集（复用 CollectConfig，不重复定义类型）。
 *  @deprecated needLogin/loginUrl/account/credentialRef 这四项（S4-1，方案 §6.1）：登录已拆成独立的
 *  「网页登录」节点（collectorKind: 'login'，见 flowModel.seeds.ts），新流程应该连一个登录节点在前面，
 *  不要再靠这里的开关。旧字段只显示兼容提示，不再提供编辑入口；定时策略已迁到 ConfigTab。 */
export type CollectorRuntimeSettings = Pick<CollectConfig, 'useProxy' | 'resume' | 'needLogin' | 'loginUrl' | 'account' | 'credentialRef' | 'proxyDetail'>

const props = defineProps<{ modelValue: CollectorRuntimeSettings; capability?: CollectorCapability }>()
const emit = defineEmits<{ 'update:modelValue': [patch: Partial<CollectorRuntimeSettings>] }>()

const open = ref(false)

function patch(p: Partial<CollectorRuntimeSettings>) {
  emit('update:modelValue', p)
}
function onCheck(key: 'useProxy' | 'resume', e: Event) {
  patch({ [key]: (e.target as HTMLInputElement).checked })
}
// 代理明细（0804 S3-1）：勾选「使用代理」才展开；取消勾选时清空明细，避免残留脏数据误导下次开启
function onProxyCheck(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  patch(checked ? { useProxy: true } : { useProxy: false, proxyDetail: undefined })
}
function onProxyDetail(key: 'ip' | 'account' | 'password', e: Event) {
  patch({ proxyDetail: { ...props.modelValue.proxyDetail, [key]: (e.target as HTMLInputElement).value } })
}
function onProxyPort(e: Event) {
  const v = (e.target as HTMLInputElement).value
  patch({ proxyDetail: { ...props.modelValue.proxyDetail, port: v ? Number(v) : undefined } })
}
const hasLegacyLogin = computed(() => Boolean(props.modelValue.needLogin || props.modelValue.loginUrl || props.modelValue.account || props.modelValue.credentialRef))
</script>

<template>
  <div v-if="capability?.supportsProxy || capability?.supportsResume || (capability?.supportsLogin && hasLegacyLogin)" class="cs-wrap">
    <button class="cs-toggle" type="button" @click="open = !open">
      {{ open ? '▾' : '▸' }} 运行设置（代理 / 断点续爬{{ hasLegacyLogin ? ' / 旧登录配置' : '' }}）
    </button>
    <div v-if="open" class="cs-body">
      <div v-if="capability?.supportsProxy || capability?.supportsResume" class="rc-field">
        <label>核心参数</label>
        <div class="cs-checks">
          <label v-if="capability?.supportsProxy" class="cs-check">
            <input type="checkbox" :checked="modelValue.useProxy" @change="onProxyCheck" /> 使用代理
          </label>
          <label v-if="capability?.supportsResume" class="cs-check">
            <input type="checkbox" :checked="modelValue.resume" @change="onCheck('resume', $event)" /> 断点续爬
          </label>
        </div>
      </div>
      <!-- 代理明细（0804 S3-1）：勾选「使用代理」才展开 -->
      <div v-if="capability?.supportsProxy && modelValue.useProxy" class="cs-proxy-grid">
        <div class="rc-field"><label>代理 IP</label><input class="rc-input" :value="modelValue.proxyDetail?.ip" placeholder="如 192.168.1.1" @input="onProxyDetail('ip', $event)" /></div>
        <div class="rc-field"><label>端口</label><input class="rc-input" type="number" :value="modelValue.proxyDetail?.port" placeholder="如 8080" @input="onProxyPort" /></div>
        <div class="rc-field"><label>账号</label><input class="rc-input" :value="modelValue.proxyDetail?.account" @input="onProxyDetail('account', $event)" /></div>
        <div class="rc-field"><label>密码</label><input class="rc-input" type="password" :value="modelValue.proxyDetail?.password" @input="onProxyDetail('password', $event)" /></div>
      </div>
      <div v-if="capability?.supportsLogin && hasLegacyLogin" class="cs-legacy-login">
        当前节点保留旧登录配置。新流程请添加“网页登录”节点，旧字段仅用于兼容读取。
      </div>
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

.cs-proxy-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; margin-bottom: 4px; }
.cs-checks { display: flex; gap: 16px; padding: 4px 0; }
.cs-check { display: inline-flex; align-items: center; gap: 6px; color: var(--rc-text-2); font-size: 12px; cursor: pointer; }
.cs-cred { display: flex; align-items: center; gap: 8px; padding: 8px 9px; border: 1px solid #dbe3ee; border-radius: 7px; background: #f8fafc; font-size: 12px; color: var(--rc-text-2); }
.cs-cred-empty { color: var(--rc-faint); }
.cs-legacy-login { padding: 8px 9px; border: 1px dashed #f5c2c7; border-radius: 7px; background: #fff7f7; color: #9f1239; font-size: 11px; line-height: 1.5; }
</style>
