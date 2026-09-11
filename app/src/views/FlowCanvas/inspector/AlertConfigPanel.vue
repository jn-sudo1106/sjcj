<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

type ChannelType = 'email' | 'dingtalk'
type AlertLevel = 'critical' | 'warning' | 'info'
type AlertOperator = 'gt' | 'gte' | 'eq' | 'lt'

interface AlertChannel {
  id: string
  type: ChannelType
  name: string
  target: string
  enabled: boolean
  recipients?: string
  cc?: string
  senderName?: string
  webhook?: string
  secretConfigured?: boolean
  secret?: string
  atAll?: boolean
  phones?: string
}

interface AlertPolicy {
  id: string
  name: string
  level: AlertLevel
  metric: string
  operator: AlertOperator
  threshold: string
  consecutiveCount: number
  repeatMinutes: number
  recoveryNotify: boolean
  enabled: boolean
  channelIds: string[]
}

interface PolicyDraft {
  name: string
  level: AlertLevel
  metric: string
  operator: AlertOperator
  threshold: string
  consecutiveCount: number
  repeatMinutes: number
  recoveryNotify: boolean
  channelIds: string[]
}

const props = defineProps<{
  nodeId: string
  nodeTitle: string
  sourceLabel: string
  scriptPath?: string
}>()

const enabled = ref(true)
const policyDialogVisible = ref(false)
const editingPolicyId = ref('')
const channelDialogVisible = ref(false)
const editingChannelType = ref<ChannelType>('email')
const channelDraft = reactive({
  recipients: '',
  cc: '',
  senderName: '',
  webhook: '',
  secret: '',
  atAll: false,
  phones: '',
})
const policyDraft = reactive<PolicyDraft>({
  name: '',
  level: 'warning',
  metric: 'delay_minutes',
  operator: 'gt',
  threshold: '30',
  consecutiveCount: 3,
  repeatMinutes: 30,
  recoveryNotify: true,
  channelIds: ['email', 'dingtalk'],
})

const channels = ref<AlertChannel[]>([
  {
    id: 'email', type: 'email', name: '运维邮件组', target: 'ops@example.com', enabled: true,
    recipients: 'ops@example.com', cc: '', senderName: '智能采集中心',
  },
  {
    id: 'dingtalk', type: 'dingtalk', name: '数据平台群', target: 'Webhook 已配置 · @数据值班', enabled: true,
    webhook: 'https://oapi.dingtalk.com/robot/send?access_token=demo', secretConfigured: true,
    atAll: false, phones: '',
  },
])

const policies = ref<AlertPolicy[]>([
  {
    id: 'delay-policy',
    name: '数据延迟超过阈值',
    level: 'critical',
    metric: 'delay_minutes',
    operator: 'gt',
    threshold: '30',
    consecutiveCount: 3,
    repeatMinutes: 30,
    recoveryNotify: true,
    enabled: true,
    channelIds: ['email', 'dingtalk'],
  },
])

const activePolicies = computed(() => policies.value.filter((policy) => policy.enabled).length)

function levelText(level: AlertLevel): string {
  return level === 'critical' ? '严重' : level === 'warning' ? '警告' : '信息'
}

function levelClass(level: AlertLevel): string {
  return `is-${level}`
}

function channelIcon(type: ChannelType): string {
  return type === 'email' ? '✉' : '钉'
}

function channelText(type: ChannelType): string {
  return type === 'email' ? '邮件' : '钉钉'
}

function operatorText(operator: AlertOperator): string {
  return operator === 'gt' ? '>' : operator === 'gte' ? '>=' : operator === 'eq' ? '=' : '<'
}

function metricText(metric: string): string {
  return metric === 'delay_minutes' ? '数据延迟' : metric === 'row_count' ? '入库数量' : '空值率'
}

function policySummary(policy: AlertPolicy): string {
  return `${metricText(policy.metric)} ${operatorText(policy.operator)} ${policy.threshold}，连续 ${policy.consecutiveCount} 次触发`
}

function channelNames(policy: AlertPolicy): string {
  return policy.channelIds
    .map((id) => channels.value.find((channel) => channel.id === id)?.name)
    .filter(Boolean)
    .join('、') || '未配置渠道'
}

function resetDraft(policy?: AlertPolicy) {
  editingPolicyId.value = policy?.id ?? ''
  Object.assign(policyDraft, {
    name: policy?.name ?? '',
    level: policy?.level ?? 'warning',
    metric: policy?.metric ?? 'delay_minutes',
    operator: policy?.operator ?? 'gt',
    threshold: policy?.threshold ?? '30',
    consecutiveCount: policy?.consecutiveCount ?? 3,
    repeatMinutes: policy?.repeatMinutes ?? 30,
    recoveryNotify: policy?.recoveryNotify ?? true,
    channelIds: [...(policy?.channelIds ?? ['email'])],
  })
}

function openAddPolicy() {
  resetDraft()
  policyDialogVisible.value = true
}

function openEditPolicy(policy: AlertPolicy) {
  resetDraft(policy)
  policyDialogVisible.value = true
}

function savePolicy() {
  const name = policyDraft.name.trim()
  if (!name) {
    ElMessage.warning('请填写告警策略名称')
    return
  }
  const channelIds = policyDraft.channelIds.filter((id) => channels.value.some((channel) => channel.id === id && channel.enabled))
  if (!channelIds.length) {
    ElMessage.warning('请至少选择一个通知渠道')
    return
  }
  const next: AlertPolicy = {
    id: editingPolicyId.value || `policy-${Date.now()}`,
    name,
    level: policyDraft.level,
    metric: policyDraft.metric,
    operator: policyDraft.operator,
    threshold: String(policyDraft.threshold).trim(),
    consecutiveCount: Math.max(1, Number(policyDraft.consecutiveCount) || 1),
    repeatMinutes: Math.max(0, Number(policyDraft.repeatMinutes) || 0),
    recoveryNotify: policyDraft.recoveryNotify,
    enabled: true,
    channelIds,
  }
  const index = policies.value.findIndex((policy) => policy.id === next.id)
  if (index >= 0) policies.value[index] = next
  else policies.value.push(next)
  policyDialogVisible.value = false
  ElMessage.success(editingPolicyId.value ? '告警策略已更新' : '告警策略已添加')
}

function togglePolicy(policy: AlertPolicy) {
  policy.enabled = !policy.enabled
}

function removePolicy(policy: AlertPolicy) {
  policies.value = policies.value.filter((item) => item.id !== policy.id)
  ElMessage.success('告警策略已删除')
}

function testChannel(channel: AlertChannel) {
  ElMessage.success(`${channelText(channel.type)}测试消息已提交（演示）`)
}

function resetChannelDraft(channel: AlertChannel) {
  editingChannelType.value = channel.type
  Object.assign(channelDraft, {
    recipients: channel.recipients ?? '',
    cc: channel.cc ?? '',
    senderName: channel.senderName ?? '',
    webhook: channel.webhook ?? '',
    secret: '',
    atAll: channel.atAll ?? false,
    phones: channel.phones ?? '',
  })
}

function openChannelConfig(channel: AlertChannel) {
  resetChannelDraft(channel)
  channelDialogVisible.value = true
}

function saveChannel() {
  const channel = channels.value.find((item) => item.type === editingChannelType.value)
  if (!channel) return
  if (editingChannelType.value === 'email') {
    const recipients = channelDraft.recipients.trim()
    if (!recipients) {
      ElMessage.warning('请填写至少一个邮件收件人')
      return
    }
    channel.recipients = recipients
    channel.cc = channelDraft.cc.trim()
    channel.senderName = channelDraft.senderName.trim()
    channel.target = recipients
  } else {
    const webhook = channelDraft.webhook.trim()
    if (!webhook) {
      ElMessage.warning('请填写钉钉 Webhook 地址')
      return
    }
    channel.webhook = webhook
    channel.secretConfigured = Boolean(channelDraft.secret.trim() || channel.secretConfigured)
    channel.secret = channelDraft.secret.trim() || channel.secret
    channel.atAll = channelDraft.atAll
    channel.phones = channelDraft.phones.trim()
    channel.target = `Webhook 已配置 · ${channel.atAll ? '@所有人' : channel.phones ? '@指定成员' : '不@人'}`
  }
  channelDialogVisible.value = false
  ElMessage.success(`${channelText(channel.type)}渠道已保存`)
}
</script>

<template>
  <section class="alert-panel" data-testid="monitor-alert-config">
    <div class="alert-panel-head">
      <div>
        <div class="alert-panel-title">告警配置</div>
        <div class="alert-panel-sub">第一期演示：策略状态机与通知渠道配置，发送接口待接入</div>
      </div>
      <div class="alert-panel-actions">
        <span class="alert-count">{{ activePolicies }} 条启用策略</span>
        <button
          class="alert-toggle"
          :class="{ 'is-on': enabled }"
          type="button"
          :aria-pressed="enabled"
          data-testid="alert-master-toggle"
          @click="enabled = !enabled"
        >
          <span class="alert-toggle-dot" />
          {{ enabled ? '告警已启用' : '告警已停用' }}
        </button>
        <button class="rc-btn primary compact" type="button" data-testid="alert-add-policy" @click="openAddPolicy">
          ＋ 新增策略
        </button>
      </div>
    </div>

    <div class="alert-context">
      <span>{{ props.nodeTitle || '数据监控节点' }}</span>
      <span>{{ props.sourceLabel || '当前数据源' }}</span>
      <span v-if="props.scriptPath">脚本 {{ props.scriptPath }}</span>
    </div>

    <div v-if="!enabled" class="alert-disabled">告警总开关已关闭，监控结果仍会继续执行。</div>

    <div v-else class="alert-policy-list">
      <div v-for="policy in policies" :key="policy.id" class="alert-policy-row" data-testid="alert-policy-row">
        <div class="alert-policy-main">
          <div class="alert-policy-title-row">
            <strong>{{ policy.name }}</strong>
            <span class="alert-level" :class="levelClass(policy.level)">{{ levelText(policy.level) }}</span>
            <span class="alert-state" :class="{ 'is-off': !policy.enabled }">{{ policy.enabled ? '启用' : '停用' }}</span>
          </div>
          <div class="alert-policy-summary">{{ policySummary(policy) }}</div>
          <div class="alert-policy-meta">
            <span>通知：{{ channelNames(policy) }}</span>
            <span>{{ policy.recoveryNotify ? '恢复时通知' : '不发送恢复通知' }}</span>
            <span>重复间隔 {{ policy.repeatMinutes }} 分钟</span>
          </div>
        </div>
        <div class="alert-policy-actions">
          <button
            class="alert-policy-toggle"
            type="button"
            :aria-pressed="policy.enabled"
            data-testid="alert-policy-toggle"
            @click="togglePolicy(policy)"
          >
            {{ policy.enabled ? '启用' : '停用' }}
          </button>
          <button class="alert-link" type="button" @click="openEditPolicy(policy)">编辑</button>
          <button class="alert-link danger" type="button" @click="removePolicy(policy)">删除</button>
        </div>
      </div>
      <div v-if="!policies.length" class="alert-empty">还没有告警策略，点击“新增策略”开始配置。</div>
    </div>

    <div class="alert-channels">
      <div class="alert-subhead">
        <div>
          <strong>通知渠道</strong>
          <span>策略可同时发送到邮件和钉钉</span>
        </div>
        <span class="alert-demo-tag">演示配置</span>
      </div>
      <div class="alert-channel-grid">
        <div v-for="channel in channels" :key="channel.id" class="alert-channel" :data-testid="`alert-channel-${channel.type}`">
          <div class="alert-channel-icon" :class="`is-${channel.type}`">{{ channelIcon(channel.type) }}</div>
          <div class="alert-channel-body">
            <strong>{{ channel.name }}</strong>
            <span>{{ channelText(channel.type) }} · {{ channel.target }}</span>
          </div>
          <div class="alert-channel-actions">
            <button class="alert-link" type="button" @click="openChannelConfig(channel)" :data-testid="`alert-channel-edit-${channel.type}`">配置</button>
            <button class="alert-link" type="button" @click="testChannel(channel)">测试</button>
          </div>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="channelDialogVisible"
      :title="editingChannelType === 'email' ? '配置邮件渠道' : '配置钉钉渠道'"
      width="520px"
      append-to-body
      data-testid="alert-channel-dialog"
    >
      <div class="alert-form">
        <template v-if="editingChannelType === 'email'">
          <label class="alert-form-field wide">
            <span>邮件收件人</span>
            <input v-model="channelDraft.recipients" data-testid="alert-email-recipients" placeholder="多个地址用分号或逗号分隔" />
          </label>
          <label class="alert-form-field wide">
            <span>抄送</span>
            <input v-model="channelDraft.cc" data-testid="alert-email-cc" placeholder="可选，多个地址用分号或逗号分隔" />
          </label>
          <label class="alert-form-field wide">
            <span>发件人名称</span>
            <input v-model="channelDraft.senderName" data-testid="alert-email-sender-name" placeholder="例如：智能采集中心" />
          </label>
        </template>
        <template v-else>
          <label class="alert-form-field wide">
            <span>Webhook 地址</span>
            <input v-model="channelDraft.webhook" data-testid="alert-dingtalk-webhook" placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." />
          </label>
          <label class="alert-form-field wide">
            <span>加签密钥</span>
            <input v-model="channelDraft.secret" type="password" data-testid="alert-dingtalk-secret" placeholder="留空表示保持已配置密钥" />
          </label>
          <label class="alert-recovery">
            <input v-model="channelDraft.atAll" type="checkbox" data-testid="alert-dingtalk-at-all" />
            <span>@所有人</span>
          </label>
          <label class="alert-form-field wide">
            <span>指定手机号</span>
            <input v-model="channelDraft.phones" data-testid="alert-dingtalk-phones" placeholder="可选，多个手机号用逗号分隔" />
          </label>
          <div class="alert-secret-hint">安全提示：Webhook 和加签密钥只在当前演示状态保存，不会回显密钥内容。</div>
        </template>
      </div>
      <template #footer>
        <button class="rc-btn" type="button" @click="channelDialogVisible = false">取消</button>
        <button class="rc-btn primary" type="button" data-testid="alert-save-channel" @click="saveChannel">保存渠道</button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="policyDialogVisible"
      :title="editingPolicyId ? '编辑告警策略' : '新增告警策略'"
      width="520px"
      append-to-body
      data-testid="alert-policy-dialog"
    >
      <div class="alert-form">
        <label class="alert-form-field wide">
          <span>策略名称</span>
          <input v-model="policyDraft.name" data-testid="alert-policy-name" placeholder="例如：入库数量为零" />
        </label>
        <div class="alert-form-grid">
          <label class="alert-form-field">
            <span>告警等级</span>
            <select v-model="policyDraft.level">
              <option value="critical">严重</option>
              <option value="warning">警告</option>
              <option value="info">信息</option>
            </select>
          </label>
          <label class="alert-form-field">
            <span>监控指标</span>
            <select v-model="policyDraft.metric">
              <option value="delay_minutes">数据延迟</option>
              <option value="row_count">入库数量</option>
              <option value="null_rate">空值率</option>
            </select>
          </label>
          <label class="alert-form-field">
            <span>比较符</span>
            <select v-model="policyDraft.operator">
              <option value="gt">&gt;</option>
              <option value="gte">&gt;=</option>
              <option value="eq">=</option>
              <option value="lt">&lt;</option>
            </select>
          </label>
          <label class="alert-form-field">
            <span>阈值</span>
            <input v-model="policyDraft.threshold" data-testid="alert-policy-threshold" />
          </label>
          <label class="alert-form-field">
            <span>连续次数</span>
            <input v-model.number="policyDraft.consecutiveCount" type="number" min="1" />
          </label>
          <label class="alert-form-field">
            <span>重复通知间隔（分钟）</span>
            <input v-model.number="policyDraft.repeatMinutes" type="number" min="0" />
          </label>
        </div>

        <div class="alert-form-field wide">
          <span>通知渠道</span>
          <div class="alert-channel-options">
            <label v-for="channel in channels" :key="channel.id" class="alert-channel-option" :class="{ 'is-selected': policyDraft.channelIds.includes(channel.id) }">
              <input
                :checked="policyDraft.channelIds.includes(channel.id)"
                type="checkbox"
                :data-testid="`alert-channel-option-${channel.type}`"
                @change="policyDraft.channelIds = policyDraft.channelIds.includes(channel.id)
                  ? policyDraft.channelIds.filter((id) => id !== channel.id)
                  : [...policyDraft.channelIds, channel.id]"
              />
              <span>{{ channelIcon(channel.type) }}</span>
              <b>{{ channelText(channel.type) }}</b>
              <small>{{ channel.target }}</small>
            </label>
          </div>
        </div>

        <label class="alert-recovery">
          <input v-model="policyDraft.recoveryNotify" type="checkbox" data-testid="alert-recovery-toggle" />
          <span>条件恢复后发送恢复通知</span>
        </label>
      </div>
      <template #footer>
        <button class="rc-btn" type="button" @click="policyDialogVisible = false">取消</button>
        <button class="rc-btn primary" type="button" data-testid="alert-save-policy" @click="savePolicy">保存策略</button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.alert-panel { margin: 12px 0 14px; border: 1px solid #dbe3ee; border-radius: 8px; background: #fff; overflow: hidden; }
.alert-panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px 12px 10px; background: #f8fafc; border-bottom: 1px solid #e8eef5; }
.alert-panel-title { color: var(--rc-text); font-size: 13px; font-weight: 800; }
.alert-panel-sub { margin-top: 4px; color: var(--rc-muted); font-size: 11px; line-height: 1.5; }
.alert-panel-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.alert-count { color: var(--rc-muted); font-size: 11px; white-space: nowrap; }
.alert-toggle, .alert-policy-toggle { display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent; color: #047857; font-size: 11px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.alert-toggle:not(.is-on), .alert-policy-toggle[aria-pressed="false"] { color: #64748b; }
.alert-toggle-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.rc-btn.compact { height: 28px; padding: 0 9px; font-size: 11px; }
.alert-context { display: flex; gap: 8px; flex-wrap: wrap; padding: 8px 12px; color: var(--rc-muted); font-size: 11px; border-bottom: 1px solid #eef2f7; }
.alert-context span + span::before { content: '·'; margin-right: 8px; color: #cbd5e1; }
.alert-disabled { margin: 10px 12px; padding: 9px 10px; border: 1px solid #fde68a; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: 11px; }
.alert-policy-list { display: flex; flex-direction: column; }
.alert-policy-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border-bottom: 1px solid #eef2f7; }
.alert-policy-main { min-width: 0; flex: 1; }
.alert-policy-title-row { display: flex; align-items: center; gap: 7px; min-width: 0; }
.alert-policy-title-row strong { overflow: hidden; color: var(--rc-text); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.alert-level, .alert-state, .alert-demo-tag { display: inline-flex; align-items: center; flex: none; height: 20px; padding: 0 6px; border-radius: 4px; font-size: 10px; font-weight: 700; }
.alert-level.is-critical { background: #fef2f2; color: #b91c1c; }
.alert-level.is-warning { background: #fffbeb; color: #b45309; }
.alert-level.is-info { background: #eff6ff; color: #1d4ed8; }
.alert-state { background: #ecfdf5; color: #047857; }
.alert-state.is-off { background: #f1f5f9; color: #64748b; }
.alert-policy-summary { margin-top: 5px; color: var(--rc-text-2); font-size: 11px; }
.alert-policy-meta { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 5px; color: var(--rc-muted); font-size: 10px; }
.alert-policy-actions { display: flex; align-items: center; gap: 9px; flex: none; }
.alert-link { padding: 0; border: 0; background: transparent; color: var(--rc-primary-ink, #2563eb); font-size: 11px; cursor: pointer; }
.alert-link.danger { color: #b91c1c; }
.alert-empty { padding: 18px 12px; color: var(--rc-muted); font-size: 11px; text-align: center; }
.alert-channels { padding: 11px 12px 12px; background: #fbfdff; }
.alert-subhead { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 9px; }
.alert-subhead strong { color: var(--rc-text); font-size: 11px; }
.alert-subhead span { margin-left: 8px; color: var(--rc-muted); font-size: 10px; }
.alert-demo-tag { background: #eff6ff; color: #2563eb; }
.alert-channel-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.alert-channel { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 8px; border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; }
.alert-channel-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 24px; height: 24px; border-radius: 5px; font-size: 11px; font-weight: 800; }
.alert-channel-icon.is-email { background: #eff6ff; color: #2563eb; }
.alert-channel-icon.is-dingtalk { background: #ecfeff; color: #0e7490; }
.alert-channel-body { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: 2px; }
.alert-channel-body strong, .alert-channel-body span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.alert-channel-actions { display: inline-flex; align-items: center; gap: 8px; flex: none; }
.alert-channel-body strong { color: var(--rc-text-2); font-size: 11px; }
.alert-channel-body span { color: var(--rc-muted); font-size: 10px; }
.alert-form { display: flex; flex-direction: column; gap: 14px; }
.alert-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.alert-form-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.alert-form-field.wide { grid-column: 1 / -1; }
.alert-form-field > span { color: var(--rc-text-2); font-size: 11px; font-weight: 700; }
.alert-form-field input, .alert-form-field select { box-sizing: border-box; width: 100%; height: 32px; padding: 0 9px; border: 1px solid #d5e2f2; border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 12px; }
.alert-form-field input:focus, .alert-form-field select:focus { outline: 0; border-color: #60a5fa; box-shadow: 0 0 0 2px #dbeafe; }
.alert-channel-options { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.alert-channel-option { display: grid; grid-template-columns: auto auto 1fr; align-items: center; gap: 6px; padding: 9px; border: 1px solid #dbe3ee; border-radius: 6px; cursor: pointer; }
.alert-channel-option.is-selected { border-color: #93c5fd; background: #eff6ff; }
.alert-channel-option input, .alert-recovery input { accent-color: #2563eb; }
.alert-channel-option b { color: var(--rc-text-2); font-size: 11px; }
.alert-channel-option small { grid-column: 2 / -1; overflow: hidden; color: var(--rc-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.alert-recovery { display: inline-flex; align-items: center; gap: 7px; color: var(--rc-text-2); font-size: 11px; cursor: pointer; }
.alert-secret-hint { padding: 9px 10px; border: 1px solid #bfdbfe; border-radius: 6px; background: #eff6ff; color: #1d4ed8; font-size: 11px; line-height: 1.5; }
@media (max-width: 720px) {
  .alert-panel-head, .alert-policy-row { align-items: flex-start; flex-direction: column; }
  .alert-panel-actions { justify-content: flex-start; }
  .alert-channel-grid, .alert-channel-options, .alert-form-grid { grid-template-columns: 1fr; }
}
</style>
