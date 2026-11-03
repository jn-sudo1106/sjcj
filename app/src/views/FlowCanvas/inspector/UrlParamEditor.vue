<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { configApi, paramApi, type Param } from '@/api'
import { extractUrlParamIds, hasFragmentParams } from '@/utils/flow/urlParams'
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
const unboundTokenIds = computed(() => tokenIds.value.filter((id) => !refs.value.includes(id)))
const fragmentWarning = computed(() => !!props.warnFragment && hasFragmentParams(props.url))

async function loadAvailable() {
  available.value = (await paramApi.paramPaged({ size: 100 })).list
}

// paramId → 绑定记录 id（configParamDel 要的是绑定记录 id，不是 paramId）。
// 每次绑定/解绑成功后重拉一次：用户可能同时在旧平台上改，本地缓存的 id 会过期。
const bindingIds = ref<Record<string, string>>({})
const busy = ref(false)
async function loadBindings() {
  if (!props.configId) { bindingIds.value = {}; return }
  try {
    const rows = (await configApi.configParams(props.configId, { size: 100 })).list
    bindingIds.value = Object.fromEntries(rows.map((row) => [row.paramId, row.id]))
  } catch {
    bindingIds.value = {} // 拉不到就退回只改本地，不阻塞界面
  }
}
watch(() => props.configId, loadBindings, { immediate: true })
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
  if (!id || refs.value.includes(id) || busy.value) return
  // 有 configId 就先写后端，写成功才更新界面——否则就是"看着绑上了、刷新又没了"。
  if (props.configId) {
    busy.value = true
    try {
      await configApi.bindParam(props.configId, id)
      await loadBindings()
    } catch (e) {
      ElMessage.error(`绑定参数失败：${(e as Error)?.message ?? String(e)}`)
      return
    } finally {
      busy.value = false
    }
  }
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
function onSaved(param: Param) {
  details[param.paramId] = param
  loadOne(param.paramId)
  if (!refs.value.includes(param.paramId)) emit('update:paramRefs', [...refs.value, param.paramId])
  loadAvailable()
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
      <div v-if="unboundTokenIds.length" class="upe-warn">URL 中的参数 {{ unboundTokenIds.join('、') }} 尚未绑定，请从上方选择已有参数{{ props.templateDefaults ? '' : '或新建参数' }}。</div>
      <div v-if="fragmentWarning" class="upe-warn">参数写在 URL 的 # 片段里，普通网页抓取（HTTP 请求）读不到，请改用“浏览器抓取”节点。</div>
      <div v-if="!refs.length" class="upe-empty">暂无参数配置</div>
      <div v-for="id in refs" :key="id" class="upe-row">
        <div v-if="loading[id]" class="upe-row-head"><span class="upe-id">{{ id }}</span><span class="muted">查询中…</span></div>
        <template v-else-if="details[id]">
          <div class="upe-row-head">
            <div class="upe-identity"><span class="upe-id">{{ id }}</span><span class="upe-name">{{ details[id]!.name }}</span><span class="upe-meta">{{ details[id]!.group || '未分组' }} · {{ kindLabel(details[id]!.kind) }}</span></div>
            <div class="upe-row-actions"><button class="upe-link danger" type="button" @click="unbind(id)">解绑</button></div>
          </div>
          <div class="upe-override"><label>{{ props.templateDefaults ? '模板默认值' : '当前源取值' }}</label><select class="rc-select upe-value" :value="props.paramValues[id] || ''" @change="onPickValue(id, $event)"><option value="">使用默认值：{{ details[id]!.defaultValue || candidates[id]?.[0] || '无' }}</option><option v-for="value in candidates[id]" :key="value" :value="value">{{ value }}</option></select></div>
        </template>
        <template v-else><div class="upe-row-head"><span class="upe-id">{{ id }}</span><span class="upe-missing">参数不存在</span><button class="upe-link danger" type="button" @click="unbind(id)">解绑</button></div></template>
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
@media (max-width: 520px) { .upe-row-head { align-items: flex-start; flex-direction: column; gap: 5px; }.upe-row-actions { padding-left: 0; }.upe-override { grid-template-columns: 1fr; gap: 4px; } }
</style>
