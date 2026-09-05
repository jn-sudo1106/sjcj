<script setup lang="ts">
// 流程中心（0828 W6）：流程列表 + 可编辑流程工作区。
//
// 「配置」不再作为独立的用户概念：节点自身承载配置，内部 configId 只作技术标识。
// **但「流程模板」保留**（0903 H24，已与后端沟通）——它是取消"源内切换流程"之后，
// 唯一保留的"流程从哪儿来"的入口。模板是流程的一个**属性**（标记在流程上），
// 不是另一类对象：模板与普通流程在同一个列表里用筛选区分，不再开第二个中心页。
// （`views/FlowTemplate/index.vue` 那个未被路由引用的死页面不会复活，见其文件头。）
//
// 这行注释此前写的是「配置中心/流程模板不再作为用户概念」，0903 会上推翻了后半句。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { flowCenterApi, type FlowRecord } from '@/api'
import { useUiStore } from '@/stores/ui'
import { makeBlankTemplateDefinition } from '@/utils/flow/flowTemplates'
import GlobalSourceSelect from '@/views/FlowCanvas/result/components/GlobalSourceSelect.vue'
import FlowDetailDrawer from './FlowDetailDrawer.vue'
import FlowSourcesDialog from './FlowSourcesDialog.vue'

const ui = useUiStore()

const flows = ref<FlowRecord[]>([])
const loading = ref(false)
const loadError = ref('')
const query = ref('')
// 排序在服务端。原来的「节点数最多」删了：节点数要解析 flowConf，而列表接口不返回它，
// 那个选项分页之后只能对当前页做局部排序，跨页看是乱的。改成后端排序白名单里真有的两项。
const sortBy = ref<'recent' | 'sourceCnt'>('recent')
// 范围：全部 / 仅模板 / 仅普通流程。**服务端过滤**（flowPaged.templateFlag，2026-09-04 实测生效）。
// 不要改成本地筛——分页之后本地只能筛当前这一页，跨页结果是错的（见下方"搜索、排序、翻页全在服务端"那段）。
const scope = ref<'all' | 'template' | 'normal'>('all')
const activeId = ref('')
/** 「使用源数」下钻弹窗的目标流程 */
const sourcesFlow = ref<FlowRecord | null>(null)
const applyFlow = ref<FlowRecord | null>(null)
const applySourceIds = ref<string[]>([])
/** 分批提交进度：「已关联 N / 总数」，只在分多批时展示 */
const applyProgress = ref('')
/** changeFlowBatch 单次上限 5000（见 endpoints.ts）。按 500 一批串行，留足余量也便于展示进度。 */
const BIND_BATCH_SIZE = 500
const applying = ref(false)

// 服务端分页：cs_flow 生产上已有 735 条（后端把存量配置整批灌进来了），一次拉全量不现实。
// 检索也在服务端（flowPaged.keywords），所以翻页和搜索是同一条路径，只是 page/keywords 不同。
const page = ref(1)
const size = ref(20)
const total = ref(0)
/** 请求序号：快速连点翻页时，作废先返回的旧响应，避免列表停在上一页的数据上 */
let loadSeq = 0
async function load() {
  const reqId = ++loadSeq
  loading.value = true
  loadError.value = ''
  try {
    const result = await flowCenterApi.paged({
      page: page.value,
      size: size.value,
      keywords: query.value.trim() || undefined,
      field: sortBy.value === 'sourceCnt' ? 'sourceCnt' : 'updateDt',
      order: 'desc',
      onlyTemplate: scope.value === 'all' ? undefined : scope.value === 'template',
    })
    if (loadSeq !== reqId) return
    flows.value = result.list
    total.value = result.total
    // 末页记录被删光时后端会回空列表，此时退回上一页，不要把用户晾在一张空表上
    if (!result.list.length && page.value > 1 && result.total > 0) {
      page.value = Math.min(page.value - 1, Math.max(1, Math.ceil(result.total / size.value)))
      await load()
    }
  } catch (e) {
    loadError.value = `流程列表加载失败：${(e as Error)?.message ?? String(e)}`
  } finally {
    loading.value = false
  }
}
/** 搜索/换页大小都要回到第 1 页，否则会停在一个新结果集里不存在的页码上 */
function search() {
  page.value = 1
  void load()
}
/** 清空：条件、排序、页码一起回到初始态，再查一次（与文件中心「清空」同义） */
function resetQuery() {
  query.value = ''
  sortBy.value = 'recent'
  page.value = 1
  void load()
}
onMounted(() => {
  void load()
  ui.registerAction('新建流程', () => { void createFlow() })
  ui.registerAction('从模板新建', () => { void createFromTemplate() })
})
onUnmounted(() => ui.clearActions())

/**
 * 搜索、排序、翻页**全在服务端**（flowPaged 的 keywords / field+order / page+limit）。
 * 本地不再做任何过滤或重排——分页之后本地排序只能排当前这一页，跨页看到的顺序是错的。
 *
 * 0828 §2.11 规则④的「按配置 ID 反查流程」**已经删掉**：那条依赖 definition.configs，而列表
 * 接口根本不返回 flowConf，本地永远筛不出结果，只会稳定地报「配置 #x 没有被任何流程引用」——
 * 一句必然为假的话比没有这个功能糟得多。要恢复得后端在 flowPaged 上支持按 configId 过滤。
 */
const rows = computed(() => flows.value)

/**
 * 工作区抽屉显示的流程**自己存一份**，不从 `flows` 里派生。
 * 分页之后列表随时会被整页换掉（新建/删除后自动重查、翻页、搜索），派生的话
 * 只要当前流程不在这一页就会变成 null，抽屉自己关掉——用户正编着流程，列表在背后
 * 刷新一下，编辑面板没了。activeId 仍保留，只用于表格行高亮。
 */
const activeFlow = ref<FlowRecord | null>(null)
function openFlow(t: FlowRecord) {
  activeFlow.value = t
  activeId.value = t.id
}
function closeFlow() {
  activeFlow.value = null
  activeId.value = ''
}

function replaceFlow(saved: FlowRecord) {
  // 本地先就位（抽屉/行内容立刻反映改动），再后台重查一次拿服务端的真实排序与总数
  flows.value = flows.value.some((item) => item.id === saved.id)
    ? flows.value.map((item) => (item.id === saved.id ? saved : item))
    : [saved, ...flows.value]
  activeFlow.value = saved
  activeId.value = saved.id
  void load()
}

/**
 * 标记 / 取消标记为流程模板（0903 H24）。
 *
 * 走既有的 `flow/saveFlow`——它**新增和修改是同一个端点，带 flowId 才是修改**，
 * 所以必须把当前流程的 id 与 definition 一起全量回传，漏了 id 会静默新建一条同名流程。
 * 列表行的 definition 是空流程（flowPaged 不返回 flowConf），所以先 detail(id) 取全量再存，
 * 否则标记一下就把画布清空了。
 */
async function toggleTemplate(t: FlowRecord) {
  const next = !t.isTemplate
  try {
    await ElMessageBox.confirm(
      next
        ? `将把流程「${t.name}」标记为模板。模板会出现在「从模板新建」与新建源的候选里，供其它流程复制。`
        : `将取消流程「${t.name}」的模板标记。已经从它复制出去的流程不受影响。`,
      next ? '标记为模板' : '取消模板标记',
      { confirmButtonText: '确定', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    const full = await flowCenterApi.detail(t.id)
    if (!full) throw new Error('流程详情读取失败，未做任何修改')
    const saved = await flowCenterApi.save({ id: full.id, name: full.name, definition: full.definition, isTemplate: next })
    replaceFlow(saved)
    ElMessage.success(next ? '已标记为模板' : '已取消模板标记')
  } catch (e) {
    ElMessage.error(`${next ? '标记' : '取消标记'}失败：${(e as Error)?.message ?? String(e)}`)
  }
}

/**
 * 从模板新建流程：走后端 `flow/copyFlow`，连 `cs_item_config` 步骤一起复制并重映射上下游，
 * `refFlowId` 自动回指模板。**不要自己拼 saveFlow**——那只会建出一条空流程。
 */
async function createFromTemplate() {
  let templates: FlowRecord[]
  try {
    templates = await flowCenterApi.templates()
  } catch (e) {
    ElMessage.error(`读取模板列表失败：${(e as Error)?.message ?? String(e)}`)
    return
  }
  if (!templates.length) {
    ElMessage.info('还没有流程被标记为模板。可以先在列表里对任一流程点「标记为模板」。')
    return
  }
  try {
    const { value } = await ElMessageBox.prompt(
      `将复制模板的全部节点与配置，生成一条新的普通流程（会记录它来自哪个模板）。可选模板：${templates.map((x) => `${x.name}(#${x.id})`).join('、')}`,
      '从模板新建',
      { inputValue: templates[0].id, inputPattern: /^\d+$/, inputErrorMessage: '请输入上面列出的模板 ID', confirmButtonText: '新建', cancelButtonText: '取消' },
    )
    const picked = templates.find((x) => x.id === String(value).trim())
    if (!picked) {
      ElMessage.error(`#${String(value).trim()} 不在模板列表里`)
      return
    }
    const newId = await flowCenterApi.copy(picked.id, `${picked.name}_copy`)
    const created = await flowCenterApi.detail(newId)
    if (created) replaceFlow(created)
    else void load()
    ElMessage.success(`已从模板「${picked.name}」新建流程 #${newId}`)
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error(`从模板新建失败：${(e as Error)?.message ?? String(e)}`)
  }
}

async function createFlow() {
  try {
    const { value } = await ElMessageBox.prompt('新流程会从空白画布开始，可在工作区直接添加节点并修改节点配置。', '新建流程', {
      inputValue: '未命名流程', inputPattern: /\S+/, inputErrorMessage: '请输入流程名称',
      confirmButtonText: '新建', cancelButtonText: '取消',
    })
    const created = await flowCenterApi.save({ name: value.trim(), definition: makeBlankTemplateDefinition() })
    replaceFlow(created)
    ElMessage.success('流程已新建')
  } catch {
    // 用户取消不提示。
  }
}

/**
 * 删除流程。后端是**逻辑删除**（is_delete=-1 + state=D），删完不在列表和有效流程里出现。
 * 二次确认里带上关联源数：真机上多数流程 sourceCnt=1，删掉之后那个源就没有流程归属了，
 * 得让人看见影响面再决定。删除不解绑源（后端只改 cs_flow），所以措辞不承诺"源会被清理"。
 */
async function removeFlow(flow: FlowRecord) {
  const bound = flow.sourceCnt
  const impact = bound ? `该流程当前关联 ${bound} 个源，删除后这些源将不再归属任何流程。` : ''
  try {
    await ElMessageBox.confirm(
      `确认删除流程「${flow.name}」（#${flow.id}）？${impact}`,
      '删除流程',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' },
    )
  } catch {
    return // 用户取消
  }
  try {
    const ack = await flowCenterApi.remove([flow.id])
    if (!ack.ok) throw new Error(ack.message || '删除失败')
    if (activeId.value === flow.id) closeFlow()
    ElMessage.success(`流程「${flow.name}」已删除`)
    void load()
  } catch (error) {
    ElMessage.error(`删除失败：${(error as Error)?.message ?? String(error)}`)
  }
}

function openApply(flow: FlowRecord) {
  applyFlow.value = flow
  applySourceIds.value = []
  applyProgress.value = ''
}

async function confirmApply() {
  const target = applyFlow.value
  if (!target || applying.value) return
  const ids = [...new Set(applySourceIds.value.filter(Boolean))]
  if (!ids.length) {
    ElMessage.warning('请先选择要关联的源')
    return
  }
  applying.value = true
  applyProgress.value = ''
  try {
    // ⚠️ 文案 2026-09-03 按后端答复重写，2026-09-04 改成多源版。上一版写的是「这只记录关联
    // 关系，不会改动该源现有的采集配置与步骤，也不会立即按此流程运行」——**那句已经是假话**：
    // 后端明确执行时按 FLOW_ID 反查后执行（「执行就按 flowID 去反选，去执行」），关联完就生效。
    // 配套口径见 0903 H01：一个流程一套配置，可关联多个源，这些源**共用**它——所以关联之后
    // 改这个流程的配置，会同时影响所有关联源。这是危险动作，必须在弹窗里说清楚。
    const batches = Math.ceil(ids.length / BIND_BATCH_SIZE)
    await ElMessageBox.confirm(
      `将把选中的 **${ids.length} 个源**关联到流程「${target.name}」。`
      + `这 ${ids.length} 个源将共用该流程的配置并按它运行；此后修改这个流程的配置，会同时影响它们。`
      + (batches > 1 ? `\n（将分 ${batches} 批提交，每批最多 ${BIND_BATCH_SIZE} 个）` : '')
      + '\n继续？',
      '关联流程到源',
      { type: 'warning', confirmButtonText: '确认关联', cancelButtonText: '取消' },
    )
    // 分批串行。**任一批失败就停下**并把已成功的条数如实报出来——继续发下去只会让
    // "到底关联成功了几个"更难说清。
    let done = 0
    for (let i = 0; i < ids.length; i += BIND_BATCH_SIZE) {
      const chunk = ids.slice(i, i + BIND_BATCH_SIZE)
      if (batches > 1) applyProgress.value = `已关联 ${done} / ${ids.length}`
      const ack = await flowCenterApi.bindSources(chunk, target.id)
      if (!ack.ok) {
        throw new Error(
          (ack.message || '关联失败')
          + (done ? `（前 ${done} 个已关联成功，本批 ${chunk.length} 个未生效）` : ''),
        )
      }
      done += chunk.length
    }
    applyFlow.value = null
    applySourceIds.value = []
    applyProgress.value = ''
    ElMessage.success(`已把 ${done} 个源关联到流程「${target.name}」`)
    void load()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(`关联失败：${(error as Error)?.message ?? String(error)}`)
  } finally {
    applying.value = false
  }
}
</script>

<template>
  <section class="fc-shell">
    <!-- 检索条对齐数据中心 / 文件中心（SiteFileView 的 .sfv-toolbar）：同一套控件尺寸（28px）、
         同一套 rc-btn，且同样是「填条件 → 点查询」而不是回车隐式触发。回车仍然可用，
         但不再是唯一入口——之前只写在 placeholder 里，用户看不见。 -->
    <div class="fc-toolbar">
      <input
        v-model="query"
        class="fc-input fc-input-wide"
        placeholder="流程名称 / 编码 / 描述 / 备注 / 标签"
        aria-label="搜索流程"
        data-testid="flow-center-search"
        @keyup.enter="search"
      />
      <select v-model="sortBy" class="fc-input" aria-label="排序" @change="search">
        <option value="recent">最近修改</option>
        <option value="sourceCnt">使用源数最多</option>
      </select>
      <!-- 范围过滤在服务端（flowPaged.templateFlag），不是本地筛 -->
      <select v-model="scope" class="fc-input" aria-label="范围" data-testid="flow-center-scope" @change="search">
        <option value="all">全部流程</option>
        <option value="template">仅模板</option>
        <option value="normal">仅普通流程</option>
      </select>
      <!-- 没有「刷新」按钮：它与「查询」是同一个请求，而且新建 / 保存 / 删除 / 关联之后
           列表都会自动重查（见 replaceFlow / removeFlow / confirmApply），不需要人工手动刷。 -->
      <button class="rc-btn primary" type="button" data-testid="flow-center-query" @click="search">查询</button>
      <button class="rc-btn" type="button" data-testid="flow-center-reset" @click="resetQuery">清空</button>
      <div class="fc-metrics">
        <span>流程 <b>{{ total }}</b></span>
      </div>
    </div>

    <div class="fc-table-wrap" v-loading="loading">
      <table class="fc-table">
        <thead>
          <tr>
            <th>流程 ID / 名称</th>
            <th style="width: 110px">使用源数</th>
            <th style="width: 150px">更新时间</th>
            <th style="width: 210px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="t in rows"
            :key="t.id"
            :class="{ active: t.id === activeId }"
            data-testid="flow-center-row"
            @click="openFlow(t)"
          >
            <td>
              <div class="fc-name">
                <b class="fc-name-link">{{ t.name }}</b>
                <!-- 角标而不是新开一列：这张表的列已经够挤了 -->
                <span v-if="t.isTemplate" class="fc-badge" data-testid="flow-template-badge" title="已标记为流程模板">模板</span>
                <span
                  v-else-if="t.fromTemplateId"
                  class="fc-badge ghost"
                  data-testid="flow-from-template"
                  :title="`由模板 #${t.fromTemplateId} 复制而来`"
                >来自 #{{ t.fromTemplateId }}</span>
                <small>{{ t.version == null ? t.id : `${t.id} · v${t.version}` }}</small>
              </div>
            </td>
            <!-- 使用源数：flowPaged / flowDetail 都回填计算列 sourceCnt（口径 cs_source.IS_DELETE >= 0，
                 含禁用源）。列表接口不返回 flowConf，所以节点数那列是 0，源数这列才是真的。 -->
            <td :class="{ 'fc-muted': !t.sourceCnt }" data-testid="flow-source-cnt">
              <button
                v-if="t.sourceCnt"
                class="fc-link"
                type="button"
                data-testid="flow-source-cnt-link"
                :title="`查看流程「${t.name}」的关联源`"
                @click.stop="sourcesFlow = t"
              >{{ t.sourceCnt }} 个</button>
              <!-- 0 个和字段缺失都不给点：点开必然是空表，白让人跑一趟 -->
              <template v-else>{{ t.sourceCnt == null ? '—' : '0 个' }}</template>
            </td>
            <td class="fc-muted">{{ t.updatedAt || '—' }}</td>
            <td>
              <div class="fc-actions">
                <button class="fc-link" type="button" @click.stop="openFlow(t)">编辑</button>
                <button class="fc-link" type="button" @click.stop="openApply(t)">关联到源</button>
                <button class="fc-link" type="button" data-testid="flow-toggle-template" @click.stop="toggleTemplate(t)">
                  {{ t.isTemplate ? '取消模板' : '标记为模板' }}
                </button>
                <button class="fc-link danger" type="button" data-testid="flow-delete" @click.stop="removeFlow(t)">删除流程</button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length">
            <td colspan="4" class="fc-empty">
              {{ loadError || (query ? `没有找到匹配「${query}」的流程` : '暂无流程') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 分页与数据中心（DataQueryPanel 的 .dqp-pager）同一套：同样的 el-pagination、
         同样的 layout / page-sizes / background+small，样式也照抄那边的容器。
         别换回手写的上一页/下一页按钮——全站其余列表（规则资产、采集资产各 tab、数据中心
         各弹窗）都是这个组件。 -->
    <div class="fc-pager" data-testid="flow-center-pager">
      <el-pagination
        data-testid="flow-center-pagination"
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[20, 40, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        small
        @current-change="load"
        @size-change="search"
      />
    </div>

    <FlowSourcesDialog :flow="sourcesFlow" @close="sourcesFlow = null" />

    <FlowDetailDrawer
      :flow="activeFlow"
      @close="closeFlow"
      @saved="replaceFlow"
      @apply="openApply"
    />

    <el-dialog
      :model-value="!!applyFlow"
      title="关联流程到源"
      width="520px"
      destroy-on-close
      @close="applyFlow = null"
    >
      <!-- 这行原来写「只登记关联关系，不改动源现有的采集配置与步骤」，与 0903 H1 答复相反，
           2026-09-04 一并改掉（同 confirmApply 里的确认文案）。 -->
      <p class="fc-apply-note">选择要关联的源，可多选。关联后这些源将<b>共用本流程的配置并按它运行</b>；此后修改这个流程的配置会同时影响它们。</p>
      <GlobalSourceSelect v-model="applySourceIds" multiple />
      <p v-if="applyProgress" class="fc-apply-note" data-testid="flow-apply-progress">{{ applyProgress }}</p>
      <template #footer>
        <button class="fc-dialog-btn" type="button" @click="applyFlow = null">取消</button>
        <button class="fc-dialog-btn primary" type="button" :disabled="applying" data-testid="flow-apply-confirm" @click="confirmApply">{{ applying ? '关联中…' : (applySourceIds.length > 1 ? `确认关联（${applySourceIds.length} 个）` : '确认关联') }}</button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.fc-badge { margin-left: 6px; padding: 0 6px; border-radius: 8px; font-size: 11px; line-height: 16px; background: var(--rc-primary-soft, #eaf2ff); color: var(--rc-primary, #2f6fed); }
.fc-badge.ghost { background: transparent; color: var(--rc-faint, #98a2b3); border: 1px solid var(--rc-border, #e4e7ec); }
.fc-shell { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
/* 以下三条与 SiteFileView 的 .sfv-toolbar / .sfv-input 保持同一组数值（28px 高、12px 字、
   6px 圆角、focus 蓝边 + 3px 光晕）。改动时请两边一起改，否则数据中心/文件中心/流程中心会走形。 */
.fc-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 12px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fff; }
.fc-input { height: 28px; min-width: 112px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text); font-size: 12px; outline: none; }
.fc-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.fc-input-wide { flex: 0 1 300px; }
.fc-toolbar .rc-btn { height: 28px; padding: 0 10px; font-size: 12px; }
.fc-metrics { margin-left: auto; display: flex; gap: 14px; color: var(--rc-muted); font-size: 12px; }
.fc-metrics b { color: var(--rc-text); }
.fc-btn { height: 28px; min-width: 28px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 12px; cursor: pointer; }
.fc-btn:hover:not(:disabled) { border-color: var(--rc-primary); color: var(--rc-primary-ink); }
.fc-btn:disabled { opacity: .5; cursor: not-allowed; }
.fc-search-note { padding: 7px 10px; border: 1px dashed #bfdbfe; border-radius: 7px; background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-size: 12px; }
.fc-table-wrap { border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fff; overflow: auto; }
.fc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.fc-table th { position: sticky; top: 0; z-index: 1; background: #f8fafc; color: var(--rc-text-2); font-weight: 700; text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--rc-border); }
.fc-table td { padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.fc-table tbody tr { cursor: pointer; }
.fc-table tbody tr:hover { background: var(--rc-primary-bg); }
.fc-table tbody tr.active { background: var(--rc-primary-bg); box-shadow: inset 2px 0 0 var(--rc-primary); }
.fc-name b { display: block; color: var(--rc-text); font-size: 13px; }
/* 名称是这一列的可点主体（整行点开工作区），按链接给蓝色 */
.fc-name b.fc-name-link { color: var(--rc-primary); }
.fc-name small { color: var(--rc-faint); font-size: 11px; font-variant-numeric: tabular-nums; }
.fc-muted { color: var(--rc-faint); }
.fc-link { border: 0; background: transparent; color: var(--rc-primary); font-size: 12px; cursor: pointer; padding: 0; }
.fc-link.danger { color: #dc2626; }
.fc-pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--rc-border-soft); }
.fc-actions { display: flex; align-items: center; gap: 12px; white-space: nowrap; }
.fc-apply-note { margin: 0 0 12px; color: var(--rc-muted); font-size: 12px; line-height: 1.6; }
.fc-dialog-btn { height: 32px; padding: 0 14px; border: 1px solid var(--rc-border); border-radius: 7px; background: #fff; color: var(--rc-text-2); cursor: pointer; }
.fc-dialog-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.fc-dialog-btn:disabled { opacity: .55; cursor: not-allowed; }
.fc-empty { padding: 44px; text-align: center; color: var(--rc-faint); }
</style>
