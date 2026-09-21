<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, Search } from '@element-plus/icons-vue'
import { useFlowStore } from '@/stores/flow'
import { useUiStore } from '@/stores/ui'
import { flowCenterApi, type FlowRecord } from '@/api'
import { normalizeSourceView, sourceViewFromHash, type SourceWorkspaceView } from '@/utils/url/workspaceRoute'
import { toExternalHref } from '@/utils/url/externalUrl'
import { useFlowAutosave } from '@/views/FlowCanvas/canvas/useFlowAutosave'

const flow = useFlowStore()
const ui = useUiStore()
const { status: saveStatus, savedClock, lastError: saveError, flush: retryFlowSave } = useFlowAutosave()
const route = useRoute()
const router = useRouter()

const src = computed(() => flow.sourceCtx)
const view = ref<SourceWorkspaceView>(normalizeSourceView(route.query.view))
function syncView() {
  view.value = sourceViewFromHash(window.location.hash)
}
watch(() => route.query.view, (next) => {
  view.value = normalizeSourceView(next)
}, { immediate: true })
onMounted(() => window.addEventListener('hashchange', syncView))
onBeforeUnmount(() => window.removeEventListener('hashchange', syncView))

const templates = ref<FlowRecord[]>([])
const flowKeyword = ref('')
const flowPickerOpen = ref(false)
/**
 * 候选**只列已标记为模板的流程**（0903 Y8-24，2026-09-05 落地）。
 *
 * 这个下拉叫「切换流程模板」，之前却把 740 条流程全列出来——用户当场提出
 * 「这里的切换流程模板要展示为模板类型的流程，非模板类型不展示」。
 *
 * 原来做不了是因为 `FlowRecord` 上没有模板标记、后端也没答复能不能按它过滤（0903 H7）。
 * **两个前提都已解除**：H7 答复标记是 `templateFlag`(0/1) 且 `flowPaged` 支持服务端过滤，
 * `FlowRecord.isTemplate` 也已接上（acb2c4e）。这里改走 `flowCenterApi.templates()`
 * （后端专给的 `flowTemplateList`，不分页）。
 *
 * **仍然不做前端筛**：那条老口径没变——存量 740 条分页之后前端只能筛当前页，跨页是错的。
 */
async function loadTemplates() {
  templates.value = await flowCenterApi.templates()
}
onMounted(() => { void loadTemplates() })

const visibleTemplates = computed(() => {
  const keyword = flowKeyword.value.trim().toLowerCase()
  const matched = keyword
    ? templates.value.filter((template) => template.name.toLowerCase().includes(keyword) || template.id.toLowerCase().includes(keyword))
    : templates.value
  return matched.slice(0, 10)
})
function openFlowPicker() {
  flowPickerOpen.value = true
}
function closeFlowPicker() {
  window.setTimeout(() => { flowPickerOpen.value = false }, 150)
}
function pickFlow(templateId: string) {
  flowKeyword.value = ''
  flowPickerOpen.value = false
  void onSwitchFlow(templateId)
}
function manageFlows() {
  flowKeyword.value = ''
  flowPickerOpen.value = false
  void onSwitchFlow('__manage_flows__')
}

// 顶部下拉 = **切换流程模板**（0903 H02）。
//
// 语义是「选一个模板 → 把模板里的那套配置复制出一套新的给当前源」，不是"让本源引用这个流程"。
// 0903 会上原话：「这里面东西应该选流程模板，然后你再切换……不是切换那个源里面那种」。
// 一度打算把这个下拉整个删掉（0903 设计方案初稿），后被推翻——要删的是"在已存在的源里换一个
// 流程引用"这个动作，不是这个入口本身。
const appliedTemplateLabel = computed(() => {
  const templateId = src.value?.templateId
  if (!templateId) return '切换流程模板'
  const template = templates.value.find((item) => item.id === templateId)
  if (!template) return '切换流程模板'
  // 真实 cs_flow 没有版本号（见 FlowRecord.version 注释），拿不到就只显示流程名，不要 `vundefined`
  const version = src.value?.templateVersion ?? template.version
  return version == null ? template.name : `${template.name} · v${version}`
})

const statusMeta = computed(() => {
  const s = src.value
  if (!s) return { cls: 'muted', text: '' }
  if (s.disabled) return { cls: 'muted', text: '已停用' }
  if (s.state === 'C') return { cls: 'ok', text: '成功' }
  if (s.state === 'E') return { cls: 'err', text: '出错' }
  if (s.state === 'L') return { cls: 'run', text: '运行中' }
  return { cls: 'muted', text: '未知' }
})
// 摘要头只展示运行所需信息；源 ID、分类和标签不在此处暴露。
// 参数源（0721 会议 T5）：只读摘要——普通源的 url 换成"参数源 · 模板 · N 个参数占位符"；
// 具体每个参数的真实取值数需要逐个查详情，摘要头不为此额外发请求，只读 paramRefs 数量。
const primaryMeta = computed(() => {
  const s = src.value
  if (!s) return ''
  return s.kind === 'param' ? `参数源 · ${s.urlTemplate || s.baseUrl || ''} · ${s.paramRefs?.length ?? 0} 个参数占位符` : s.url
})
// 「上次成功」单独拆出来，别再跟 URL 拼成一个字符串：公众号那类 URL 有 200+ 字符
// （`mp.weixin.qq.com/s?__biz=…&chksm=…&scene=…`），拼在一起会把时间和后面的「所属流程」
// 一起挤到换行甚至看不见（2026-09-17 走查）。拆开后 URL 单行省略，这两项始终可见。
const lastSuccessText = computed(() => (src.value?.lastSuccessAt ? `上次成功 ${src.value.lastSuccessAt}` : ''))

/**
 * 摘要行里的 URL 可点开（2026-09-17 用户提）：看到地址就想去原站核对一下，
 * 之前只能选中复制再贴到地址栏。
 *
 * 参数源的摘要是「参数源 · 模板 · N 个占位符」，不是个能打开的地址，不给链接。
 * 其余交给 toExternalHref 把关（只放行 http/https）。
 */
const openableUrl = computed(() => (src.value && src.value.kind !== 'param' ? toExternalHref(src.value.url) : ''))

// 所属流程：源上带 flowId（sourceDetail 已补，0903 §H8），流程名要单查一次 flow/detail；
// 查不到就退化成 `#<id>`。切源时按 flowId 变化重查，回来慢了也不会写串。
const owningFlowName = ref('')
/**
 * 「这个 flowId 是悬空的」——流程被删了，源还挂着它（0917 R1，方案 §21）。
 *
 * **只认 `detail()` 返回 null 这一种情况**：那个函数的语义是查不到返回 `null`、
 * 网络 / HTTP 错误抛异常（`api/index.ts:2866`）。catch 里一律不标记，
 * 否则断网时整屏的源都写着「流程已删除」，比不标更糟。
 */
const owningFlowMissing = ref(false)
watch(() => src.value?.flowId, async (fid) => {
  owningFlowName.value = ''
  owningFlowMissing.value = false
  if (!fid) return
  const want = String(fid)
  try {
    const rec = await flowCenterApi.detail(want)
    if (String(src.value?.flowId ?? '') !== want) return
    owningFlowName.value = rec?.name ?? ''
    owningFlowMissing.value = rec === null
  } catch { /* 保留 ID 展示，不标记已删除 */ }
}, { immediate: true })
const owningFlowLabel = computed(() => {
  const fid = src.value?.flowId
  if (!fid) return ''
  if (owningFlowName.value) return owningFlowName.value
  return owningFlowMissing.value ? `#${fid}（流程已删除）` : `#${fid}`
})
const owningFlowTitle = computed(() => (owningFlowMissing.value
  ? '这个流程已经被删除，源上的流程 ID 成了悬空引用'
  : '在流程中心查看这个流程'))

/**
 * 去流程中心时带上「回来的路」（0917-09）。
 *
 * `/flows` 是主导航页，不挂源页签条（`SourceTabsBar.vue:31` 只认 `/collect` 和 `/canvas`），
 * 所以离开画布之后没有任何入口能回到刚才那个源——会上原话「你别让他忙了半天回不去了」。
 * 流程中心读到 `from=canvas` 就渲染一条返回条。
 *
 * `view` 要原样带走：这个头是常驻的，从数据视图点出去的人，回来也该落在数据视图。
 * `fromName` 一起带上，返回条要显示源名，而流程中心手上只有 ID——传过去就不用再查一次源详情。
 */
function flowCenterQuery(extra: Record<string, string> = {}): Record<string, string> {
  const s = src.value
  const siteId = s?.siteId || String(route.query.siteId ?? '')
  const q: Record<string, string> = { from: 'canvas', view: view.value, ...extra }
  if (s?.sourceId) q.sourceId = String(s.sourceId)
  if (siteId) q.siteId = siteId
  if (s?.name) q.fromName = s.name
  return q
}
function openOwningFlow() {
  const fid = src.value?.flowId
  // 已删除的流程点过去只会在流程中心搜出一个空列表，看着像搜索坏了——按钮已 disabled，这里再挡一道
  if (!fid || owningFlowMissing.value) return
  router.push({ path: '/flows', query: flowCenterQuery({ q: owningFlowName.value || String(fid) }) })
}
/**
 * 返回源视图（0828 W5-6/7 合并）。
 *
 * 原来是「返回列表」→ `/collect`（网站列表）。会上明确不要回网站列表：
 * 「你这个返回不要返回到网站」「我点个返回的源列表」。
 * 落点是**当前源所属网站**的源视图（单网站），不是全网站。
 * 这也把原计划里单独加一个「源视图」入口按钮那条合并掉了：一个返回按钮就够，不再多摆一个。
 *
 * 归属网站按既有优先级取：源上下文 > URL。游离源（无网站归属，见 0824-11 §1.2c-3）
 * 没有可回的源视图，退回网站列表。
 */
function backToSourceView() {
  const siteId = src.value?.siteId || String(route.query.siteId ?? '')
  if (siteId) router.push({ path: '/canvas', query: { siteId, view: 'source' } })
  else router.push('/collect')
}
// 0917：监控视图页签改为**常驻**，跟流程/数据/文件/任务四档一样，选中的是不是数据监控节点都显示。
// 之前按 `isMonitorNode(flow.selectedNode)` 显隐，还配了一条"选中非监控节点就弹回流程视图"的兜底；
// 产品口径是这五个视图平级——点任意节点都能停在监控视图上（非同类型节点时面板内给提示，见 MonitorConfigView）。
function switchView(target: SourceWorkspaceView) {
  if (view.value === target) {
    if (target === 'data') ui.applyViewLayoutDefault('data')
    return
  }
  const query = { ...route.query }
  // 五档都显式写进 URL，包括流程视图。原来流程视图是删掉 query.view 走缺省值，
  // 2026-09-18 缺省视图改成数据视图（见 normalizeSourceView）之后，这条等于把
  // 「切到流程视图」翻译成「切到数据视图」，页签点了没反应。
  query.view = target
  void router.replace({ path: '/canvas', query })
}

// 发起抓取（0714 会议 Task 4）：唯一的完整执行入口——本组件只派发动作，
// 校验/请求/驱动运行态统一收在 index.vue（走 ui 动作总线，避免在 FlowBoard/ResultView/TaskView/FileView
// 四处宿主组件里各自转发一遍事件）。
function srcSnatch() {
  ui.fireAction('发起抓取')
}

async function onSwitchFlow(command: string) {
  if (!command) return
  if (command === '__manage_flows__') {
    // 与「所属流程」同一条离开路径，同样要能回来（0917-09）
    void router.push({ path: '/flows', query: flowCenterQuery() })
    return
  }
  const template = templates.value.find((item) => item.id === command)
  if (!template || !src.value) return
  // 确认弹窗**恒弹**（0903 Y0-3）：原来只在 flow.dirty 时弹，等于"画布干净时静默替换全部节点"——
  // 这个动作会为本源新建一整套配置，任何情况下都该让人先看一眼再点。
  const nodeCount = flow.main.filter((id: string) => flow.configs[id]).length
  try {
    await ElMessageBox.confirm(
      [
        `将复制模板「${template.name}」的配置，生成属于本源的一套新配置。`,
        nodeCount ? `当前 ${nodeCount} 个节点会被替换。` : '',
        flow.dirty ? '当前画布有未保存改动，将一并丢弃。' : '',
        '此操作不影响该模板和其它源。',
      ].filter(Boolean).join(''),
      '切换流程模板',
      { type: 'warning', confirmButtonText: '复制并替换', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  const result = flow.applyTemplate(template)
  if (!result) return
  // 真实 cs_flow 没有版本号（见 FlowRecord.version 注释），拿不到就只说流程名，不要 `vundefined`
  const versionText = template.version == null ? '' : ` v${template.version}`
  ElMessage.success(`已复制模板「${template.name}」${versionText}${result.cleared ? `，原 ${result.cleared} 个节点已替换` : ''}`)
}

</script>

<template>
  <div v-if="src" class="rc-canvas-head">
    <button class="rc-btn ghost" type="button" @click="backToSourceView">← 返回源视图</button>
    <div class="ch-switcher">
      <button class="ch-seg" :class="{ on: view === 'flow' }" type="button" @click="switchView('flow')">流程视图</button>
      <button class="ch-seg" :class="{ on: view === 'data' }" type="button" @click="switchView('data')">数据视图</button>
      <!-- ⚠️ 「文件视图 / 任务视图」**保留**。2026-09-05 一度按 0904 I11 把这两档删掉，是**读反了**：
           产品原话「文件和任务我觉得暂时吧，因为数据视图里面是包着文件的」——"暂时吧"是
           **暂时留着**，不是暂时去掉（当时开发问的是"这块不要了"，产品没有顺着答"对"）。
           删掉后用户当场提出「不是，任务视图和文件视图呢」，已还原。0904 纪要 I11 同步订正。 -->
      <button class="ch-seg" :class="{ on: view === 'file' }" type="button" @click="switchView('file')">文件视图</button>
      <button class="ch-seg" :class="{ on: view === 'task' }" type="button" @click="switchView('task')">任务视图</button>
      <!-- 监控视图（0917 常驻）：原来按 `v-if=isMonitorNode(选中节点)` 显隐，选中普通规则节点就整档消失，
           视觉上像"页签跑到别处去了"。现在跟前面四档一样常驻，节点类型只影响面板内容。
           0917 更名：「监控配置」→「监控视图」——这一档跟流程/数据/文件/任务平级，叫"配置"会被当成
           某个节点的配置面板入口；档内实际展示的告警面板才叫配置。 -->
      <button
        class="ch-seg"
        :class="{ on: view === 'monitor-config' }"
        type="button"
        data-testid="monitor-config-view"
        @click="switchView('monitor-config')"
      >监控视图</button>
    </div>

    <template v-if="src">
      <div class="ch-titlewrap">
        <div class="ch-title">
          {{ src.name }}
          <span class="rc-status" :class="statusMeta.cls">{{ statusMeta.text }}</span>
          <span v-if="src.externalChanged" class="rc-status warn">外部变更待确认</span>
        </div>
        <div class="ch-sub">
          <!-- 用 el-tooltip 不用原生 title：URL 单行省略后，全文只能靠悬浮看，
               而原生提示要等约 1 秒才出、长 URL 还会被拉成横穿屏幕的一条（见 tokens.css）。 -->
          <el-tooltip
            v-if="primaryMeta"
            :content="primaryMeta"
            placement="bottom-start"
            :show-after="120"
            popper-class="rc-tip-longtext"
          >
            <a
              v-if="openableUrl"
              class="ch-sub-url ch-sub-link"
              :href="openableUrl"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="source-url-link"
            >{{ primaryMeta }}</a>
            <span v-else class="ch-sub-url">{{ primaryMeta }}</span>
          </el-tooltip>
          <span v-else class="ch-sub-url"></span>
          <template v-if="lastSuccessText">
            <span class="ch-sub-sep">·</span>
            <span class="ch-sub-fixed">{{ lastSuccessText }}</span>
          </template>
          <template v-if="src.flowId">
            <span class="ch-sub-sep">·</span>
            <button
              class="ch-flow-link"
              type="button"
              data-testid="owning-flow"
              :disabled="owningFlowMissing"
              :title="owningFlowTitle"
              @click="openOwningFlow"
            >所属流程：{{ owningFlowLabel }}</button>
          </template>
        </div>
      </div>
      <div v-if="view === 'flow'" class="ch-actions">
        <div class="ch-flow-picker">
          <div class="ch-flow-searchbox" :class="{ open: flowPickerOpen }">
            <el-icon class="ch-flow-search-icon"><Search /></el-icon>
            <input
              v-model="flowKeyword"
              class="ch-flow-search"
              data-testid="flow-switch-search"
              :placeholder="appliedTemplateLabel"
              :title="appliedTemplateLabel"
              aria-label="搜索并切换流程模板"
              @focus="openFlowPicker"
              @mousedown="openFlowPicker"
              @blur="closeFlowPicker"
            />
            <el-icon class="ch-flow-chevron"><ArrowDown /></el-icon>
          </div>
          <div v-if="flowPickerOpen" class="ch-flow-options" data-testid="flow-switch-options">
            <!-- 区分两种空：一个模板都没有 vs 搜索没搜到。前者要告诉用户去哪儿标记，
                 后者只是关键词不匹配——都说「没有匹配的流程模板」会让人以为是搜错了。 -->
            <div v-if="!templates.length" class="ch-flow-empty" data-testid="flow-picker-empty">
              还没有流程被标记为模板。可在流程中心对任一流程点「标记为模板」。
            </div>
            <div v-else-if="!visibleTemplates.length" class="ch-flow-empty">没有匹配的流程模板</div>
            <button
              v-for="template in visibleTemplates"
              :key="template.id"
              type="button"
              class="ch-flow-option"
              :class="{ active: template.id === src.templateId }"
              data-testid="flow-switch-option"
              @mousedown.prevent="pickFlow(template.id)"
            >
              <span class="ch-flow-option-name">{{ template.name }}</span>
              <span v-if="template.version != null" class="ch-flow-option-version">v{{ template.version }}</span>
            </button>
            <div v-if="!flowKeyword.trim() && templates.length > 10" class="ch-flow-limit">默认展示前 10 个，输入名称或 ID 搜索</div>
            <button type="button" class="ch-flow-manage" @mousedown.prevent="manageFlows">管理流程…</button>
          </div>
        </div>
        <!-- 0828 W9-2/D06：步骤接口已通，拓扑/进入条件防抖自动保存；不再放手动保存按钮。 -->
        <span class="ch-save-status" data-testid="flow-save-status">
          <span v-if="saveStatus === 'pending'" class="ch-save-pending">请先保存节点配置</span>
          <template v-else-if="saveStatus === 'saving'">保存中…</template>
          <template v-else-if="saveStatus === 'saved'">已保存 {{ savedClock }}</template>
          <!-- title 带上真实报错（0903）：原来失败只显示这六个字，排查时连是哪一步抛的都不知道 -->
          <button
            v-else-if="saveStatus === 'error'"
            class="ch-save-retry"
            type="button"
            data-testid="flow-save-retry"
            :title="saveError ? `保存失败：${saveError}（点击重试）` : '点击重试'"
            @click="void retryFlowSave()"
          >保存失败，点击重试</button>
        </span>
      </div>
      <!-- 「停用」0828 D24 移除：源启停统一在源视图的行操作里做，画布头只留运行入口。
           这里不做成禁用或隐藏——按钮整个删掉，避免同一能力两个入口。 -->
      <!-- 分支流程的只读提示（0903 YB-A/YB-3，YB-B 后改文案）：画布已经能还原分支结构，
           但**分支的挂接关系还不支持在画布上调整**——自动保存对分支流程冻结 lastStep 回写
           （见 useStepWrite），拖动节点不会写回。不说这句话，用户会以为拖了就生效。 -->
      <div v-if="view === 'flow' && flow.hasBranchedSteps" class="ch-branch-note" data-testid="flow-branch-flattened">
        <span aria-hidden="true">⚠</span>
        该流程含分支。分支的挂接关系暂不支持在画布上调整——拖动节点不会写回后端，节点名称与进入条件照常保存。
      </div>
      <div v-if="view === 'flow'" class="ch-canvas-actions" aria-label="源运行操作">
        <button class="rc-btn primary" type="button" @click="srcSnatch">发起抓取</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rc-canvas-head { position: relative; z-index: 20; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; flex-wrap: wrap; }
.ch-switcher { display: inline-flex; padding: 2px; background: #f1f5f9; border: 1px solid var(--rc-border); border-radius: 7px; }
.ch-seg { height: 26px; padding: 0 12px; border: 0; background: transparent; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 5px; }
.ch-seg.on { background: var(--rc-primary); color: #fff; }
.ch-seg:hover:not(.on) { color: var(--rc-primary-ink); }
.ch-seg:disabled { color: var(--rc-faint); cursor: not-allowed; }
.ch-titlewrap { min-width: 0; }
.ch-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; color: var(--rc-text); font-size: 13px; }
/* 一行放下：URL 可压缩省略，时间和「所属流程」不参与压缩（flex: none），
   这样再长的 URL 也挤不掉它们。 */
.ch-sub { display: flex; align-items: center; min-width: 0; color: var(--rc-faint); font-size: 10px; margin-top: 1px; }
.ch-sub-url { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 默认呈现为蓝色链接（2026-09-21 用户反馈） */
.ch-sub-link { color: var(--rc-primary); text-decoration: none; }
.ch-sub-link:hover { color: var(--rc-primary); text-decoration: underline; }
.ch-sub-fixed { flex: none; }
.ch-sub-sep { flex: none; margin: 0 4px; }
/* flex: none + nowrap：默认的 0 1 auto 会让它跟着被压缩，长 URL 下它会被挤到 52px 宽、
   「所属流程：振江集团-603507」折成三行，把整条摘要撑高（2026-09-17 走查）。压缩只由 URL 段承担。 */
/* 下划线是**常态**，不是 hover 才有（2026-09-20 走查）：这一行是 10px 的灰字（.ch-sub），
   同行的 URL 还是 color: inherit，只有这一处带色——但产品仍然没认出它能点。
   字号不动：URL 段要靠 flex 压缩省略，动字号会牵动整行排版。 */
.ch-flow-link { flex: none; white-space: nowrap; border: 0; background: transparent; padding: 0; color: var(--rc-primary); font-size: inherit; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.ch-flow-link:hover { text-decoration-thickness: 2px; }
/* 流程已删除：跳过去只会搜出空列表，不给点 */
.ch-flow-link:disabled { color: var(--rc-faint); cursor: not-allowed; text-decoration: none; }
.ch-actions { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
.ch-actions .rc-btn { height: 30px; padding: 0 11px; font-size: 12px; }
.ch-flow-picker { position: relative; width: 184px; margin-right: 4px; }
.ch-flow-searchbox { display: flex; align-items: center; gap: 6px; box-sizing: border-box; height: 30px; padding: 0 8px; border: 1px solid #dbe3ee; border-radius: 7px; background: #f8fafc; color: var(--rc-faint); transition: border-color .15s, box-shadow .15s, background .15s; }
.ch-flow-searchbox:focus-within { border-color: #60a5fa; background: #fff; box-shadow: 0 0 0 3px #dbeafe; }
.ch-flow-search-icon, .ch-flow-chevron { flex: none; font-size: 13px; }
.ch-flow-search { min-width: 0; flex: 1; height: 28px; padding: 0; border: 0; background: transparent; color: var(--rc-text); font-size: 12px; outline: none; text-overflow: ellipsis; }
.ch-flow-search::placeholder { color: var(--rc-muted); opacity: 1; }
.ch-flow-chevron { transition: transform .15s; }
.ch-flow-searchbox.open .ch-flow-chevron { transform: rotate(180deg); }
.ch-flow-options { position: absolute; z-index: 12; top: 34px; right: 0; width: 300px; overflow: hidden; border: 1px solid #dbe3ee; border-radius: 8px; background: #fff; box-shadow: 0 14px 32px -12px rgba(15, 23, 42, 0.28); }
.ch-flow-option { display: flex; align-items: center; gap: 8px; width: 100%; height: 34px; padding: 0 10px; border: 0; border-bottom: 1px solid var(--rc-border-soft); background: #fff; color: var(--rc-text-2); font-size: 12px; text-align: left; cursor: pointer; }
.ch-flow-option:hover, .ch-flow-option.active { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.ch-flow-option-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.ch-flow-option-version { flex: none; color: var(--rc-faint); font-family: var(--rc-mono, monospace); font-size: 10px; }
.ch-flow-empty, .ch-flow-limit { padding: 9px 10px; color: var(--rc-faint); font-size: 11px; text-align: center; }
.ch-flow-limit { border-bottom: 1px solid var(--rc-border-soft); }
.ch-flow-manage { width: 100%; height: 32px; padding: 0 10px; border: 0; background: #fff; color: var(--rc-primary); font-size: 12px; text-align: left; cursor: pointer; }
.ch-flow-manage:hover { background: var(--rc-primary-bg); }
.ch-branch-note { display: flex; align-items: center; gap: 6px; width: 100%; margin-top: 6px; padding: 6px 9px; border: 1px solid #fde68a; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: 11.5px; }
.ch-save-status { color: var(--rc-faint); font-size: 12px; min-height: 18px; min-width: 4em; }
.ch-save-pending { color: var(--rc-warn); }
.ch-save-retry { border: 0; background: transparent; color: #b91c1c; font-size: 12px; cursor: pointer; padding: 0; }
.ch-save-retry:hover { text-decoration: underline; }
.ch-canvas-actions { position: absolute; z-index: 4; right: 32px; top: calc(100% + 18px); display: flex; gap: 6px; }
.ch-canvas-actions .rc-btn { height: 30px; padding: 0 11px; font-size: 12px; }
.rc-btn.ghost { height: 28px; padding: 0 10px; font-size: 12px; border-color: var(--rc-border); background: transparent; color: var(--rc-text-2); }
.rc-btn.ghost:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.danger { border-color: #fecaca; color: #b91c1c; background: #fff; }
.rc-btn.danger:hover { border-color: #f87171; background: #fef2f2; }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
</style>
