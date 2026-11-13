<script setup lang="ts">
// 采集节点运行设置（0711 R5）：代理/断点续爬/登录从 Source 级迁到节点级，各采集节点可独立配置。
// 默认折叠收起（用户口径："在抓取节点配置、折叠起来"）；只在 capability 支持的项上渲染对应控件。
// 缺省值兜底：调用方（NodeInspector）传入的 modelValue 已经是"节点自身值 ?? 旧 Source 同名字段"的 1:1+fallback 结果，
// 本组件只管展示与编辑，不关心 fallback 从哪来。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CollectConfig, CollectorCapability } from '@/views/FlowCanvas/canvas/flowModel'
import { parseProxyCurl } from '@/utils/proxyCurlImport'
import { runnerManagementApi } from '@/api/runnerManagement'

/** 运行设置涉及的字段子集（复用 CollectConfig，不重复定义类型）。
 *  @deprecated needLogin/loginUrl/account/credentialRef 这四项（S4-1，方案 §6.1）：登录已拆成独立的
 *  「网页登录」节点（collectorKind: 'login'，见 flowModel.seeds.ts），新流程应该连一个登录节点在前面，
 *  不要再靠这里的开关。旧字段只显示兼容提示，不再提供编辑入口；定时策略已迁到 ConfigTab。 */
export type CollectorRuntimeSettings = Pick<CollectConfig, 'useProxy' | 'resume' | 'needLogin' | 'loginUrl' | 'account' | 'credentialRef' | 'proxyDetail'>

const props = defineProps<{ modelValue: CollectorRuntimeSettings; capability?: CollectorCapability; configId?: string; persistent?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [patch: Partial<CollectorRuntimeSettings>] }>()

const open = ref(false)
const importOpen = ref(false), proxyCurl = ref(''), importError = ref('')
const proxyState = ref<Partial<CollectorRuntimeSettings> | null>(null)
const settings = computed(() => ({ ...props.modelValue, ...proxyState.value }))
const loadingProxy = ref(false), savingProxy = ref(false), savedProxy = ref('')
let proxyRequest = 0, revision: number | undefined
onBeforeUnmount(() => { proxyRequest++ })
watch(() => [props.configId, props.persistent, props.capability?.supportsProxy], async () => {
  const request = ++proxyRequest
  proxyState.value = null; revision = undefined; loadingProxy.value = false; savingProxy.value = false; savedProxy.value = ''; importError.value = ''; closeImport()
  if (!props.persistent || !props.configId || !props.capability?.supportsProxy) return
  loadingProxy.value = true
  try {
    const result = await runnerManagementApi.nodeProxySettings(props.configId)
    if (request !== proxyRequest) return
    revision = result.revision
    if (result.configured) proxyState.value = { useProxy: result.useProxy, proxyDetail: result.proxyDetail }
  } catch (e) { if (request === proxyRequest) importError.value = `代理配置读取失败：${e instanceof Error ? e.message : String(e)}` }
  finally { if (request === proxyRequest) loadingProxy.value = false }
}, { immediate: true })
function closeImport() { importOpen.value = false; proxyCurl.value = ''; importError.value = '' }
async function persistProxy(value: Partial<CollectorRuntimeSettings>) {
  if (!props.persistent) { patch(value); return true }
  if (!props.configId || revision === undefined) { importError.value = '请先保存节点配置，并等代理设置读取完成后重试'; return false }
  const request = proxyRequest, configId = props.configId
  savingProxy.value = true; importError.value = ''
  try {
    const result = await runnerManagementApi.saveNodeProxySettings({ configId, revision, useProxy: !!value.useProxy, proxyDetail: value.proxyDetail })
    if (request === proxyRequest) {
      revision = result.revision; patch({ useProxy: result.useProxy, proxyDetail: result.proxyDetail })
      savedProxy.value = `代理已保存 · 配置 ${configId}`
    }
    return true
  } catch (e) { if (request === proxyRequest) importError.value = e instanceof Error ? e.message : '保存代理失败'; return false }
  finally { if (request === proxyRequest) savingProxy.value = false }
}
async function importProxy() {
  if (!settings.value.useProxy || savingProxy.value || loadingProxy.value) return
  try {
    const proxyDetail = parseProxyCurl(proxyCurl.value)
    if (await persistProxy({ useProxy: true, proxyDetail })) closeImport()
  } catch (e) { importError.value = e instanceof Error ? e.message : '代理配置解析失败' }
}

function patch(p: Partial<CollectorRuntimeSettings>) {
  if ('useProxy' in p || 'proxyDetail' in p) { proxyState.value = { ...(proxyState.value || props.modelValue), ...p }; savedProxy.value = '' }
  emit('update:modelValue', p)
}
function onCheck(key: 'useProxy' | 'resume', e: Event) {
  patch({ [key]: (e.target as HTMLInputElement).checked })
}
// 代理明细（0804 S3-1）：勾选「使用代理」才展开；取消勾选时清空明细，避免残留脏数据误导下次开启
function onProxyCheck(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  if (!checked) closeImport()
  if (!checked && props.persistent && props.configId) { void persistProxy({ useProxy: false }); return }
  patch(checked ? { useProxy: true } : { useProxy: false, proxyDetail: undefined })
}
watch(() => props.modelValue.useProxy, enabled => { if (!props.persistent) proxyState.value = null; if (!enabled) closeImport() })
function onProxyDetail(key: 'ip' | 'account' | 'password', e: Event) {
  patch({ proxyDetail: { ...settings.value.proxyDetail, [key]: (e.target as HTMLInputElement).value } })
}
function onProxyPort(e: Event) {
  const v = (e.target as HTMLInputElement).value
  patch({ proxyDetail: { ...settings.value.proxyDetail, port: v ? Number(v) : undefined } })
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
            <input type="checkbox" :disabled="loadingProxy || savingProxy" :checked="settings.useProxy" @change="onProxyCheck" /> 使用代理
          </label>
          <label v-if="capability?.supportsResume" class="cs-check">
            <input type="checkbox" :checked="modelValue.resume" @change="onCheck('resume', $event)" /> 断点续爬
          </label>
          <button v-if="capability?.supportsProxy && settings.useProxy" type="button" class="cs-import" :disabled="loadingProxy || savingProxy" data-testid="proxy-curl-open" @click="importOpen = !importOpen; proxyCurl = ''; importError = ''">导入 cURL</button>
        </div>
      </div>
      <div v-if="capability?.supportsProxy && settings.useProxy && importOpen" class="cs-import-form">
        <textarea v-model="proxyCurl" class="rc-input" rows="3" aria-label="代理 cURL 命令" autocomplete="off" spellcheck="false" placeholder='curl -x 代理地址:端口 -U "账号:密码" 目标网址' data-testid="proxy-curl-input" />
        <div class="cs-checks"><button type="button" class="cs-import" :disabled="!proxyCurl.trim() || loadingProxy || savingProxy" data-testid="proxy-curl-apply" @click="importProxy">保存代理</button><button type="button" class="cs-import" @click="closeImport">取消</button></div>
      </div>
      <!-- 代理明细（0804 S3-1）：勾选「使用代理」才展开 -->
      <div v-if="capability?.supportsProxy && settings.useProxy" class="cs-proxy-grid">
        <div class="rc-field"><label>代理地址</label><input class="rc-input" :disabled="loadingProxy || savingProxy" :value="settings.proxyDetail?.ip" placeholder="域名或 IP，如 proxy.example.com" @input="onProxyDetail('ip', $event)" /></div>
        <div class="rc-field"><label>端口</label><input class="rc-input" :disabled="loadingProxy || savingProxy" type="number" :value="settings.proxyDetail?.port" placeholder="如 8080" @input="onProxyPort" /></div>
        <div class="rc-field"><label>账号</label><input class="rc-input" :disabled="loadingProxy || savingProxy" :value="settings.proxyDetail?.account" @input="onProxyDetail('account', $event)" /></div>
        <div class="rc-field"><label>密码</label><input class="rc-input" :disabled="loadingProxy || savingProxy" type="password" :value="settings.proxyDetail?.password" @input="onProxyDetail('password', $event)" /></div>
      </div>
      <button v-if="persistent && settings.useProxy && !importOpen" type="button" class="cs-import" :disabled="loadingProxy || savingProxy" data-testid="proxy-save" @click="persistProxy({ useProxy: true, proxyDetail: settings.proxyDetail })">{{ savingProxy ? '正在保存…' : '保存代理' }}</button>
      <p v-if="savedProxy" role="status">{{ savedProxy }}</p>
      <p v-if="importError" role="alert">{{ importError }}</p>
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
.cs-import { border:0; background:transparent; color:var(--el-color-primary); cursor:pointer; padding:2px 0; font-size:12px; }
.cs-import:disabled { color:var(--el-text-color-disabled); cursor:default; }
.cs-import-form { margin-bottom:10px; }
.cs-import-form textarea { resize:vertical; }
.cs-import-form [role=alert] { color:var(--el-color-danger); font-size:12px; }
.cs-checks { display: flex; gap: 16px; padding: 4px 0; }
.cs-check { display: inline-flex; align-items: center; gap: 6px; color: var(--rc-text-2); font-size: 12px; cursor: pointer; }
.cs-cred { display: flex; align-items: center; gap: 8px; padding: 8px 9px; border: 1px solid #dbe3ee; border-radius: 7px; background: #f8fafc; font-size: 12px; color: var(--rc-text-2); }
.cs-cred-empty { color: var(--rc-faint); }
.cs-legacy-login { padding: 8px 9px; border: 1px dashed #f5c2c7; border-radius: 7px; background: #fff7f7; color: #9f1239; font-size: 11px; line-height: 1.5; }
</style>
