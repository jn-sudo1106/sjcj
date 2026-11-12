<script setup lang="ts">
// URL生成静态[备] —— 1:1 迁移旧 data-view `src/page/install/UrlBuild3.vue`（旧路由 /install/url-build2）。
//
// 旧页面全貌（一行工具栏 + 一块结果 + N 块参数）：
//   名称 / URL / 变换部分 / [加][减] / 笛卡尔集开关 / [生成URL]
//   + [参数2 diff 1][参数1 diff 2][distinct 参数1] + 红字「结果数量:N」
//   结果文本域（10 行）；下方每 1/3 宽一块参数文本域，占位符 `$p1$` / `$p2$`
//
// ⚠️ 与隔壁「URL生成工具」的本质区别：这一屏**纯前端字符串替换**，不调 comm/exp。
//    `$p1$` 就是字面占位符，`url.replace('$p1$', 值)` 完事。
//
// 有意偏差：
//   1. 旧版那个「变换部分」输入框**没有 v-model**，打什么都进不了变量 —— 纯摆设。
//      这里保留输入框（不然页面看着少一块、跟旧截图对不上），但同样不接线，并在 placeholder 里说明。
//   2. 旧版结果框绑定的是 computed（改不动），这里 readonly。
//   3. 生成 / diff 结果为空时旧版没有任何提示，这里保持静默（只在等长校验失败时报错，同旧版）。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElNotification } from 'element-plus'
import { distinctValues, genCartesian, genSimple, parseToList } from './urlGen'

defineOptions({ name: 'UrlBuildStatic' })

const nameTpl = ref('$p1$-$p2$')
const urlTpl = ref('http://$p1$-$p2$')
const cartesian = ref(false)

const paramCount = ref(2)
const paramList = computed(() => Array.from({ length: paramCount.value }, (_, index) => index + 1))
/** 参数值：键 = `$p1$` / `$p2$`（旧版就是拿 `'$p' + (i+1) + '$'` 当键） */
const vs = reactive<Record<string, string>>({})
const results = ref<string[]>([])
const resultText = computed(() => results.value.join('\n'))

function keyOf(index: number): string {
  return `$p${index}$`
}
function ensureParamKeys() {
  paramList.value.forEach((index) => {
    if (vs[keyOf(index)] === undefined) vs[keyOf(index)] = ''
  })
}
onMounted(ensureParamKeys)
watch(paramCount, ensureParamKeys, { flush: 'post' })

function addParam() {
  paramCount.value += 1
}
function delParam() {
  if (paramCount.value <= 1) return
  delete vs[keyOf(paramCount.value)]
  paramCount.value -= 1
}

function collectRows(): string[][] {
  return paramList.value.map((index) => parseToList(vs[keyOf(index)]))
}

/** 旧 genUrls：按开关走笛卡尔集或简单配对 */
function genUrls() {
  const rows = collectRows()
  const { error, lines } = cartesian.value
    ? genCartesian(rows, urlTpl.value, nameTpl.value)
    : genSimple(rows, urlTpl.value, nameTpl.value)
  if (error) {
    results.value = [`[出错]${error}`]
    ElNotification.error({ title: error })
    return
  }
  results.value = lines
  ElNotification.success({ title: '生成URL成功' })
}

/** 旧 genDistinct(a, b)：不带 b = 自身去重；带 b = b 里有、a 里没有的 */
function genDistinct(a: number, b?: number) {
  const first = parseToList(vs[keyOf(a)])
  if (!b) {
    results.value = distinctValues(first)
    return
  }
  const second = parseToList(vs[keyOf(b)])
  results.value = distinctValues(second, first)
}
</script>

<template>
  <div class="ubs-shell">
    <!-- 工具栏（旧一行 a-row + 栅格） -->
    <div class="ubs-bar">
      <div class="ubs-field">
        <span class="ubs-label">名称</span>
        <el-input v-model="nameTpl" placeholder="名称" />
      </div>
      <div class="ubs-field ubs-field-url">
        <span class="ubs-label">URL</span>
        <el-input v-model="urlTpl" placeholder="固定URL" />
      </div>
      <div class="ubs-field">
        <span class="ubs-label">变换部分</span>
        <el-input placeholder="变换函数（旧版未接线，占位保留）" />
      </div>
      <div class="ubs-field ubs-field-mini">
        <el-button @click="addParam">加</el-button>
        <el-button @click="delParam">减</el-button>
      </div>
      <div class="ubs-switch">
        笛卡尔集:
        <el-switch v-model="cartesian" inline-prompt active-text="开" inactive-text="关" />
      </div>
      <div class="ubs-actions">
        <el-button type="primary" @click="genUrls">生成URL</el-button>
        <el-button @click="genDistinct(1, 2)">参数2 diff 1</el-button>
        <el-button @click="genDistinct(2, 1)">参数1 diff 2</el-button>
        <el-button @click="genDistinct(1)">distinct 参数1</el-button>
        <el-tag type="danger" class="ubs-count">结果数量:{{ results.length }}</el-tag>
      </div>
    </div>

    <!-- 结果（旧 10 行文本域，绑定 computed，改不动） -->
    <el-input :model-value="resultText" type="textarea" :rows="10" readonly placeholder="生成结果" />

    <!-- 参数区：每行 3 块 -->
    <div class="ubs-grid">
      <el-input
        v-for="index in paramList"
        :key="index"
        v-model="vs[keyOf(index)]"
        type="textarea"
        :rows="15"
        :placeholder="`参数${index}, $p${index}$`"
      />
    </div>
  </div>
</template>

<style scoped>
.ubs-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.ubs-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
}
.ubs-field {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 200px;
}
.ubs-field-url {
  flex: 0 1 320px;
}
.ubs-field-mini {
  min-width: 0;
}
.ubs-label {
  flex: none;
  color: var(--rc-text-2, #475569);
  font-size: 12px;
}
.ubs-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--rc-text-2, #475569);
  font-size: 12px;
}
.ubs-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.ubs-count {
  margin-left: 2px;
}
.ubs-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
@media (max-width: 1200px) {
  .ubs-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
