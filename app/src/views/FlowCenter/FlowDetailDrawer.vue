<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { configApi, flowCenterApi, type FlowDefinition, type FlowRecord, type Source } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { rootStepForSource } from '@/views/FlowCanvas/canvas/flowModel'
import FlowBoard from '@/views/FlowCanvas/canvas/FlowBoard.vue'
import NodeInspector from '@/views/FlowCanvas/inspector/NodeInspector.vue'

// categories 由列表页透传（那边已经拉过一次 sourceCategories，抽屉不再重复请求）
const props = withDefaults(defineProps<{ flow: FlowRecord | null; categories?: { id: string; name: string }[] }>(), {
  categories: () => [],
})
const emit = defineEmits<{
  close: []
  saved: [flow: FlowRecord]
  apply: [flow: FlowRecord]
}>()

const canvas = useFlowStore()
const name = ref('')
const saving = ref(false)

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function definitionFromCanvas(): FlowDefinition {
  return {
    main: [...canvas.main],
    branches: clone(canvas.branches),
    configs: clone(canvas.configs),
    branchGroups: clone(canvas.branchGroups),
  }
}

function loadIntoWorkspace(flow: FlowRecord) {
  name.value = flow.name
  canvas.clearSourceCtx()
  canvas.clearSiteCtx()
  canvas.load({
    id: flow.id,
    name: flow.name,
    // FlowDef.version 只是画布上的展示串；cs_flow 没有版本列，没有就用流程 ID 兜底，
    // 不要拼出 `flow-vundefined`（见 FlowRecord.version 注释）。
    version: flow.version == null ? `flow-${flow.id}` : `flow-v${flow.version}`,
    main: flow.definition.main,
    branches: flow.definition.branches,
    configs: flow.definition.configs,
    branchGroups: flow.definition.branchGroups,
    updatedAt: flow.updatedAt,
  })
  const firstNode = flow.definition.main.find((id) => id !== 'start' && id !== 'end' && flow.definition.configs[id])
  canvas.select(firstNode ?? '')
  canvas.markSaved()
}

/**
 * flowConf 为空时，按这个流程**自己的配置**（cs_config，configId=flowId）把画布还原出来。
 *
 * 背景：生产上 735 条流程是后端从 cs_config 整批灌进来的，flowConf 全是 null——但它们不是
 * 空流程，真实结构在 cs_config/cs_item_config 里（起点节点 1 个 + 真实子步骤 N 个）。直接
 * 显示空画布等于告诉用户"这流程没内容"，而且一旦有人点保存，就把空定义写进去了。
 *
 * 2026-09-02 后端上线 `nextConfigPaged?flowId=` 后联调验证过：这条查询恒不返回起点节点那
 * 一行——不是接口没做全，是那一行天生不是 cs_item_config 的真实记录，是接口拿"当前查的
 * 这个源自己的 configId"现算拼出来的（换个源查，name/url 全变，configId/mainConfig 却一直
 * 相同）。既然 flowId=configId 对这批迁移数据是恒等式，起点节点该显示什么，直接问这个流程
 * 自己的 `config/configDetail` 就有了——而且比"随手挑一个关联源顶替"更准：以前挑出来的
 * 名字经常跟流程名对不上（比如 ins-adamgrant 流程挑到的某个关联源却叫 ins-Valuetainment），
 * 换成这条以后不再要求这个流程必须有至少一个关联源（原来 sourceCnt=0 的流程直接放弃还原）。
 *
 * `rootStepForSource(source)` 现成造一个"列表抓取"根节点，只要 `source.url`/`mainTable` 有值
 * 就行，本来是给"全新源、还没配步骤"场景用的兜底，这里直接复用，构造一个不对应任何真实源的
 * stub Source（`sourceId` 留空）。
 *
 * **不能指望 `buildSourceSeed` 自己的兜底分支触发**：那条分支只在 `steps.length === 0` 时才
 * 退回 `rootStepForSource`——对"这个流程没有任何真实子步骤"的流程管用，但大多数存量流程是
 * "有真实子步骤、缺的只是起点那一行"（flowId 模式天生不返回它），这种情况下 `steps` 非空，
 * `buildSourceSeed` 会直接跳过 stub 起点，整个起点节点凭空消失（2026-09-02 真机对比 zqrb
 * 流程 #1400832 的流程中心视图与它关联源的流程视图发现：后者靠 sourceId+svg 查询自带这一
 * 行，前者整个没有）。所以起点节点必须在这里手动拼进 `steps` 数组最前面，不能依赖那条兜底。
 *
 * **刻意在 loadFromSource 之后清掉源上下文**：画布一旦挂上 sourceCtx，节点编辑会走步骤自动
 * 保存（item/next/*）——这个 stub Source 连 sourceId 都是假的，更不能被当成真源写。
 */
/**
 * 抽屉里可编辑的流程属性（0904 I16/I17 · Z7-5）：分类 / 标签 / 描述。
 * 与名称一样随 flow 变化重置；**业务大类只读展示**——生产里 bizType 一个值都没有，
 * 枚举无从照抄（0904 Q3），不给选。
 */
const metaForm = reactive({ categoryId: '', tags: '', description: '' })
watch(() => props.flow?.id, () => {
  metaForm.categoryId = props.flow?.categoryId ?? ''
  metaForm.tags = props.flow?.flowTags ?? ''
  metaForm.description = props.flow?.description ?? ''
}, { immediate: true })
/** 标签统一成逗号串：中英文逗号、空格分隔都收，去重去空（与新建表单同一口径） */
function normalizeTags(raw: string): string {
  return [...new Set(raw.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean))].join(',')
}

const derivedFromConfig = ref(false)
async function deriveFromFlowConfig(flow: FlowRecord): Promise<boolean> {
  const [config, steps] = await Promise.all([
    configApi.configDetail(flow.id),
    flowCenterApi.steps(flow.id),
  ])
  const stubSource: Source = {
    sourceId: '',
    name: config?.name || flow.name,
    url: config?.url || '',
    configId: flow.id,
    mainTable: config?.entryTypeId || '',
    owner: '',
    state: 'C',
  }
  // 2026-09-04：`steps()` 改带 svg=true 后，后端会返回这个流程真实的根节点行（isRoot=1）。
  // 有真根就用真根——它带着正确的名字（= 配置名，旧平台拓扑图显示的就是这个）和真实
  // itemConfig；再合成一个假的只会把节点画成硬编码的「列表抓取 / 列表页」（stubSource 的
  // rootStepForSource 无条件这么命名），跟旧平台对不上。实测流程 1400979：旧平台显示
  // 「#41383 · 纽约市政府市长办公室新闻处_copy · 流程入口」，我们显示「列表抓取」。
  // 只有后端没给根节点行时才退回合成（旧数据 / 接口异常）。
  const rootStep = steps.some((step) => step.isRoot) ? null : rootStepForSource(stubSource)
  const seedSteps = rootStep ? [rootStep, ...steps] : steps
  canvas.loadFromSource(stubSource, seedSteps)
  // loadFromSource 把 FlowDef.id 设成了 source.sourceId（这里是空串，stub 源故意不担真源）——
  // 流程 ID 必须显式纠正回来，不然「流程 XML」导出（flowId 要用于导入导出）会把它显示成空。
  canvas.flowId = flow.id
  canvas.clearSourceCtx()
  canvas.clearSiteCtx()
  canvas.setFlowName(flow.name)
  name.value = flow.name
  canvas.markSaved()
  if (canvas.main.length <= 2) return false // 只有 start/end：配置和步骤都没给出任何真实节点
  derivedFromConfig.value = true
  return true
}

/**
 * 打开工作区必须**单独取一次详情**：列表走的是 flowPaged，它不返回 flowConf 这个大字段，
 * 行上的 definition 恒为空流程。直接拿列表行喂画布的话，任何已有流程点开都是一张空画布
 * ——保存下去还会把真实的 flowConf 覆盖成空。2026-09-02 联调实测撞到过。
 * loadSeq 防竞态：连着点两条流程时，先返回的那条不能盖住后点的。
 */
let loadSeq = 0
const loadingDetail = ref(false)
async function openFlowInWorkspace(flow: FlowRecord) {
  const reqId = ++loadSeq
  // 先用列表行把名字/头部铺上，画布等详情回来再填，避免闪一下旧流程的节点
  name.value = flow.name
  loadingDetail.value = true
  derivedFromConfig.value = false
  try {
    const full = await flowCenterApi.detail(flow.id)
    if (reqId !== loadSeq) return
    const record = full ?? flow
    // ⚠️ 判据是"有没有**真实节点**"，不是 main 非空（2026-09-04 修）。
    // `makeBlankTemplateDefinition()` 产出的 main 是 ['start','end']——结构上非空、实际一个节点
    // 都没有。按长度判会让**我们自己新建的流程永远走不到下面的还原分支**：saveFlow 在后端
    // 自动建了一条 isRoot=1 的真实根节点（旧平台新增流程同样如此，实测 1400987/1400988/1400989
    // 各恰好 1 条），而我们拿着这份空 flowConf 把它盖掉，画布显示 0 个节点，旧平台显示 1 个。
    const hasRealNode = record.definition.main.some((id) => id !== 'start' && id !== 'end')
      || (record.definition.branchGroups ?? []).some((g) => g.branches.some((b) => b.chain.length))
    if (hasRealNode) {
      loadIntoWorkspace(record)
      return
    }
    // 存量流程走这条：flowConf 空，但这个流程自己的 config/步骤有真实内容
    const derived = await deriveFromFlowConfig(record).catch(() => false)
    if (reqId !== loadSeq) return
    if (!derived) loadIntoWorkspace(record) // 配置和步骤都没给出内容，那就是一张真空白画布
  } catch (error) {
    if (reqId !== loadSeq) return
    // 取不到详情就不要拿空画布糊弄——那会让人以为流程是空的，一保存就真空了
    ElMessage.error(`流程详情加载失败：${(error as Error)?.message ?? String(error)}，请重新打开`)
    emit('close')
  } finally {
    if (reqId === loadSeq) loadingDetail.value = false
  }
}

watch(() => props.flow?.id, () => {
  if (props.flow) void openFlowInWorkspace(props.flow)
}, { immediate: true })

async function persistFlow(showMessage = true, isTemplate?: boolean): Promise<FlowRecord | null> {
  if (!props.flow || saving.value) return null
  const trimmed = name.value.trim()
  if (!trimmed) {
    ElMessage.warning('请输入流程名称')
    return null
  }
  saving.value = true
  try {
    const saved = await flowCenterApi.save({
      id: props.flow.id,
      name: trimmed,
      definition: definitionFromCanvas(),
      ...(isTemplate === undefined ? {} : { isTemplate }),
      // 这三项在抽屉里可编辑，保存时一并提交。空串是有意义的（= 清空），
      // 所以这里**不做"空就不传"**——与新建表单不同，那边空表示"没填过"。
      categoryId: metaForm.categoryId,
      flowTags: normalizeTags(metaForm.tags),
      description: metaForm.description.trim(),
    })
    name.value = saved.name
    canvas.markSaved()
    emit('saved', saved)
    if (showMessage) {
      ElMessage.success(saved.version == null ? '流程已保存' : `流程已保存为 v${saved.version}`)
    }
    return saved
  } catch (error) {
    ElMessage.error(`流程保存失败：${(error as Error)?.message ?? String(error)}`)
    return null
  } finally {
    saving.value = false
  }
}

/**
 * 标记 / 取消标记为模板（0903 H24）。抽屉里改走 persistFlow——它已经带着 flowId 与画布定义，
 * 顺手把标记一起提交即可；**不要另发一次只带 templateFlag 的 saveFlow**，那是全量保存端点，
 * 漏掉 definition 会把画布存空。
 */
const togglingTemplate = ref(false)
async function toggleTemplate() {
  if (!props.flow || togglingTemplate.value) return
  const next = !props.flow.isTemplate
  togglingTemplate.value = true
  try {
    const saved = await persistFlow(false, next)
    if (saved) ElMessage.success(next ? '已标记为模板' : '已取消模板标记')
  } finally {
    togglingTemplate.value = false
  }
}

async function applyToSource() {
  const saved = canvas.dirty || name.value.trim() !== props.flow?.name
    ? await persistFlow(false)
    : props.flow
  if (saved) emit('apply', saved)
}
</script>

<template>
  <aside v-if="flow" class="fd-drawer" aria-label="流程工作区">
    <header class="fd-head">
      <div class="fd-title">
        <span class="fd-kicker">流程工作区</span>
        <input v-model="name" class="fd-name" aria-label="流程名称" @input="canvas.setFlowName(name)" />
        <p>
          {{ flow.version == null ? flow.id : `${flow.id} · v${flow.version}` }} · 更新于 {{ flow.updatedAt || '—' }}
          <span v-if="flow.isTemplate" class="fd-badge" data-testid="flow-drawer-template-badge">模板</span>
          <span v-else-if="flow.fromTemplateId" class="fd-badge ghost">来自模板 #{{ flow.fromTemplateId }}</span>
        </p>
      </div>
      <button class="fd-close" type="button" title="关闭" @click="emit('close')">✕</button>
    </header>

    <!-- 流程属性（0904 I16/I17 · Z7-5）：分类 / 标签 / 描述可改，随「保存流程」一起提交。
         业务大类只读——生产里 bizType 一个值都没有，枚举无从照抄（0904 Q3）。 -->
    <div class="fd-meta">
      <label class="fd-meta-item">
        <span>分类</span>
        <select v-model="metaForm.categoryId" class="fd-meta-input" data-testid="flow-meta-category">
          <option value="">不设置</option>
          <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </label>
      <label class="fd-meta-item">
        <span>标签</span>
        <input v-model="metaForm.tags" class="fd-meta-input" data-testid="flow-meta-tags" placeholder="多个用逗号或空格分隔" />
      </label>
      <label class="fd-meta-item grow">
        <span>描述</span>
        <input v-model="metaForm.description" class="fd-meta-input" data-testid="flow-meta-desc" placeholder="选填" />
      </label>
      <span v-if="flow.bizType" class="fd-meta-ro" title="业务大类（只读）">大类 {{ flow.bizType }}</span>
      <span v-if="flow.createdAt" class="fd-meta-ro">创建于 {{ flow.createdAt }}</span>
    </div>

    <div v-if="loadingDetail" class="fd-loading" data-testid="flow-workspace-loading">正在加载流程定义…</div>
    <!-- 还原态必须说明白：画布上这些节点还没写进流程本身，是照这个流程自己的配置和步骤画的。
         不写这行的话，用户会以为流程里已经存着这份定义。 -->
    <div v-if="!loadingDetail && derivedFromConfig" class="fd-derived" data-testid="flow-derived-note">
      该流程尚未保存画布定义，以下节点按这个流程自己的配置（#{{ flow?.id }}）还原，点「保存流程」后才会写入流程。
    </div>
    <div v-if="!loadingDetail" class="fd-workspace">
      <section class="fd-canvas" aria-label="流程节点">
        <FlowBoard embedded />
      </section>
      <section class="fd-inspector" aria-label="节点设置">
        <NodeInspector hide-ai />
      </section>
    </div>

    <footer class="fd-foot">
      <!-- 这行原来写的是「关联到源只登记归属关系，不改动源现有的配置与步骤」，与 0903 H1 的
           答复相反（「执行就按 flowID 去反选，去执行」）：绑定即生效，关联过来的源会**共用**
           这个流程的配置。说的和做的相反比不说更糟，2026-09-04 改。 -->
      <span class="fd-foot-note">节点配置在右侧直接修改；关联到源后，这些源将共用本流程的配置——此后改这里会同时影响它们。</span>
      <button
        class="fd-secondary"
        type="button"
        :disabled="saving || togglingTemplate"
        data-testid="flow-drawer-toggle-template"
        @click="toggleTemplate"
      >{{ flow.isTemplate ? '取消模板' : '标记为模板' }}</button>
      <button class="fd-secondary" type="button" :disabled="saving" data-testid="flow-apply-to-source" @click="applyToSource">关联到源</button>
      <button class="fd-primary" type="button" :disabled="saving" data-testid="flow-save" @click="persistFlow()">{{ saving ? '保存中…' : '保存流程' }}</button>
    </footer>
  </aside>
</template>

<style scoped>
.fd-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 8px 16px; border-bottom: 1px solid var(--rc-border-soft); }
.fd-meta-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--rc-text-2); }
.fd-meta-item.grow { flex: 1; min-width: 180px; }
.fd-meta-input { height: 26px; padding: 0 8px; border: 1px solid var(--rc-border); border-radius: 5px; font-size: 12px; background: #fff; }
.fd-meta-item.grow .fd-meta-input { flex: 1; min-width: 0; }
.fd-meta-ro { color: var(--rc-faint); font-size: 12px; }
.fd-badge { margin-left: 6px; padding: 0 6px; border-radius: 8px; font-size: 11px; background: var(--rc-primary-soft, #eaf2ff); color: var(--rc-primary, #2f6fed); }
.fd-badge.ghost { background: transparent; color: var(--rc-faint); border: 1px solid var(--rc-border-soft); }
.fd-drawer { position: fixed; top: 56px; right: 0; bottom: 0; width: min(980px, calc(100vw - 256px)); max-width: 100vw; z-index: 40; display: flex; flex-direction: column; background: #fff; border-left: 1px solid var(--rc-border); box-shadow: -12px 0 32px -24px rgba(15, 23, 42, 0.48); }
.fd-head { display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--rc-border-soft); }
.fd-title { min-width: 0; }
.fd-kicker { display: block; color: var(--rc-muted); font-size: 11px; }
.fd-name { display: block; width: min(520px, 70vw); margin: 2px 0 3px; padding: 0; border: 0; outline: 0; background: transparent; color: var(--rc-text); font-size: 15px; font-weight: 700; }
.fd-name:focus { box-shadow: inset 0 -1px 0 var(--rc-primary); }
.fd-title p { margin: 0; color: var(--rc-faint); font-size: 11px; font-variant-numeric: tabular-nums; }
.fd-close { margin-left: auto; border: 0; background: transparent; color: var(--rc-faint); font-size: 14px; cursor: pointer; }
.fd-close:hover { color: var(--rc-text); }
.fd-derived { padding: 8px 16px; border-bottom: 1px solid #fde68a; background: #fffbeb; color: #92400e; font-size: 12px; line-height: 1.5; }
.fd-loading { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--rc-faint); font-size: 12px; background: #f4f7fb; }
.fd-workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(340px, 42%) minmax(420px, 1fr); gap: 10px; padding: 10px; background: #f4f7fb; }
.fd-canvas, .fd-inspector { min-width: 0; min-height: 0; }
.fd-foot { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--rc-border-soft); }
.fd-foot-note { flex: 1; color: var(--rc-faint); font-size: 11px; }
.fd-primary, .fd-secondary { height: 32px; padding: 0 14px; border-radius: 7px; font-size: 12px; font-weight: 600; cursor: pointer; }
.fd-primary { border: 1px solid var(--rc-primary); background: var(--rc-primary); color: #fff; }
.fd-secondary { border: 1px solid #bfdbfe; background: #fff; color: var(--rc-primary-ink); }
.fd-primary:disabled, .fd-secondary:disabled { opacity: .55; cursor: not-allowed; }
@media (max-width: 980px) {
  .fd-drawer { width: 100vw; }
  .fd-workspace { grid-template-columns: minmax(320px, 44%) minmax(360px, 1fr); overflow-x: auto; }
}
</style>
