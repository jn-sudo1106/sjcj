<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { configApi, paramApi, type Param } from '@/api'
import { expandParameterizedUrl, extractUrlParamIds, hasFragmentParams } from '@/utils/flow/urlParams'
import ParamEditorDrawer from '@/components/param/ParamEditorDrawer.vue'

const props = defineProps<{
  templateDefaults?: boolean
  url: string
  paramRefs?: string[]
  paramValues: Record<string, string>
  warnFragment?: boolean
  /** 本节点引用的配置 ID。给了就把绑定/解绑接到真实接口（config/configParamAdd|Del，
   *  2026-08-26 拍板放开生产写）；不给（新建节点还没有配置）则退回只改本地。 */
  configId?: string
}>()
const emit = defineEmits<{
  'update:paramRefs': [refs: string[]]
  'update:paramValues': [values: Record<string, string>]
}>()

const pickerValue = ref('')
const available = ref<Param[]>([])
const details = reactive<Record<string, Param | null | undefined>>({})
const candidates = reactive<Record<string, string[]>>({})
const loading = reactive<Record<string, boolean>>({})
const drawer = reactive<{ visible: boolean; param: Param | null }>({ visible: false, param: null })

const refs = computed(() => [...new Set(props.paramRefs ?? [])])
const tokenIds = computed(() => extractUrlParamIds(props.url))
const fragmentWarning = computed(() => !!props.warnFragment && hasFragmentParams(props.url))

async function loadAvailable() {
  available.value = (await paramApi.paramPaged({ size: 100 })).list
}

// paramId → 绑定记录 id（configParamDel 要的是绑定记录 id，不是 paramId）。
// 每次绑定/解绑成功后重拉一次：用户可能同时在旧平台上改，本地缓存的 id 会过期。
const bindingIds = ref<Record<string, string>>({})
/** 后端绑定读到了才判「未绑定」：读取中 / 读失败时不下结论，免得把真绑定误标成没绑 */
const bindingsLoaded = ref(false)
const busy = ref(false)
async function loadBindings() {
  if (!props.configId) { bindingIds.value = {}; bindingsLoaded.value = false; return }
  try {
    const rows = (await configApi.configParams(props.configId, { size: 100 })).list
    bindingIds.value = Object.fromEntries(rows.map((row) => [row.paramId, row.id]))
    bindingsLoaded.value = true
  } catch {
    bindingIds.value = {} // 拉不到就退回只改本地，不阻塞界面
    bindingsLoaded.value = false
  }
}
watch(() => props.configId, loadBindings, { immediate: true })

/**
 * 列表里有、配置上却没有绑定记录的参数（2026-11-26 186 源 491000036 实测）：节点没有绑定时，
 * 画布按 URL 里的 $PARAM$_id 占位自动把参数放进列表（flowModel.layout），看着像绑好了，
 * 但后端配置没有这条绑定，loadParams 查不到，发起抓取不带参数值。这类要明确标出来并能一键绑定。
 * 没有配置 ID（新建节点）时绑定只在本地，不算。
 */
function notOnConfig(id: string): boolean {
  return !!props.configId && bindingsLoaded.value && !bindingIds.value[id]
}
const notOnConfigIds = computed(() => refs.value.filter(notOnConfig))
/** URL 里有占位、但不在列表里或没真正绑到配置上的参数 */
const unboundTokenIds = computed(() => tokenIds.value.filter((id) => !refs.value.includes(id) || notOnConfig(id)))

/** 写后端绑定（configParamAdd），成功后重读绑定；失败提示并返回 false */
async function bindOnConfig(id: string): Promise<boolean> {
  if (!props.configId) return true
  busy.value = true
  try {
    await configApi.bindParam(props.configId, id)
    await loadBindings()
    return true
  } catch (e) {
    ElMessage.error(`绑定参数失败：${(e as Error)?.message ?? String(e)}`)
    return false
  } finally {
    busy.value = false
  }
}
async function loadOne(id: string) {
  loading[id] = true
  try {
    const [detail, values] = await Promise.all([paramApi.paramDetail(id), paramApi.genValues(id)])
    details[id] = detail
    candidates[id] = values
  } finally {
    loading[id] = false
  }
}
watch(refs, (ids) => { ids.forEach((id) => { if (!(id in details) && !loading[id]) loadOne(id) }) }, { immediate: true })
onMounted(loadAvailable)

/**
 * 代入后的 URL 预览（2026-11-23 用户要「看参数设置的结果」）：
 * 选了「当前源取值」= 只用这一个值；否则用参数生成的全部值（每个值一条 URL，多个参数做笛卡尔积，
 * 与 expandParameterizedUrl 同口径），都没有再退到默认值。缺值的参数单独列出来——
 * 那样跑出来 URL 里这个位置是空的，比给一条带空洞的 URL 更好懂。
 */
const PREVIEW_SHOWN = 3
const urlPreview = computed(() => {
  const ids = tokenIds.value
  // 绑了参数但 URL 里没有占位：说清楚「没有可代入的地方」，别让人以为参数会改 URL（参数也可能用在登录等别处，所以只说 URL）
  if (!ids.length) return refs.value.length ? { pending: false as const, noToken: true as const, missing: [], urls: [], total: 0, truncated: false } : null
  if (ids.some((id) => loading[id] || details[id] === undefined)) return { pending: true as const }
  // 没绑到配置上的参数，发任务时后端拿不到它，URL 里会原样留着占位：不给假的代入结果
  const notBound = ids.filter((id) => !refs.value.includes(id) || notOnConfig(id))
  if (notBound.length) {
    return { pending: false as const, notBound: notBound.map((id) => details[id]?.name ? `${details[id]!.name}（${id}）` : id), missing: [], urls: [], total: 0, truncated: false }
  }
  const valuesByParam: Record<string, string[]> = {}
  for (const id of ids) {
    const pinned = props.paramValues[id]
    const fallback = details[id]?.defaultValue
    valuesByParam[id] = pinned ? [pinned] : candidates[id]?.length ? candidates[id]! : fallback ? [fallback] : []
  }
  const missing = ids.filter((id) => !valuesByParam[id]!.length)
  if (missing.length) {
    return { pending: false as const, missing: missing.map((id) => details[id]?.name ? `${details[id]!.name}（${id}）` : id), urls: [], total: 0, truncated: false }
  }
  const result = expandParameterizedUrl(props.url, valuesByParam)
  return { pending: false as const, missing: [], urls: result.urls.slice(0, PREVIEW_SHOWN), total: result.total, truncated: result.truncated }
})

function valueOf(id: string): string {
  return props.paramValues[id] || details[id]?.defaultValue || candidates[id]?.[0] || ''
}
function onPickValue(id: string, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  const next = { ...props.paramValues }
  if (value) {
    next[id] = value
  } else {
    const fallbackVal = valueOf(id)
    if (fallbackVal) next[id] = fallbackVal
    else delete next[id]
  }
  emit('update:paramValues', next)
}
async function bind(id: string) {
  if (!id || busy.value) return
  // 已在列表里但没真正绑到配置：只补后端绑定，列表和取值不动
  if (refs.value.includes(id)) {
    if (notOnConfig(id) && await bindOnConfig(id)) ElMessage.success('已绑定到配置')
    return
  }
  // 有 configId 就先写后端，写成功才更新界面——否则就是"看着绑上了、刷新又没了"。
  if (!await bindOnConfig(id)) return
  const picked = available.value.find((param) => param.paramId === id)
  if (picked) {
    details[id] = picked
    if (!candidates[id]) candidates[id] = picked.values ?? []
  }
  emit('update:paramRefs', [...refs.value, id])
  pickerValue.value = ''

  const defaultVal = props.paramValues[id] || picked?.defaultValue || picked?.values?.[0] || valueOf(id)
  if (defaultVal) {
    emit('update:paramValues', { ...props.paramValues, [id]: defaultVal })
  }
}
async function unbind(id: string) {
  if (busy.value) return
  // 迁移进来的绑定在后端是有记录的，只改内存等于没解绑（刷新就回来）。有绑定记录 id 就真删，
  // 删成功才更新界面。这是删生产数据且不可撤销，所以先二次确认。
  const bindingId = bindingIds.value[id]
  if (props.configId && bindingId) {
    const name = details[id]?.name || id
    try {
      await ElMessageBox.confirm(
        `将解除配置 ${props.configId} 与参数「${name}」的绑定，该操作直接生效且不可撤销，是否继续？`,
        '解绑参数',
        { type: 'warning', confirmButtonText: '解绑', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    busy.value = true
    try {
      await configApi.unbindParam(bindingId)
      await loadBindings()
    } catch (e) {
      ElMessage.error(`解绑失败：${(e as Error)?.message ?? String(e)}`)
      return
    } finally {
      busy.value = false
    }
    ElMessage.success('已解绑')
  }
  emit('update:paramRefs', refs.value.filter((ref) => ref !== id))
  const next = { ...props.paramValues }
  delete next[id]
  emit('update:paramValues', next)
}
function openCreate() {
  drawer.param = null
  drawer.visible = true
}
async function onSaved(param: Param) {
  details[param.paramId] = param
  loadOne(param.paramId)
  loadAvailable()
  // 新建参数也要真正绑到配置上，否则同样是「列表里有、发任务没有」
  if (notOnConfig(param.paramId) && !await bindOnConfig(param.paramId)) return
  if (!refs.value.includes(param.paramId)) emit('update:paramRefs', [...refs.value, param.paramId])
}

function kindLabel(kind: Param['kind']) {
  return { list: '列表', date: '日期', sequence: '序列', date_sequence: '日期序列', database: '数据库' }[kind]
}
</script>

<template>
  <div class="upe">
    <div class="upe-body">
      <div class="upe-actions">
        <select v-model="pickerValue" class="rc-select upe-picker"><option value="">添加已有参数</option><option v-for="param in available.filter((item) => !refs.includes(item.paramId))" :key="param.paramId" :value="param.paramId">{{ param.name }} · {{ param.paramId }}</option></select>
        <button class="rc-btn" type="button" :disabled="!pickerValue" @click="bind(pickerValue)">绑定</button>
        <button v-if="!props.templateDefaults" class="rc-btn" type="button" @click="openCreate">＋ 新建参数</button>
      </div>
      <div v-if="unboundTokenIds.length" class="upe-warn" data-testid="url-param-unbound">URL 中的参数 {{ unboundTokenIds.join('、') }} 尚未绑定到配置{{ props.configId ? ` #${props.configId}` : '' }}，发起抓取时不会带参数值。{{ notOnConfigIds.length ? '请点下方参数的「绑定到配置」' : `请从上方选择已有参数${props.templateDefaults ? '' : '或新建参数'}` }}。</div>
      <div v-if="fragmentWarning" class="upe-warn">参数写在 URL 的 # 片段里，普通网页抓取（HTTP 请求）读不到，请改用“浏览器抓取”节点。</div>
      <div v-if="!refs.length" class="upe-empty">暂无参数配置</div>
      <div v-for="id in refs" :key="id" class="upe-row">
        <div v-if="loading[id]" class="upe-row-head"><span class="upe-id">{{ id }}</span><span class="muted">查询中…</span></div>
        <template v-else-if="details[id]">
          <div class="upe-row-head">
            <div class="upe-identity"><span class="upe-id">{{ id }}</span><span class="upe-name">{{ details[id]!.name }}</span><span class="upe-meta">{{ details[id]!.group || '未分组' }} · {{ kindLabel(details[id]!.kind) }}</span></div>
            <div class="upe-row-actions">
              <template v-if="notOnConfig(id)">
                <span class="upe-unsaved" data-testid="url-param-not-on-config" title="只是 URL 里写了这个参数的占位，配置上没有绑定记录，发起抓取时后端拿不到它">未绑定到配置</span>
                <button class="upe-link" type="button" :disabled="busy" data-testid="url-param-bind-config" @click="bind(id)">绑定到配置</button>
              </template>
              <button class="upe-link danger" type="button" @click="unbind(id)">{{ notOnConfig(id) ? '移除' : '解绑' }}</button>
            </div>
          </div>
          <div class="upe-override"><label>{{ props.templateDefaults ? '模板默认值' : '当前源取值' }}</label><select class="rc-select upe-value" :value="props.paramValues[id] || ''" @change="onPickValue(id, $event)"><option value="">使用默认值：{{ details[id]!.defaultValue || candidates[id]?.[0] || '无' }}</option><option v-for="value in candidates[id]" :key="value" :value="value">{{ value }}</option></select></div>
        </template>
        <template v-else><div class="upe-row-head"><span class="upe-id">{{ id }}</span><span class="upe-missing">参数不存在</span><button class="upe-link danger" type="button" @click="unbind(id)">解绑</button></div></template>
      </div>
      <div v-if="urlPreview" class="upe-preview" data-testid="url-param-preview">
        <label>代入后的 URL</label>
        <div v-if="urlPreview.pending" class="muted">取值查询中…</div>
        <div v-else-if="'notBound' in urlPreview" class="upe-preview-miss" data-testid="url-param-preview-notbound">
          {{ urlPreview.notBound?.join('、') }} 还没绑定到配置，发起抓取时不会代入，任务 URL 会原样保留占位。绑定后这里显示代入结果。
        </div>
        <div v-else-if="'noToken' in urlPreview" class="muted" data-testid="url-param-preview-notoken">{{ props.url ? '当前 URL 里没有参数占位（$PARAM$_参数ID），已绑定的参数不会代入 URL。' : '当前节点没有 URL，没有可代入参数的地方。' }}</div>
        <div v-else-if="urlPreview.missing.length" class="upe-preview-miss" data-testid="url-param-preview-missing">
          {{ urlPreview.missing.join('、') }} 没有可用取值（未选当前源取值、没有默认值，生成值也为空），运行时 URL 里这个位置会是空的。可到「规则资产 → 参数中心」打开参数点「生成值预览」核对。
        </div>
        <template v-else>
          <div v-for="u in urlPreview.urls" :key="u" class="upe-preview-url" :title="u">{{ u }}</div>
          <div v-if="urlPreview.total > urlPreview.urls.length" class="muted">共 {{ urlPreview.truncated ? `超过 ${urlPreview.total}` : urlPreview.total }} 条 URL，仅显示前 {{ urlPreview.urls.length }} 条</div>
        </template>
      </div>
      <ParamEditorDrawer v-if="!props.templateDefaults" v-model="drawer.visible" :param="drawer.param" @saved="onSaved" />
    </div>
  </div>
</template>

<style scoped>
.upe { margin-top: 4px; }
.upe-link:hover { color: var(--rc-primary-ink); }
.upe-body { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--rc-border-soft); }
.upe-actions { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; margin-bottom: 10px; }
.upe-actions .rc-btn { height: 30px; padding: 0 10px; font-size: 12px; white-space: nowrap; }.upe-actions .rc-btn:last-child { grid-column: 1 / -1; justify-self: start; }
.rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; outline: none; box-sizing: border-box; }
.rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.upe-picker { min-width: 0; height: 30px; padding: 0 9px; font-size: 12px; }
.upe-empty { color: var(--rc-muted); font-size: 11px; line-height: 1.6; }
.upe-warn { font-size: 11px; color: var(--rc-warn, #d97706); background: var(--rc-warn-bg, #fef3c7); border-radius: 6px; padding: 6px 8px; margin-bottom: 8px; line-height: 1.5; }
.upe-row { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--rc-border-soft); font-size: 12px; }.upe-row-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }.upe-identity { display: flex; align-items: center; gap: 7px; min-width: 0; flex-wrap: wrap; }.upe-id { color: var(--rc-text-2); font-family: var(--rc-mono, ui-monospace, monospace); }.upe-name { font-weight: 600; }.upe-meta, .muted { color: var(--rc-faint); font-size: 11px; }.upe-row-actions { display: inline-flex; gap: 10px; flex: none; white-space: nowrap; }.upe-override { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px; margin-top: 7px; }.upe-override label { color: var(--rc-muted); font-size: 11px; white-space: nowrap; }.upe-value { min-width: 0; height: 30px; padding: 0 8px; font-size: 12px; }.upe-link { border: 0; background: transparent; padding: 0; color: var(--rc-primary-ink); font-size: 11px; cursor: pointer; }.upe-link.danger, .upe-missing { color: var(--rc-error, #dc2626); }
.upe-preview { margin-top: 10px; padding: 8px 9px; border: 1px solid #dbeafe; border-radius: 7px; background: #f8fbff; display: grid; gap: 4px; min-width: 0; }
.upe-preview label { color: var(--rc-muted); font-size: 11px; font-weight: 600; }
.upe-preview-url { font-family: var(--rc-mono, ui-monospace, monospace); font-size: 11px; color: var(--rc-text-2); word-break: break-all; }
.upe-unsaved { color: var(--rc-warn, #d97706); font-size: 11px; }
.upe-preview-miss { font-size: 11px; line-height: 1.5; color: var(--rc-warn, #d97706); }
@media (max-width: 520px) { .upe-row-head { align-items: flex-start; flex-direction: column; gap: 5px; }.upe-row-actions { padding-left: 0; }.upe-override { grid-template-columns: 1fr; gap: 4px; } }
</style>
