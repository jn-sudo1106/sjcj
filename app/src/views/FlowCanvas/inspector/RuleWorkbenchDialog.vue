<script setup lang="ts">
// 编排工作区（L3 全屏弹层，S6-1，方案 §4.1）：合并原来各自独立的 RuleScriptDialog（脚本查看，只读）+
// RuleSystemPromptDialog（编辑系统提示词）——会议原话"是不是把它放到一个界面里面去，就是你脚本和那个
// 东西，它能对应上""要两边能看到，不然的话这个东西一直卡在里面，啥也看不到"。
// 左栏系统提示词 / 右栏脚本（或抓取配置 XML），中间可拖拽分隔；面板内直接放生成/保存/测试，
// 避免"看着提示词，要退出去才能生成"（方案 §4.1 改法 3）。
//
// 保存语义刻意保留两种不同颗粒度，跟合并前一致，没有为了"统一"而改变行为：
//   - 系统提示词：本地草稿 + 显式「保存」——沿用原 RuleSystemPromptDialog 的"取消不污染已保存值"设计
//     （只在本组件内部提交草稿，emit update:systemPrompt，不打后端；打开时从 props.systemPrompt 重置草稿）。
//   - 脚本/配置：直接双向绑定（每次输入都 emit update:script），没有草稿概念——原来这块是只读的，
//     S6-1 才第一次开放编辑，没有"取消"包袱要延续，直接绑定跟本应用其余文本框风格一致，更简单。
//     真正落盘由外部「保存脚本/配置」按钮触发（走 orchestrationSave 接口 + 二次确认，逻辑留在父组件不重复）。
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { PromptCategory } from '@/api'
import type { PromptCategoryGroup } from './promptCategory'

const props = defineProps<{
  open: boolean
  title: string
  scriptLabel: string
  systemPrompt: string
  promptCategory: PromptCategory
  promptCategoryGroups: PromptCategoryGroup[]
  script: string
  scriptPath?: string
  generateLabel: string
  saveLabel: string
  generating: boolean
  saving: boolean
  showTest?: boolean
  canTest?: boolean
}>()
const emit = defineEmits<{
  'update:open': [boolean]
  'update:systemPrompt': [string]
  'update:promptCategory': [PromptCategory]
  'update:script': [string]
  generate: []
  'cancel-generate': []
  save: []
  test: []
}>()

function close() {
  emit('update:open', false)
}

// 系统提示词草稿：只在打开时从 props 重置，取消/关闭不回写
const promptDraft = ref(props.systemPrompt)
const promptCategoryDraft = ref<PromptCategory>(props.promptCategory)
const firstPromptCategory = computed(() => props.promptCategoryGroups[0]?.options[0]?.value ?? '自定义节点')
watch(() => props.open, (v) => {
  if (v) {
    promptDraft.value = props.systemPrompt
    promptCategoryDraft.value = props.promptCategory || firstPromptCategory.value
  }
})
watch(() => props.promptCategory, (v) => {
  if (props.open) promptCategoryDraft.value = v || firstPromptCategory.value
})
function savePrompt() {
  emit('update:systemPrompt', promptDraft.value)
  emit('update:promptCategory', promptCategoryDraft.value)
  ElMessage.success('系统提示词已保存')
}

function onScriptInput(e: Event) {
  emit('update:script', (e.target as HTMLTextAreaElement).value)
}
async function copyScript() {
  try {
    await navigator.clipboard.writeText(props.script)
    ElMessage.success('已复制脚本内容')
  } catch {
    ElMessage.error('复制失败，请手动选中复制')
  }
}

// 中间拖拽分隔（左栏宽度百分比，25%~75% 夹住，跟 FlowCanvas/index.vue 的检查区分隔条同款交互）
const leftPct = ref(42)
const bodyEl = ref<HTMLElement>()
let splitStartX = 0
let splitStartPct = 0
function onSplitMove(e: MouseEvent) {
  const w = bodyEl.value?.clientWidth || 1
  const deltaPct = ((e.clientX - splitStartX) / w) * 100
  leftPct.value = Math.min(75, Math.max(25, splitStartPct + deltaPct))
}
function onSplitEnd() {
  window.removeEventListener('mousemove', onSplitMove)
  window.removeEventListener('mouseup', onSplitEnd)
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}
function onSplitStart(e: MouseEvent) {
  e.preventDefault()
  splitStartX = e.clientX
  splitStartPct = leftPct.value
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  window.addEventListener('mousemove', onSplitMove)
  window.addEventListener('mouseup', onSplitEnd)
}

const leftStyle = computed(() => ({ flex: `0 0 ${leftPct.value}%` }))
</script>

<template>
  <el-dialog :model-value="open" :title="title" width="94vw" top="4vh" :close-on-click-modal="false" @update:model-value="close">
    <div ref="bodyEl" class="wb-body">
      <div class="wb-pane" :style="leftStyle">
        <div class="wb-pane-head">
          <b>系统提示词</b>
          <el-select
            v-model="promptCategoryDraft"
            class="wb-category"
            size="small"
            :teleported="false"
          >
            <el-option-group v-for="group in promptCategoryGroups" :key="group.label" :label="group.label">
              <el-option v-for="item in group.options" :key="item.value" :label="item.label" :value="item.value" />
            </el-option-group>
          </el-select>
          <button class="rc-btn primary" type="button" @click="savePrompt">保存</button>
        </div>
        <textarea
          v-model="promptDraft"
          class="wb-textarea"
          placeholder="描述生成脚本时应遵循的约束，如入口函数签名、禁止访问外部网络等"
        />
      </div>

      <div class="wb-splitter" @mousedown="onSplitStart" />

      <div class="wb-pane wb-pane-right">
        <div class="wb-pane-head">
          <b>{{ scriptLabel }}</b>
          <span class="wb-path">{{ scriptPath || '未生成' }}</span>
          <div class="wb-pane-actions">
            <button class="rc-btn" type="button" :disabled="!script.trim()" @click="copyScript">复制</button>
            <button v-if="showTest" class="rc-btn" type="button" :disabled="!canTest" @click="emit('test')">测试</button>
            <button class="rc-btn" type="button" :disabled="generating" @click="emit('generate')">
              {{ generating ? '生成中...' : generateLabel }}
            </button>
            <button v-if="generating" class="rc-btn" type="button" @click="emit('cancel-generate')">取消</button>
            <button class="rc-btn primary" type="button" :disabled="saving || !script.trim()" @click="emit('save')">
              {{ saving ? '保存中...' : saveLabel }}
            </button>
          </div>
        </div>
        <textarea class="wb-textarea wb-code" :value="script" placeholder="点右上「生成」，或直接手写" @input="onScriptInput" />
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.wb-body { display: flex; align-items: stretch; height: 78vh; gap: 0; }
.wb-pane { display: flex; flex-direction: column; min-width: 0; }
.wb-pane-right { flex: 1 1 auto; }
.wb-pane-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
.wb-pane-head b { font-size: 13px; color: var(--rc-text); flex-shrink: 0; }
.wb-category { width: 140px; flex: 0 0 140px; }
.wb-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--rc-faint); font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.wb-pane-actions { display: flex; gap: 8px; flex-shrink: 0; }
.wb-textarea { flex: 1; width: 100%; margin: 0; border: 1px solid #dbe3ee; border-radius: 8px; background: #fff; color: var(--rc-text); font-size: 13px; line-height: 1.6; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 12px; outline: none; resize: none; box-sizing: border-box; }
.wb-textarea:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.wb-code { background: #0f172a; color: #dbeafe; }
.wb-code:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #1e3a5f; }
.wb-splitter { flex: 0 0 10px; cursor: col-resize; position: relative; }
.wb-splitter::before { content: ''; position: absolute; left: 4px; top: 8px; bottom: 8px; width: 2px; border-radius: 2px; background: var(--rc-border-soft); }
.wb-splitter:hover::before, .wb-splitter:active::before { background: var(--rc-primary); }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; height: 30px; padding: 0 12px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.rc-btn:hover { border-color: #bfdbfe; }
.rc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
