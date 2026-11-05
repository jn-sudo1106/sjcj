<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { runnerManagementApi as api, type MqCodeJob, type ModelInterface } from '@/api/runnerManagement'
import { createGenerationTaskId as newRequestId } from '@/utils/generationWorkspace'
import CodeGenerationPromptVariables from '@/components/CodeGenerationPromptVariables.vue'
import AiCodeWorkspaceDialog from '@/components/AiCodeWorkspaceDialog.vue'

const props = defineProps<{ job: MqCodeJob }>()
const emit = defineEmits<{ created: [job: MqCodeJob]; cancel: [] }>()
const loading = ref(true), submitting = ref(false), error = ref(''), models = ref<ModelInterface[]>([])
const prepared = ref<Awaited<ReturnType<typeof api.prepareCodeRegeneration>> | null>(null)
const systemPrompt = ref(''), userPrompt = ref(''), correction = ref(''), interfaceId = ref(''), updateNodePrompts = ref(false)
const rightTab = ref('result')
const open = ref(true), showPrevious = ref(false)
let requestId = newRequestId(), submittedBody = '', alive = true
const files = computed(() => props.job.result?.archive?.files || [])
const modelMissing = computed(() => !!interfaceId.value && !models.value.some(model => model.id === interfaceId.value))
const ready = computed(() => !loading.value && !!prepared.value && !modelMissing.value && !!interfaceId.value && !!systemPrompt.value.trim() && !!userPrompt.value.trim())
function repositoryFile(path: string) { return { path: '/settings', query: { tab: 'code-repos', repoId: props.job.result?.archive?.repoId, filePath: path } } }
onMounted(async () => {
  try {
    const [snapshot, settings] = await Promise.all([api.prepareCodeRegeneration(props.job.taskId), api.modelInterfaces()])
    if (!alive) return
    prepared.value = snapshot; models.value = settings.items.filter(model => model.enabled)
    systemPrompt.value = snapshot.generation.systemPrompt || ''; userPrompt.value = snapshot.generation.userPrompt || ''; interfaceId.value = snapshot.generation.interfaceId || ''
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
  <AiCodeWorkspaceDialog v-model="open" title="AI 代码工作区 · 修改后重新生成" :busy="submitting" data-testid="regeneration-dialog" @close="emit('cancel')">
    <section v-loading="loading" class="regeneration" :class="{ 'has-previous': showPrevious }" aria-label="修改后重新生成" data-testid="regeneration-workspace">
      <div class="regeneration-heading"><span class="regeneration-context">原任务 {{ job.taskId }} · 第 {{ (job.attempt || 1) + 1 }} 次生成</span><el-button link type="primary" data-testid="toggle-previous-generation" @click="showPrevious = !showPrevious">{{ showPrevious ? '收起上次结果' : '查看上次结果' }}</el-button></div>
      <p v-if="prepared" class="regeneration-context">{{ prepared.context.sourceName || prepared.context.sourceId }} · 流程 {{ prepared.context.flowId }} · {{ prepared.context.nodeName }} · 配置 {{ prepared.context.configId }}</p>
      <el-alert v-if="error" :title="error" type="error" :closable="false" data-testid="regeneration-error" />
      <div class="regeneration-columns">
      <form class="regeneration-form" @submit.prevent="submit">
        <div class="regeneration-mode">任务方式<span>提交后创建新任务，原任务记录保留</span></div>
        <label>模型接口<el-select v-model="interfaceId" aria-label="重新生成模型接口" :disabled="submitting || loading" filterable><el-option v-if="modelMissing" :value="interfaceId" :label="`${interfaceId}（已停用或不存在）`" disabled /><el-option v-for="model in models" :key="model.id" :value="model.id" :label="`${model.name} · ${model.model || '默认模型'}`" /></el-select></label>
        <CodeGenerationPromptVariables />
        <div class="regeneration-prompts">
          <label>系统提示词<el-input v-model="systemPrompt" aria-label="重新生成系统提示词" type="textarea" :rows="12" maxlength="12000" :disabled="submitting || loading" /></label>
          <label>用户提示词<el-input v-model="userPrompt" aria-label="重新生成用户提示词" type="textarea" :rows="12" maxlength="12000" :disabled="submitting || loading" /></label>
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
.regeneration{display:flex;flex-direction:column;gap:10px;min-width:0;height:min(760px,calc(100dvh - 160px));min-height:0}.regeneration-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.regeneration-context{margin:0;color:var(--el-text-color-secondary);font-size:12px;overflow-wrap:anywhere}.regeneration-columns{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;min-width:0;flex:1;min-height:0}.has-previous .regeneration-columns{grid-template-columns:minmax(360px,1.15fr) minmax(0,1.4fr)}.regeneration-form{display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0;overflow-y:auto;padding:14px;border:1px solid var(--el-border-color-lighter);border-radius:8px;background:var(--rc-primary-bg,var(--el-color-primary-light-9))}.regeneration-form> :not(.regeneration-prompts){flex-shrink:0}.regeneration-form label{display:flex;flex-direction:column;gap:6px;font-size:13px;min-width:0}.regeneration-form .el-select{width:100%}.regeneration-mode{font-size:13px;color:var(--el-color-primary);font-weight:600}.regeneration-mode span{font-size:12px;color:var(--el-text-color-secondary);margin-left:14px;font-weight:400}.regeneration-prompts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;flex:1;min-height:240px}.regeneration-prompts :deep(.el-textarea){flex:1;min-height:0}.regeneration-prompts :deep(.el-textarea__inner){height:100%;resize:none}.has-previous .regeneration-prompts{grid-template-columns:1fr;grid-template-rows:repeat(2,minmax(150px,1fr));min-height:320px}.regeneration-submit{display:flex;align-items:center;justify-content:space-between;gap:12px}.regeneration-previous{min-width:0;min-height:0;overflow-y:auto;padding:14px;border:1px solid var(--el-border-color-lighter);border-radius:8px;font-size:12px;overflow-wrap:anywhere}.regeneration-previous pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:var(--el-fill-color-light);border-radius:6px}.regeneration-previous ul{padding-left:16px}.regeneration-previous a{color:var(--el-color-primary)}@media(max-width:760px){.regeneration{height:auto;max-height:calc(100dvh - 180px);overflow:auto}.has-previous .regeneration-columns{grid-template-columns:1fr}.regeneration-form,.regeneration-previous{overflow:visible}.regeneration-prompts{grid-template-columns:1fr;grid-template-rows:repeat(2,minmax(220px,1fr));min-height:456px}.regeneration-submit{flex-wrap:wrap}}
</style>
