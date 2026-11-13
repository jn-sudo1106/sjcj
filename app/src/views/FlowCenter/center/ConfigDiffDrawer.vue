<script setup lang="ts">
// 流程中心「配置差异」抽屉（1109 原型 #frame4 / 方案 §5 C11）。
//
// 只做只读对比：基准实例 vs 对比实例。数据来自 fetchInstanceDiff(baseId, compareId)，
// 形状见 api/types/flowCenterCenter.ts 的 ConfigDiffResult：
//   · base / compare 身份卡：名称 + 覆盖源数；
//   · sections：后端给什么分组就画什么分组——标题含「步骤」的按表格列（步骤 / 项 / 基准 / 对比），
//     其余按「改 · 项：基准 → 对比」列表（原型里全局配置只列变化项，相同项折叠）；
//   · schedules：实例自身没有调度，这里单列「使用源的调度」只读表（源 / 任务 / 时间）。
//
// 两个容易踩的点：
//   1. 切实例时旧请求可能后回来。这里用自增 seq 标记每次加载，响应回来时 seq 已变就整包丢弃，
//      不会出现「切到 B 后闪回 A 的结果」；关闭抽屉 / 卸载时也把 seq 推进一步，让在途请求失效。
//   2. visible 关闭时清空已加载结果（下次打开重新拉，避免展示上一次的旧差异），但不动父组件的 props。
//
// 视觉按项目设计系统（app/src/design/tokens.css 的 rc-* 类 + Element Plus）：容器用 rc-card，
// 差异表用 rc-data-table，状态用 rc-status，标签用 el-tag；局部间距/列宽写在 scoped 的 .cdd-* 里，
// 颜色只取 var(--rc-*) 与 Element 变量。对外契约仍是 visible prop + @close（测试与父页面依赖），
// el-drawer 只认 v-model，所以中间用一个 computed 桥接。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Close } from '@element-plus/icons-vue'
import { fetchInstanceDiff } from '@/api/flowCenterCenter'
import type { ConfigDiffItem, ConfigDiffResult, ConfigDiffSection } from '@/api/types/flowCenterCenter'

const props = defineProps<{ visible: boolean; baseId: string; compareId: string }>()
const emit = defineEmits<{ close: []; 'open-instance': [id: string] }>()

const diff = ref<ConfigDiffResult | null>(null)
const loading = ref(false)
const error = ref('')
/** 请求代次：只有同代次的响应才允许写回，切实例 / 关闭时自增即可作废在途请求 */
let seq = 0

/** el-drawer 用 v-model；对外仍暴露 visible + close，二者在这里互转（关闭由父组件落 visible） */
const open = computed({
  get: () => props.visible,
  set: (value: boolean) => {
    if (!value) close()
  },
})

const globalSections = computed(() => (diff.value?.sections ?? []).filter((section) => !isStepSection(section)))
const stepSections = computed(() => (diff.value?.sections ?? []).filter((section) => isStepSection(section)))

/** 步骤级配置按节点分组；后端标题里带「步骤」就按表格画 */
function isStepSection(section: ConfigDiffSection) {
  return section.title.includes('步骤')
}

function isChanged(item: ConfigDiffItem) {
  return item.base !== item.compare
}

function changedCountOf(section: ConfigDiffSection) {
  return section.items.filter(isChanged).length
}

/** 全局配置列表只列变化项（原型「相同项已折叠」）；返回空数组时模板给一行「各项一致」 */
function changedItemsOf(section: ConfigDiffSection) {
  return section.items.filter(isChanged)
}

/** 「详情采集 · 请求头」拆成 步骤 / 项 两列；没有分隔符就整串当作项名 */
function splitLabel(label: string) {
  const at = label.indexOf(' · ')
  return at < 0 ? { step: '', item: label } : { step: label.slice(0, at), item: label.slice(at + 3) }
}

/** 步骤级表格保留相同项（原型里也有一行「同」），变化项高亮 */
function stepRowsOf(section: ConfigDiffSection) {
  return section.items.map((item) => ({ ...item, ...splitLabel(item.label), changed: isChanged(item) }))
}

function reasonOf(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

async function load() {
  const run = ++seq
  diff.value = null
  error.value = ''
  if (!props.baseId || !props.compareId) {
    loading.value = false
    error.value = '缺少基准或对比实例 ID，无法加载配置差异'
    return
  }
  loading.value = true
  try {
    const result = await fetchInstanceDiff(props.baseId, props.compareId)
    if (run !== seq) return
    diff.value = result
  } catch (e) {
    if (run !== seq) return
    error.value = `配置差异加载失败：${reasonOf(e)}`
    ElMessage.error(error.value)
  } finally {
    if (run === seq) loading.value = false
  }
}

/** 关闭时清空 loaded 状态：下次打开（visible 重新变 true）一定重新拉 */
function reset() {
  seq++
  diff.value = null
  loading.value = false
  error.value = ''
}

function close() {
  emit('close')
}

function openInstance() {
  emit('open-instance', props.baseId)
}

watch(
  () => [props.visible, props.baseId, props.compareId] as const,
  ([visible]) => {
    if (visible) void load()
    else reset()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  seq++
})
</script>

<template>
  <el-drawer
    v-model="open"
    direction="rtl"
    size="620px"
    :with-header="false"
    append-to-body
    title="配置差异"
    class="cdd-drawer"
    style="--el-drawer-padding-primary: 0"
  >
    <div class="cdd-body" data-testid="config-diff-drawer">
      <!-- 自绘标题栏：原型里标题 + 一句话口径说明 + 关闭按钮 -->
      <header class="cdd-head">
        <div class="cdd-head-main">
          <h3 class="cdd-title">配置差异</h3>
          <p class="cdd-sub">同一模板下的两个实例对比 · 只读，不修改模板与其他实例</p>
        </div>
        <el-button
          class="cdd-close"
          link
          :icon="Close"
          aria-label="关闭"
          data-testid="config-diff-close"
          @click="close"
        />
      </header>

      <div class="cdd-content">
        <div v-if="loading" class="cdd-loading" data-testid="config-diff-loading">
          <el-skeleton :rows="4" animated />
          <span class="cdd-loading-text">加载中…</span>
        </div>

        <el-alert
          v-else-if="error"
          class="cdd-error"
          type="error"
          :closable="false"
          show-icon
          data-testid="config-diff-error"
        >
          <p class="cdd-error-text">{{ error }}</p>
          <el-button size="small" data-testid="config-diff-retry" @click="load">重试</el-button>
        </el-alert>

        <template v-else-if="diff">
          <!-- 基准 / 对比身份卡：只读，对比对象由父组件决定 -->
          <div class="cdd-ident">
            <div class="cdd-ident-card rc-mini-card is-base" data-testid="config-diff-base">
              <div class="cdd-ident-head">
                <span class="rc-status run">基准</span>
                <span class="cdd-ident-id">#{{ diff.base.id }}</span>
              </div>
              <div class="cdd-ident-name">{{ diff.base.name }}</div>
              <div class="cdd-ident-meta">覆盖 {{ diff.baseSourceCount }} 个源</div>
            </div>
            <div class="cdd-ident-card rc-mini-card" data-testid="config-diff-compare">
              <div class="cdd-ident-head">
                <span class="rc-status muted">对比</span>
                <span class="cdd-ident-id">#{{ diff.compare.id }}</span>
              </div>
              <div class="cdd-ident-name">{{ diff.compare.name }}</div>
              <div class="cdd-ident-meta">覆盖 {{ diff.compareSourceCount }} 个源</div>
            </div>
          </div>

          <!-- 全局配置：只列变化项，与原型「相同项已折叠」一致 -->
          <section
            v-for="section in globalSections"
            :key="section.title"
            class="cdd-section rc-card"
            data-testid="config-diff-global"
          >
            <div class="rc-card-head cdd-sec-head">
              <div class="cdd-sec-head-main">
                <div class="rc-card-title">{{ section.title }}</div>
                <div class="rc-card-sub">只列与基准不同的项，相同项已折叠</div>
              </div>
              <span class="rc-status" :class="changedCountOf(section) ? 'warn' : 'muted'">
                {{ changedCountOf(section) }} 项差异
              </span>
            </div>
            <ul v-if="changedItemsOf(section).length" class="cdd-list">
              <li
                v-for="item in changedItemsOf(section)"
                :key="item.label"
                class="cdd-row chg"
                data-testid="config-diff-global-row"
              >
                <el-tag class="cd chg cdd-tag" type="warning" size="small" effect="plain">改</el-tag>
                <span class="cdd-row-label">{{ item.label }}</span>
                <span class="cdd-row-val">
                  <code class="cdd-code">{{ item.base }}</code>
                  <span class="cdd-arrow">→</span>
                  <code class="cdd-code is-next">{{ item.compare }}</code>
                </span>
              </li>
            </ul>
            <p v-else class="cdd-same">各项一致</p>
          </section>

          <!-- 步骤级配置：按节点列，变化项高亮，相同项保留一行「同」 -->
          <section
            v-for="section in stepSections"
            :key="section.title"
            class="cdd-section rc-card"
            data-testid="config-diff-step"
          >
            <div class="rc-card-head cdd-sec-head">
              <div class="cdd-sec-head-main">
                <div class="rc-card-title">{{ section.title }}</div>
                <div class="rc-card-sub">按节点列出，未列出的步骤配置相同</div>
              </div>
            </div>
            <div class="cdd-table-wrap">
              <table class="rc-data-table cdd-table">
                <thead>
                  <tr>
                    <th class="cdd-col-step">步骤</th>
                    <th class="cdd-col-item">项</th>
                    <th>基准</th>
                    <th>对比</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in stepRowsOf(section)"
                    :key="row.label"
                    :class="{ chg: row.changed }"
                    data-testid="config-diff-step-row"
                  >
                    <td class="cdd-cell-step">
                      <span v-if="row.step">{{ row.step }}</span>
                      <span v-else class="cdd-step-global">全局</span>
                    </td>
                    <td class="cdd-cell-item">
                      <span class="cdd-item-cell">
                        <el-tag
                          v-if="row.changed"
                          class="cd chg cdd-tag"
                          type="warning"
                          size="small"
                          effect="plain"
                        >改</el-tag>
                        <el-tag v-else class="cd same cdd-tag" type="info" size="small" effect="plain">同</el-tag>
                        <span class="cdd-item-name">{{ row.item }}</span>
                      </span>
                    </td>
                    <td><code class="cdd-code">{{ row.base }}</code></td>
                    <td :class="{ 'cd-diff': row.changed }"><code class="cdd-code">{{ row.compare }}</code></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- 实例自身没有调度：调度按源 / 任务读取，单独只读展示，不能当成实例配置 -->
          <section class="cdd-section rc-card" data-testid="config-diff-schedules">
            <div class="rc-card-head cdd-sec-head">
              <div class="cdd-sec-head-main">
                <div class="rc-card-title">使用源的调度</div>
                <div class="rc-card-sub">不属于实例配置 · 只读</div>
              </div>
              <span class="rc-status muted">{{ diff.schedules.length }} 条</span>
            </div>
            <div v-if="diff.schedules.length" class="cdd-table-wrap">
              <table class="rc-data-table cdd-table">
                <thead>
                  <tr>
                    <th class="cdd-col-source">源</th>
                    <th class="cdd-col-task">任务</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in diff.schedules" :key="`${row.sourceName}-${row.taskName}-${row.at}`">
                    <td>{{ row.sourceName }}</td>
                    <td>{{ row.taskName }}</td>
                    <td class="cdd-mono">{{ row.at }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="cdd-same">这些源还没有配置调度</p>
            <p class="cdd-note cdd-sched-note">调度按源执行，不属于实例配置；改实例配置不会统一改这些源的定时。</p>
          </section>

          <section class="cdd-why rc-mini-card">
            <h4 class="cdd-why-title">为什么不能直接改模板？</h4>
            <p class="cdd-why-copy">
              同模板下的不同实例互相独立，改一个不影响另一个；同一实例被多个源共用时，改该实例配置会影响这些源（基准实例「{{ diff.base.name }}」当前 {{ diff.baseSourceCount }} 个源）；模板本身不随实例修改而变，模板后续调整也不会静默改存量实例，须显式迁移。
            </p>
          </section>
        </template>

        <div v-else class="cdd-empty">暂无配置差异数据</div>
      </div>
    </div>

    <template #footer>
      <div class="cdd-foot rc-actions">
        <span class="cdd-foot-hint">{{ diff ? `差异 ${diff.changedCount} 项 · 相同项已折叠` : '只读对比' }}</span>
        <el-button data-testid="config-diff-footer-close" @click="close">关闭</el-button>
        <el-button type="primary" :disabled="!diff" data-testid="config-diff-open" @click="openInstance">
          在画布中打开该实例编辑
        </el-button>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
/* 抽屉骨架：抽屉自身 padding 归零（style 覆盖 --el-drawer-padding-primary），
   标题栏 sticky 在滚动容器（.el-drawer__body）顶部，正文与页脚各自留白。 */
.cdd-body { display: flex; flex-direction: column; min-height: 100%; font-size: 12px; }

.cdd-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px 12px;
  border-bottom: 1px solid var(--rc-border-soft);
  background: var(--rc-surface);
}
.cdd-head-main { min-width: 0; }
.cdd-title { margin: 0; color: var(--rc-text); font-size: 14px; font-weight: 700; line-height: 1.35; }
.cdd-sub { margin: 4px 0 0; color: var(--rc-muted); font-size: 12px; line-height: 1.5; }
.cdd-close { flex: none; margin-top: 2px; color: var(--rc-muted); }

.cdd-content { display: flex; flex-direction: column; gap: 14px; padding: 16px 20px 20px; }

.cdd-loading { display: flex; flex-direction: column; gap: 8px; }
.cdd-loading-text { color: var(--rc-faint); font-size: 12px; }

.cdd-error-text { margin: 0 0 10px; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.cdd-empty { padding: 40px 12px; color: var(--rc-faint); font-size: 12px; text-align: center; }
.cdd-same { margin: 0; padding: 14px; color: var(--rc-faint); font-size: 12px; }
.cdd-note { margin: 8px 0 0; color: var(--rc-muted); font-size: 12px; line-height: 1.6; }
.cdd-sched-note { padding: 0 14px 12px; }

/* 基准 / 对比身份卡 */
.cdd-ident { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.cdd-ident-card { display: flex; flex-direction: column; gap: 5px; margin: 0; padding: 12px 14px; }
.cdd-ident-card.is-base { border-color: var(--el-color-primary-light-7); background: var(--rc-primary-bg); }
.cdd-ident-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cdd-ident-id { color: var(--rc-faint); font-size: 12px; }
.cdd-ident-name { color: var(--rc-text); font-size: 13px; font-weight: 700; line-height: 1.4; overflow-wrap: anywhere; }
.cdd-ident-meta { color: var(--rc-muted); font-size: 12px; }

/* 分区卡片 */
.cdd-section { margin: 0; }
.cdd-sec-head { min-height: 0; padding: 10px 14px; }
.cdd-sec-head-main { min-width: 0; }
.cdd-sec-head .rc-card-title { font-size: 13px; }

.cdd-list { display: flex; flex-direction: column; margin: 0; padding: 4px 14px 8px; list-style: none; }
.cdd-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 7px 0;
  border-bottom: 1px dashed var(--rc-border-soft);
}
.cdd-row:last-child { border-bottom: 0; }
.cdd-row-label { flex: none; color: var(--rc-text-2); font-size: 12px; }
.cdd-row-val { display: inline-flex; align-items: baseline; flex-wrap: wrap; gap: 6px; min-width: 0; }
.cdd-arrow { color: var(--rc-faint); font-size: 12px; }

.cdd-tag { flex: none; }
.cdd-code {
  padding: 2px 7px;
  border: 1px solid var(--rc-border-soft);
  border-radius: 4px;
  background: var(--rc-bg);
  color: var(--rc-text-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.cdd-code.is-next { border-color: var(--el-color-warning-light-5); background: var(--rc-warn-bg); color: var(--rc-warn); }

/* 差异表：长值允许换行，变化行底色 + 对比值加深 */
.cdd-table-wrap { overflow-x: auto; }
.cdd-table { font-size: 12px; }
.cdd-table th { height: 36px; padding: 0 12px; }
.cdd-table td { height: 40px; padding: 6px 12px; white-space: normal; word-break: break-word; vertical-align: middle; }
.cdd-table tbody tr td { transition: background-color 0.15s ease; }
.cdd-table tr.chg td { background: var(--rc-warn-bg); }
.cdd-table tr.chg td.cd-diff code { border-color: var(--el-color-warning-light-5); background: var(--el-color-warning-light-9); color: var(--rc-warn); font-weight: 700; }
/* 「项」列：td 保持 table-cell（flex 会破坏列宽/对齐），内部用 inline-flex 固定「标签 + 6px + 文字」 */
.cdd-item-cell { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.cdd-item-name { min-width: 0; }
/* 「步骤」列：没有具体步骤的差异不显示破折号，直接写「全局」 */
.cdd-cell-step { text-align: left; }
.cdd-step-global { color: var(--rc-muted); }
.cdd-col-step { width: 110px; }
.cdd-col-item { width: 128px; }
.cdd-col-source { width: 170px; }
.cdd-col-task { width: 118px; }
.cdd-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--rc-text-2); }

/* 「为什么不能直接改模板」说明块 */
.cdd-why { margin: 0; padding: 12px 14px; }
.cdd-why-title { margin: 0 0 6px; color: var(--rc-text-2); font-size: 13px; font-weight: 700; }
.cdd-why-copy { margin: 0; color: var(--rc-muted); font-size: 12px; line-height: 1.65; }

/* 页脚 */
.cdd-foot { display: flex; align-items: center; gap: 10px; padding: 12px 20px; }
.cdd-foot-hint { margin-right: auto; color: var(--rc-muted); font-size: 12px; }
</style>