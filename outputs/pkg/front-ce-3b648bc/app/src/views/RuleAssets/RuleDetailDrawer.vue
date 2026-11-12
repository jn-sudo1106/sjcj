<script setup lang="ts">
import { computed } from 'vue'
import type { Rule, RuleTestCase, SharedConfig } from '../../api'

const props = defineProps<{
  visible: boolean
  rule: Rule | null
  testCases: RuleTestCase[]
  shared: SharedConfig[]
  loading: boolean
}>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'publish'): void
  (e: 'run-batch'): void
  (e: 'test'): void
}>()

const open = computed({
  get: () => props.visible,
  set: (v: boolean) => emit('update:visible', v),
})

function sharedName(id: string) {
  return props.shared.find((s) => s.id === id)?.name ?? id
}
function stateMeta(s: string) {
  if (s === 'published') return { cls: 'ok', text: '已发布' }
  if (s === 'draft') return { cls: 'warn', text: '草稿' }
  return { cls: 'muted', text: '已弃用' }
}
function gateBadge(kind: 'syntax' | 'reference' | 'batchTest') {
  const v = props.rule?.gate[kind]
  if (kind === 'batchTest') {
    if (v === 'pass') return { cls: 'ok', text: '通过' }
    if (v === 'fail') return { cls: 'err', text: '未通过' }
    return { cls: 'muted', text: '待接口' }
  }
  if (v === 'pass') return { cls: 'ok', text: '通过' }
  if (v === 'warn') return { cls: 'warn', text: '告警' }
  return { cls: 'err', text: '未通过' }
}
function resultMeta(r: string) {
  if (r === 'pass') return { cls: 'ok', text: '通过' }
  if (r === 'fail') return { cls: 'err', text: '失败' }
  return { cls: 'muted', text: '待跑' }
}
</script>

<template>
  <el-drawer v-model="open" :with-header="false" size="480px">
    <div v-if="rule" class="ra-d">
      <div class="ra-d-head">
        <div>
          <div class="ra-d-title">{{ rule.name }}</div>
          <div class="ra-d-sub">{{ rule.ruleId }} · {{ rule.stage }} · {{ rule.version }}</div>
        </div>
        <span class="rc-status" :class="stateMeta(rule.state).cls">{{ stateMeta(rule.state).text }}</span>
      </div>

      <div class="ra-d-section">发布门禁</div>
      <div class="ra-d-gates">
        <div class="ra-d-gate"><span>语法</span><span class="rc-status" :class="gateBadge('syntax').cls">{{ gateBadge('syntax').text }}</span></div>
        <div class="ra-d-gate"><span>引用</span><span class="rc-status" :class="gateBadge('reference').cls">{{ gateBadge('reference').text }}</span></div>
        <div class="ra-d-gate"><span>批测</span><span class="rc-status" :class="gateBadge('batchTest').cls">{{ gateBadge('batchTest').text }}</span></div>
      </div>

      <div class="ra-d-section">表达式</div>
      <div class="rc-code-box">{{ rule.expr }}</div>

      <div class="ra-d-section">依赖共享配置</div>
      <div v-if="rule.sharedConfigs?.length" class="ra-d-tags">
        <el-tag v-for="id in rule.sharedConfigs" :key="id" size="small" effect="plain">{{ sharedName(id) }}</el-tag>
      </div>
      <div v-else class="muted ra-d-empty">无依赖</div>

      <div class="ra-d-section">测试集 <span class="muted">（{{ testCases.length }}）</span></div>
      <div v-loading="loading" class="ra-d-cases">
        <div v-for="c in testCases" :key="c.caseId" class="ra-case">
          <div class="ra-case-h">
            <strong>{{ c.name }}</strong>
            <span>
              <span v-if="c.blocking" class="rc-status warn ra-blk">阻断项</span>
              <span class="rc-status" :class="resultMeta(c.lastResult).cls">{{ resultMeta(c.lastResult).text }}</span>
            </span>
          </div>
          <div class="ra-case-kv">context {{ JSON.stringify(c.context) }} → 期望 {{ c.expected }}</div>
        </div>
        <div v-if="!loading && !testCases.length" class="muted ra-d-empty">暂无测试样本</div>
      </div>

      <div class="ra-d-section">被引用关系 <span class="muted">（{{ rule.refCount }}）</span></div>
      <ul v-if="rule.refBy?.length" class="ra-d-refs">
        <li v-for="r in rule.refBy" :key="r">{{ r }}</li>
      </ul>
      <div v-else class="muted ra-d-empty">未被引用</div>

      <div class="ra-d-foot">
        <button class="rc-btn" type="button" @click="emit('test')">在测试器中打开</button>
        <button class="rc-btn" type="button" @click="emit('run-batch')">跑批测</button>
        <button class="rc-btn danger" type="button" @click="emit('publish')">发布</button>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.ra-d {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ra-d-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.ra-d-title {
  color: var(--rc-text);
  font-size: 15px;
  font-weight: 700;
}
.ra-d-sub {
  margin-top: 4px;
  color: var(--rc-muted);
  font-size: 12px;
}
.ra-d-section {
  margin-top: 2px;
  color: var(--rc-text);
  font-size: 13px;
  font-weight: 700;
}
.ra-d-gates {
  display: flex;
  gap: 18px;
}
.ra-d-gate {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--rc-muted);
  font-size: 12px;
}
.ra-d-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ra-d-cases {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 40px;
}
.ra-case {
  padding: 10px 12px;
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius);
  background: #fff;
}
.ra-case-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.ra-case-h > span {
  display: inline-flex;
  gap: 6px;
}
.ra-blk {
  margin-right: 2px;
}
.ra-case-kv {
  color: var(--rc-muted);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  word-break: break-all;
}
.ra-d-refs {
  margin: 0;
  padding-left: 18px;
  color: var(--rc-text-2);
  font-size: 12px;
  line-height: 1.8;
}
.ra-d-empty {
  font-size: 12px;
}
.ra-d-foot {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  padding-top: 14px;
  border-top: 1px solid var(--rc-border-soft);
}
</style>
