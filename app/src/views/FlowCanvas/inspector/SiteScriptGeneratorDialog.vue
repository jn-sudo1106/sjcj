<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { generateSiteScript } from '@/api/siteScript'
import { copyToClipboard } from '@/utils/clipboard'

const props = defineProps<{ initialUrl: string; initialPrompt: string }>()
const open = defineModel<boolean>('open', { required: true })
const url = ref('')
const prompt = ref('')
const code = ref('')
const candidate = ref('')
const fileName = ref('')
const candidateFileName = ref('')
const error = ref('')
const warnings = ref<string[]>([])
const generating = ref(false)
let controller: AbortController | null = null

watch(open, (visible) => {
  if (!visible) {
    controller?.abort()
    return
  }
  if (!url.value) url.value = props.initialUrl
  if (!prompt.value) prompt.value = props.initialPrompt
}, { immediate: true })

onBeforeUnmount(() => controller?.abort())

function cancelGenerate() {
  controller?.abort()
}

async function generate() {
  if (!prompt.value.trim()) {
    error.value = '请填写抓取提示词'
    return
  }
  try {
    const parsed = new URL(url.value.trim())
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) throw new Error()
  } catch {
    error.value = '请输入有效的 http(s) 列表 URL'
    return
  }
  controller?.abort()
  const active = new AbortController()
  controller = active
  generating.value = true
  error.value = ''
  candidate.value = ''
  warnings.value = []
  try {
    const result = await generateSiteScript({
      prompt: prompt.value.trim(),
      url: url.value.trim(),
      sampleId: 'www.realcan.cn.py',
    }, active.signal)
    if (active.signal.aborted) return
    candidate.value = result.code
    candidateFileName.value = result.fileName
    warnings.value = result.warnings
  } catch (e) {
    if (!active.signal.aborted) error.value = (e as Error)?.message || '生成失败'
  } finally {
    if (controller === active) {
      generating.value = false
      controller = null
    }
  }
}

function adopt() {
  if (!candidate.value) return
  code.value = candidate.value
  fileName.value = candidateFileName.value
  candidate.value = ''
  ElMessage.success('已采用生成结果，可编辑后下载')
}

function download() {
  if (!code.value.trim()) return
  const blob = new Blob([code.value], { type: 'text/x-python;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName.value || 'site.py'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}
</script>

<template>
  <el-dialog v-model="open" title="AI 生成站点脚本" width="min(920px, 94vw)" top="5vh" append-to-body data-testid="site-script-dialog">
    <div class="site-script-form">
      <p class="site-script-hint">以 www.realcan.cn.py 为样例，生成提供 scrape(url) 的 Python 文件。生成结果只供检查和下载，不会自动下发到处理机。</p>
      <label>列表 URL
        <input v-model="url" class="site-script-input" data-testid="site-script-url" placeholder="https://www.realcan.cn/newscenter" />
      </label>
      <label>抓取提示词
        <textarea v-model="prompt" class="site-script-prompt" data-testid="site-script-prompt" placeholder="说明列表页结构、需要提取的字段及详情页处理要求" />
      </label>
      <div class="site-script-actions">
        <span>参考样例：www.realcan.cn.py</span>
        <el-button type="primary" :loading="generating" data-testid="site-script-generate" @click="generate">生成代码</el-button>
        <el-button v-if="generating" @click="cancelGenerate">取消</el-button>
      </div>
      <p v-if="error" class="site-script-error" data-testid="site-script-error">{{ error }}</p>
      <p v-for="warning in warnings" :key="warning" class="site-script-warning">{{ warning }}</p>
      <div v-if="candidate" class="site-script-result" data-testid="site-script-candidate">
        <div class="site-script-result-head">
          <b>新生成结果 · {{ candidateFileName }}</b>
          <el-button size="small" type="primary" data-testid="site-script-adopt" @click="adopt">采用生成结果</el-button>
        </div>
        <textarea :value="candidate" class="site-script-code" readonly aria-label="生成结果预览" />
      </div>
      <div v-if="code" class="site-script-result" data-testid="site-script-editor">
        <div class="site-script-result-head">
          <b>当前代码 · {{ fileName }}</b>
          <div>
            <el-button size="small" @click="copyToClipboard(code, 'Python 代码')">复制</el-button>
            <el-button size="small" type="primary" data-testid="site-script-download" @click="download">下载 .py</el-button>
          </div>
        </div>
        <textarea v-model="code" class="site-script-code" aria-label="可编辑 Python 代码" />
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.site-script-form { display: grid; gap: 12px; max-height: 76vh; overflow-y: auto; }
.site-script-form label { display: grid; gap: 5px; color: var(--rc-text); font-size: 12px; font-weight: 600; }
.site-script-hint { margin: 0; color: var(--rc-muted); font-size: 12px; line-height: 1.5; }
.site-script-input, .site-script-prompt, .site-script-code { box-sizing: border-box; width: 100%; border: 1px solid #dbe3ee; border-radius: 6px; padding: 8px; font-size: 12px; }
.site-script-prompt { min-height: 100px; resize: vertical; }
.site-script-code { min-height: 220px; resize: vertical; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
.site-script-actions, .site-script-result-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.site-script-actions span { color: var(--rc-muted); font-size: 12px; }
.site-script-result { display: grid; gap: 8px; min-width: 0; }
.site-script-result-head b { font-size: 12px; }
.site-script-error { margin: 0; color: #dc2626; font-size: 12px; }
.site-script-warning { margin: 0; color: #b45309; font-size: 12px; }
</style>
