<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { flowApi } from '../../api'
import { useFlowStore } from '../../stores/flow'
import { nodeOutputTable } from './flowModel'

// 节点级 AI 对话（0701 问题八）：与顶栏「＋智能生成新流程」（流程级 AI）同体系两层，
// mock 阶段走关键词匹配回复（flowApi.nodeAiChat），二期换真 LLM 界面零改动。
const flow = useFlowStore()
const cfg = computed(() => flow.selectedNode)
const id = computed(() => flow.selectedId)

interface ChatMsg { role: 'user' | 'ai'; text: string }
const messages = ref<ChatMsg[]>([{ role: 'ai', text: `我是「${cfg.value?.title ?? '当前节点'}」的节点助手（演示），可以问我配置、输出表或试跑失败原因。` }])
const input = ref('')
const sending = ref(false)
const scrollEl = ref<HTMLElement | null>(null)

const QUICK_COMMANDS = ['解释该节点配置', '为什么试跑失败', '任务队列怎么填']

async function scrollToBottom() {
  await nextTick()
  if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight
}

async function send(text?: string) {
  const question = (text ?? input.value).trim()
  if (!question || sending.value || !cfg.value) return
  messages.value.push({ role: 'user', text: question })
  input.value = ''
  sending.value = true
  scrollToBottom()
  try {
    const res = await flowApi.nodeAiChat({
      nodeId: id.value,
      question,
      nodeTitle: cfg.value.title,
      outputTable: nodeOutputTable(cfg.value),
      disabled: cfg.value.disabled,
    })
    messages.value.push({ role: 'ai', text: res?.reply || '（无回复）' })
  } finally {
    sending.value = false
    scrollToBottom()
  }
}

</script>

<template>
  <div class="nac-shell">
    <div ref="scrollEl" class="nac-messages">
      <div v-for="(m, i) in messages" :key="i" class="nac-msg" :class="m.role">
        <span class="nac-msg-bubble">{{ m.text }}</span>
      </div>
      <div v-if="sending" class="nac-msg ai"><span class="nac-msg-bubble nac-typing">对方正在输入…</span></div>
    </div>
    <div class="nac-quick">
      <button v-for="q in QUICK_COMMANDS" :key="q" class="nac-quick-chip" type="button" @click="send(q)">{{ q }}</button>
    </div>
    <div class="nac-input-row">
      <input
        v-model="input"
        class="rc-input"
        placeholder="问点什么，如“为什么试跑失败”"
        :disabled="sending"
        @keyup.enter="send()"
      />
      <button class="rc-btn primary" type="button" :disabled="sending || !input.trim()" @click="send()">发送</button>
    </div>
  </div>
</template>

<style scoped>
.nac-shell { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.nac-messages { flex: 1 1 auto; min-height: 120px; overflow-y: auto; padding: 4px 2px; display: flex; flex-direction: column; gap: 8px; }
.nac-msg { display: flex; }
.nac-msg.user { justify-content: flex-end; }
.nac-msg.ai { justify-content: flex-start; }
.nac-msg-bubble { max-width: 84%; padding: 7px 10px; border-radius: 10px; font-size: 12px; line-height: 1.5; white-space: pre-wrap; }
.nac-msg.ai .nac-msg-bubble { background: #f1f5f9; color: var(--rc-text); border-bottom-left-radius: 3px; }
.nac-msg.user .nac-msg-bubble { background: var(--rc-primary); color: #fff; border-bottom-right-radius: 3px; }
.nac-typing { color: var(--rc-faint); font-style: italic; }
.nac-quick { flex: none; display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 0; border-top: 1px dashed var(--rc-border-soft); }
.nac-quick-chip { border: 1px solid #dbe3ee; background: #fff; color: var(--rc-text-2); border-radius: 999px; padding: 4px 10px; font-size: 11px; cursor: pointer; }
.nac-quick-chip:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.nac-input-row { flex: none; display: flex; gap: 8px; }
.nac-input-row .rc-input { flex: 1; }
.nac-input-row .rc-btn { flex: none; height: 34px; padding: 0 16px; }
</style>
