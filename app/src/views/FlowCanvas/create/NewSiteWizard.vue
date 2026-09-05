<script setup lang="ts">
// 新建采集闸门原型：单页填写网站 + 首批源，创建后进入画布配流程。
// 不做分步向导，节点配置仍然进画布再做。
//
// 0903 Y8-C（H03）**订正**了原来那句"也不在这一页选择流程、模板"：这一页现在可以选一个
// **流程模板**，创建完把模板的节点与配置复制出一套给这批新源。原注释按当时"模板不再是
// 用户概念"的口径写的，0903 会上推翻了。
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { flowCenterApi, siteApi, type FlowRecord, type Site, type Source } from '@/api'
import { useUiStore } from '@/stores/ui'
import { firstSourceId } from '@/utils/url/workspaceRoute'
import CategoryTreePicker, { type CategorySelection } from '@/views/FlowCanvas/source/CategoryTreePicker.vue'

const router = useRouter()
const ui = useUiStore()

function suggestId(prefix: string): string {
  return `${prefix}${Math.floor(100000 + Math.random() * 900000)}`
}

function blankSiteDraft(): Site {
  return {
    siteId: suggestId('site-'),
    name: '',
    category: '',
    categoryPath: '',
    owner: 'admin',
    sourceCount: 0,
    errorCount: 0,
    tags: [],
  }
}

interface GateChildRow { sourceId: string; name: string; url: string }
function blankRow(): GateChildRow {
  return { sourceId: suggestId('src-'), name: '', url: '' }
}

const gateSite = ref(blankSiteDraft())
const gateRows = ref<GateChildRow[]>([blankRow()])
const firstSourceNameTouched = ref(false)
const creating = ref(false)

const gateCategory = computed<CategorySelection>({
  get: () => ({ dirId: gateSite.value.dirId, category: gateSite.value.category, categoryPath: gateSite.value.categoryPath ?? '' }),
  set: (v) => {
    gateSite.value.dirId = v.dirId
    gateSite.value.category = v.category
    gateSite.value.categoryPath = v.categoryPath
  },
})

watch(() => gateSite.value.name, (name) => {
  if (!firstSourceNameTouched.value && gateRows.value[0]) gateRows.value[0].name = name
}, { flush: 'sync' })

function addGateRow() {
  gateRows.value.push(blankRow())
}

function removeGateRow(i: number) {
  if (gateRows.value.length > 1) gateRows.value.splice(i, 1)
}

// ---- 流程模板（Y8-C / H03）----
// 候选**默认只列已标记为模板的流程**；想用普通流程当蓝本时切到"全部流程"。
const templateId = ref('')
const templateScope = ref<'template' | 'all'>('template')
const templateOptions = ref<FlowRecord[]>([])
const templatesLoading = ref(false)
async function loadTemplateOptions() {
  templatesLoading.value = true
  try {
    templateOptions.value = templateScope.value === 'template'
      ? await flowCenterApi.templates()
      : (await flowCenterApi.paged({ page: 1, size: 200 })).list
  } catch (error) {
    templateOptions.value = []
    ElMessage.warning(`流程候选加载失败：${(error as Error)?.message ?? String(error)}，可先不选，进画布后再配`)
  } finally {
    templatesLoading.value = false
  }
}
watch(templateScope, () => {
  templateId.value = ''
  void loadTemplateOptions()
})
const pickedTemplate = computed(() => templateOptions.value.find((f) => f.id === templateId.value) ?? null)

function onCancelGate() {
  void router.push('/collect')
}

async function onCreateAndEnter() {
  if (creating.value) return
  const site = gateSite.value
  if (!site.name || !site.category) {
    ElMessage.warning('请完整填写网站名称 / 分类')
    return
  }
  const rows = gateRows.value.filter((r) => r.name.trim())
  if (!rows.length) {
    ElMessage.warning('请至少填写一个源名称')
    return
  }
  const sources: Source[] = rows.map((r) => ({
    sourceId: r.sourceId,
    name: r.name,
    url: r.url,
    configId: '',
    mainTable: '',
    owner: site.owner || 'admin',
    state: 'C',
    dirId: site.dirId,
  }))
  const siteForCreate: Site = { ...site, sourceCount: sources.length, errorCount: 0 }
  creating.value = true
  try {
    const res = await siteApi.siteCreate(siteForCreate, sources)
    if (!res?.ok) {
      ElMessage.warning(res?.message || '创建失败，请重试')
      return
    }
    const sourceId = res.sourceId || firstSourceId(sources)
    await applyTemplateToNewSources(sources, sourceId)
    ElMessage.success(`网站「${siteForCreate.name}」已创建（${sources.length} 个源），已进入首个源的流程视图`)
    await router.replace({ path: '/canvas', query: { ...(res.siteId ? { siteId: res.siteId } : {}), sourceId, view: 'flow' } })
  } catch (error) {
    ElMessage.error(`创建失败：${(error as Error).message ?? '网络异常'}，请勿重复提交；如已返回网站 ID，请先回查网站后再继续`)
  } finally {
    creating.value = false
  }
}

/**
 * 把选中的模板复制成**一套新的流程**，并把这批新源关联上去（Y8-C / H03）。
 *
 * H03 澄清「新增配置」= 把模板中的配置**复制出一套**，不是凭空建空配置，也不是引用模板——
 * 所以走 `copyFlow`（连 cs_item_config 步骤一起复制并重映射，refFlowId 自动回指模板），
 * 而不是 `saveFlow` 拼一个空流程。
 *
 * ⚠️ 一处计划里没写死、这里做的选择：Y8-20 原文说走 `copyTemplateSteps(模板, 目标流程)`，
 * 但那条要求**目标流程已存在**；新建出来的源还没有任何流程。所以这里先 `copyFlow` 造出
 * 目标流程，再把这批源整体绑上去——**N 个源共用这一条流程**，正是 0903 H01 的口径
 * （一个流程一套配置，可关联多个源）。要"每个源各自一套配置"得另开需求。
 *
 * 失败不阻断建站：网站和源已经建好了，模板没套上只是少了一步，进画布还能手工配。
 */
async function applyTemplateToNewSources(sources: Source[], firstId: string) {
  const template = pickedTemplate.value
  if (!template) return
  const ids = sources.map((s) => s.sourceId).filter(Boolean)
  const targetIds = ids.length ? ids : (firstId ? [firstId] : [])
  if (!targetIds.length) return
  try {
    const newFlowId = await flowCenterApi.copy(template.id, `${gateSite.value.name}-流程`)
    const bound = await flowCenterApi.bindSources(targetIds, newFlowId)
    if (!bound.ok) {
      ElMessage.warning(`已按模板「${template.name}」复制出流程 #${newFlowId}，但未能关联到新源（${bound.message || '原因未知'}），可在流程中心手动关联`)
      return
    }
    ElMessage.success(`已按模板「${template.name}」复制出流程 #${newFlowId}，并关联 ${targetIds.length} 个新源`)
  } catch (error) {
    ElMessage.warning(`网站与源已创建，但套用模板「${template.name}」失败：${(error as Error)?.message ?? String(error)}。可进画布手工配置`)
  }
}

onMounted(() => {
  ui.clearActions()
  void loadTemplateOptions()
})
</script>

<template>
  <div class="rc-gate">
    <div class="rc-gate-card">
      <div class="rc-gate-title">新建采集 · 网站基础信息</div>
      <div class="rc-gate-hint">网站用于归属与管理；源（语言 / 变体）才是真正的采集实体。这一页填完即可创建，流程配置进画布后再做。</div>
      <div class="rc-field">
        <label>网站名称</label>
        <input class="rc-input" v-model="gateSite.name" placeholder="必填" />
      </div>
      <div class="rc-field">
        <label>分类</label>
        <CategoryTreePicker v-model="gateCategory" />
      </div>

      <div class="rc-field">
        <label>流程模板<span class="rc-gate-optional">（可选）</span></label>
        <div class="rc-gate-template">
          <select v-model="templateId" class="rc-input" data-testid="new-site-template" :disabled="templatesLoading">
            <option value="">不使用（空白画布）</option>
            <option v-for="f in templateOptions" :key="f.id" :value="f.id">{{ f.name }}（#{{ f.id }}）</option>
          </select>
          <!-- 默认只列已标记为模板的流程；想拿普通流程当蓝本再切「全部流程」（设计 §2.3.3） -->
          <select v-model="templateScope" class="rc-input rc-gate-template-scope" data-testid="new-site-template-scope">
            <option value="template">仅模板</option>
            <option value="all">查看全部流程</option>
          </select>
        </div>
        <!-- H03 澄清：「新增配置」= 把模板里那套配置**复制出一套新的**，不是引用模板 -->
        <div class="rc-gate-template-note" data-testid="new-site-template-note">
          <template v-if="templatesLoading">流程候选加载中…</template>
          <template v-else-if="pickedTemplate">
            将复制模板「{{ pickedTemplate.name }}」的节点，并把<b>模板里的那套配置复制出一套新的</b>给本批源。
            修改新配置不会影响模板和其它源。
          </template>
          <template v-else-if="!templateOptions.length && templateScope === 'template'">
            还没有流程被标记为模板（可在流程中心标记）。不选则从空白画布开始。
          </template>
          <template v-else>不选则从空白画布开始，进画布后再逐个配置节点。</template>
        </div>
      </div>

      <div class="rc-gate-rows-title">源清单（至少一个，语言 / 变体，创建后可继续增删）</div>
      <div v-for="(row, i) in gateRows" :key="row.sourceId" class="rc-gate-row">
        <input
          class="rc-input"
          v-model="row.name"
          placeholder="源名称，必填"
          @input="i === 0 && (firstSourceNameTouched = true)"
        />
        <input class="rc-input" v-model="row.url" placeholder="源 URL，选填" />
        <button class="rc-btn" type="button" :disabled="gateRows.length <= 1" @click="removeGateRow(i)">移除</button>
      </div>
      <button class="rc-btn" type="button" @click="addGateRow">＋ 添加源</button>

      <div class="rc-gate-actions">
        <button class="rc-btn" type="button" @click="onCancelGate">取消</button>
        <button class="rc-btn primary" type="button" :disabled="creating" @click="onCreateAndEnter">
          {{ creating ? '创建中…' : '创建并进入编排' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rc-gate { display: flex; justify-content: center; padding: 24px 16px 40px; }
.rc-gate-optional { color: var(--rc-faint); font-weight: 400; }
.rc-gate-template { display: flex; gap: 8px; }
.rc-gate-template-scope { flex: none; width: 130px; }
.rc-gate-template-note { margin-top: 4px; color: var(--rc-faint); font-size: 11px; line-height: 1.6; }
.rc-gate-card { width: min(640px, 100%); background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); padding: 20px 22px; }
.rc-gate-title { font-size: 15px; font-weight: 800; color: var(--rc-text); margin-bottom: 6px; }
.rc-gate-hint { font-size: 11px; color: var(--rc-muted); line-height: 1.6; margin-bottom: 14px; }
.rc-gate-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--rc-border-soft); }
.rc-gate-rows-title { font-size: 11px; font-weight: 700; color: var(--rc-muted); margin: 14px 0 8px; }
.rc-gate-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; margin-bottom: 8px; align-items: center; }
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input, .rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-input:focus, .rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
</style>
