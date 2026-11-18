<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { streamPromptEditChat, formatModelTestOutput } from '@/api/modelInterfaceStream'
import { CODE_GENERATION_PROMPT_VARIABLES } from '@/utils/codeGenerationPromptVariables'
import CodeGenerationPromptVariables from './CodeGenerationPromptVariables.vue'
import { promptEditReply, validatePromptEdit } from '@/utils/promptEditReply'

const props = defineProps<{ prompt: string; embedded?: boolean; promptType?: 'system' | 'user'; disabled?: boolean }>()
const emit = defineEmits<{ close: []; apply: [prompt: string] }>()
interface Message { role: 'user' | 'assistant'; text: string; content: string; failed?: boolean }
const base = ref(props.prompt)
const promptLabel = computed(() => props.promptType === 'system' ? '系统提示词' : '用户提示词')
const selected = ref(''), selectedName = ref(''), selectedMachine = ref(''), sending = ref(false)
const question = ref(''), messages = ref<Message[]>([]), candidate = ref<string | null>(null), error = ref(''), stale = ref(false)
const resultEl = ref<HTMLElement>()
const canApply = computed(() => !props.disabled && !sending.value && !stale.value && candidate.value !== null && candidate.value !== base.value && !validatePromptEdit(base.value, candidate.value))
let controller: AbortController | undefined, session = 0, stopped = false
function cancel() {
  session++; controller?.abort(); sending.value = false; candidate.value = null
  const last = messages.value.at(-1)
  if (last?.role === 'assistant' && !last.content) { last.failed = true; last.text = '本轮修改已取消' }
}
async function send() {
  const text = question.value.trim()
  if (!text || text.length > 2000 || props.disabled || sending.value || stale.value) return
  const request = ++session
  controller = new AbortController(); sending.value = true; error.value = ''; candidate.value = null
  messages.value.push({ role: 'user', text, content: text }); question.value = ''
  const transcript = messages.value.filter(item => !item.failed).map(item => ({ role: item.role, content: item.content })).slice(-8)
  const reply = ref<Message>({ role: 'assistant', text: '正在整理修改…', content: '' })
  messages.value.push(reply.value)
  const index = messages.value.length - 1
  let raw = ''
  try {
    await streamPromptEditChat({ automatic: true, ...(selected.value ? { interfaceId: selected.value } : {}), basePrompt: base.value, messages: transcript,
      ...(props.promptType ? { promptType: props.promptType } : {}),
      variableCatalog: CODE_GENERATION_PROMPT_VARIABLES.map(([name, description]) => ({ name, description })) }, event => {
      if (request !== session || stopped) return
      if (event.type === 'connecting' && event.interfaceId) {
        selected.value = event.interfaceId; selectedName.value = event.interfaceName || event.interfaceId
        selectedMachine.value = [event.serverName, event.serverAddress].filter(Boolean).join(' · ')
      }
      if (event.type === 'headers' && !event.ok) throw new Error(`Chat 接口返回 HTTP ${event.status}`)
      if (event.type === 'chunk') {
        raw += event.text
        const text = formatModelTestOutput(raw, true)
        messages.value[index]!.text = text.startsWith('{') ? '正在整理修改…' : text
      }
    }, controller.signal)
    if (request !== session || stopped) return
    const result = promptEditReply(raw)
    messages.value[index] = { role: 'assistant', text: result.reply || '已完成修改，请查看下方完整提示词', content: JSON.stringify(result) }
    if (result.userPrompt !== null) {
      const invalid = validatePromptEdit(base.value, result.userPrompt)
      if (invalid) error.value = invalid
      else candidate.value = result.userPrompt
    }
    await nextTick(); resultEl.value?.scrollIntoView?.({ block: 'nearest' })
  } catch (e) {
    if (request !== session || stopped) return
    messages.value[index]!.failed = true
    messages.value[index]!.text = raw ? formatModelTestOutput(raw) : '本轮修改未完成'
    error.value = e instanceof Error ? e.message : String(e)
  } finally { if (request === session) sending.value = false }
}
function rebase() { cancel(); base.value = props.prompt; messages.value = []; candidate.value = null; stale.value = false; error.value = '' }
function apply() {
  if (!canApply.value || candidate.value === null) return
  const value = candidate.value
  if (props.embedded) { base.value = value; messages.value = []; candidate.value = null; error.value = ''; stale.value = false }
  emit('apply', value)
}
watch(() => props.prompt, value => {
  if (value === base.value) return
  if (props.embedded && !messages.value.length) { rebase(); return }
  cancel(); stale.value = true
  error.value = props.embedded ? '提示词已更新，请使用最新内容重新对话' : '原提示词已更新，请关闭后重新打开 AI 修改'
})
onBeforeUnmount(() => { stopped = true; cancel() })
</script>

<template>
  <component :is="embedded ? 'section' : 'el-drawer'" :class="{ 'pa-embedded': embedded }" v-bind="embedded ? {} : { modelValue: true, title: `AI 修改${promptLabel}`, size: 'min(880px, 94vw)', appendToBody: true }" @close="emit('close')">
    <div class="prompt-ai-editor">
      <p class="pa-current-model" data-testid="prompt-edit-current-agent">{{ selectedName ? `当前对话：${selectedName}${selectedMachine ? ` · ${selectedMachine}` : ''}` : sending ? '正在分配空闲智能体…' : '发送后自动分配空闲智能体' }}</p>
      <b v-if="embedded">AI 修改{{ promptLabel }}</b>
      <details v-if="!embedded"><summary>查看当前{{ promptLabel }}</summary><pre>{{ base }}</pre></details>
      <CodeGenerationPromptVariables v-if="!embedded" />
      <p class="pa-note">描述你希望调整的内容，可以连续对话；确认应用后才会替换当前{{ promptLabel }}。</p>
      <section v-for="(message, index) in messages" :key="index" class="pa-message" :class="message.role"><b>{{ message.role === 'user' ? '你' : 'AI' }}</b><p>{{ message.text }}</p></section>
      <div class="pa-input"><el-input v-model="question" type="textarea" :rows="8" resize="vertical" maxlength="2000" show-word-limit :disabled="disabled || sending || stale" placeholder="例如：只采集当前列表页，不进入详情页；失败时只返回简短原因" aria-label="提示词修改要求" /><el-button type="primary" :loading="sending" :disabled="disabled || !question.trim() || stale" data-testid="prompt-edit-send" @click="send">发送</el-button><el-button v-if="sending" @click="cancel">取消本轮</el-button></div>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-button v-if="embedded && stale" @click="rebase">使用最新提示词重新对话</el-button>
      <section v-if="candidate !== null" ref="resultEl" class="pa-result" data-testid="prompt-edit-preview"><b>修改后的完整{{ promptLabel }}</b><pre>{{ candidate }}</pre></section>
      <el-button v-if="embedded" type="primary" :disabled="!canApply" data-testid="prompt-edit-apply" @click="apply">应用修改</el-button>
    </div>
    <template v-if="!embedded" #footer><el-button @click="emit('close')">关闭</el-button><el-button type="primary" :disabled="!canApply" data-testid="prompt-edit-apply" @click="apply">应用修改</el-button></template>
  </component>
</template>

<style scoped>
.pa-embedded{display:flex;flex:1;min-width:0;min-height:0}.pa-embedded .prompt-ai-editor{flex:1;overflow:auto;min-height:0}.pa-embedded .prompt-ai-editor>*{flex-shrink:0}.pa-embedded .pa-input{flex:1;min-height:180px;align-items:stretch}.pa-embedded .pa-input>.el-button{align-self:flex-end}.pa-embedded .pa-input :deep(.el-textarea__inner){height:100%;min-height:180px}.pa-current-model{margin:0;color:var(--el-text-color-secondary);font-size:12px}
.prompt-ai-editor{display:flex;flex-direction:column;gap:12px;min-width:0;font-size:13px}.pa-model{display:flex;align-items:center;gap:8px}.pa-model .el-select{flex:1;min-width:0}.pa-model>span{white-space:nowrap}pre{margin:8px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.6}.pa-note,summary{color:var(--el-text-color-secondary)}summary{cursor:pointer}.pa-message{padding:10px 12px;border-radius:6px;background:var(--el-fill-color-light)}.pa-message.user{background:var(--el-color-primary-light-9)}.pa-message p{margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}.pa-input{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap}.pa-input .el-textarea{flex:1;min-width:240px}.pa-input .el-button+.el-button{margin-left:0}.pa-result{padding:12px;border:1px solid var(--el-border-color-light);border-radius:6px}
</style>
