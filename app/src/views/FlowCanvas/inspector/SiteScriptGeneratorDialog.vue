<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { generateSiteScript } from '@/api/siteScript'
import { runnerManagementApi, type PublishedScript, type SiteCodeVersion } from '@/api/runnerManagement'
import { copyToClipboard } from '@/utils/clipboard'

const props = defineProps<{ initialUrl: string; initialPrompt: string; configId?: string; queueName?: string }>()
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
const publishing = ref(false)
const published = ref<PublishedScript | null>(null)
const codeType = ref<'site' | 'default'>('site')
const versions = ref<SiteCodeVersion[]>([])
const versionsError = ref('')
let controller: AbortController | null = null
let openedFor = ''

function clearDraft() {
  code.value = ''
  candidate.value = ''
  fileName.value = ''
  candidateFileName.value = ''
  published.value = null
}

watch(open, (visible) => {
  if (!visible) {
    controller?.abort()
    return
  }
  const context = `${props.configId ?? ''}\n${props.initialUrl}`
  const contextChanged = !!openedFor && openedFor !== context
  if (contextChanged || (url.value && url.value !== props.initialUrl)) clearDraft()
  openedFor = context
  url.value = props.initialUrl
  if (!prompt.value || contextChanged) prompt.value = props.initialPrompt
  if (props.configId) void loadVersions(props.configId)
}, { immediate: true })

watch(() => props.initialUrl, (next) => {
  if (!open.value || url.value === next) return
  clearDraft()
  url.value = next
})

watch(url, (next, previous) => {
  if (previous && next !== previous) clearDraft()
})

watch(() => [props.configId, props.queueName] as const, () => {
  if (open.value && props.configId) void loadVersions(props.configId)
})

watch(code, () => { published.value = null })

async function loadVersions(configId: string) {
  versionsError.value = ''
  versions.value = []
  try {
    if (props.queueName) {
      versions.value = await runnerManagementApi.siteCodeVersions(configId, props.queueName)
    }
  } catch (e) {
    versionsError.value = e instanceof Error ? e.message : String(e)
  }
}

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
  ElMessage.success('已放入编辑区，检查后可保存代码版本')
}

function editManually() {
  try {
    const parsed = new URL(url.value.trim())
    if (!['http:', 'https:'].includes(parsed.protocol) || !/^[a-z0-9.-]+$/i.test(parsed.hostname)) throw new Error()
    fileName.value = `${parsed.hostname.toLowerCase()}.py`
  } catch {
    error.value = '请先填写有效的 http(s) 列表 URL'
    return
  }
  if (!code.value) code.value = 'def scrape(url):\n    # 返回包含 title/date/url/summary/content 的字典列表\n    return []\n'
  error.value = ''
}

async function publish() {
  const configId = props.configId?.trim()
  if (!configId) {
    error.value = '请先保存节点配置，再发布脚本'
    return
  }
  if (!code.value.trim()) return
  if (!props.queueName?.trim()) {
    error.value = '请先在任务配置中保存队列名称'
    return
  }
  publishing.value = true
  error.value = ''
  try {
    published.value = await runnerManagementApi.publishScript({
      configId, fileName: fileName.value, code: code.value, prompt: prompt.value.trim(), url: url.value.trim(),
      queueName: props.queueName.trim(), codeType: codeType.value,
      siteHost: codeType.value === 'site' ? new URL(url.value.trim()).hostname.toLowerCase() : undefined,
    })
    await loadVersions(configId)
    ElMessage.success('代码版本已保存；请在「节点代码」中发布运行配置')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    publishing.value = false
  }
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
      <p class="site-script-hint">以 www.realcan.cn.py 为样例，生成提供 scrape(url) 的 Python 文件。代码版本保存后，可在「系统设置 → 节点代码」发布运行配置。</p>
      <div v-if="configId" class="site-script-binding">
        <b>节点 #{{ configId }} · 队列 {{ queueName || '未配置' }}</b>
        <span>{{ versionsError || (queueName ? `已有 ${versions.length} 个代码版本` : '请先配置队列') }}</span>
      </div>
      <label>列表 URL
        <input v-model="url" class="site-script-input" data-testid="site-script-url" placeholder="https://www.realcan.cn/newscenter" />
      </label>
      <label>抓取提示词
        <textarea v-model="prompt" class="site-script-prompt" data-testid="site-script-prompt" placeholder="说明列表页结构、需要提取的字段及详情页处理要求" />
      </label>
      <div class="site-script-actions">
        <span>参考样例：www.realcan.cn.py</span>
        <el-button type="primary" :loading="generating" data-testid="site-script-generate" @click="generate">生成代码</el-button>
        <el-button data-testid="site-script-manual" @click="editManually">手动编写</el-button>
        <el-button v-if="generating" @click="cancelGenerate">取消</el-button>
      </div>
      <p v-if="error" class="site-script-error" data-testid="site-script-error">{{ error }}</p>
      <p v-for="warning in warnings" :key="warning" class="site-script-warning">{{ warning }}</p>
      <div v-if="candidate" class="site-script-result" data-testid="site-script-candidate">
        <div class="site-script-result-head">
          <b>新生成结果 · {{ candidateFileName }}</b>
          <el-button size="small" type="primary" data-testid="site-script-adopt" @click="adopt">放入编辑区</el-button>
        </div>
        <textarea :value="candidate" class="site-script-code" readonly aria-label="生成结果预览" />
      </div>
      <div v-if="code" class="site-script-result" data-testid="site-script-editor">
        <div class="site-script-result-head">
          <b>当前代码 · {{ codeType === 'site' ? `sites/${fileName}` : `${queueName}.py` }}</b>
          <div>
            <el-button size="small" @click="copyToClipboard(code, 'Python 代码')">复制</el-button>
            <el-button size="small" type="primary" data-testid="site-script-download" @click="download">下载 .py</el-button>
            <el-button size="small" type="primary" :loading="publishing" :disabled="!configId" data-testid="site-script-publish" @click="publish">保存代码版本</el-button>
          </div>
        </div>
        <div class="site-script-binding"><span>下发类型</span><el-select v-model="codeType" style="width: 220px"><el-option label="网站专用（优先）" value="site" /><el-option label="队列通用（兜底）" value="default" /></el-select></div>
        <textarea v-model="code" class="site-script-code" aria-label="可编辑 Python 代码" />
        <div v-if="published" class="site-script-binding">
          <span>已保存：{{ published.gitUrl }} · {{ published.scriptDigest }}</span>
        </div>
      </div>
      <div v-if="versions.length" class="site-script-result" data-testid="site-code-versions">
        <b>已发布代码 · {{ versions.length }}</b>
        <div v-for="item in versions" :key="item.scriptDigest" class="site-script-binding">
          <span>{{ item.deliveryPath }} · {{ item.gitCommit.slice(0, 12) }} · {{ item.scriptDigest.slice(0, 16) }}</span>
        </div>
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
.site-script-binding { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 6px; background: #f1f5f9; color: var(--rc-text); font-size: 12px; overflow-wrap: anywhere; }
</style>
