<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { ALL_AGENTS, isAgentInterface, agentStatusLabel } from '@/utils/agentPool'
import { runnerManagementApi as api, type MqCodeJob, type ModelInterface } from '@/api/runnerManagement'
import { fillNodePrompt, nodePromptApi, type NodePromptTemplate } from '@/api/nodePrompts'
import { createGenerationTaskId as newRequestId } from '@/utils/generationWorkspace'
import { siteScriptOutputBlock, withSiteScriptQueuePrompt } from '@/utils/flow/siteScriptOutputPrompt'
import CodeGenerationPromptVariables from '@/components/CodeGenerationPromptVariables.vue'
import AiCodeWorkspaceDialog from '@/components/AiCodeWorkspaceDialog.vue'
import PromptTemplatePicker from '@/views/FlowCanvas/inspector/PromptTemplatePicker.vue'
import PromptAiEditor from '@/components/PromptAiEditor.vue'

const props = defineProps<{ job: MqCodeJob }>()
const emit = defineEmits<{ created: [job: MqCodeJob]; updated: [job: MqCodeJob]; cancel: [] }>()
interface Message { id: string; role: 'user' | 'assistant'; text: string; job?: MqCodeJob }
const statuses = { queued: '等待智能体', running: '正在修改代码', succeeded: '本轮完成', failed: '本轮失败' }
const processOutput = (job: MqCodeJob) => `${job.stages?.join('\n') || ''}${job.stages?.length ? '\n\n' : ''}${job.output || '暂无过程输出'}`
const messages = ref<Message[]>([{ id: `assistant:${props.job.taskId}`, role: 'assistant', text: processOutput(props.job), job: props.job }])
const currentJob = ref(props.job), parentTaskId = ref(props.job.taskId)
const prepared = ref<Awaited<ReturnType<typeof api.prepareCodeRegeneration>> | null>(null)
const loading = ref(true), submitting = ref(false), tracking = ref(false), rebasing = ref(false), error = ref(''), pollingError = ref('')
const models = ref<ModelInterface[]>([]), systemPrompt = ref(''), userPrompt = ref(''), correction = ref(''), interfaceId = ref('')
const updateNodePrompts = ref(false), settingsOpen = ref(false), promptAiOpen = ref(false), open = ref(true)
const templates = ref<NodePromptTemplate[]>([]), templatesLoading = ref(false), templateError = ref(''), selectedTemplateId = ref(0)
const promptTab = ref<'system' | 'user'>('user'), feed = ref<HTMLElement>(), following = ref(true)
const promptText = computed(() => JSON.stringify([systemPrompt.value, userPrompt.value]))
const modelMissing = computed(() => !!interfaceId.value && interfaceId.value !== ALL_AGENTS && !models.value.some(item => item.id === interfaceId.value))
const ready = computed(() => !loading.value && !rebasing.value && !!prepared.value && !modelMissing.value && !!interfaceId.value && !!systemPrompt.value.trim() && !!userPrompt.value.trim())
const canSend = computed(() => ready.value && !submitting.value && !tracking.value && !!correction.value.trim())
const agentLabel = computed(() => {
  const actual = currentJob.value.modelCall
  if (actual?.interfaceId && (tracking.value || actual.interfaceId === interfaceId.value)) return [actual.name, actual.serverName, actual.serverAddress].filter(Boolean).join(' · ')
  if (interfaceId.value === ALL_AGENTS) return '自动匹配空闲智能体'
  const item = models.value.find(model => model.id === interfaceId.value)
  return item?.name || interfaceId.value || '未选择智能体'
})
const missingTemplateFields = computed(() => selectedTemplateId.value > 0 && /\{\{\s*output_fields\s*\}\}/.test(systemPrompt.value + '\n' + userPrompt.value))
let alive = true, appliedPromptText = '', requestId = newRequestId(), submittedBody = '', pollingSequence = 0
let timer: ReturnType<typeof setTimeout> | undefined
function repositoryFile(path: string, job: MqCodeJob) { return { path: '/settings', query: { tab: 'code-repos', repoId: job.result?.archive?.repoId, filePath: path } } }
function applyPrompt(value: string) { if (promptTab.value === 'system') systemPrompt.value = value; else userPrompt.value = value; selectedTemplateId.value = 0; promptAiOpen.value = false }
function onScroll() { if (feed.value) following.value = feed.value.scrollHeight - feed.value.scrollTop - feed.value.clientHeight < 48 }
function scrollReply() { if (following.value) void nextTick(() => { if (feed.value) feed.value.scrollTop = feed.value.scrollHeight }) }
async function loadTemplates(snapshot: NonNullable<typeof prepared.value>) {
  templatesLoading.value = true
  try {
    const sourceType = snapshot.generation.configType || (await api.resolveGenerationDestination({ configId: snapshot.context.configId, queueName: snapshot.generation.queueName })).configType
    const items = await nodePromptApi.list({ sourceType, templateUse: 'script' })
    if (alive) templates.value = items.filter(item => item.isActive === 1)
  } catch (e) { if (alive) templateError.value = e instanceof Error ? e.message : String(e) }
  finally { if (alive) templatesLoading.value = false }
}
async function selectTemplate(id: number) {
  if (!prepared.value || loading.value || submitting.value || tracking.value || id === selectedTemplateId.value) return
  if (!id) { selectedTemplateId.value = 0; return }
  const template = templates.value.find(item => item.promptId === id)
  if (!template) return
  if (promptText.value !== appliedPromptText) {
    try { await ElMessageBox.confirm('切换提示词将替换当前系统和用户提示词，是否继续？', '切换提示词', { confirmButtonText: '切换', cancelButtonText: '保留当前内容', type: 'warning' }) }
    catch { return }
  }
  if (!alive || submitting.value || tracking.value) return
  const { generation, context } = prepared.value
  const original = generation.userPrompt || '', outputBlock = siteScriptOutputBlock(original)
  const description = original.match(/^[ \t]*(?:-[ \t]*)?需求描述[：:][ \t]*([^\r\n]+)$/m)?.[1]?.trim()
  const variables = { ...context, source_id: context.sourceId, config_id: context.configId, url: generation.url, queue_name: generation.queueName,
    ...(outputBlock ? { output_fields: outputBlock, output_table: outputBlock.match(/^输出表：(.+)$/m)?.[1] || '' } : {}), ...(description ? { describe: description } : {}) }
  systemPrompt.value = fillNodePrompt(template.systemPrompt, variables)
  const rendered = fillNodePrompt(template.userPromptTemplate || original, variables)
  userPrompt.value = withSiteScriptQueuePrompt(outputBlock && !rendered.includes(outputBlock) ? `${rendered}\n\n${outputBlock}` : rendered, generation.queueName)
  selectedTemplateId.value = id; appliedPromptText = promptText.value
}
function adoptSnapshot(snapshot: NonNullable<typeof prepared.value>, job: MqCodeJob) {
  prepared.value = snapshot
  systemPrompt.value = snapshot.generation.systemPrompt || ''; userPrompt.value = snapshot.generation.userPrompt || ''
  interfaceId.value = job.result?.interfaceId || job.modelCall?.interfaceId || snapshot.generation.interfaceId || ''
  selectedTemplateId.value = 0; appliedPromptText = promptText.value
}
async function rebase(job: MqCodeJob) {
  rebasing.value = true; prepared.value = null
  try {
    const snapshot = await api.prepareCodeRegeneration(job.taskId)
    if (alive && currentJob.value.taskId === job.taskId) { adoptSnapshot(snapshot, job); error.value = '' }
  } catch (e) { if (alive) error.value = `读取下一轮生成配置失败：${e instanceof Error ? e.message : String(e)}` }
  finally { if (alive) rebasing.value = false }
}
async function poll(taskId: string, sequence: number) {
  if (!alive || sequence !== pollingSequence) return
  try {
    const result = await api.mqCodeJob(taskId)
    if (!alive || sequence !== pollingSequence) return
    if (!result.job || result.job.taskId !== taskId) throw new Error('智能体任务回复不匹配')
    const job = result.job
    currentJob.value = job; pollingError.value = ''
    const reply = messages.value.find(message => message.id === `assistant:${taskId}`)
    if (reply) { reply.job = job; reply.text = processOutput(job) }
    scrollReply()
    if (['succeeded', 'failed'].includes(job.status)) {
      tracking.value = false; parentTaskId.value = job.taskId
      await rebase(job)
      if (alive) emit('updated', job)
      return
    }
  } catch (e) { if (alive && sequence === pollingSequence) pollingError.value = `读取智能体回复失败，将重试：${e instanceof Error ? e.message : String(e)}` }
  if (alive && sequence === pollingSequence) timer = setTimeout(() => { void poll(taskId, sequence) }, 1500)
}
onMounted(async () => {
  try {
    const [snapshot, settings] = await Promise.all([api.prepareCodeRegeneration(props.job.taskId), api.modelInterfaces()])
    if (!alive) return
    models.value = settings.items.filter(item => item.enabled && isAgentInterface(item)); adoptSnapshot(snapshot, props.job)
    void loadTemplates(snapshot)
  } catch (e) { if (alive) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (alive) loading.value = false }
})
onBeforeUnmount(() => { alive = false; pollingSequence++; clearTimeout(timer) })
async function submit() {
  if (!canSend.value || !prepared.value) return
  submitting.value = true; error.value = ''
  const text = correction.value.trim()
  try {
    const input = { taskId: parentTaskId.value, systemPrompt: systemPrompt.value, userPrompt: userPrompt.value, correction: text,
      interfaceId: interfaceId.value, updateNodePrompts: updateNodePrompts.value, nodePromptRevision: prepared.value.nodePromptRevision }
    const fingerprint = JSON.stringify(input)
    if (submittedBody && submittedBody !== fingerprint) requestId = newRequestId()
    submittedBody = fingerprint
    const result = await api.regenerateCodeTask({ ...input, requestId })
    if (!alive) return
    const child = result.job
    messages.value.push({ id: `user:${child.taskId}`, role: 'user', text }, { id: `assistant:${child.taskId}`, role: 'assistant', text: processOutput(child), job: child })
    currentJob.value = child; correction.value = ''; submittedBody = ''; requestId = newRequestId()
    tracking.value = true; following.value = true; scrollReply(); emit('created', child)
    void poll(child.taskId, ++pollingSequence)
  } catch (e) { if (alive) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (alive) submitting.value = false }
}
</script>

<template>
  <AiCodeWorkspaceDialog v-model="open" title="代码生成 · 继续修改" :busy="submitting" data-testid="regeneration-dialog" @close="emit('cancel')">
    <section v-loading="loading" class="regeneration" aria-label="与智能体继续修改代码" data-testid="regeneration-workspace">
      <header class="regeneration-heading"><div><b>智能体：{{ agentLabel }}</b><p v-if="prepared">{{ prepared.context.sourceName || prepared.context.sourceId }} · 流程 {{ prepared.context.flowId }} · {{ prepared.context.nodeName }} · 配置 {{ prepared.context.configId }}</p></div><el-button :disabled="loading || submitting || tracking || rebasing" data-testid="regeneration-settings" @click="settingsOpen = true">生成设置</el-button></header>
      <el-alert v-if="error" :title="error" type="error" :closable="false" data-testid="regeneration-error" />
      <el-alert v-if="modelMissing && !loading" title="原智能体已停用或不存在，请在生成设置中选择可用智能体" type="warning" :closable="false" />
      <el-alert v-if="pollingError" :title="pollingError" type="warning" :closable="false" />
      <el-button v-if="!loading && !prepared && !rebasing && !tracking" link type="primary" @click="rebase(currentJob)">重新读取生成配置</el-button>
      <div ref="feed" class="generation-chat-feed" role="log" aria-label="代码生成对话" data-testid="generation-chat-feed" @scroll="onScroll">
        <article v-for="message in messages" :key="message.id" class="generation-chat-message" :class="message.role" :data-testid="message.role === 'assistant' ? 'generation-agent-reply' : 'generation-user-message'">
          <header><b>{{ message.role === 'user' ? '你' : '智能体' }}</b><span v-if="message.job" :class="`status-${message.job.status}`">{{ statuses[message.job.status] }} · {{ message.job.taskId }}</span></header>
          <pre>{{ message.text }}</pre>
          <p v-if="message.job?.status === 'failed' && message.job.message && !message.text.includes(message.job.message)" class="generation-chat-failure">{{ message.job.message }}</p>
          <details v-if="message.job?.result?.code || message.job?.result?.archive?.files.length" class="generation-chat-result"><summary>查看本轮代码和文件</summary><ul v-if="message.job.result.archive?.files.length"><li v-for="file in message.job.result.archive.files" :key="file.path"><RouterLink :to="repositoryFile(file.path, message.job)" target="_blank" rel="noopener">{{ file.path }}</RouterLink></li></ul><pre v-if="message.job.result.code">{{ message.job.result.code }}</pre></details>
        </article>
      </div>
      <form class="generation-chat-composer" @submit.prevent="submit">
        <el-input v-model="correction" aria-label="本次修正要求" type="textarea" :rows="6" resize="vertical" maxlength="12000" show-word-limit :disabled="loading || submitting || tracking || rebasing" placeholder="针对上面的结果继续提出修改要求，智能体会继续修改代码" />
        <div class="generation-chat-send"><span>{{ tracking ? '智能体正在修改代码，回复会显示在上方' : rebasing ? '正在准备下一轮对话…' : '发送给生成脚本的智能体，生成的代码按原配置保存和提交' }}</span><el-button type="primary" native-type="submit" :loading="submitting || tracking" :disabled="!canSend" data-testid="submit-regeneration">{{ tracking ? '正在修改' : '发送并修改代码' }}</el-button></div>
      </form>
    </section>
    <template #footer><el-button :disabled="submitting" @click="emit('cancel')">关闭</el-button></template>
  </AiCodeWorkspaceDialog>
  <el-drawer v-model="settingsOpen" title="生成设置" size="min(760px, 94vw)" append-to-body>
    <section class="regeneration-settings">
      <PromptTemplatePicker :items="templates" :model-value="selectedTemplateId" :loading="templatesLoading" :disabled="submitting || tracking" test-id="regeneration-prompt-template" @select="selectTemplate" />
      <el-alert v-if="templateError" :title="`提示词模板加载失败：${templateError}`" type="warning" :closable="false" />
      <el-alert v-if="missingTemplateFields" title="原任务没有记录输出字段，请补全字段名和字段 ID" type="warning" :closable="false" />
      <label>智能体<el-select v-model="interfaceId" aria-label="重新生成智能体接口" :disabled="submitting || tracking" filterable><el-option :value="ALL_AGENTS" label="全选 · 任意空闲智能体" /><el-option v-if="modelMissing" :value="interfaceId" :label="`${interfaceId}（已停用或不存在）`" disabled /><el-option v-for="model in models" :key="model.id" :value="model.id" :label="`${model.name} · ${model.model || '默认模型'} · ${agentStatusLabel(model)}`" /></el-select></label>
      <CodeGenerationPromptVariables />
      <nav><el-button :type="promptTab === 'system' ? 'primary' : 'default'" data-testid="regeneration-system-tab" @click="promptTab = 'system'">系统提示词</el-button><el-button :type="promptTab === 'user' ? 'primary' : 'default'" data-testid="regeneration-user-tab" @click="promptTab = 'user'">用户提示词</el-button><el-button link type="primary" @click="promptAiOpen = true">AI 修改当前提示词</el-button></nav>
      <el-input v-show="promptTab === 'system'" v-model="systemPrompt" aria-label="重新生成系统提示词" type="textarea" :rows="12" maxlength="12000" :disabled="submitting || tracking" />
      <el-input v-show="promptTab === 'user'" v-model="userPrompt" aria-label="重新生成用户提示词" type="textarea" :rows="12" maxlength="12000" readonly :disabled="submitting || tracking" />
      <el-checkbox v-model="updateNodePrompts" :disabled="!prepared?.canUpdateNode || submitting || tracking">同时更新节点提示词</el-checkbox>
    </section>
  </el-drawer>
  <PromptAiEditor v-if="promptAiOpen" :prompt-type="promptTab" :prompt="promptTab === 'system' ? systemPrompt : userPrompt" @close="promptAiOpen = false" @apply="applyPrompt" />
</template>

<style scoped>
.regeneration{display:flex;flex-direction:column;gap:12px;height:min(760px,calc(100dvh - 160px));min-height:0;min-width:0}.regeneration-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.regeneration-heading b{font-size:13px}.regeneration-heading p{margin:4px 0 0;color:var(--el-text-color-secondary);font-size:12px}.generation-chat-feed{flex:1;min-height:120px;overflow:auto;display:flex;flex-direction:column;gap:14px;padding:12px;border:1px solid var(--el-border-color-light);border-radius:8px;background:var(--el-fill-color-extra-light)}.generation-chat-message{padding:12px 14px;border:1px solid var(--el-border-color-lighter);border-radius:8px;background:var(--el-bg-color);min-width:0}.generation-chat-message.user{margin-left:8%;background:var(--el-color-primary-light-9)}.generation-chat-message>header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px;font-size:12px}.generation-chat-message>header span{font-size:11px;color:var(--el-text-color-secondary);overflow-wrap:anywhere}.generation-chat-message .status-running{color:var(--el-color-primary)}.generation-chat-message .status-failed,.generation-chat-failure{color:var(--el-color-danger)}.generation-chat-message .status-succeeded{color:var(--el-color-success)}.generation-chat-message pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.7;font-family:var(--el-font-family)}.generation-chat-result{margin-top:10px;font-size:12px}.generation-chat-result summary{cursor:pointer;color:var(--el-color-primary)}.generation-chat-result a{color:var(--el-color-primary)}.generation-chat-result pre{margin-top:8px}.generation-chat-composer{display:flex;flex-direction:column;gap:8px;flex-shrink:0}.generation-chat-send{display:flex;align-items:center;justify-content:space-between;gap:12px}.generation-chat-send>span{font-size:12px;color:var(--el-text-color-secondary)}.regeneration-settings{display:flex;flex-direction:column;gap:16px;min-width:0}.regeneration-settings label{display:flex;flex-direction:column;gap:6px;font-size:13px}.regeneration-settings nav{display:flex;gap:8px;flex-wrap:wrap}.regeneration-settings nav .el-button{margin:0}@media(max-width:760px){.generation-chat-send{align-items:flex-start;flex-direction:column}.regeneration-heading{align-items:flex-start}.generation-chat-message.user{margin-left:3%}}
</style>
