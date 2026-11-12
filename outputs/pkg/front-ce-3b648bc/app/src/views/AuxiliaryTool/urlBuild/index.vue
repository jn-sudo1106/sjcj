<script setup lang="ts">
// URL 生成工具 —— 1:1 迁移旧 data-view `src/page/install/UrlBuild.vue`（旧路由 /install/url-build）。
//
// 旧页面全貌：
//   第一行：固定部分（URL 模板） + [加][减][生成URL]
//   第二行：名称 + 多参数笛卡尔集开关
//   参数区：每 1/3 宽一张卡片 = 一个参数（p1、p2…），卡片头有 [生成序列][时间序列] 两个按钮
//           + 一个「转义」开关，卡片体是 15 行文本域（一行一个值）
//   生成URL → 结果弹窗（900 宽、20 行文本域）
//   「生成序列」弹窗：起始 / 结束 / 步长 → 灌进该参数
//   「时间序列」弹窗：按日/按月、月初/月末/月初~月末/每月固定日、起止日期、间隔、格式 → 灌进该参数
//
// ⚠️ 这一屏的 URL 模板与名称都是**表达式**，不是字符串模板：
//      URL 模板 'http://' + p1 + '-' + p2，每次组合都把 p1/p2 塞进表达式上下文再发
//      POST /v1/comm/exp 求值（api/exp.ts）。所以生成 3 个参数 × 10 行 = 10 次请求，
//      这是旧页面本来的做法，不是可以"优化"掉的多余调用。
//
// 有意偏差：
//   1. 旧版每行 `handleCheck` 是 fire-and-forget 的 .then(push)，谁先回来谁先入列 —— 结果顺序跟参数
//      顺序对不上。这里用 Promise.all 保序（还是并发，但顺序稳定）。
//   2. 结果框旧版可编辑但改了没用，这里 readonly。
//   3. 旧版 `genUrlsDKR` 在有参数为空时会 reduce 抛 TypeError，这里按「结果为空」处理并提示。
//   4. 生成的「时间序列」用本目录 dateSeq.ts 复刻 moment 行为（新项目没有 moment/dayjs）。
//   5. 旧版左列的「名称」框和「多参数笛卡尔集」开关是同一行里的两段，这里保持同样的排布。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElNotification } from 'element-plus'
import { checkExp } from '@/api/exp'
import { buildEnv, buildRule, cartesianRows, lengthMismatch, parseToList } from './urlGen'
import { buildIntSeq, buildTimeSeq, type MonthMode, type SeqUnit } from './dateSeq'

defineOptions({ name: 'UrlBuild' })

/** 参数卡片：索引从 1 开始（p1、p2…），与旧版 `'p' + (index + 1)` 一致 */
const paramCount = ref(2)
const paramList = computed(() => Array.from({ length: paramCount.value }, (_, index) => index + 1))

/** 参数区两个字典（vs = 文本、ts = 转义开关）按需补齐，避免 el-input 收到 undefined */
function ensureParamKeys() {
  paramList.value.forEach((index) => {
    if (vs[`p${index}`] === undefined) vs[`p${index}`] = ''
    if (ts[`p${index}`] === undefined) ts[`p${index}`] = false
  })
}
onMounted(ensureParamKeys)
watch(paramCount, ensureParamKeys, { flush: 'post' })

const urlTpl = ref("'http://' + p1 + '-' + p2")
const nameTpl = ref("p1 + '-' + p2")
/** 多参数笛卡尔集（旧 flag，默认开） */
const cartesian = ref(true)
/** 每块参数粘贴区的内容：键 = p1 / p2 … */
const vs = reactive<Record<string, string>>({})
/** 每块参数的「转义」开关 */
const ts = reactive<Record<string, boolean>>({})

const resultText = ref('')
const resultVisible = ref(false)
const generating = ref(false)

function addParam() {
  paramCount.value += 1
}
function delParam() {
  if (paramCount.value <= 1) return
  const key = `p${paramCount.value}`
  delete vs[key]
  delete ts[key]
  paramCount.value -= 1
}

/** 收集各行参数值；encodes 与 rows 一一对应 */
function collectParams(): { rows: string[][]; encodes: boolean[] } {
  const rows: string[][] = []
  const encodes: boolean[] = []
  paramList.value.forEach((index) => {
    rows.push(parseToList(vs[`p${index}`]))
    encodes.push(!!ts[`p${index}`])
  })
  return { rows, encodes }
}

/** 组合 + 逐行求值（旧 genUrls / genUrlsSimple / genUrlsDKR 的合体） */
async function genUrls() {
  const { rows, encodes } = collectParams()
  if (rows.length && rows.every((row) => row.length === 0)) {
    ElNotification.warning({ title: '没有可用的参数', message: '请先在参数区粘贴值（一行一个）' })
    return
  }
  generating.value = true
  try {
    let combos: string[][]
    if (cartesian.value) {
      combos = cartesianRows(rows)
      if (rows.some((row) => row.length === 0)) {
        ElNotification.warning({ title: '参数为空', message: '笛卡尔集需要每个参数都有值' })
        resultText.value = ''
        resultVisible.value = true
        return
      }
    } else {
      const mismatch = lengthMismatch(rows)
      if (mismatch) {
        ElNotification.error({ title: mismatch })
        resultText.value = `[出错]${mismatch}`
        resultVisible.value = true
        return
      }
      // 简单模式 = 按下标配对（第 i 个参数取各自第 i 行）
      const count = rows[0]?.length ?? 0
      combos = Array.from({ length: count }, (_, i) => rows.map((row) => row[i] ?? ''))
    }

    if (!combos.length) {
      resultText.value = ''
      resultVisible.value = true
      return
    }

    // 旧版是 fire-and-forget，顺序随机；这里并发但保序
    const rule = buildRule(nameTpl.value, urlTpl.value)
    const lines = await Promise.all(
      combos.map(async (combo) => {
        try {
          const res = await checkExp('', rule, JSON.stringify(buildEnv(combo, encodes)))
          return typeof res === 'string' ? res : JSON.stringify((res as { data?: unknown })?.data ?? res)
        } catch (error) {
          ElNotification.error({
            title: '表达式处理失败',
            message: error instanceof Error ? error.message : String(error),
          })
          return null
        }
      }),
    )
    resultText.value = lines.filter((line): line is string => line !== null).join('\n')
    resultVisible.value = true
    ElNotification.success({ title: '生成URL成功' })
  } finally {
    generating.value = false
  }
}

// ---- 生成序列弹窗 ----
const seqVisible = ref(false)
const seqTarget = ref<number>(1)
const seqForm = reactive({ start: '1', end: '5', step: '1' })

function openSeq(index: number) {
  seqTarget.value = index
  seqVisible.value = true
}

function applySeq() {
  vs[`p${seqTarget.value}`] = buildIntSeq(seqForm.start, seqForm.end, seqForm.step).join('\n')
  seqVisible.value = false
}

// ---- 时间序列弹窗 ----
const timeVisible = ref(false)
const timeTarget = ref<number>(1)
const timeForm = reactive({
  type: 'days' as SeqUnit,
  /** 1 月初 / 2 月末 / 3 每月固定日[同起始时间] / 4 月初 ~ 月末 */
  mode: 1 as MonthMode,
  start: '',
  end: today(),
  step: '1',
  format: 'YYYY-MM-DD',
})

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function openTimeSeq(index: number) {
  timeTarget.value = index
  // 旧版每次打开都把起始时间清空（form2.start = null），保持同样行为
  timeForm.start = ''
  timeVisible.value = true
}

function applyTimeSeq() {
  const list = buildTimeSeq({
    start: timeForm.start,
    end: timeForm.end,
    step: Number(timeForm.step) || 1,
    unit: timeForm.type,
    mode: timeForm.mode,
    format: timeForm.format,
  })
  if (!list.length) {
    ElNotification.warning({ title: '没生成任何日期', message: '请检查起始 / 结束时间与格式' })
    return
  }
  vs[`p${timeTarget.value}`] = list.join('\n')
  timeVisible.value = false
}
</script>

<template>
  <div class="ub-shell">
    <!-- 固定部分 + 操作（旧第一行） -->
    <div class="ub-row">
      <div class="ub-label">固定部分</div>
      <el-input v-model="urlTpl" placeholder="URL模板" />
      <div class="ub-actions">
        <el-button @click="addParam">加</el-button>
        <el-button @click="delParam">减</el-button>
        <el-button type="primary" :loading="generating" @click="genUrls">生成URL</el-button>
      </div>
    </div>

    <!-- 名称 + 笛卡尔集开关（旧第二行） -->
    <div class="ub-row ub-row-name">
      <div class="ub-label">名称</div>
      <el-input v-model="nameTpl" placeholder="名称" class="ub-name" />
      <div class="ub-switch">
        多参数笛卡尔集:
        <el-switch v-model="cartesian" inline-prompt active-text="开" inactive-text="关" />
      </div>
    </div>

    <!-- 参数区：每行 3 张卡片（旧 a-card-grid :span="8" width:33%） -->
    <div class="ub-grid">
      <div v-for="index in paramList" :key="index" class="ub-card">
        <div class="ub-card-head">
          <el-button-group size="small">
            <el-button size="small" @click="openSeq(index)">生成序列</el-button>
            <el-button size="small" @click="openTimeSeq(index)">时间序列</el-button>
          </el-button-group>
          <span class="ub-escape">
            转义:
            <el-switch
              v-model="ts[`p${index}`]"
              inline-prompt
              active-text="转"
              inactive-text="-"
              size="small"
            />
          </span>
        </div>
        <el-input
          v-model="vs[`p${index}`]"
          type="textarea"
          :rows="15"
          :placeholder="`参数${index}, p${index}`"
        />
      </div>
    </div>

    <!-- 结果弹窗（旧 width 900 + 20 行文本域） -->
    <el-dialog v-model="resultVisible" title="生成结果" width="900px" top="6vh">
      <el-input :model-value="resultText" type="textarea" :rows="20" readonly placeholder="生成结果" />
      <template #footer>
        <el-button @click="resultVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 生成序列（旧 a-descriptions bordered :column="4"） -->
    <el-dialog v-model="seqVisible" title="生成序列" width="900px">
      <el-descriptions border :column="4" size="small">
        <el-descriptions-item label="起始" :span="2">
          <el-input v-model="seqForm.start" />
        </el-descriptions-item>
        <el-descriptions-item label="结束" :span="2">
          <el-input v-model="seqForm.end" />
        </el-descriptions-item>
        <el-descriptions-item label="步长" :span="2">
          <el-input v-model="seqForm.step" />
        </el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button @click="seqVisible = false">取消</el-button>
        <el-button type="primary" @click="applySeq">确定</el-button>
      </template>
    </el-dialog>

    <!-- 时间序列（旧 a-descriptions bordered :column="4" + radio-group button-style="solid"） -->
    <el-dialog v-model="timeVisible" title="时间序列" width="900px">
      <el-descriptions border :column="4" size="small">
        <el-descriptions-item label="类型" :span="4">
          <el-radio-group v-model="timeForm.type">
            <el-radio-button value="days">日</el-radio-button>
            <el-radio-button value="months">月</el-radio-button>
          </el-radio-group>
        </el-descriptions-item>
        <el-descriptions-item v-if="timeForm.type === 'months'" label="取整方式" :span="4">
          <el-radio-group v-model="timeForm.mode">
            <el-radio-button :value="1">月初</el-radio-button>
            <el-radio-button :value="2">月未</el-radio-button>
            <el-radio-button :value="4">月初 ~ 月末</el-radio-button>
            <el-radio-button :value="3">每月固定日[同起始时间]</el-radio-button>
          </el-radio-group>
        </el-descriptions-item>
        <el-descriptions-item label="起始时间" :span="2">
          <el-date-picker
            v-model="timeForm.start"
            type="date"
            value-format="YYYY-MM-DD"
            :format="timeForm.format"
            placeholder="起始时间"
            class="ub-date"
          />
        </el-descriptions-item>
        <el-descriptions-item label="结束时间" :span="2">
          <el-date-picker
            v-model="timeForm.end"
            type="date"
            value-format="YYYY-MM-DD"
            :format="timeForm.format"
            placeholder="结束时间"
            class="ub-date"
          />
        </el-descriptions-item>
        <el-descriptions-item label="间隔" :span="2">
          <el-input v-model="timeForm.step" />
        </el-descriptions-item>
        <el-descriptions-item label="格式" :span="2">
          <el-input v-model="timeForm.format" placeholder="YYYY-MM-DD" />
        </el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button @click="timeVisible = false">取消</el-button>
        <el-button type="primary" @click="applyTimeSeq">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.ub-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.ub-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}
.ub-row-name {
  grid-template-columns: 72px 240px minmax(0, 1fr);
}
.ub-label {
  color: var(--rc-text-2, #475569);
  font-size: 12px;
}
.ub-actions {
  display: flex;
  gap: 8px;
}
.ub-name {
  width: 240px;
}
.ub-switch {
  color: var(--rc-text-2, #475569);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
/* 旧 a-card-grid：三列、卡片之间留 8px 间距 */
.ub-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.ub-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius-sm, 6px);
  background: var(--rc-panel-shine, #fff);
}
.ub-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.ub-escape {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
.ub-date {
  width: 100%;
}
@media (max-width: 1200px) {
  .ub-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
