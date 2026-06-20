<script setup lang="ts">
import { computed } from 'vue'
import type { Source, Step } from '../../api'

const props = defineProps<{
  visible: boolean
  source: Source | null
  steps: Step[]
  loading: boolean
}>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'snatch'): void
  (e: 'copy'): void
  (e: 'toggle-enable'): void
}>()

const open = computed({
  get: () => props.visible,
  set: (v: boolean) => emit('update:visible', v),
})

function statusMeta(s: Source) {
  if (s.disabled) return { cls: 'muted', text: '已停用' }
  if (s.state === 'C') return { cls: 'ok', text: '成功' }
  if (s.state === 'E') return { cls: 'err', text: '出错' }
  if (s.state === 'L') return { cls: 'run', text: '运行中' }
  return { cls: 'muted', text: '未知' }
}
function verifyText(v?: string) {
  if (v === 'normal') return '已核验正常'
  if (v === 'abnormal') return '已标异常'
  return '未核验'
}
</script>

<template>
  <el-drawer v-model="open" :with-header="false" size="440px">
    <div v-if="source" class="ca-d">
      <div class="ca-d-head">
        <div class="ca-d-headmain">
          <div class="ca-d-title">{{ source.name }}</div>
          <div class="ca-d-sub">源 ID {{ source.sourceId }} · {{ source.url }}</div>
        </div>
        <span class="rc-status" :class="statusMeta(source).cls">{{ statusMeta(source).text }}</span>
      </div>

      <div v-if="source.externalChanged" class="ca-d-alert">
        <strong>外部变更待确认</strong>
        <p>最后修改人 {{ source.lastModifiedBy || '—' }} · 同步时间 {{ source.syncedAt || '—' }}</p>
      </div>

      <div class="ca-d-section">源配置</div>
      <dl class="rc-kv">
        <dt>源 ID</dt><dd>{{ source.sourceId }}</dd>
        <dt>责任人</dt><dd>{{ source.owner }}</dd>
        <dt>域</dt><dd>{{ source.domain || '—' }}</dd>
        <dt>大类 / 子类</dt><dd>{{ source.category || '—' }} / {{ source.subCategory || '—' }}</dd>
        <dt>目录路径</dt><dd>{{ source.categoryPath || '—' }}</dd>
        <dt>目录 ID</dt><dd>{{ source.dirId || '—' }}</dd>
        <dt>采集周期</dt><dd>{{ source.cycle || '—' }} · 频率 {{ source.freqTag || '—' }}</dd>
        <dt>绑定配置</dt><dd>{{ source.configId }}</dd>
        <dt>主表</dt><dd>{{ source.mainTable }}</dd>
        <dt>核心参数</dt><dd>{{ source.coreParam || '—' }}</dd>
        <dt>断点续传</dt><dd>{{ source.resume ? '是' : '否' }}</dd>
        <dt>上次 URL</dt><dd>{{ source.lastUrl || '—' }}</dd>
        <dt>数据量</dt><dd>{{ (source.dataCount ?? 0).toLocaleString() }}（新入 {{ source.newInCount ?? 0 }}）</dd>
        <dt>上次任务</dt><dd>{{ source.lastTaskAt || '—' }}</dd>
        <dt>上次成功</dt><dd>{{ source.lastSuccessAt || '—' }}</dd>
        <dt>更新时间</dt><dd>{{ source.updatedAt || '—' }}</dd>
        <dt>人工核验</dt><dd>{{ verifyText(source.verified) }}</dd>
        <dt>版本号</dt><dd>v{{ source.version ?? 1 }}</dd>
      </dl>
      <p v-if="source.remark" class="rc-mini-card">{{ source.remark }}</p>

      <template v-if="source.credentialRef">
        <div class="ca-d-section">登录凭据</div>
        <div class="rc-mini-card">凭据引用 {{ source.credentialRef }} · 只存引用，明文密码不回显（CredentialRef）</div>
      </template>

      <div class="ca-d-section">子步骤 <span class="muted">（{{ steps.length }}）</span></div>
      <div v-loading="loading" class="ca-d-steps">
        <div v-for="st in steps" :key="st.stepId" class="ca-step">
          <div class="ca-step-h">
            <strong>{{ st.name }}</strong>
            <span class="rc-status" :class="st.enabled ? 'ok' : 'muted'">{{ st.enabled ? '启用' : '停用' }}</span>
          </div>
          <div class="ca-step-kv">
            <span>输入 {{ st.inputTable || '—' }}</span>
            <span>输出 {{ st.outputTable || '—' }}</span>
            <span>失败动作 {{ st.failAction || '—' }}</span>
          </div>
        </div>
        <div v-if="!loading && !steps.length" class="muted ca-d-empty">无子步骤</div>
      </div>

      <div class="ca-d-foot">
        <button class="rc-btn" type="button" @click="emit('snatch')">发起抓取</button>
        <button class="rc-btn" type="button" @click="emit('copy')">复制派生</button>
        <button class="rc-btn danger" type="button" @click="emit('toggle-enable')">
          {{ source.disabled ? '启用' : '停用' }}
        </button>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.ca-d {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ca-d-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.ca-d-title {
  color: var(--rc-text);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.4;
}
.ca-d-sub {
  margin-top: 4px;
  color: var(--rc-muted);
  font-size: 12px;
  word-break: break-all;
}
.ca-d-alert {
  padding: 10px 12px;
  border: 1px solid #fed7aa;
  border-radius: var(--rc-radius);
  background: var(--rc-warn-bg);
  color: var(--rc-warn);
}
.ca-d-alert strong {
  font-size: 13px;
}
.ca-d-alert p {
  margin: 4px 0 0;
  font-size: 12px;
}
.ca-d-section {
  margin-top: 2px;
  color: var(--rc-text);
  font-size: 13px;
  font-weight: 700;
}
.ca-d-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 40px;
}
.ca-step {
  padding: 10px 12px;
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius);
  background: #fff;
}
.ca-step-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.ca-step-kv {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  color: var(--rc-muted);
  font-size: 12px;
}
.ca-d-empty {
  padding: 8px 0;
}
.ca-d-foot {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  padding-top: 14px;
  border-top: 1px solid var(--rc-border-soft);
}
</style>
