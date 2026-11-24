<script setup lang="ts">
// 新建采集闸门原型：单页填写网站 + 首批源，创建后进入画布配流程。
// 1123 A1：流程模板在表单里选（默认上次用过的模板），提交前就能看到节点数与写入表，
// 「预览 / 更换」打开带节点图和表配置的模板选择弹窗；仍可选「暂不配置流程」。
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { siteApi, type Site, type Source } from '@/api'
import { NO_FLOW_TEMPLATE, availableFlowTemplates, lastFlowTemplateId, pickFlowTemplate, rememberFlowTemplate } from '@/utils/flow/createFromTemplate'
import FlowChoiceSummary from '@/views/FlowCanvas/shared/FlowChoiceSummary.vue'
import { createSharedFlow, addSourcesToBizDirNote } from '@/utils/source/createCollect'
import { useUiStore } from '@/stores/ui'
import { firstSourceId } from '@/utils/url/workspaceRoute'
import { urlOrPlaceholder } from '@/utils/source/placeholderUrl'
import CategoryTreePicker, { type CategorySelection } from '@/views/FlowCanvas/source/CategoryTreePicker.vue'
import { BIZ_DIR_ROOT_ID } from '@/api/sourceDirs'

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
/** 已选流程模板；NO_FLOW_TEMPLATE = 暂不配置流程。null = 模板还没读到 */
const templateId = ref<string | null>(null)
const templateError = ref('')

async function loadDefaultTemplate() {
  try {
    const templates = await availableFlowTemplates()
    const last = lastFlowTemplateId()
    templateId.value = templates.find(t => t.id === last)?.id ?? templates[0]?.id ?? NO_FLOW_TEMPLATE
    templateError.value = ''
  } catch (error) {
    templateId.value = NO_FLOW_TEMPLATE
    templateError.value = `流程模板读取失败：${(error as Error)?.message ?? String(error)}，可点「预览 / 更换」重试`
  }
}

async function changeTemplate() {
  try {
    templateId.value = await pickFlowTemplate({ allowNone: true, initialId: templateId.value ?? undefined })
    templateError.value = ''
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error((error as Error)?.message ?? String(error))
  }
}

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
    // 0904 I15（Z8）：后端 url 必填，空了会报错。**不在前端加必填**（那是把后端的毛病
    // 转嫁给用户），空的时候补一个一眼认得出的占位值；后端去掉必填后连同 helper 一起删。
    url: urlOrPlaceholder(r.url, r.sourceId),
    configId: '',
    mainTable: '',
    owner: site.owner || 'admin',
    state: 'C',
    // 分类只选业务目录（10-22）：业务目录走分类—源关系表，源的系统目录 categoryId 不指向它，留空
    dirId: '',
  }))
  const siteForCreate: Site = { ...site, sourceCount: sources.length, errorCount: 0 }
  if (templateId.value === null) {
    ElMessage.warning('流程模板还在读取，请稍候')
    return
  }
  const chosenTemplate = templateId.value
  creating.value = true
  try {
    // 允许「暂不配置流程」：只建网站和源，进画布后在流程标签栏「＋」再建
    if (chosenTemplate !== NO_FLOW_TEMPLATE) rememberFlowTemplate(chosenTemplate)
    const res = await siteApi.siteCreate(siteForCreate, sources)
    if (!res?.ok) {
      ElMessage.warning(res?.message || '创建失败，请重试')
      return
    }
    const sourceId = res.sourceId || firstSourceId(sources)
    const withFlow = chosenTemplate !== NO_FLOW_TEMPLATE
    const flowNote = withFlow ? (await createSharedFlow(siteForCreate.name.trim(), res.sourceIds ?? [], chosenTemplate)).note : ''
    const dirNote = await addSourcesToBizDirNote(site, res.sourceIds ?? [])
    if (flowNote || dirNote) ElMessage.warning([flowNote, dirNote].filter(Boolean).join('；'))
    else if (withFlow) ElMessage.success(`网站「${siteForCreate.name}」已创建（${sources.length} 个源，共用流程「${siteForCreate.name.trim()}」），已进入首个源的流程视图`)
    else ElMessage.success(`网站「${siteForCreate.name}」已创建（${sources.length} 个源，暂未建流程），可在流程标签栏点「＋」新建`)
    await router.replace({ path: '/canvas', query: { ...(res.siteId ? { siteId: res.siteId } : {}), sourceId, view: 'flow' } })
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(`创建失败：${(error as Error).message ?? '网络异常'}，请勿重复提交；如已返回网站 ID，请先回查网站后再继续`)
  } finally {
    creating.value = false
  }
}

onMounted(() => {
  ui.clearActions()
  void loadDefaultTemplate()
})
</script>

<template>
  <div class="rc-gate">
    <div class="rc-gate-card">
      <div class="rc-gate-title">新建采集 · 网站基础信息</div>
      <div class="rc-gate-hint">网站用于归属与管理；源（语言 / 变体）才是真正的采集实体。这一页填完即可创建，流程按下方模板建好，节点配置进画布后再调。</div>
      <div class="rc-field">
        <label>网站名称</label>
        <input class="rc-input" v-model="gateSite.name" placeholder="必填" />
      </div>
      <div class="rc-field">
        <label>分类</label>
        <CategoryTreePicker v-model="gateCategory" :root-id="BIZ_DIR_ROOT_ID" />
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

      <div class="rc-field" data-testid="gate-flow">
        <label>采集流程（这批源共用一条，按模板新建）</label>
        <FlowChoiceSummary v-if="templateId !== null" :flow-id="templateId" prefix="按模板">
          <template #actions>
            <button class="rc-btn sm" type="button" data-testid="gate-flow-change" @click="changeTemplate">预览 / 更换</button>
          </template>
        </FlowChoiceSummary>
        <div v-else class="rc-gate-hint">正在读取流程模板…</div>
        <button v-if="templateId === NO_FLOW_TEMPLATE" class="rc-btn sm rc-gate-flow-pick" type="button" data-testid="gate-flow-pick" @click="changeTemplate">选择流程模板</button>
        <div v-if="templateError" class="rc-gate-error">{{ templateError }}</div>
      </div>

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
.rc-gate-card { width: min(640px, 100%); background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); padding: 20px 22px; }
.rc-gate-title { font-size: 15px; font-weight: 800; color: var(--rc-text); margin-bottom: 6px; }
.rc-gate-hint { font-size: 11px; color: var(--rc-muted); line-height: 1.6; margin-bottom: 14px; }
.rc-gate-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--rc-border-soft); }
.rc-gate-rows-title { font-size: 11px; font-weight: 700; color: var(--rc-muted); margin: 14px 0 8px; }
.rc-btn.sm { height: 26px; padding: 0 9px; font-size: 12px; }
.rc-gate-flow-pick { margin-top: 6px; }
.rc-gate-error { margin-top: 4px; color: var(--rc-error); font-size: 11px; }
.rc-gate-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; margin-bottom: 8px; align-items: center; }
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input, .rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-input:focus, .rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
</style>
