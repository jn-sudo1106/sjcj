<script setup lang="ts">
// 批量修改所属网站（2026-11-03，源管理「系统目录 / 业务目录」页签的「归类」下拉）。
// 一个源只属于一个网站（0824 定），所以这是搬移而不是新增关联：改完后原网站不再包含这些源。
// 「不绑定网站」走 changeSite(ids, '0')，与侧栏右键「更换网站」、快捷编辑源同一条口径。
// 后端不返回逐条结果，只在整批一个 success；接口内部的回查兜底见 sourceApi.changeSite。
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { CHANGE_SITE_CHUNK, siteApi, sourceApi } from '@/api'

const props = defineProps<{ sourceIds: string[] }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const UNBIND_SITE_ID = '0'
const visible = ref(true)
const siteId = ref('')
const sites = ref<{ siteId: string; name: string }[]>([])
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const error = ref('')
const progress = ref('')
const total = computed(() => props.sourceIds.length)
const canSubmit = computed(() => !!siteId.value && !saving.value && !loading.value && !loadError.value && total.value > 0)

let siteRequestId = 0
/** 目标网站候选：默认按名称远搜（site/sitePaged 只认网站名），候选上限同快捷编辑源 */
async function loadSites(keyword = '') {
  const requestId = ++siteRequestId
  loading.value = true
  loadError.value = ''
  try {
    const result = await siteApi.sitePaged({ page: 1, size: 2000, ...(keyword.trim() ? { name: keyword.trim() } : {}) })
    if (requestId !== siteRequestId) return
    sites.value = result.list.map((s) => ({ siteId: String(s.siteId), name: s.name }))
  } catch {
    if (requestId !== siteRequestId) return
    loadError.value = '网站列表加载失败，请重试'
  } finally {
    if (requestId === siteRequestId) loading.value = false
  }
}
void loadSites()

const targetLabel = computed(() => siteId.value === UNBIND_SITE_ID
  ? '不绑定网站'
  : sites.value.find((s) => s.siteId === siteId.value)?.name ?? `网站 ${siteId.value}`)

function close() {
  visible.value = false
  emit('close')
}

async function submit() {
  if (!canSubmit.value) return
  saving.value = true
  error.value = ''
  progress.value = ''
  const target = siteId.value
  try {
    const ack = await sourceApi.changeSite([...props.sourceIds], target, (done, all) => {
      // 超过单片上限才分片提交，只用来说明「还没跑完」，不假装逐条进度
      if (all > CHANGE_SITE_CHUNK) progress.value = `正在提交 ${done}/${all}`
    })
    if (!ack.ok) {
      // 可能已部分落地（如网关超时但后端写完），这里把列表刷新交给父级核对，不清空选择
      error.value = ack.message || '修改所属网站失败，请重试'
      emit('saved')
      return
    }
    ElMessage.success(target === UNBIND_SITE_ID
      ? `已将 ${total.value} 个源解除网站关联`
      : `已将 ${total.value} 个源改到「${targetLabel.value}」`)
    emit('saved')
    close()
  } catch (e) {
    error.value = `修改失败：${(e as Error)?.message ?? String(e)}。请刷新列表核对归属后再重试。`
  } finally {
    saving.value = false
    progress.value = ''
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`修改 ${total} 个源的所属网站`"
    width="520px"
    append-to-body
    data-testid="change-site-dialog"
    :close-on-click-modal="!saving"
    :show-close="!saving"
    @update:model-value="(v: boolean) => { if (!v) close() }"
  >
    <div class="csd-field">
      <label class="csd-label">目标网站</label>
      <el-select
        v-model="siteId"
        filterable
        remote
        :remote-method="loadSites"
        :loading="loading"
        placeholder="搜索网站名称，或选「不绑定网站」"
        aria-label="目标网站"
        data-testid="change-site-select"
        style="width: 100%"
        :disabled="saving"
      >
        <el-option label="不绑定网站（解除网站关联）" :value="UNBIND_SITE_ID" />
        <el-option v-for="s in sites" :key="s.siteId" :label="`${s.name}（ID ${s.siteId}）`" :value="s.siteId" />
      </el-select>
      <div v-if="loadError" class="csd-err">{{ loadError }}</div>
    </div>
    <p class="csd-hint" data-testid="change-site-hint">
      <template v-if="siteId === UNBIND_SITE_ID">
        解除后这些源不属于任何网站，原网站将不再包含它们；源本身和流程不受影响，之后可在对应网站的「导入已有源」里按源 ID 找回。
      </template>
      <template v-else-if="siteId">
        一个源只能属于一个网站：确认后原网站将不再包含这些源（共 {{ total }} 个）。
      </template>
      <template v-else>只改归属网站，不动源的名称、URL、流程和业务目录。</template>
    </p>
    <div v-if="progress" class="csd-progress" role="status">{{ progress }}</div>
    <div v-if="error" class="csd-err" role="alert" data-testid="change-site-error">{{ error }}</div>
    <template #footer>
      <el-button :disabled="saving" @click="close">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canSubmit" data-testid="change-site-submit" @click="submit">
        {{ saving ? '提交中…' : `确认修改 ${total} 个源` }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.csd-field { display: flex; flex-direction: column; gap: 6px; }
.csd-label { color: var(--rc-text-2); font-size: 13px; }
.csd-hint { margin: 10px 0 0; color: var(--rc-muted); font-size: 12px; line-height: 1.6; }
.csd-progress { margin-top: 8px; color: var(--rc-text-2); font-size: 12px; }
.csd-err { margin-top: 8px; color: var(--rc-error); font-size: 12px; overflow-wrap: anywhere; }
</style>
