<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '../../stores/flow'
import { flowApi } from '../../api'
import { PRESET_INTENTS, type FlowRecommendation } from './flowModel'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const flow = useFlowStore()
const prompt = ref('')
const result = ref<FlowRecommendation | null>(null)
const loading = ref(false)

// 打开时重置；关闭不保留上次结果
watch(
  () => props.open,
  (v) => {
    if (v) {
      prompt.value = ''
      result.value = null
      loading.value = false
    }
  },
)

// 推荐链路的节点标题预览（开始 → … → 完成）
const chain = computed<string[]>(() => {
  const f = result.value?.flow
  if (!f) return []
  return f.main.filter((id) => id !== 'start' && id !== 'end').map((id) => f.configs[id]?.title ?? id)
})

async function recommend(intent?: string) {
  if (!intent && !prompt.value.trim()) {
    ElMessage.info('先描述你的采集需求，或点选一个意图')
    return
  }
  loading.value = true
  try {
    result.value = await flowApi.flowRecommend(prompt.value.trim(), intent)
  } finally {
    loading.value = false
  }
}

function adopt() {
  if (!result.value) return
  flow.load(result.value.flow)
  ElMessage.success(`已采用「${result.value.flow.name}」，可在右侧逐节点完善配置`)
  close()
}
function startBlank() {
  flow.newFlow('blank')
  ElMessage.success('已新建空白流程')
  close()
}
function close() {
  emit('update:open', false)
}
</script>

<template>
  <div v-if="open" class="rc-node-modal-backdrop show" @click.self="close">
    <div class="rc-node-modal" role="dialog" aria-modal="true">
      <div class="rc-node-modal-head">
        <div class="rc-node-modal-title">新建流程 · 描述你的采集需求</div>
        <button class="rc-node-modal-close" type="button" aria-label="关闭" @click="close">×</button>
      </div>

      <div class="rc-node-modal-body">
        <div class="rc-nf-input-row">
          <input
            v-model="prompt"
            class="rc-input"
            placeholder="例如：我想做个公共网页数据抓取"
            @keyup.enter="recommend()"
          />
          <button class="rc-btn primary" type="button" :disabled="loading" @click="recommend()">
            {{ loading ? '生成中…' : '智能生成' }}
          </button>
        </div>

        <div class="rc-nf-chips">
          <span class="rc-nf-chips-label">快捷意图</span>
          <button
            v-for="p in PRESET_INTENTS"
            :key="p.key"
            class="rc-nf-chip"
            type="button"
            @click="recommend(p.key)"
          >{{ p.label }}</button>
        </div>

        <!-- 推荐结果 -->
        <div v-if="result" class="rc-nf-result">
          <div class="rc-nf-result-name">{{ result.flow.name }}</div>
          <div class="rc-nf-rationale">{{ result.rationale }}</div>
          <div v-if="chain.length" class="rc-nf-chain">
            <span class="rc-nf-term">开始</span>
            <template v-for="(t, i) in chain" :key="i">
              <span class="rc-nf-arrow">→</span><span class="rc-nf-step">{{ t }}</span>
            </template>
            <span class="rc-nf-arrow">→</span><span class="rc-nf-term">完成</span>
          </div>
          <div v-else class="rc-nf-empty-hint">空白流程：开始 → 完成，进入后自行编排。</div>

          <div v-if="result.alternatives.length" class="rc-nf-alts">
            <span class="rc-nf-chips-label">换一个</span>
            <button
              v-for="a in result.alternatives"
              :key="a.intent"
              class="rc-nf-chip ghost"
              type="button"
              @click="recommend(a.intent)"
            >{{ a.name }}</button>
          </div>
        </div>
        <div v-else class="rc-nf-placeholder">
          输入需求或点选意图，智能体会推荐一条合适的初始流程。首期为本地意图匹配，二期接入真实模型。
        </div>
      </div>

      <div class="rc-node-modal-foot">
        <button class="rc-btn" type="button" @click="startBlank">从空白开始</button>
        <button class="rc-btn primary" type="button" :disabled="!result" @click="adopt">采用此流程</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rc-node-modal-backdrop { position: fixed; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.28); padding: 24px; }
.rc-node-modal { width: min(620px, calc(100vw - 48px)); background: #fff; border: 1px solid var(--rc-border); border-radius: 12px; box-shadow: 0 24px 64px -22px rgba(15, 23, 42, 0.45); overflow: hidden; }
.rc-node-modal-head { height: 52px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 1px solid var(--rc-border-soft); }
.rc-node-modal-title { font-size: 14px; font-weight: 800; color: var(--rc-text); }
.rc-node-modal-close { width: 30px; height: 30px; border: 0; background: transparent; color: var(--rc-faint); font-size: 22px; font-weight: 700; cursor: pointer; border-radius: 7px; }
.rc-node-modal-close:hover { background: #f8fafc; color: var(--rc-text-2); }
.rc-node-modal-body { padding: 16px; }
.rc-node-modal-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--rc-border-soft); background: #fbfdff; }

.rc-input { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 13px; padding: 9px 11px; outline: none; }
.rc-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-nf-input-row { display: flex; gap: 8px; }
.rc-nf-input-row .rc-btn { flex: none; height: auto; }

.rc-btn { display: inline-flex; align-items: center; justify-content: center; height: 36px; padding: 0 14px; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); font-size: 13px; font-weight: 600; cursor: pointer; }
.rc-btn:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.rc-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.rc-nf-chips { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.rc-nf-chips-label { font-size: 11px; color: var(--rc-muted); margin-right: 2px; }
.rc-nf-chip { border: 1px solid #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); border-radius: 999px; padding: 4px 11px; font-size: 12px; cursor: pointer; }
.rc-nf-chip:hover { border-color: var(--rc-primary); background: #dbeafe; }
.rc-nf-chip.ghost { border-color: var(--rc-border); background: #fff; color: var(--rc-text-2); }
.rc-nf-chip.ghost:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }

.rc-nf-placeholder { margin-top: 14px; padding: 14px; border: 1px dashed #cbd5e1; border-radius: 8px; color: var(--rc-faint); font-size: 12px; line-height: 1.6; background: #f8fafc; }

.rc-nf-result { margin-top: 14px; padding: 14px; border: 1px solid #bfdbfe; border-radius: 9px; background: #fbfdff; }
.rc-nf-result-name { font-size: 14px; font-weight: 800; color: var(--rc-text); }
.rc-nf-rationale { margin-top: 5px; color: var(--rc-text-2); font-size: 12px; line-height: 1.6; }
.rc-nf-chain { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 11px; }
.rc-nf-term { padding: 3px 9px; border: 1px solid var(--rc-border); border-radius: 999px; background: #fff; color: var(--rc-text-2); font-size: 11px; }
.rc-nf-step { padding: 3px 9px; border: 1px solid #bfdbfe; border-radius: 6px; background: #fff; color: var(--rc-primary-ink); font-size: 11px; }
.rc-nf-arrow { color: var(--rc-faint); font-size: 12px; }
.rc-nf-empty-hint { margin-top: 10px; color: var(--rc-faint); font-size: 11px; }
.rc-nf-alts { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 12px; padding-top: 11px; border-top: 1px solid var(--rc-border-soft); }
</style>
