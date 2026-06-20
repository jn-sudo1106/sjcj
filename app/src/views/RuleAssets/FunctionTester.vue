<script setup lang="ts">
import { ref } from 'vue'
import { ruleApi, type EvalResult } from '../../api'

const expr = ref('IF(score >= 60, "合格", "不合格")')
const contextStr = ref('{\n  "score": 75\n}')
const result = ref<EvalResult | null>(null)
const loading = ref(false)

const PRESETS: { label: string; expr: string; context: string }[] = [
  { label: '评分门限', expr: 'IF(score >= 60, "合格", "不合格")', context: '{ "score": 75 }' },
  { label: '公告识别', expr: 'IF(CONTAINS(title, "公告"), "公告类", "其他")', context: '{ "title": "重大事项公告" }' },
  {
    label: '组合条件',
    expr: 'IF(amount > 10000 AND level == "vip", "高价值", "普通")',
    context: '{ "amount": 20000, "level": "vip" }',
  },
]

function apply(e: string, c: unknown) {
  expr.value = e
  contextStr.value = typeof c === 'string' ? c : JSON.stringify(c ?? {}, null, 2)
  result.value = null
}
async function run() {
  loading.value = true
  try {
    result.value = await ruleApi.evaluate(expr.value, contextStr.value)
  } finally {
    loading.value = false
  }
}

defineExpose({ apply })
</script>

<template>
  <div class="rc-card ra-tester">
    <div class="rc-card-head">
      <div>
        <div class="rc-card-title">函数测试器</div>
        <div class="rc-card-sub">context + 表达式 → mock 求值</div>
      </div>
    </div>
    <div class="ra-tester-body">
      <label class="ra-lbl">表达式</label>
      <el-input v-model="expr" type="textarea" :rows="3" placeholder='IF(score >= 60, "合格", "不合格")' />

      <label class="ra-lbl">上下文 context（JSON）</label>
      <el-input v-model="contextStr" type="textarea" :rows="4" placeholder='{ "score": 75 }' />

      <div class="ra-presets">
        <span class="muted">示例：</span>
        <el-button v-for="p in PRESETS" :key="p.label" size="small" @click="apply(p.expr, p.context)">
          {{ p.label }}
        </el-button>
      </div>

      <button class="rc-btn primary ra-eval" type="button" @click="run">{{ loading ? '求值中…' : '求值' }}</button>

      <div v-if="result" class="ra-result" :class="{ err: !result.ok }">
        <template v-if="result.ok">
          <div class="ra-result-val">
            <span>结果</span><b>{{ result.value }}</b>
          </div>
          <div v-if="result.branch" class="ra-result-branch">命中分支：{{ result.branch }}</div>
          <ol v-if="result.trace?.length" class="ra-trace">
            <li v-for="(t, i) in result.trace" :key="i">{{ t }}</li>
          </ol>
        </template>
        <template v-else>
          <div class="ra-result-err">求值失败：{{ result.error }}</div>
          <ol v-if="result.trace?.length" class="ra-trace">
            <li v-for="(t, i) in result.trace" :key="i">{{ t }}</li>
          </ol>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ra-tester {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 168px);
  min-height: 560px;
}
.ra-tester-body {
  flex: 1;
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ra-lbl {
  margin-top: 4px;
  color: var(--rc-text);
  font-size: 12px;
  font-weight: 700;
}
.ra-presets {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: 4px 0;
}
.ra-eval {
  width: 100%;
  margin-top: 4px;
}
.ra-result {
  margin-top: 8px;
  padding: 12px;
  border: 1px solid var(--rc-ok);
  border-radius: var(--rc-radius);
  background: var(--rc-ok-bg);
}
.ra-result.err {
  border-color: #fecaca;
  background: var(--rc-error-bg);
}
.ra-result-val {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.ra-result-val span {
  color: var(--rc-muted);
  font-size: 12px;
}
.ra-result-val b {
  color: var(--rc-ok);
  font-size: 20px;
}
.ra-result-branch {
  margin-top: 6px;
  color: var(--rc-text-2);
  font-size: 12px;
}
.ra-result-err {
  color: var(--rc-error);
  font-size: 13px;
  font-weight: 600;
}
.ra-trace {
  margin: 10px 0 0;
  padding-left: 18px;
  color: var(--rc-text-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.7;
}
</style>
