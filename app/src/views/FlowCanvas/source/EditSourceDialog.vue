<script setup lang="ts">
// 编辑源名称 / 源 URL。侧栏「源详情」只有 ~186px，长 URL 不适合行内改；
// 交互跟节点配置里「只读 + 编辑弹窗」同款（EditParamSourceDialog / EditNodeSourceDialog）。
// 源 ID 不可改。参数源的地址是 URL 模板，这里不让改，避免把 $PARAM$ 占位符改坏。
// 2026-10-19 补「核心参数」：旧平台源编辑（SourceList.vue 的 base-edit-modal）里的 sourceParam，
// 普通文本框、不做 JSON 校验，随 updateSource 整条提交。新平台此前只读展示、没有编辑入口。
// 2026-10-28 快捷编辑补「所属网站」：updateSource 不认 siteId，改了网站另走 changeSite（0 = 不绑定网站，
// 与侧栏「更换网站」同口径）。侧栏源详情本身就在某个网站里，换站走右键「更换网站」，这里只给快捷编辑。
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { siteApi, sourceApi, type Source } from '@/api'

const props = defineProps<{ open: boolean; source: Source | null; quick?: boolean }>()
const emit = defineEmits<{ 'update:open': [boolean]; saved: [Source] }>()

const name = ref('')
const url = ref('')
const coreParam = ref('')
/** 核心参数要从源详情取：侧栏列表数据不一定带这个字段，拿列表值回写会把原值冲掉。取不到就不提交它。 */
const coreParamLoaded = ref(false)
const loadError = ref('')
const saving = ref(false)
const isParam = computed(() => props.source?.kind === 'param')

const UNBIND_SITE_ID = '0'
const siteId = ref(UNBIND_SITE_ID)
/** 打开时的所属网站，保存时只有变了才调 changeSite */
const originalSiteId = ref(UNBIND_SITE_ID)
const siteOptions = ref<{ siteId: string; name: string }[]>([])
const siteLoadError = ref('')
/** 当前网站不在列表里（如已软删）时也要能显示出来，不然下拉里只剩一串 ID */
const siteSelectOptions = computed(() => {
  const list = siteOptions.value
  if (originalSiteId.value === UNBIND_SITE_ID || list.some((s) => s.siteId === originalSiteId.value)) return list
  return [{ siteId: originalSiteId.value, name: props.source?.siteName || `网站 ${originalSiteId.value}` }, ...list]
})
function normalizeSiteId(value: unknown): string {
  const id = value == null ? '' : String(value)
  return id && id !== '-1' ? id : UNBIND_SITE_ID
}
async function loadSites() {
  siteLoadError.value = ''
  try {
    siteOptions.value = (await siteApi.sitePaged({ page: 1, size: 2000 })).list.map((s) => ({ siteId: String(s.siteId), name: s.name }))
  } catch {
    siteLoadError.value = '网站列表加载失败，本次保存不改所属网站'
  }
}

watch(() => props.open, (open) => {
  if (!open || !props.source) return
  name.value = props.source.name
  url.value = isParam.value
    ? (props.source.urlTemplate || props.source.baseUrl || props.source.url || '')
    : (props.source.url || '')
  coreParam.value = props.source.coreParam ?? ''
  coreParamLoaded.value = false
  siteId.value = originalSiteId.value = normalizeSiteId(props.source.siteId)
  void loadCoreParam(props.source.sourceId)
  if (props.quick) void loadSites()
}, { immediate: true })

async function loadCoreParam(sourceId: string) {
  loadError.value = ''
  try {
    const detail = await sourceApi.sourceDetail(sourceId)
    if (!props.open || props.source?.sourceId !== sourceId) return
    if (!detail) { loadError.value = '未找到源详情，请重试'; return }
    coreParam.value = detail.coreParam ?? ''
    if (props.quick) {
      name.value = detail.name
      if (!isParam.value) url.value = detail.url
      siteId.value = originalSiteId.value = normalizeSiteId(detail.siteId)
    }
    coreParamLoaded.value = true
  } catch {
    if (!props.open || props.source?.sourceId !== sourceId) return
    loadError.value = '读取源详情失败，请重试'
    // 取不到详情就不让改，保存时也不带它，避免误清空
  }
}

function close() {
  emit('update:open', false)
}

async function onSave() {
  const current = props.source
  if (!current || saving.value || (props.quick && !coreParamLoaded.value)) return
  const nextName = name.value.trim()
  if (!nextName) {
    ElMessage.warning('源名称不能为空')
    return
  }
  const nextUrl = url.value.trim()
  const base: Source = isParam.value
    ? { ...current, name: nextName }
    : { ...current, name: nextName, url: nextUrl }
  const updated: Source = coreParamLoaded.value ? { ...base, coreParam: coreParam.value.trim() } : base
  saving.value = true
  try {
    const res = props.quick
      ? await sourceApi.updateSourceCore(current.sourceId, { name: nextName, ...(isParam.value ? {} : { url: nextUrl }), coreParam: coreParam.value.trim() })
      : await sourceApi.sourceUpdate(updated)
    if (!res?.ok) {
      ElMessage.warning(res?.message || '保存失败，请重试')
      return
    }
    const nextSiteId = siteId.value
    if (props.quick && !siteLoadError.value && nextSiteId !== originalSiteId.value) {
      const moved = await sourceApi.changeSite([current.sourceId], nextSiteId).catch((error: unknown) => ({
        ok: false, message: error instanceof Error ? error.message : String(error),
      }))
      if (!moved?.ok) {
        // 名称等已经写进去了：照常回传、关窗，只提示网站没换成
        emit('saved', updated)
        ElMessage.warning(`源信息已保存，但更换所属网站失败：${moved?.message || '请重试'}`)
        close()
        return
      }
      emit('saved', { ...updated, siteId: nextSiteId })
      ElMessage.success(nextSiteId === UNBIND_SITE_ID ? '源信息已保存，已解除网站绑定' : '源信息已保存，所属网站已更换')
      close()
      return
    }
    emit('saved', updated)
    ElMessage.success(res.message || '源信息已保存')
    close()
  } catch (error) {
    ElMessage.error(`保存失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="open" class="esd-backdrop" data-testid="edit-source-dialog" @click.self="close">
    <div class="esd-card">
      <div class="esd-title">{{ quick ? '快捷编辑源' : '编辑源' }}</div>
      <div v-if="quick && source" class="esd-source">{{ source.sourceId }} · {{ source.name }}</div>
      <div class="rc-field">
        <label>源名称</label>
        <input v-model="name" class="rc-input" aria-label="源名称" data-testid="edit-source-name" :disabled="quick && !coreParamLoaded" />
      </div>
      <div class="rc-field">
        <label>源 URL</label>
        <input
          v-model="url"
          class="rc-input"
          aria-label="源 URL"
          data-testid="edit-source-url"
          :disabled="isParam || (quick && !coreParamLoaded)"
          :placeholder="isParam ? '参数源请在节点配置里编辑参数源' : '如 https://example.com/list'"
        />
        <div class="rc-help">
          {{ isParam
            ? '这是参数源：地址模板带 $PARAM$ 占位符，请到节点配置里用「编辑参数源」改。'
            : '源 URL 属于这条源，和节点配置里那份配置 URL 不是同一字段。' }}
        </div>
      </div>
      <div v-if="quick" class="rc-field">
        <label>所属网站</label>
        <el-select
          v-model="siteId"
          filterable
          aria-label="所属网站"
          data-testid="edit-source-site"
          style="width: 100%"
          :disabled="!coreParamLoaded || !!siteLoadError"
        >
          <el-option label="不绑定网站" :value="UNBIND_SITE_ID" />
          <el-option v-for="s in siteSelectOptions" :key="s.siteId" :label="`${s.name}（ID ${s.siteId}）`" :value="s.siteId" />
        </el-select>
        <div v-if="siteLoadError" class="rc-help esd-site-error">{{ siteLoadError }}</div>
        <div v-else-if="siteId !== originalSiteId" class="rc-help" data-testid="edit-source-site-hint">
          {{ siteId === UNBIND_SITE_ID
            ? `保存后该源不属于任何网站，只能按源 ID（${source?.sourceId}）找回。`
            : '一个源只能属于一个网站：保存后原网站将不再包含该源。' }}
        </div>
      </div>
      <div class="rc-field">
        <label>核心参数</label>
        <textarea
          v-model="coreParam"
          class="rc-input esd-textarea"
          rows="3"
          aria-label="核心参数"
          data-testid="edit-source-core-param"
          :disabled="!coreParamLoaded"
          :placeholder="coreParamLoaded ? '可选，原样保存' : loadError || '正在读取源详情…'"
        />
      </div>
      <div v-if="quick && loadError" class="esd-load-error" role="alert">{{ loadError }} <button type="button" class="rc-btn" @click="source && loadCoreParam(source.sourceId)">重试</button></div>
      <div class="esd-actions">
        <button class="rc-btn" type="button" @click="close">取消</button>
        <button class="rc-btn primary" type="button" data-testid="edit-source-save" :disabled="saving || (quick && !coreParamLoaded)" @click="onSave">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.esd-backdrop { position: fixed; inset: 0; z-index: 91; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.28); }
.esd-card { width: min(520px, calc(100vw - 48px)); background: #fff; border: 1px solid var(--rc-border); border-radius: 12px; padding: 16px; box-shadow: 0 24px 64px -22px rgba(15, 23, 42, 0.45); }
.esd-title { font-size: 13px; font-weight: 800; color: var(--rc-text); margin-bottom: 12px; }
.esd-source { margin-bottom: 14px; color: var(--rc-muted); font-size: 12px; overflow-wrap: anywhere; }
.esd-load-error { margin-bottom: 12px; color: var(--rc-error); font-size: 12px; }
.esd-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 14px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; box-sizing: border-box; }
.esd-textarea { resize: vertical; min-height: 64px; font-family: inherit; line-height: 1.5; }
.rc-input:disabled { background: #f8fafc; color: var(--rc-muted); }
.rc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.5; margin-top: 6px; }
.esd-site-error { color: var(--rc-error); }
.rc-field:last-of-type { margin-bottom: 12px; }
</style>
