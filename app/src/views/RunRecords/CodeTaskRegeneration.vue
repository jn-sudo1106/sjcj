<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
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
const emit = defineEmits<{ created: [job: MqCodeJob]; cancel: [] }>()
const loading = ref(true), submitting = ref(false), error = ref(''), models = ref<ModelInterface[]>([])
const prepared = ref<Awaited<ReturnType<typeof api.prepareCodeRegeneration>> | null>(null)
const systemPrompt = ref(''), userPrompt = ref(''), correction = ref(''), interfaceId = ref(''), updateNodePrompts = ref(false)
const rightTab = ref('result')
const open = ref(true), showPrevious = ref(false)
const templates = ref<NodePromptTemplate[]>([]), templatesLoading = ref(false), templateError = ref('')
const selectedTemplateId = ref(0)
const promptTab = ref<'system' | 'user'>('user')
function applyPrompt(value: string) { if (promptTab.value === 'system') systemPrompt.value = value; else userPrompt.value = value; selectedTemplateId.value = 0 }
const promptText = computed(() => JSON.stringify([systemPrompt.value, userPrompt.value]))
let appliedPromptText = ''
let requestId = newRequestId(), submittedBody = '', alive = true
const files = computed(() => props.job.result?.archive?.files || [])
const modelMissing = computed(() => !!interfaceId.value && interfaceId.value !== ALL_AGENTS && !models.value.some(model => model.id === interfaceId.value))
const ready = computed(() => !loading.value && !!prepared.value && !modelMissing.value && !!interfaceId.value && !!systemPrompt.value.trim() && !!userPrompt.value.trim())
const missingTemplateFields = computed(() => selectedTemplateId.value > 0 && /\{\{\s*output_fields\s*\}\}/.test(systemPrompt.value + '\n' + userPrompt.value))
function repositoryFile(path: string) { return { path: '/settings', query: { tab: 'code-repos', repoId: props.job.result?.archive?.repoId, filePath: path } } }

async function loadTemplates(snapshot: NonNullable<typeof prepared.value>) {
  templatesLoading.value = true
  try {
    const sourceType = snapshot.generation.configType || (await api.resolveGenerationDestination({
      configId: snapshot.context.configId, queueName: snapshot.generation.queueName,
    })).configType
    const items = await nodePromptApi.list({ sourceType, templateUse: 'script' })
    if (alive) templates.value = items.filter(item => item.isActive === 1)
  } catch (e) {
    if (alive) templateError.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (alive) templatesLoading.value = false
  }
}

async function selectTemplate(id: number) {
  if (!prepared.value || loading.value || submitting.value || id === selectedTemplateId.value) return
  if (!id) { selectedTemplateId.value = 0; return }
  const template = templates.value.find(item => item.promptId === id)
  if (!template) return
  if (promptText.value !== appliedPromptText) {
    try {
      await ElMessageBox.confirm('切换提示词将替换当前系统和用户提示词，是否继续？', '切换提示词', {
        confirmButtonText: '切换', cancelButtonText: '保留当前内容', type: 'warning',
      })
    } catch { return }
  }
  if (!alive || submitting.value) return
  const { generation, context } = prepared.value
  const original = generation.userPrompt || ''
  const outputBlock = siteScriptOutputBlock(original)
  const description = original.match(/^[ \t]*(?:-[ \t]*)?需求描述[：:][ \t]*([^\r\n]+)$/m)?.[1]?.trim()
  const variables = { ...context, source_id: context.sourceId, config_id: context.configId,
    url: generation.url, queue_name: generation.queueName,
    ...(outputBlock ? { output_fields: outputBlock, output_table: outputBlock.match(/^输出表：(.+)$/m)?.[1] || '' } : {}),
    ...(description ? { describe: description } : {}),
  }
  systemPrompt.value = fillNodePrompt(template.systemPrompt, variables)
  const rendered = fillNodePrompt(template.userPromptTemplate || original, variables)
  const prompt = outputBlock && !rendered.includes(outputBlock) ? `${rendered}\n\n${outputBlock}` : rendered
  userPrompt.value = withSiteScriptQueuePrompt(prompt, generation.queueName)
  selectedTemplateId.value = id
  appliedPromptText = promptText.value
}

onMounted(async () => {
  try {
    const [snapshot, settings] = await Promise.all([api.prepareCodeRegeneration(props.job.taskId), api.modelInterfaces()])
    if (!alive) return
    prepared.value = snapshot; models.value = settings.items.filter(model => model.enabled && isAgentInterface(model))
    systemPrompt.value = snapshot.generation.systemPrompt || ''; userPrompt.value = snapshot.generation.userPrompt || ''
    interfaceId.value = props.job.result?.interfaceId || props.job.modelCall?.interfaceId || snapshot.generation.interfaceId || ''
    appliedPromptText = promptText.value
    void loadTemplates(snapshot)
  } catch (e) { if (alive) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (alive) loading.value = false }
})
onBeforeUnmount(() => { alive = false })
async function submit() {
  if (!ready.value || submitting.value || !prepared.value) return
  submitting.value = true; error.value = ''
  try {
    const input = { taskId: props.job.taskId, systemPrompt: systemPrompt.value, userPrompt: userPrompt.value,
      correction: correction.value, interfaceId: interfaceId.value, updateNodePrompts: updateNodePrompts.value, nodePromptRevision: prepared.value.nodePromptRevision }
    const fingerprint = JSON.stringify(input)
    if (submittedBody && submittedBody !== fingerprint) requestId = newRequestId()
    submittedBody = fingerprint
    const result = await api.regenerateCodeTask({ ...input, requestId })
    if (alive) emit('created', result.job)
  } catch (e) { if (alive) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (alive) submitting.value = false }
}
</script>

<template>
  <AiCodeWorkspaceDialog v-model="open" title="代码生成 · 修改后重新生成" :busy="submitting" data-testid="regeneration-dialog" @close="emit('cancel')">
    <section v-loading="loading" class="regeneration" :class="{ 'has-previous': showPrevious }" aria-label="修改后重新生成" data-testid="regeneration-workspace">
      <div class="regeneration-heading"><span class="regeneration-context">原任务 {{ job.taskId }} · 第 {{ (job.attempt || 1) + 1 }} 次生成</span><el-button link type="primary" data-testid="toggle-previous-generation" @click="showPrevious = !showPrevious">{{ showPrevious ? '收起上次结果' : '查看上次结果' }}</el-button></div>
      <p v-if="prepared" class="regeneration-context">{{ prepared.context.sourceName || prepared.context.sourceId }} · 流程 {{ prepared.context.flowId }} · {{ prepared.context.nodeName }} · 配置 {{ prepared.context.configId }}</p>
      <el-alert v-if="error" :title="error" type="error" :closable="false" data-testid="regeneration-error" />
      <div class="regeneration-columns">
      <form class="regeneration-form" @submit.prevent="submit">
        <div class="regeneration-mode">任务方式<span>提交后创建新任务，原任务记录保留</span></div>
        <div class="regeneration-controls">
        <PromptTemplatePicker :items="templates" :model-value="selectedTemplateId" :loading="templatesLoading" :disabled="loading || submitting" test-id="regeneration-prompt-template" @select="selectTemplate" />
        <el-alert v-if="templateError" :title="`提示词模板加载失败：${templateError}`" type="warning" :closable="false" />
        <el-alert v-if="missingTemplateFields" title="原任务没有记录输出字段，请在提示词中补全字段名和字段 ID" type="warning" :closable="false" />
        <label>智能体接口<el-select v-model="interfaceId" aria-label="重新生成智能体接口" :disabled="submitting || loading" filterable><el-option :value="ALL_AGENTS" label="全选 · 任意空闲智能体" /><el-option v-if="modelMissing" :value="interfaceId" :label="`${interfaceId}（已停用或不存在）`" disabled /><el-option v-for="model in models" :key="model.id" :value="model.id" :label="`${model.name} · ${model.model || '默认模型'} · ${agentStatusLabel(model)}`" /></el-select></label>
        </div>
        <CodeGenerationPromptVariables />
        <div class="regeneration-prompts">
          <div class="regeneration-prompt-left"><nav aria-label="选择提示词类型"><el-button :type="promptTab === 'system' ? 'primary' : 'default'" data-testid="regeneration-system-tab" @click="promptTab = 'system'">系统提示词</el-button><el-button :type="promptTab === 'user' ? 'primary' : 'default'" data-testid="regeneration-user-tab" @click="promptTab = 'user'">用户提示词</el-button></nav>
          <label v-show="promptTab === 'system'">系统提示词<el-input v-model="systemPrompt" aria-label="重新生成系统提示词" type="textarea" :rows="12" maxlength="12000" :disabled="submitting || loading" /></label>
          <label v-show="promptTab === 'user'">用户提示词<el-input v-model="userPrompt" aria-label="重新生成用户提示词" type="textarea" :rows="12" maxlength="12000" readonly :disabled="submitting || loading" /></label></div>
          <section class="regeneration-prompt-chat"><PromptAiEditor v-if="!loading && prepared" :key="promptTab" embedded :prompt-type="promptTab" :prompt="promptTab === 'system' ? systemPrompt : userPrompt" :disabled="submitting" @apply="applyPrompt" /></section>
        </div>
        <label>本次修正要求<el-input v-model="correction" aria-label="本次修正要求" type="textarea" :rows="3" maxlength="12000" :disabled="submitting || loading" placeholder="如：发布日期取错了，请使用列表中的日期" /></label>
        <div class="regeneration-submit"><el-checkbox v-model="updateNodePrompts" aria-label="同时更新节点提示词" :disabled="submitting || !prepared?.canUpdateNode">同时更新节点提示词</el-checkbox><el-button type="primary" native-type="submit" :loading="submitting" :disabled="!ready || submitting" data-testid="submit-regeneration">提交生成任务</el-button></div>
      </form>
      <section v-if="showPrevious" class="regeneration-previous" aria-label="上次生成结果">
        <b>上次任务 {{ job.taskId }}</b>
        <el-tabs v-model="rightTab"><el-tab-pane label="上次结果" name="result">
          <p v-if="job.message">{{ job.message }}</p>
          <ul v-if="files.length"><li v-for="file in files" :key="file.path"><RouterLink :to="repositoryFile(file.path)" target="_blank" rel="noopener">{{ file.path }}</RouterLink></li></ul>
          <p v-else>暂无已归档文件</p>
          <pre v-if="job.result?.code" data-testid="previous-code-snapshot">{{ job.result.code }}</pre>
        </el-tab-pane><el-tab-pane label="错误和过程输出" name="output"><pre>{{ job.stages?.join('\n') }}{{ job.stages?.length ? '\n\n' : '' }}{{ job.output || job.message || '暂无过程输出' }}</pre></el-tab-pane></el-tabs>
      </section>
      </div>
    </section>
    <template #footer><el-button :disabled="submitting" @click="emit('cancel')">关闭</el-button></template>
  </AiCodeWorkspaceDialog>
</template>

<style scoped>
.regeneration:not(.has-previous) .regeneration-columns{grid-template-rows:minmax(0,1fr)}.regeneration-prompt-left{padding:12px;border:1px solid var(--el-border-color-light);border-radius:8px;background:var(--el-bg-color)}.regeneration-prompt-chat{display:flex;min-height:0;overflow:hidden}.regeneration .regeneration-prompts{flex:1;align-items:stretch}
.regeneration-controls { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); align-items:end; gap:12px; }.regeneration-controls>.el-alert { grid-column:1/-1; }@media(max-width:760px){.regeneration-controls{grid-template-columns:1fr}}
.regeneration-prompt-left { display:flex; flex-direction:column; min-width:0; gap:10px; min-height:360px; align-self:stretch; }.regeneration-prompt-left nav { display:flex; gap:8px; }.regeneration-prompt-left nav .el-button { margin:0; }.regeneration-prompt-left label { flex:1; }.regeneration-prompt-chat { min-width:0; padding:12px; border:1px solid var(--el-border-color-light); border-radius:8px; background:var(--el-bg-color); }
.regeneration{display:flex;flex-direction:column;gap:10px;min-width:0;height:min(760px,calc(100dvh - 160px));min-height:0;overflow:auto}.regeneration-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.regeneration-context{margin:0;color:var(--el-text-color-secondary);font-size:12px;overflow-wrap:anywhere}.regeneration-columns{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;min-width:0;flex:1;min-height:0}.regeneration-form{display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0;padding:14px;border:1px solid var(--el-border-color-lighter);border-radius:8px;background:var(--rc-primary-bg,var(--el-color-primary-light-9))}.regeneration-form> :not(.regeneration-prompts){flex-shrink:0}.regeneration-form label{display:flex;flex-direction:column;gap:6px;font-size:13px;min-width:0}.regeneration-form .el-select{width:100%}.regeneration-mode{font-size:13px;color:var(--el-color-primary);font-weight:600}.regeneration-mode span{font-size:12px;color:var(--el-text-color-secondary);margin-left:14px;font-weight:400}.regeneration-prompts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start;min-height:360px}.regeneration-prompts :deep(.el-textarea){flex:1;min-height:0}.regeneration-prompts :deep(.el-textarea__inner){height:100%;resize:none}.regeneration-submit{display:flex;align-items:center;justify-content:space-between;gap:12px}.regeneration-previous{min-width:0;min-height:0;padding:14px;border:1px solid var(--el-border-color-lighter);border-radius:8px;font-size:12px;overflow-wrap:anywhere}.regeneration-previous pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:var(--el-fill-color-light);border-radius:6px}.regeneration-previous ul{padding-left:16px}.regeneration-previous a{color:var(--el-color-primary)}@media(max-width:760px){.regeneration{height:auto;max-height:calc(100dvh - 180px);overflow:auto}.has-previous .regeneration-columns{grid-template-columns:1fr}.regeneration-form,.regeneration-previous{overflow:visible}.regeneration-prompts{grid-template-columns:1fr;min-height:360px}.regeneration-submit{flex-wrap:wrap}}
</style>
