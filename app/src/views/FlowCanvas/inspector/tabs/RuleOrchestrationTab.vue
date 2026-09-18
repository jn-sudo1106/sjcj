<script setup lang="ts">
// 编排配置 Tab（0801 方案 §6.2/§6.4/§7.2）：规则处理节点=业务规则脚本（路径 B：描述/生成/全屏/测试/保存），
// 0804 S3-3 起非规则节点（采集/登录）也走这个 Tab，内容换成抓取配置 XML——两者同构复用 RuleOrchestration
// （content 概念 ≙ script/scriptPath/describe/systemPrompt，见 flowModel.ts execCfg 字段注释与方案 §3.1 修正 D），
// 存储位置不同（ruleCfg vs execCfg，避免污染 isRuleNode() 判定），UI/接口调用整套照搬，只有文案、
// 字段校验、测试入口（规则节点专属）、切换已有配置（非规则节点专属，规则节点的等价能力已被 D3 砍掉）不同。
// 0804 S2-2 拍板：路径 A（表/字段绑定 + 保存元数据）整个搬去「表配置」Tab（TableTab.vue），
// 本 Tab 不再有 showBinder/editingMeta 两态切换——表配置本来就是常驻可编辑的一个 Tab，
// 编排配置只消费已经选好的表/字段，不重复展示可编辑摘要。
// 0804 拍板：规则名称 = 节点名称，不再单独输入（下面 orchCfg 计算时强制用 cfg.title 覆盖）；
// 「引用已有规则」能力整体砍掉，复用需求交给模板功能承接（等于回退 edc08d1）。
//
// 0917：编辑对象不再写死 useFlowStore()，改从 nodeEditorContext 取——**网站汇总态的监控视图
// （监控视图 → 监控配置）直接复用本 Tab 渲染同一套界面**，改动落在它自己那份按源拼的种子上。
// 画布侧没 provide 那个上下文，走默认实现（读写 flow store），行为不变。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Document, Headset, Picture, UploadFilled, VideoPlay } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { recognizeImage, readImageAsBase64, ocrTextOf, type OcrBlock } from '@/api/ocr'
import { isArticleSummaryNode, isArticleTagNode, isAudioTextNode, isDataValidationNode, isMonitorNode, isOcrNode, isRuleNode, isScriptlessNode, isTranslateNode, isVideoAudioNode, makeDefaultRuleOrchestration, makeDefaultExecConfig, MONITOR_METHODS, type MonitorAlertConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { parseArticleTags, riskLevelTone, type ArticleTagResult } from '@/utils/flow/articleTags'
import { TRANSLATE_LANGUAGE_CODES, TRANSLATE_MAX_QUERY_BYTES, translateText, utf8ByteLength } from '@/api/translate'
import { SPEECH_AUDIO_EXTENSIONS, SPEECH_LANGUAGE_OPTIONS, SPEECH_MAX_DURATION_SECONDS, SPEECH_MAX_FILE_SIZE, isSupportedAudioFile, readAudioDuration, transcribeAudio, type SpeechTranscriptionResult } from '@/api/speech'
import { MEDIA_AUDIO_FORMATS, MEDIA_BIT_RATE_OPTIONS, MEDIA_CHANNEL_OPTIONS, MEDIA_MAX_FILE_SIZE, MEDIA_SAMPLING_RATE_OPTIONS, MEDIA_VIDEO_EXTENSIONS, extractAudio, isSupportedVideoFile, readVideoDuration, type MediaExtractionResult } from '@/api/media'
import { useNodeEditorContext } from '../nodeEditorContext'
import { configApi, entryApi, fetchDefaultModels, fetchModelProviders, ruleApi, type EntryType, type ModelOption, type ModelProviderOption, type PromptCategory, type RuleOrchestration, type RuleOrchestrationItem } from '@/api'
import { isVruleNumericRuleId } from '@/api/legacyAdapters'
import { RULE_DATA_SOURCE } from '@/constants/rule'
import { useRuleTableFields } from '@/composables/useRuleTableFields'
import { parseCaptureConfig, validateColumns } from '@/utils/flow/captureConfig'
import { buildDataProcessGeneratePayload } from '@/utils/flow/dataProcess'
import { syncMonitorCkSource } from '@/utils/flow/monitorCkSource'
import { nodeScheduleCron } from '@/utils/flow/scheduleCron'
import { promptCategoryGroupsForNode, promptListCategoryForNode, resolvePromptCategoryForNode } from '../promptCategory'
import { loadPromptTemplateForNode } from '../promptTemplateLoader'
import { useNodeInspectorAssets } from '../useNodeInspectorAssets'
import RuleWorkbenchDialog from '../RuleWorkbenchDialog.vue'
import AlertConfigPanel from '../AlertConfigPanel.vue'

// 编辑对象来自节点编辑上下文（0917）：画布右侧配置区 = 全局 flow store，
// 网站汇总态的监控视图 = 它自己按源拼的那份种子（见 nodeEditorContext.ts 头注）。
//
// 数据监控节点不出现「上传 Excel」样本文件入口（0917 产品口径，画布和监控视图两处一致）；
// 规则处理节点照旧保留——那里的 Excel 是给"按样本生成规则脚本"用的。
const { id, cfg, patch: patchNode, setMonitorMethods: setNodeMonitorMethods, setMonitorAlertConfig: setNodeMonitorAlertConfig, sourceId: promptSourceId, sourceSchedule } = useNodeEditorContext()
const router = useRouter()
const route = useRoute()
const { tables } = useNodeInspectorAssets()

const isRule = computed(() => (cfg.value ? isRuleNode(cfg.value) : false))
const isMonitor = computed(() => (cfg.value ? isMonitorNode(cfg.value) : false))
const isDataValidation = computed(() => (cfg.value ? isDataValidationNode(cfg.value) : false))
/**
 * 「不给脚本编辑入口」的节点类型（2026-09-17 产品口径）：OCR 识别 / 视频转音频 / 语音转文字 /
 * 文章摘要这几类不需要生成脚本，标题行的入口整个收掉，只留本类型自己的字段。
 * 清单在 flowModel 的 isScriptlessNode() 里，要加减只改那一处。
 */
const isScriptless = computed(() => isScriptlessNode(cfg.value))

/**
 * OCR 识别试跑区只给 OCR 抓取节点用（判定同 isOcrNode，见 flowModel）。
 */
const isOcr = computed(() => isOcrNode(cfg.value))

// ---- 语音转文字试跑（0917 第一版，仅音频提取文字节点）----
// 上传音频 → multipart 调后端 /api/speech/transcriptions → 展示转写文本。
// 与 OCR 那套一样，音频与结果只在本组件内存里流转，暂不写节点配置（口径确定后再接）。
const audioFileInput = ref<HTMLInputElement | null>(null)
const audioFile = ref<File | null>(null)
const audioFileError = ref('')
const audioLanguage = ref('')
const audioRunning = ref(false)
const audioError = ref('')
const audioResult = ref<SpeechTranscriptionResult | null>(null)
/** 浏览器解析出的时长（秒）；读不出是 null，此时不做本地拦截 */
const audioDuration = ref<number | null>(null)
const AUDIO_ACCEPT = SPEECH_AUDIO_EXTENSIONS.map((ext) => `.${ext}`).join(',')

const isAudioText = computed(() => isAudioTextNode(cfg.value))
/** 已知时长超上限就不让提交：上游对 >500s 一律 400，发过去只是白等一趟 */
const audioTooLong = computed(() => (audioDuration.value ?? 0) > SPEECH_MAX_DURATION_SECONDS)

function formatDuration(seconds: number | null): string {
  if (seconds == null) return ''
  const total = Math.round(seconds)
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function clearAudioFile() {
  audioFile.value = null
  audioFileError.value = ''
  audioError.value = ''
  audioResult.value = null
  audioDuration.value = null
  if (audioFileInput.value) audioFileInput.value.value = ''
}

function onAudioFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  audioFileError.value = ''
  if (!file) return
  // 后端按**后缀**校验格式、超限也会 400，这里先拦一道省一次往返
  if (!isSupportedAudioFile(file)) {
    input.value = ''
    audioFileError.value = `不支持的音频格式，请用 ${SPEECH_AUDIO_EXTENSIONS.join(' / ')}`
    return
  }
  if (file.size > SPEECH_MAX_FILE_SIZE) {
    input.value = ''
    audioFileError.value = `音频不能超过 ${Math.round(SPEECH_MAX_FILE_SIZE / 1024 / 1024)}MB`
    return
  }
  audioFile.value = file
  // 换文件即作废上一次结果
  audioError.value = ''
  audioResult.value = null
  audioDuration.value = null
  // 时长是异步读出来的（浏览器解析文件头）：读完再判上限。
  // 读不出来（null）不拦——那是上游报错的事，比前端瞎猜强。
  void readAudioDuration(file).then((seconds) => {
    if (audioFile.value !== file) return
    audioDuration.value = seconds
    if (seconds && seconds > SPEECH_MAX_DURATION_SECONDS) {
      audioFileError.value = `音频时长 ${formatDuration(seconds)}，超过单段上限 ${formatDuration(SPEECH_MAX_DURATION_SECONDS)}，请先裁剪或分段再上传`
    }
  })
}

async function runTranscribe() {
  const file = audioFile.value
  if (!file || audioRunning.value || audioTooLong.value) return
  audioRunning.value = true
  audioError.value = ''
  audioResult.value = null
  try {
    const result = await transcribeAudio(file, { language: audioLanguage.value })
    audioResult.value = result
    ElMessage.success(`转写完成：${result.text.length} 字`)
  } catch (e) {
    audioError.value = `转写失败：${(e as Error)?.message ?? String(e)}`
    ElMessage.error(audioError.value)
  } finally {
    audioRunning.value = false
  }
}

async function copyTranscription() {
  const text = audioResult.value?.text ?? ''
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('转写文本已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择文本')
  }
}

// ---- 视频提取音频试跑（0917 第一版，仅视频提取音频节点）----
// 上传视频 → multipart 调后端 /api/media/extract-audio → 拿回音频（默认二进制流，可试听/下载）。
// 与 OCR / 语音两块一样只存内存，暂不写节点配置；勾选「上传到文件服务」时后端改回 JSON + fileId，
// 那个 fileId 就是后续落到节点产物上的抓手。
const videoFileInput = ref<HTMLInputElement | null>(null)
const videoFile = ref<File | null>(null)
const videoFileError = ref('')
const videoDuration = ref<number | null>(null)
const mediaFormat = ref('mp3')
const mediaBitRate = ref('')
const mediaSamplingRate = ref('')
const mediaChannels = ref('')
const mediaUpload = ref(false)
const videoRunning = ref(false)
const videoError = ref('')
const videoResult = ref<MediaExtractionResult | null>(null)
/** 二进制分支：给 <audio> 试听与下载用的 object URL */
const videoAudioUrl = ref('')
const VIDEO_ACCEPT = MEDIA_VIDEO_EXTENSIONS.map((ext) => `.${ext}`).join(',')

const isVideoAudio = computed(() => isVideoAudioNode(cfg.value))
/** 无损格式下发码率没有意义（后端也会忽略），界面上直接禁掉 */
const mediaFormatLossy = computed(() => MEDIA_AUDIO_FORMATS.find((f) => f.value === mediaFormat.value)?.lossy ?? true)
const extractedAudio = computed(() => (videoResult.value?.kind === 'file' ? videoResult.value : null))
/** 上传分支的结果（模板里用它才能把联合类型收窄到 upload 那一支） */
const uploadedAudio = computed(() => (videoResult.value?.kind === 'upload' ? videoResult.value : null))

function releaseVideoAudioUrl() {
  if (videoAudioUrl.value) URL.revokeObjectURL(videoAudioUrl.value)
  videoAudioUrl.value = ''
}

function clearVideoFile() {
  releaseVideoAudioUrl()
  videoFile.value = null
  videoFileError.value = ''
  videoError.value = ''
  videoResult.value = null
  videoDuration.value = null
  if (videoFileInput.value) videoFileInput.value.value = ''
}

function onVideoFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  videoFileError.value = ''
  if (!file) return
  if (!isSupportedVideoFile(file)) {
    input.value = ''
    videoFileError.value = `不支持的视频格式，请用 ${MEDIA_VIDEO_EXTENSIONS.join(' / ')}`
    return
  }
  if (file.size > MEDIA_MAX_FILE_SIZE) {
    input.value = ''
    videoFileError.value = `视频不能超过 ${Math.round(MEDIA_MAX_FILE_SIZE / 1024 / 1024)}MB`
    return
  }
  releaseVideoAudioUrl()
  videoFile.value = file
  videoError.value = ''
  videoResult.value = null
  videoDuration.value = null
  // 时长只用于展示与"大概要等多久"的提示，读不出来不阻塞（null）
  void readVideoDuration(file).then((seconds) => {
    if (videoFile.value === file) videoDuration.value = seconds
  })
}

async function runExtractAudio() {
  const file = videoFile.value
  if (!file || videoRunning.value) return
  videoRunning.value = true
  videoError.value = ''
  releaseVideoAudioUrl()
  videoResult.value = null
  try {
    const result = await extractAudio(file, {
      format: mediaFormat.value,
      bitRate: mediaBitRate.value ? Number(mediaBitRate.value) : undefined,
      samplingRate: mediaSamplingRate.value ? Number(mediaSamplingRate.value) : undefined,
      channels: mediaChannels.value ? Number(mediaChannels.value) : undefined,
      upload: mediaUpload.value,
    })
    videoResult.value = result
    if (result.kind === 'file') videoAudioUrl.value = URL.createObjectURL(result.blob)
    ElMessage.success(result.kind === 'upload' ? '已提取并上传到文件服务' : '音频已提取')
  } catch (e) {
    videoError.value = `提取失败：${(e as Error)?.message ?? String(e)}`
    ElMessage.error(videoError.value)
  } finally {
    videoRunning.value = false
  }
}

function downloadExtractedAudio() {
  const audio = extractedAudio.value
  if (!audio) return
  const url = URL.createObjectURL(audio.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = audio.filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  ElMessage.success(`已下载 ${audio.filename}`)
}

async function copyFileId() {
  const fileId = videoResult.value?.kind === 'upload' ? videoResult.value.fileId : ''
  if (!fileId) return
  try {
    await navigator.clipboard.writeText(fileId)
    ElMessage.success('fileId 已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择文本')
  }
}

// ---- 文章生成摘要（0917 第一版，仅文章生成摘要节点）----
// 上传/粘贴正文 → 调后端 /api/answer/data-process 出摘要。
// 系统提示词**不在前端拼**：进 Tab 时按 category=rule + node_type_name=文章生成摘要 从
// cfg_llm_node_prompt 取（见 promptCategory.ts 的分类映射与 promptTemplateLoader），
// 结果落在节点的 execCfg.systemPrompt 上，生成时整段作为 systemPrompt 发出去（后端 .system() 直接用）。
// 模型供应商 / 模型与规则节点同源（/api/model/*），存在节点上，可随时切换。
const isArticleSummary = computed(() => isArticleSummaryNode(cfg.value))
const ARTICLE_TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'json', 'log', 'html', 'htm']
/** 正文体积上限：模型上下文有限，超了先拦，免得白烧一次调用 */
const ARTICLE_MAX_CHARS = 200_000

const articleText = ref('')
const articleFileInput = ref<HTMLInputElement | null>(null)
const articleFileName = ref('')
const articleFileError = ref('')
const articleRunning = ref(false)
const articleError = ref('')
const articleSummary = ref('')
const articleThinking = ref('')
const articleDone = ref(false)
const articlePromptOpen = ref(false)
const articleAbort = ref<AbortController | null>(null)

const articleCharCount = computed(() => articleText.value.trim().length)
/** 提示词必须来自提示词表：取不到（表里没这行/接口挂了）就不让生成，免得拿默认那句抓取配置提示词瞎跑 */
/**
 * 提示词是否真的来自提示词表。
 *
 * ⚠️ 只看 `systemPrompt` 非空是不够的：这类节点的种子默认值是「抓取配置」那句提示词
 *（makeDefaultExecConfig），非空但完全不对口。所以由提示词 watcher 在取模板失败时置位，
 * 这里据此拦住生成（界面上给出明确原因），避免拿错提示词白跑一次模型调用。
 */
const articlePromptMissing = ref(false)
const articlePromptReady = computed(() => !articlePromptMissing.value && !!orchCfg.value.systemPrompt?.trim())
const canGenerateSummary = computed(() => (
  !articleRunning.value && articleCharCount.value > 0 && articlePromptReady.value
  && !!(orchCfg.value.modelProviderCode ?? '').trim() && !!(orchCfg.value.modelCode ?? '').trim()
))

function clearArticle() {
  articleText.value = ''
  articleFileName.value = ''
  articleFileError.value = ''
  articleError.value = ''
  articleSummary.value = ''
  articleThinking.value = ''
  articleDone.value = false
  if (articleFileInput.value) articleFileInput.value.value = ''
}

function isTextFile(file: File): boolean {
  const name = file.name || ''
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  return ARTICLE_TEXT_EXTENSIONS.includes(ext) || file.type.startsWith('text/')
}

function onArticleFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  articleFileError.value = ''
  if (!file) return
  if (!isTextFile(file)) {
    input.value = ''
    articleFileError.value = `只支持文本文件（${ARTICLE_TEXT_EXTENSIONS.join(' / ')}）`
    return
  }
  const reader = new FileReader()
  reader.onerror = () => { articleFileError.value = '文本读取失败' }
  reader.onload = () => {
    const text = typeof reader.result === 'string' ? reader.result : ''
    if (text.trim().length > ARTICLE_MAX_CHARS) {
      articleFileError.value = `正文超过 ${ARTICLE_MAX_CHARS} 字，请先精简或分段`
      return
    }
    articleText.value = text
    articleFileName.value = file.name
    articleError.value = ''
    articleSummary.value = ''
    articleDone.value = false
  }
  reader.readAsText(file)
}

function onArticleTextInput(e: Event) {
  articleText.value = (e.target as HTMLTextAreaElement).value
  articleFileError.value = ''
  if (articleText.value.trim().length > ARTICLE_MAX_CHARS) {
    articleFileError.value = `正文超过 ${ARTICLE_MAX_CHARS} 字，请先精简或分段`
  }
}

async function runArticleSummary() {
  if (!canGenerateSummary.value) return
  articleRunning.value = true
  articleError.value = ''
  articleSummary.value = ''
  articleThinking.value = ''
  articleDone.value = false
  articleAbort.value?.abort()
  const controller = new AbortController()
  articleAbort.value = controller
  let streamed = ''
  try {
    // description 即 user message：正文本身；systemPrompt 是提示词表里那条模板的渲染结果
    streamed = await callDataProcessForText({
      text: articleText.value,
      sourceLabel: articleFileName.value || '文章文本',
      signal: controller,
      onThinking: (delta) => { articleThinking.value += delta },
      onContent: (full) => { articleSummary.value = full },
    })
    if (!streamed.trim() && !articleSummary.value.trim()) {
      articleError.value = '模型没有返回内容，请重试或换一个模型'
    } else {
      articleDone.value = true
      ElMessage.success('摘要已生成')
    }
  } catch (e) {
    if (controller.signal.aborted || (e as Error)?.message?.includes('已取消')) {
      ElMessage.info('已取消生成')
    } else {
      articleError.value = `生成失败：${(e as Error)?.message ?? String(e)}`
      ElMessage.error(articleError.value)
    }
  } finally {
    if (articleAbort.value === controller) articleAbort.value = null
    articleRunning.value = false
  }
}

function cancelArticleSummary() {
  articleAbort.value?.abort()
}

async function copyArticleSummary() {
  const text = articleSummary.value.trim()
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('摘要已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择文本')
  }
}

// ---- 翻译助手（0917 第一版，仅翻译助手节点）----
// 上传/粘贴文本 → 选目标语言 → 调 /api/answer/data-process 出译文。
// 系统提示词同样来自提示词表：那一行是 node_type_name='翻译'、**category 为空**（2026-09-17 直接读
// cfg_llm_node_prompt 核对），所以查模板时不带 category（见 promptCategory.promptListCategoryForNode）。
const isTranslate = computed(() => isTranslateNode(cfg.value))
/** 源语言下拉里的「自动检测」项：请求时发 auto（见 api/translate.ts） */
const TRANSLATE_AUTO = '自动检测'
/**
 * 语言候选（产品给的 9 项）。直接取语言码表的键，保证"能选的语言"与"能翻译的语言"永远一致
 *（百度语言码见 api/translate.ts：日语 jp、韩语 kor、法语 fra、繁体 cht，不是 ISO 639-1）。
 */
const TRANSLATE_LANGUAGES = Object.keys(TRANSLATE_LANGUAGE_CODES)

const translateText_ = ref('')
const translateFileInput = ref<HTMLInputElement | null>(null)
const translateFileName = ref('')
const translateFileError = ref('')
const translateSource = ref(TRANSLATE_AUTO)
const translateTarget = ref('英语')
const translateRunning = ref(false)
const translateError = ref('')
const translateResult = ref('')
/** 上游实际识别到的源语言码（auto 时有用），拼成一句"检测到：xx" */
const translateDetectedFrom = ref('')
const translateAbort = ref<AbortController | null>(null)

/** 源语言是「自动检测」时没有可互换的对象，按钮置灰（不替用户猜一个源语言出来） */
const canSwapLanguages = computed(() => translateSource.value !== TRANSLATE_AUTO)
function swapTranslateLanguages() {
  if (!canSwapLanguages.value) return
  const from = translateSource.value
  translateSource.value = translateTarget.value
  translateTarget.value = from
}

const translateCharCount = computed(() => translateText_.value.trim().length)
/** 上限按 **UTF-8 字节** 算（后端 translate.baidu.max-query-bytes，默认 6000）：中文 1 字 3 字节，约 2000 字 */
const translateByteCount = computed(() => utf8ByteLength(translateText_.value.trim()))
const translateTooLong = computed(() => translateByteCount.value > TRANSLATE_MAX_QUERY_BYTES)
const canTranslate = computed(() => (
  !translateRunning.value && translateCharCount.value > 0 && !translateTooLong.value && !!translateTarget.value
))

function clearTranslate() {
  translateText_.value = ''
  translateFileName.value = ''
  translateFileError.value = ''
  translateError.value = ''
  translateResult.value = ''
  translateDetectedFrom.value = ''
  if (translateFileInput.value) translateFileInput.value.value = ''
}

function onTranslateFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  translateFileError.value = ''
  if (!file) return
  if (!isTextFile(file)) {
    input.value = ''
    translateFileError.value = `只支持文本文件（${ARTICLE_TEXT_EXTENSIONS.join(' / ')}）`
    return
  }
  const reader = new FileReader()
  reader.onerror = () => { translateFileError.value = '文件读取失败' }
  reader.onload = () => {
    const text = typeof reader.result === 'string' ? reader.result : ''
    translateText_.value = text
    translateFileName.value = file.name
    translateError.value = ''
    translateResult.value = ''
    translateDetectedFrom.value = ''
    const bytes = utf8ByteLength(text.trim())
    if (bytes > TRANSLATE_MAX_QUERY_BYTES) {
      translateFileError.value = `文件 ${bytes} 字节，超过单次上限 ${TRANSLATE_MAX_QUERY_BYTES} 字节（中文约 2000 字），请先分段`
    }
  }
  reader.readAsText(file)
}

function onTranslateTextInput(e: Event) {
  translateText_.value = (e.target as HTMLTextAreaElement).value
  translateFileError.value = ''
}

async function runTranslate() {
  if (!canTranslate.value) return
  translateRunning.value = true
  translateError.value = ''
  translateResult.value = ''
  translateDetectedFrom.value = ''
  translateAbort.value?.abort()
  const controller = new AbortController()
  translateAbort.value = controller
  try {
    const result = await translateText({
      from: translateSource.value,
      to: translateTarget.value,
      query: translateText_.value,
    }, { signal: controller.signal })
    translateResult.value = result.translatedText
    translateDetectedFrom.value = result.from
    ElMessage.success(`已翻译为${translateTarget.value}`)
  } catch (e) {
    if (controller.signal.aborted) {
      ElMessage.info('已取消翻译')
    } else {
      translateError.value = `翻译失败：${(e as Error)?.message ?? String(e)}`
      ElMessage.error(translateError.value)
    }
  } finally {
    if (translateAbort.value === controller) translateAbort.value = null
    translateRunning.value = false
  }
}

function cancelTranslate() {
  translateAbort.value?.abort()
}

async function copyTranslation() {
  const text = translateResult.value.trim()
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('译文已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择文本')
  }
}

function downloadTranslation() {
  const text = translateResult.value
  if (!text.trim()) return
  const base = (translateFileName.value || 'translation').replace(/\.[^.]+$/, '')
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${base}.${translateTarget.value}.txt`
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  ElMessage.success('译文已下载')
}

/**
 * 文本 → data-process 的公共调用（文章摘要 / 翻译助手共用）。
 *
 * ⚠️ sourceTable / inputFields 必须非空：后端 AnswerServiceImpl.dataProcess() 对这两个字段做了
 * validateText（`targetTable` / `outputFields` 反倒可选），传空直接 500（错误体还是空的）。
 * 这类节点没有表与字段，按"文本来源"如实填占位值；后端放宽校验后可以删掉。
 */
async function callDataProcessForText(input: {
  text: string
  sourceLabel: string
  signal: AbortController
  onThinking: (delta: string) => void
  /** 回传的是**累计到当前的全文**（不是增量）——调用方直接赋值给结果区即可 */
  onContent: (fullText: string) => void
}): Promise<string> {
  const payload = buildDataProcessGeneratePayload({
    description: input.text,
    configId: Number(cfg.value?.configId ?? 0),
    providerCode: orchCfg.value.modelProviderCode ?? '',
    model: orchCfg.value.modelCode ?? '',
    sourceTable: input.sourceLabel || '文本',
    targetTable: '',
    inputFields: ['article_text'],
    outputFields: [],
    inputFieldOptions: [{ itemCode: 'article_text', itemName: '正文' }],
    outputFieldOptions: [],
    systemPrompt: orchCfg.value.systemPrompt ?? '',
  })
  // buildDataProcessGeneratePayload 在 outputFieldOptions 为空时会**退回 inputFields**（规则节点的既有口径），
  // 这类纯文本节点没有出参字段，显式清掉，免得把「正文」当成出参写进 payload 与 cs_config.snatch_conf。
  payload.outputFields = ''
  let streamed = ''
  await ruleApi.dataProcessGenerate(payload, {
    signal: input.signal.signal,
    onThinking: (delta) => { if (delta) input.onThinking(delta) },
    onContent: (delta) => {
      if (!delta) return
      streamed += delta
      input.onContent(streamed)
    },
  })
  return streamed
}

// ---- 文章打标签（0918 第一版，仅文章打标签节点）----
// 上传/粘贴文本 → 调 /api/answer/data-process（与摘要同一条通路：系统提示词整段由前端从
// cfg_llm_node_prompt 取，node_type_name='文章打标签'、category='rule'）→ 解析模型输出的 JSON 标签。
const isArticleTag = computed(() => isArticleTagNode(cfg.value))
const tagPromptMissing = ref(false)
const tagPromptOpen = ref(false)

const tagText = ref('')
const tagFileInput = ref<HTMLInputElement | null>(null)
const tagFileName = ref('')
const tagFileError = ref('')
const tagRunning = ref(false)
const tagError = ref('')
/** 模型原始输出（也用于"解析不出 JSON 时退回展示"） */
const tagRawOutput = ref('')
const tagResult = ref<ArticleTagResult | null>(null)
const tagRawOpen = ref(false)
const tagAbort = ref<AbortController | null>(null)

const tagCharCount = computed(() => tagText.value.trim().length)
const tagPromptReady = computed(() => !tagPromptMissing.value && !!orchCfg.value.systemPrompt?.trim())
const canTag = computed(() => (
  !tagRunning.value && tagCharCount.value > 0 && tagPromptReady.value
  && !!(orchCfg.value.modelProviderCode ?? '').trim() && !!(orchCfg.value.modelCode ?? '').trim()
))

function clearArticleTag() {
  tagText.value = ''
  tagFileName.value = ''
  tagFileError.value = ''
  tagError.value = ''
  tagRawOutput.value = ''
  tagResult.value = null
  tagRawOpen.value = false
  if (tagFileInput.value) tagFileInput.value.value = ''
}

function onTagFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  tagFileError.value = ''
  if (!file) return
  if (!isTextFile(file)) {
    input.value = ''
    tagFileError.value = `只支持文本文件（${ARTICLE_TEXT_EXTENSIONS.join(' / ')}）`
    return
  }
  const reader = new FileReader()
  reader.onerror = () => { tagFileError.value = '文件读取失败' }
  reader.onload = () => {
    const text = typeof reader.result === 'string' ? reader.result : ''
    if (text.trim().length > ARTICLE_MAX_CHARS) {
      tagFileError.value = `正文超过 ${ARTICLE_MAX_CHARS} 字，请先精简或分段`
      return
    }
    tagText.value = text
    tagFileName.value = file.name
    tagError.value = ''
    tagResult.value = null
    tagRawOutput.value = ''
  }
  reader.readAsText(file)
}

function onTagTextInput(e: Event) {
  tagText.value = (e.target as HTMLTextAreaElement).value
  tagFileError.value = ''
  if (tagText.value.trim().length > ARTICLE_MAX_CHARS) {
    tagFileError.value = `正文超过 ${ARTICLE_MAX_CHARS} 字，请先精简或分段`
  }
}

async function runArticleTag() {
  if (!canTag.value) return
  tagRunning.value = true
  tagError.value = ''
  tagRawOutput.value = ''
  tagResult.value = null
  tagAbort.value?.abort()
  const controller = new AbortController()
  tagAbort.value = controller
  let streamed = ''
  try {
    // 提示词里的示例把用户输入写成「文本：<正文>」，这里保持一致，减少模型跑偏
    streamed = await callDataProcessForText({
      text: `文本：\n${tagText.value}`,
      sourceLabel: tagFileName.value || '待标注文本',
      signal: controller,
      onThinking: () => { /* 打标签不需要展示思考过程，忽略 */ },
      onContent: (full) => { tagRawOutput.value = full },
    })
    tagRawOutput.value = streamed
    tagResult.value = parseArticleTags(streamed)
    if (!tagResult.value && !streamed.trim()) {
      tagError.value = '模型没有返回内容，请重试或换一个模型'
    } else if (!tagResult.value) {
      // 不是 JSON 也不报错：把原文摆出来，让人看得见模型到底说了什么
      ElMessage.warning('模型没有按 JSON 输出，已展示原始返回')
    } else {
      ElMessage.success('标注完成')
    }
  } catch (e) {
    if (controller.signal.aborted || (e as Error)?.message?.includes('已取消')) {
      ElMessage.info('已取消')
    } else {
      tagError.value = `打标签失败：${(e as Error)?.message ?? String(e)}`
      ElMessage.error(tagError.value)
    }
  } finally {
    if (tagAbort.value === controller) tagAbort.value = null
    tagRunning.value = false
  }
}

function cancelArticleTag() {
  tagAbort.value?.abort()
}

async function copyArticleTagResult() {
  const text = tagResult.value?.raw || tagRawOutput.value.trim()
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('标签已复制（JSON）')
  } catch {
    ElMessage.warning('复制失败，请手动选择文本')
  }
}

// 切节点（NodeInspector 里本组件不带 key，是复用的）时清空试跑区，避免串到下一个节点上
watch(id, () => {
  clearOcrImage()
  clearAudioFile()
  audioLanguage.value = ''
  clearVideoFile()
  clearArticle()
  articlePromptOpen.value = false
  articlePromptMissing.value = false
  clearArticleTag()
  tagPromptOpen.value = false
  tagPromptMissing.value = false
  clearTranslate()
  translateTarget.value = '英语'
  translateSource.value = TRANSLATE_AUTO
  mediaFormat.value = 'mp3'
  mediaBitRate.value = ''
  mediaSamplingRate.value = ''
  mediaChannels.value = ''
  mediaUpload.value = false
})

/** OCR / 语音试跑区共用：文件体积展示 */
function formatFileSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

// ---- OCR 识别试跑（0917 第一版，仅 OCR 抓取节点）----
// 图片只在本组件内存里流转：选图 → 转 base64 → 调 /ocr → 展示识别文本。
// 暂不写入节点配置（也不落库）：这一步是"先能试出来"，图要不要跟着节点存、识别结果怎么用
// 到生成脚本上，等口径定了再接（接口契约见 api/ocr.ts 头注）。
const ocrFileInput = ref<HTMLInputElement | null>(null)
const ocrFile = ref<File | null>(null)
const ocrPreviewUrl = ref('')
const ocrFileError = ref('')
const ocrRunning = ref(false)
const ocrError = ref('')
const ocrBlocks = ref<OcrBlock[]>([])
const ocrRawText = ref('')
const ocrTextVisible = ref(false)
const OCR_MAX_FILE_SIZE = 10 * 1024 * 1024

const ocrText = computed(() => ocrTextOf(ocrBlocks.value))
const ocrBlockCount = computed(() => ocrBlocks.value.filter((block) => block.text.trim()).length)

function releaseOcrPreview() {
  if (ocrPreviewUrl.value) URL.revokeObjectURL(ocrPreviewUrl.value)
  ocrPreviewUrl.value = ''
}

/** 换图/切节点时把上一条结果一起清掉：结果与图片是一对，留着上一张的识别文本会误导。 */
function clearOcrImage() {
  releaseOcrPreview()
  ocrFile.value = null
  ocrFileError.value = ''
  ocrError.value = ''
  ocrBlocks.value = []
  ocrRawText.value = ''
  ocrTextVisible.value = false
  if (ocrFileInput.value) ocrFileInput.value.value = ''
}

async function onOcrFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  ocrFileError.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    input.value = ''
    ocrFileError.value = '只支持图片文件（PNG / JPG 等）'
    return
  }
  if (file.size > OCR_MAX_FILE_SIZE) {
    input.value = ''
    ocrFileError.value = `图片不能超过 ${Math.round(OCR_MAX_FILE_SIZE / 1024 / 1024)}MB`
    return
  }
  releaseOcrPreview()
  ocrFile.value = file
  ocrPreviewUrl.value = URL.createObjectURL(file)
  // 换图即作废上一次结果
  ocrError.value = ''
  ocrBlocks.value = []
  ocrRawText.value = ''
  ocrTextVisible.value = false
}

async function runOcrRecognize() {
  const file = ocrFile.value
  if (!file || ocrRunning.value) return
  ocrRunning.value = true
  ocrError.value = ''
  ocrBlocks.value = []
  ocrRawText.value = ''
  try {
    const base64 = await readImageAsBase64(file)
    const result = await recognizeImage(base64)
    ocrBlocks.value = result.blocks
    ocrRawText.value = JSON.stringify(result.raw, null, 2)
    ElMessage.success(`识别完成：${ocrTextOf(result.blocks).length} 字`)
  } catch (e) {
    ocrError.value = `识别失败：${(e as Error)?.message ?? String(e)}`
    ElMessage.error(ocrError.value)
  } finally {
    ocrRunning.value = false
  }
}

async function copyOcrText() {
  const text = ocrText.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('识别文本已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择文本')
  }
}

onBeforeUnmount(() => {
  releaseOcrPreview()
  releaseVideoAudioUrl()
  articleAbort.value?.abort()
  translateAbort.value?.abort()
  tagAbort.value?.abort()
})
const orchCfg = computed<RuleOrchestration>(() => ({
  ...(isRule.value ? makeDefaultRuleOrchestration() : makeDefaultExecConfig()),
  ...(isRule.value ? cfg.value?.ruleCfg : cfg.value?.execCfg),
  name: cfg.value?.title ?? '',
}))

function patch(p: Partial<RuleOrchestration>) {
  patchNode(p)
}

// 文案分流：内容同构，只有措辞按节点类型切换
const describeLabel = computed(() => (isMonitor.value ? '数据监控描述' : isDataValidation.value ? '数据校验描述' : isRule.value ? '规则处理描述' : '抓取需求描述'))
const describePlaceholder = computed(() => (isRule.value ? '请使用自然语言描述你需要生成脚本的规则或转换关系' : '描述抓取需求，如打开列表页提取表格前 20 行数据'))
const generateLabel = computed(() => (isRule.value ? '生成脚本' : '生成配置'))
const saveLabel = computed(() => (isRule.value ? '保存脚本' : '保存配置'))
// S6-1：编排工作区（合并原 RuleScriptDialog/RuleSystemPromptDialog）的文案分流
const workbenchTitle = computed(() => (isRule.value ? '规则脚本工作区' : '抓取配置工作区'))
const scriptLabel = computed(() => (isRule.value ? 'Python 脚本' : '抓取配置 XML'))
const promptCategoryGroups = computed(() => promptCategoryGroupsForNode(cfg.value))
const promptCategory = computed(() => resolvePromptCategoryForNode(cfg.value, orchCfg.value.promptCategory))
const promptListCategory = computed(() => promptListCategoryForNode(cfg.value))
const describeTouched = ref(false)

// 数据监控节点：监控方法与规则描述同属编排语义，放在「设置业务规则」上方。
const monitorMethods = computed<string[]>(() => cfg.value?.monitorMethods ?? [])
function setMonitorMethods(values: string[]) {
  setNodeMonitorMethods(values ?? [])
}
function setMonitorAlertConfig(config: MonitorAlertConfig) {
  setNodeMonitorAlertConfig(config)
}

// 监控方法随 config 的 checkRule 落库（逗号分隔，生成脚本时仍按原口径传给后端）。
// 本地已有勾选时不覆盖；否则按当前配置详情回填已保存的候选项。
const checkRuleRestoreToken = ref('')
watch(
  () => [id.value, isMonitor.value, cfg.value?.configId ?? '', cfg.value?.monitorMethods?.length ?? 0] as const,
  ([nid, monitor, configId, methodCount]) => {
    if (!monitor || !configId || methodCount) return
    const token = `${nid}:${configId}`
    if (checkRuleRestoreToken.value === token) return
    checkRuleRestoreToken.value = token
    void (async () => {
      try {
        const record = await configApi.configDetailRaw(String(configId))
        const saved = String(record?.checkRule ?? '').trim()
        if (!saved) return
        const known = new Set(MONITOR_METHODS)
        const restored = saved.split(',').map((m) => m.trim()).filter((m) => m && known.has(m))
        if (restored.length) setNodeMonitorMethods(restored)
      } catch {
        // 回填失败不阻断编排配置，用户仍可手动选择。
      }
    })()
  },
  { immediate: true },
)

function formatTableLabel(table?: Pick<EntryType, 'name' | 'tableName'> | null): string {
  const name = table?.name?.trim() || ''
  const tableName = table?.tableName?.trim() || ''
  if (name && tableName) return `${name}:${tableName}`
  return name || tableName || ''
}

function resolveTableLabel(tableRef: string): string {
  const ref = tableRef.trim()
  if (!ref) return ''
  const table = tables.value.find((item) => item.tableId === ref || item.tableName === ref || item.name === ref)
  return formatTableLabel(table) || ref
}

const sourceTableName = computed(() => resolveTableLabel(
  cfg.value?.collectCfg?.inputTable?.trim()
  || cfg.value?.inputTable?.trim()
  || orchCfg.value.inputTableId?.trim()
  || orchCfg.value.inputTable?.trim()
  || '',
))

function readRawTextField(value: unknown, keys: string[]): string {
  const readObject = (record: Record<string, unknown>): string => {
    for (const key of keys) {
      const raw = record[key]
      if (raw == null) continue
      const text = String(raw).trim()
      if (text) return text
    }
    return ''
  }
  if (value == null) return ''
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return ''
    if (/^[{\[]/.test(text)) {
      try {
        const parsed = JSON.parse(text)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return readObject(parsed as Record<string, unknown>) || text
        }
      } catch {
        // 不是 JSON 就按原文本看
      }
    }
    return text
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return readObject(value as Record<string, unknown>)
  }
  return ''
}

function resolveConfigDetailPrefill(raw: Record<string, unknown>): { describe: string; scriptPath: string; script: string } {
  const describe = readRawTextField(raw.snatchConf, ['description', 'describe', 'nlDescribe'])
  const codeRuleValue = raw.codeRule
  const codeRuleText = readRawTextField(codeRuleValue, ['scriptPath', 'codePath', 'codeFileName', 'path'])
  const scriptText = (codeRuleValue && typeof codeRuleValue === 'object' && !Array.isArray(codeRuleValue))
    ? readRawTextField(codeRuleValue, ['script', 'scriptCode', 'code', 'body', 'content'])
    : ''
  const codeRuleRaw = String(codeRuleValue ?? '').trim()
  const scriptPath = codeRuleText || (/^[^\n]+\.[a-z0-9]+$/i.test(codeRuleRaw) ? codeRuleRaw : '')
  return { describe, scriptPath, script: scriptText }
}

watch(id, () => {
  describeTouched.value = false
}, { immediate: true })

function buildMonitorDescribe() {
  if (!isMonitor.value) return ''
  const tableLabel = sourceTableName.value
  const methods = (cfg.value?.monitorMethods ?? []).map((item) => item.trim()).filter(Boolean)
  if (!tableLabel || !methods.length) return ''
  return `我想对${tableLabel}进行如下监控：\n${methods.map((item, index) => `${index + 1}.${item}`).join('\n')}`
}
const monitorDescribeSeed = computed(() => buildMonitorDescribe())

// ---- 抓取配置 XML 轻解析（0804 S3-4，方案 §3.1 修正 B · 附录 §十）：仅非规则节点 ----
// 只读动作链摘要（顶部展示）+ 保存前的字段一致性提示，不做可视化编辑（方案已拍板不做）。
const parsedCapture = computed(() => (!isRule.value && orchCfg.value.script?.trim() ? parseCaptureConfig(orchCfg.value.script) : undefined))
function summarizeActions(actions: { title: string }[]): string {
  const groups: { title: string; count: number }[] = []
  for (const a of actions) {
    const last = groups[groups.length - 1]
    if (last && last.title === a.title) last.count++
    else groups.push({ title: a.title, count: 1 })
  }
  return groups.map((g) => (g.count > 1 ? `${g.title} ×${g.count}` : g.title)).join(' → ')
}
const actionSummary = computed(() => (parsedCapture.value ? summarizeActions(parsedCapture.value.actions) : ''))

// 采集节点没有逐字段勾选 UI（跟规则节点的 inputFields/outputFields 不同），校验对象退化为
// 输出表的全部字段——校验"XML 引用的 BizId 是否都在这张表上"，而不是"是否都在某个已选子集里"。
const outputTableId = computed(() => cfg.value?.collectCfg?.outputTable || cfg.value?.outputTable || '')
async function checkColumnConsistency(): Promise<boolean> {
  if (isRule.value || !parsedCapture.value?.columns.length || !outputTableId.value) return true
  try {
    const entry = await entryApi.entryDetail(outputTableId.value)
    const issues = validateColumns(parsedCapture.value, entry.fields.map((f) => f.prop))
    if (!issues.length) return true
    try {
      await ElMessageBox.confirm(issues.join('\n'), '字段一致性提示', {
        type: 'warning', confirmButtonText: '仍要保存', cancelButtonText: '取消',
      })
      return true
    } catch {
      return false
    }
  } catch {
    return true // 拉字段失败不阻塞保存，只是跳过这次校验
  }
}

// 表字段：只读消费「表配置」Tab 已经选好的表——测试台需要按字段回填入参标签，见 RuleTestDialog。
// 非规则节点的 orchCfg 没有 inputTableId/outputTableId，watch 里的字段拉取会静默 no-op，安全。
const { inputFieldOptions, outputFieldOptions } = useRuleTableFields(orchCfg)

const providerOptions = ref<ModelProviderOption[]>([])
const modelOptions = ref<ModelOption[]>([])
const providerLoading = ref(false)
const modelLoading = ref(false)
const providerError = ref('')
const modelError = ref('')
function firstProviderCode() {
  return providerOptions.value[0]?.providerCode || ''
}
function firstModelCode() {
  return modelOptions.value[0]?.modelCode || ''
}
async function loadModels(providerCode: string, preferredModelCode?: string) {
  modelLoading.value = true
  modelError.value = ''
  try {
    modelOptions.value = await fetchDefaultModels(providerCode)
    const modelCode = modelOptions.value.find((item) => item.modelCode === preferredModelCode)?.modelCode || firstModelCode()
    if (modelCode !== (orchCfg.value.modelCode || '')) patch({ modelCode })
  } catch (e) {
    modelOptions.value = []
    patch({ modelCode: '' })
    modelError.value = `模型加载失败：${(e as Error)?.message ?? String(e)}`
  } finally {
    modelLoading.value = false
  }
}
async function loadProviderModelOptions() {
  providerLoading.value = true
  providerError.value = ''
  try {
    providerOptions.value = await fetchModelProviders()
    const providerCode = providerOptions.value.find((item) => item.providerCode === orchCfg.value.modelProviderCode)?.providerCode || firstProviderCode()
    if (providerCode !== (orchCfg.value.modelProviderCode || '')) patch({ modelProviderCode: providerCode })
    if (!providerCode) {
      modelOptions.value = []
      patch({ modelCode: '' })
      return
    }
    await loadModels(providerCode, orchCfg.value.modelCode)
  } catch (e) {
    providerOptions.value = []
    modelOptions.value = []
    patch({ modelProviderCode: '', modelCode: '' })
    providerError.value = `模型供应商加载失败：${(e as Error)?.message ?? String(e)}`
  } finally {
    providerLoading.value = false
  }
}
watch(
  // 文章生成摘要 / 文章打标签也要选模型（它们不生成"脚本"，但同样要调模型）
  () => [id.value, isRule.value, isArticleSummary.value, isArticleTag.value] as const,
  ([, rule, summary, tag]) => { if (rule || summary || tag) void loadProviderModelOptions() },
  { immediate: true },
)

const configDetailPrefillToken = ref('')
watch(
  () => [id.value, isRule.value, cfg.value?.configId] as const,
  () => {
    configDetailPrefillToken.value = ''
  },
  { immediate: true },
)
watch(
  () => [id.value, isRule.value, cfg.value?.configId] as const,
  () => {
    if (!isRule.value) return
    const configId = cfg.value?.configId?.trim()
    if (!configId) return
    const token = `${id.value}:${configId}`
    if (configDetailPrefillToken.value === token) return
    void (async () => {
      try {
        const raw = await configApi.configDetailRaw(configId)
        if (configDetailPrefillToken.value === token) return
        const prefill = raw ? resolveConfigDetailPrefill(raw) : { describe: '', scriptPath: '', script: '' }
        const next: Partial<RuleOrchestration> = {}
        if (prefill.describe) next.describe = prefill.describe
        if (prefill.scriptPath) next.scriptPath = prefill.scriptPath
        if (prefill.script) next.script = prefill.script
        if (Object.keys(next).length) patch(next)
        if (prefill.scriptPath && !prefill.script) {
          const loadedScript = await ruleApi.fileDownloadScript(prefill.scriptPath).catch(() => '')
          if (loadedScript.trim()) patch({ script: loadedScript })
        }
        configDetailPrefillToken.value = token
      } catch {
        // 详情回填失败不阻断编排页，其它回填逻辑仍可继续。
      }
    })()
  },
  { immediate: true },
)
/**
 * 系统提示词 / 工作台里 `{{source_id}}` 的取值：**当前正在编辑的那个源**——
 * 画布上是左侧源列表里选中的那个（`flow.sourceCfg`，个别场景它为空时取 `flow.sourceCtx` 兜底），
 * 网站汇总态下是监控视图里选中的那个源。取值由节点编辑上下文提供（见 nodeEditorContext.ts）。
 *
 * 不能用节点的 `stepSourceId`：那是旧步骤的「适用源」，规则处理 / 数据监控节点按设计默认
 * `-1`（表示该配置下所有源共用，见 flowModel.ts 的字段注释），拼进提示词就成了
 * `source_id=-1`——监控脚本里拿这个 ID 去查数据必然查不到（2026-09-16 实测踩到）。
 * 两者不是同一层，别互相顶替。
 */

/**
 * 系统提示词里 `{{source_cron}}` 的取值：**节点配置 Tab「定时策略」里那个 cron 框的值**
 *（节点 → collectCfg → 源 三层合并 + 策略推导，见 utils/flow/scheduleCron.ts）。
 *
 * 与 ck_source.SCHEDULE 落库值同源（utils/flow/monitorCkSource.ts 用同一个函数）——
 * 之前这里直接读 `node.schedule.cron`，节点只选过「每天 08:00」这类策略时那个字段可能是空的，
 * 于是界面显示 `0 0 8 * * ?`、提示词里却是空。
 */
const sourceCron = computed(() => nodeScheduleCron(cfg.value, sourceSchedule.value))

let promptRefreshSeq = 0
watch(
  () => [
    id.value,
    isRule.value,
    isMonitor.value,
    isDataValidation.value,
    isArticleSummary.value,
    isArticleTag.value,
    sourceTableName.value,
    promptSourceId.value,
    promptCategory.value,
    promptListCategory.value,
    orchCfg.value.inputFields?.join(',') ?? '',
    orchCfg.value.outputFields?.join(',') ?? '',
    inputFieldOptions.value.map((field) => `${field.itemCode}:${field.itemName}`).join(','),
    outputFieldOptions.value.map((field) => `${field.itemCode}:${field.itemName}`).join(','),
  ] as const,
  () => {
    if (!isRule.value && !isMonitor.value && !isDataValidation.value && !isArticleSummary.value && !isArticleTag.value) return
    const refreshSeq = ++promptRefreshSeq
    // 数据监控节点进入编排 Tab 时即拼接系统提示词，与脚本编辑弹窗的行为一致——
    // 弹窗 loadPromptTemplate 无条件调用，这里也不卡 sourceTableName/inputFields。
    if (isRule.value && !isMonitor.value && !isDataValidation.value) {
      if (!sourceTableName.value) return
      if (!orchCfg.value.inputFields?.length) return
      if (!orchCfg.value.outputFields?.length) return
    }
    void (async () => {
      const applied = await loadPromptTemplateForNode({
        promptListCategory: promptListCategory.value,
        promptCategory: promptCategory.value,
        inputTableName: sourceTableName.value,
        outputTableName: orchCfg.value.outputTable?.trim() || sourceTableName.value,
        sourceId: isMonitor.value ? promptSourceId.value : '',
        sourceCron: isMonitor.value ? sourceCron.value : '',
        inputFields: orchCfg.value.inputFields ?? [],
        outputFields: orchCfg.value.outputFields ?? [],
        inputFieldOptions: inputFieldOptions.value,
        outputFieldOptions: outputFieldOptions.value.length ? outputFieldOptions.value : inputFieldOptions.value,
      })
      // 文章生成摘要 / 文章打标签节点：模板取不到的信号要留给界面（它们不能靠"提示词非空"判断能不能跑）
      if (isArticleSummary.value) articlePromptMissing.value = !applied
      if (isArticleTag.value) tagPromptMissing.value = !applied
      if (!applied) return
      if (refreshSeq !== promptRefreshSeq) return
      if (applied !== orchCfg.value.systemPrompt) patch({ systemPrompt: applied })
    })()
  },
  { immediate: true },
)

watch(
  () => [id.value, isMonitor.value, monitorDescribeSeed.value] as const,
  () => {
    if (!isMonitor.value || describeTouched.value) return
    const autoDescribe = monitorDescribeSeed.value
    if (autoDescribe && orchCfg.value.describe !== autoDescribe) patch({ describe: autoDescribe })
  },
  { immediate: true },
)

function onDescribeChange(e: Event) {
  describeTouched.value = true
  patch({ describe: (e.target as HTMLTextAreaElement).value })
}
function onSystemPromptChange(value: string) {
  patch({ systemPrompt: value })
}
function onPromptCategoryChange(value: PromptCategory) {
  patch({ promptCategory: resolvePromptCategoryForNode(cfg.value, value) })
}
async function onModelProviderChange(value: string) {
  patch({ modelProviderCode: value })
  // 换供应商必须重拉该供应商的模型列表，否则下拉里留着上一家的模型（原 onMainModelProviderChange 的行为）
  await loadModels(value, orchCfg.value.modelCode)
}
function onModelChange(value: string) {
  patch({ modelCode: value })
}
function onScriptChange(value: string) {
  patch({ script: value })
}
const generating = ref(false)
const generateAbort = ref<AbortController | null>(null)
const thinkingText = ref('')
const generationMessage = ref('')
const generationState = ref<'idle' | 'thinking' | 'content' | 'done' | 'error'>('idle')
const selectedExcelFile = ref<File | null>(null)
const excelFileError = ref('')
const excelFileInput = ref<HTMLInputElement | null>(null)
const MAX_EXCEL_FILE_SIZE = 10 * 1024 * 1024
const mainThinkingRef = ref<HTMLElement | null>(null)
const mainResultRef = ref<HTMLElement | null>(null)
function formatResultLabel(value: string): string {
  const text = value.trim()
  if (!text) return ''
  return text.replace(/^#?\s*(?:当前文件已保存到|保存到)\s*/, '')
}
const mainResultLabel = computed(() => formatResultLabel(orchCfg.value.scriptPath?.trim() || generationMessage.value))
const loadingResultScript = ref(false)
async function scrollMainThinkingToBottom() {
  await nextTick()
  const el = mainThinkingRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}
async function scrollMainResultToBottom() {
  await nextTick()
  const el = mainResultRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}
// 点击「生成结果」路径按钮时，把脚本下载到本地，文件名取路径最后一段（如 1788931403322.py）。
// 之前叫 loadResultScriptFromFile，做的是回填编辑器；本次改为本地下载，不再改 orchCfg.script。
function basenameOfPath(p: string): string {
  const trimmed = p.replace(/[?#].*$/, '').replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  const base = slash >= 0 ? trimmed.slice(slash + 1) : trimmed
  return base || 'script.txt'
}
async function downloadResultScriptToLocal() {
  const fileId = orchCfg.value.scriptPath?.trim() || mainResultLabel.value
  if (!fileId || loadingResultScript.value) return
  loadingResultScript.value = true
  try {
    const script = await ruleApi.fileDownloadScript(fileId)
    const fileName = basenameOfPath(fileId)
    const blob = new Blob([script], { type: 'text/plain;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = fileName
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(objectUrl)
    ElMessage.success(`已下载到本地：${fileName}`)
  } catch (e) {
    ElMessage.error((e as Error)?.message ?? String(e))
  } finally {
    loadingResultScript.value = false
  }
}
watch(
  () => [thinkingText.value, generating.value, generationState.value] as const,
  () => {
    if (!isRule.value) return
    if (generating.value || thinkingText.value.trim() || generationState.value === 'done' || generationState.value === 'error') {
      void scrollMainThinkingToBottom()
    }
  },
  { flush: 'post' },
)
watch(
  () => [orchCfg.value.script, generating.value, generationState.value] as const,
  () => {
    if (!isRule.value) return
    if (generating.value || orchCfg.value.script?.trim() || generationState.value === 'content' || generationState.value === 'done') {
      void scrollMainResultToBottom()
    }
  },
  { flush: 'post' },
)
function onCancelGenerate() {
  generateAbort.value?.abort()
}
function formatExcelFileSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
function onExcelFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  excelFileError.value = ''
  if (!file) return
  if (!/\.(?:xls|xlsx)$/i.test(file.name)) {
    selectedExcelFile.value = null
    excelFileError.value = '仅支持 .xls 或 .xlsx 文件'
    input.value = ''
    return
  }
  if (file.size > MAX_EXCEL_FILE_SIZE) {
    selectedExcelFile.value = null
    excelFileError.value = 'Excel 文件不能超过 10MB'
    input.value = ''
    return
  }
  selectedExcelFile.value = file
}
function removeExcelFile() {
  selectedExcelFile.value = null
  excelFileError.value = ''
  if (excelFileInput.value) excelFileInput.value.value = ''
}
/** 仅非规则节点的旧 XML 抓取配置复用还依赖 compose ruleId；规则/监控节点生成脚本走 configId。 */
async function resolveInputTableName(): Promise<string> {
  if (!isRule.value) return ''
  const named = orchCfg.value.inputTable?.trim()
  if (named) return named
  const tableId = orchCfg.value.inputTableId?.trim()
  if (!tableId) return ''
  try {
    const entry = await entryApi.entryDetail(tableId)
    const tableName = entry.tableName?.trim() || ''
    if (tableName) patch({ inputTable: tableName })
    return tableName
  } catch {
    return ''
  }
}
async function ensureLegacyComposeRuleId(): Promise<string | undefined> {
  if (isVruleNumericRuleId(orchCfg.value.ruleId)) return orchCfg.value.ruleId
  // 已有非数字 id（mock orch-*）：生成接口会走 mock，不必再打 saveMeta。`-1` 除外。
  const existing = orchCfg.value.ruleId?.trim()
  if (existing && existing !== '-1') return existing
  if (!cfg.value?.title?.trim()) {
    ElMessage.warning('请先在「节点配置」填写节点名称')
    return undefined
  }
  try {
    const inputTable = await resolveInputTableName()
    const res = await ruleApi.orchestrationSaveMeta({
      ...orchCfg.value,
      dataSource: RULE_DATA_SOURCE,
      inputTable,
      outputTable: isRule.value ? orchCfg.value.outputTable : outputTableId.value,
    })
    patch({ mode: 'ref', ruleId: res.ruleId })
    if (!isVruleNumericRuleId(res.ruleId)) {
      ElMessage.error('编排记录未返回有效 ruleId，无法生成配置')
      return undefined
    }
    return res.ruleId
  } catch (e) {
    ElMessage.error(`保存编排记录失败：${(e as Error)?.message ?? String(e)}`)
    return undefined
  }
}
async function onGenerateScript(
  draft?: Partial<Pick<RuleOrchestration, 'systemPrompt' | 'promptCategory' | 'modelProviderCode' | 'modelCode'>> & { file?: File },
) {
  if (!orchCfg.value.describe.trim()) {
    ElMessage.warning(isMonitor.value ? '请先填写数据监控描述' : isDataValidation.value ? '请先填写数据校验描述' : isRule.value ? '请先填写规则处理描述' : '请先填写抓取需求描述')
    return
  }
  if (isRule.value && !cfg.value?.configId) {
    ElMessage.warning('请先保存表配置，再生成脚本')
    return
  }
  if (isRule.value && (!((draft?.modelProviderCode ?? orchCfg.value.modelProviderCode) || '').trim() || !((draft?.modelCode ?? orchCfg.value.modelCode) || '').trim())) {
    ElMessage.warning('请先选择模型供应商和模型')
    return
  }
  if (isRule.value && !isMonitor.value && !isDataValidation.value && (!orchCfg.value.inputFields?.length || !orchCfg.value.outputFields?.length)) {
    ElMessage.warning('请先在「表配置」完成入参/出参字段绑定')
    return
  }
  // 数据监控节点无出参字段，只校验入参，跳过出参校验（2026-09-01）
  if ((isMonitor.value || isDataValidation.value) && !orchCfg.value.inputFields?.length) {
    ElMessage.warning('请先在「表配置」完成入参字段绑定')
    return
  }
  generateAbort.value?.abort()
  const controller = new AbortController()
  generateAbort.value = controller
  generating.value = true
  thinkingText.value = ''
  generationMessage.value = ''
  generationState.value = 'idle'
  patch({ script: '', scriptPath: '' })
  try {
    const legacyRuleId = !isRule.value ? await ensureLegacyComposeRuleId() : undefined
    if (!isRule.value && !legacyRuleId) return
    if (controller.signal.aborted) throw new Error('已取消生成')
    const currentOrchCfg = { ...orchCfg.value }
    if (isRule.value) delete currentOrchCfg.ruleId
    const genCfg = {
      ...currentOrchCfg,
      ...draft,
      ...(legacyRuleId ? { ruleId: legacyRuleId } : {}),
    }
    let streamedScript = ''
    let res: Awaited<ReturnType<typeof ruleApi.orchestrationGenerate>>
    if (isRule.value) {
      res = await ruleApi.dataProcessGenerate(buildDataProcessGeneratePayload({
        description: genCfg.describe,
        configId: Number(cfg.value?.configId ?? 0),
        providerCode: genCfg.modelProviderCode ?? '',
        model: genCfg.modelCode ?? '',
        sourceTable: sourceTableName.value,
        targetTable: genCfg.outputTable ?? '',
        inputFields: genCfg.inputFields ?? [],
        outputFields: genCfg.outputFields ?? [],
        inputFieldOptions: inputFieldOptions.value,
        outputFieldOptions: outputFieldOptions.value,
        systemPrompt: genCfg.systemPrompt ?? '',
        checkRule: isMonitor.value ? (cfg.value?.monitorMethods ?? []).join(',') || undefined : undefined,
      }), {
        file: selectedExcelFile.value ?? undefined,
        signal: controller.signal,
        onThinking: (delta) => {
          if (!delta) return
          generationState.value = 'thinking'
          thinkingText.value = `${thinkingText.value}${delta}`
        },
        onContent: (delta) => {
          if (!delta) return
          generationState.value = 'content'
          streamedScript += delta
          patch({ script: streamedScript })
        },
        onDone: (payload) => {
          generationState.value = 'done'
          generationMessage.value = payload.message || '保存完成'
          // 流式接口在 onDone 提示里带回保存路径（如「已保存到/code01/202609/x.py」），
          // 没有独立 scriptPath 字段——从 message 提取并 patch，否则「测试脚本」拿不到 codePath
          const savedPath = (payload.message || '').match(/保存到\s*([^\s]+)/)?.[1]
          if (savedPath) patch({ scriptPath: savedPath })
        },
      })
    } else {
      res = await ruleApi.orchestrationGenerate(genCfg, controller.signal)
    }
    // 流式分支的 scriptPath 由 onDone 从提示文本提取并 patch，res.scriptPath 为空——
    // 这里只有 res.scriptPath 有值时才覆盖，避免把流式提取到的路径清空
    patch({ script: res.script, ...(res.scriptPath ? { scriptPath: res.scriptPath } : {}) })
    if (isRule.value) {
      generationState.value = 'done'
      generationMessage.value = generationMessage.value || '保存完成'
    }
    ElMessage.success(isRule.value ? '脚本已生成' : '配置已生成')
  } catch (e) {
    if (controller.signal.aborted || (e as Error)?.message?.includes('已取消')) {
      ElMessage.info('已取消生成')
    } else {
      generationState.value = 'error'
      generationMessage.value = (e as Error)?.message ?? String(e)
      ElMessage.error(`生成${isRule.value ? '脚本' : '配置'}失败：${(e as Error)?.message ?? String(e)}`)
    }
  } finally {
    if (generateAbort.value === controller) generateAbort.value = null
    generating.value = false
  }
}

const workbenchOpen = ref(false)

const savingScript = ref(false)
const codeTestLoading = ref(false)
const codeTestResult = ref('')
const codeTestError = ref('')
const monitorCodeTestVisible = ref(false)

async function onSaveScript() {
  if (!orchCfg.value.script?.trim()) {
    ElMessage.warning(isRule.value ? '请先生成脚本' : '请先生成配置')
    return
  }
  // 文件服务按 scriptPath 原地覆盖写文件；scriptPath 为空时不能确定写入目标。
  // 开放手写脚本后，script 非空不再等价于已经生成过文件路径，因此这里必须显式校验。
  if (!orchCfg.value.scriptPath?.trim()) {
    ElMessage.warning(isRule.value ? '请先点「生成脚本」换一个本节点自己的文件路径，再保存' : '请先点「生成配置」换一个本节点自己的文件路径，再保存')
    return
  }
  if (!(await checkColumnConsistency())) return
  try {
    await ElMessageBox.confirm(
      isRule.value ? '保存后将把当前脚本绑定到该规则处理节点，是否继续？' : '保存后将把当前配置绑定到该节点，是否继续？',
      isRule.value ? '保存规则脚本' : '保存抓取配置',
      { type: 'warning', confirmButtonText: '确认保存', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  savingScript.value = true
  try {
    // 保存脚本文本直接写入当前节点的 scriptPath，不再调用已废弃的编排脚本编辑接口。
    const fileId = orchCfg.value.scriptPath.trim()
    const res = await ruleApi.fileUploadScript(fileId, orchCfg.value.script ?? '')
    patch({ mode: 'ref', scriptPath: fileId })
    // 数据监控节点：脚本保存成功后同步 ck_source（失败不回滚，单独提示）。
    // 同步实现在 utils/flow/monitorCkSource.ts——2026-09-07 起 NodeInspector 底部「保存」
    //（编排配置 Tab）也触发同一条同步，两处共用保证 payload 口径一致。
    // 源一并传进去：节点没配过定时时，节点配置 Tab 展示的就是源上的 cron，落库要用同一个值。
    if (isMonitor.value) {
      try {
        await syncMonitorCkSource(promptSourceId.value, cfg.value, sourceSchedule.value)
      } catch (e) {
        ElMessage.error(`监控源配置同步失败：${(e as Error)?.message ?? String(e)}`)
      }
    }
    ElMessage.success(res.message || (isRule.value ? '规则脚本已保存' : '抓取配置已保存'))
  } catch (e) {
    ElMessage.error(`保存失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    savingScript.value = false
  }
}

// ---- 切换已有配置（P0，仅非规则节点；规则节点的「引用已有规则」已被 D3 砍掉，见方案 §1.3）----
// 复用 ruleApi.orchestrationPaged（vrule 编排列表接口，无新增端点）；列表项不带 format，
// 按 scriptPath 是否 .xml 后缀筛出抓取配置类记录——后续如果有专用接口，只用改这一个函数。
const switchOptions = ref<RuleOrchestrationItem[]>([])
const switchLoading = ref(false)
const switchLoaded = ref(false)
const switchLoadError = ref('')
const switchSelected = ref('')
async function loadSwitchOptions() {
  if (switchLoaded.value || switchLoading.value) return
  switchLoading.value = true
  switchLoadError.value = ''
  try {
    const paged = await ruleApi.orchestrationPaged({ size: 100 })
    switchOptions.value = paged.list.filter((item) => item.scriptPath?.endsWith('.xml'))
    switchLoaded.value = true
  } catch (e) {
    // 既有配置只是可选的复用入口，列表接口异常不能阻断当前节点的新建/生成/保存流程。
    switchLoadError.value = `既有配置列表暂时不可用：${(e as Error)?.message ?? String(e)}`
  } finally {
    switchLoading.value = false
  }
}
function retryLoadSwitchOptions() {
  void loadSwitchOptions()
}
watch(isRule, (v) => { if (!v) void loadSwitchOptions() }, { immediate: true })

const applyingSwitch = ref(false)
async function onApplySwitch() {
  const target = switchOptions.value.find((o) => o.ruleId === switchSelected.value)
  if (!target) return
  // 非规则节点必须有自己的旧 compose 记录才能切换套用，否则只拷内容不带 ruleId 没有落点。
  if (!isVruleNumericRuleId(orchCfg.value.ruleId)) {
    if (!(await ensureLegacyComposeRuleId())) return
  }
  applyingSwitch.value = true
  try {
    const detail = await ruleApi.orchestrationDetail(target.ruleId)
    const sourceScriptPath = detail.scriptPath || target.scriptPath
    const script = sourceScriptPath ? await ruleApi.orchestrationLoadScript(sourceScriptPath).catch(() => '') : ''
    // 只拷内容当草稿，ruleId/scriptPath 不跟着换——这两个决定「保存脚本」实际写去哪，沿用源节点的
    // 会直接覆盖它的文件，不是"另存"（文件服务按 scriptPath 原地覆盖写，
    // 跟 ruleId 无关）。
    // scriptPath 清空，强制先点一次「生成配置」换成本节点
    // 自己的新文件，才允许「保存脚本」（onSaveScript 的 scriptPath 非空校验兜底）。
    patch({
      describe: detail.describe || target.describe || '',
      systemPrompt: detail.systemPrompt || orchCfg.value.systemPrompt,
      script,
      scriptPath: '',
    })
    ElMessage.success(`已复制「${target.name}」的内容，点「生成脚本」换成本节点自己的文件后再保存`)
  } catch (e) {
    ElMessage.error(`切换配置失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    applyingSwitch.value = false
  }
}

// ---- 测试脚本：普通规则处理仍切换到「数据视图」tab；数据监控脚本不需要行参数，直接执行 codePath ----
const canTest = computed(() => {
  const hasScript = !!(orchCfg.value.script?.trim() || orchCfg.value.scriptPath?.trim())
  const hasScriptPath = !!orchCfg.value.scriptPath?.trim()
  if (isMonitor.value || isDataValidation.value) return hasScriptPath
  const hasInputTable = !!(
    orchCfg.value.inputTable?.trim()
    || orchCfg.value.inputTableId?.trim()
    || cfg.value?.inputTable?.trim()
    || cfg.value?.collectCfg?.inputTable?.trim()
  )
  return hasScript && hasInputTable
})
function formatCodeTestResult(result: unknown): string {
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}
async function executeMonitorCode() {
  const codePath = orchCfg.value.scriptPath?.trim()
  if (!codePath) {
    ElMessage.warning('请先生成脚本')
    return
  }
  monitorCodeTestVisible.value = true
  codeTestLoading.value = true
  codeTestResult.value = ''
  codeTestError.value = ''
  try {
    const result = await ruleApi.executeCode({ codePath, timeout: 300 })
    codeTestResult.value = formatCodeTestResult(result)
    ElMessage.success('测试脚本执行完成')
  } catch (e) {
    const message = (e as Error)?.message ?? String(e)
    codeTestError.value = message
    ElMessage.error(`测试脚本失败：${message}`)
  } finally {
    codeTestLoading.value = false
  }
}
function goToDataView() {
  const query: Record<string, string> = { ...route.query } as Record<string, string>
  query.view = 'data'
  if (id.value) query.nodeId = id.value
  if (orchCfg.value.scriptPath?.trim()) query.scriptPath = orchCfg.value.scriptPath.trim()
  void router.replace({ path: '/canvas', query })
}
function onTestScript() {
  if (isMonitor.value || isDataValidation.value) {
    void executeMonitorCode()
    return
  }
  goToDataView()
}
</script>

<template>
  <div v-if="isMonitor" class="rc-field rc-monitor-methods-field" data-testid="monitor-methods-field">
    <label>监控方法</label>
    <el-select
      class="rc-monitor-methods-select"
      :model-value="monitorMethods"
      multiple
      collapse-tags
      collapse-tags-tooltip
      clearable
      placeholder="选择监控方法"
      @update:model-value="setMonitorMethods"
    >
      <el-option v-for="m in MONITOR_METHODS" :key="m" :label="m" :value="m" />
    </el-select>
  </div>
  <div class="ni-section-title ni-section-title-row">
    <span>{{ isRule ? '设置业务规则' : '抓取配置' }}</span>
    <span v-if="!isScriptless" class="ni-section-actions">
      <button class="rc-btn" type="button" @click="workbenchOpen = true">脚本编辑</button>
    </span>
  </div>
  <!-- OCR 识别试跑（0917 第一版）：选图 → 转 base64 → 调 OCR 服务 → 把识别文本贴出来。
       图片只存在本组件的内存里（切节点即清），暂不落节点配置；要不要随之落库等口径确定。 -->
  <div v-if="isOcr" class="rc-field ocr-field" data-testid="ocr-recognize-field">
    <label>OCR 识别</label>
    <div class="ocr-picker">
      <input
        ref="ocrFileInput"
        class="rc-file-input"
        data-testid="ocr-image-input"
        type="file"
        accept="image/*"
        @change="onOcrFileChange"
      />
      <button class="rc-btn" type="button" data-testid="ocr-pick-image" @click="ocrFileInput?.click()">
        <Picture aria-hidden="true" />
        <span>{{ ocrFile ? '更换图片' : '选择图片' }}</span>
      </button>
      <span class="ocr-hint">PNG / JPG，最大 {{ Math.round(OCR_MAX_FILE_SIZE / 1024 / 1024) }}MB，识别时转 base64</span>
    </div>
    <div v-if="ocrFile" class="ocr-preview">
      <img v-if="ocrPreviewUrl" class="ocr-thumb" :src="ocrPreviewUrl" :alt="ocrFile.name">
      <span class="ocr-file-name" :title="ocrFile.name">{{ ocrFile.name }}</span>
      <span class="ocr-file-size">{{ formatFileSize(ocrFile.size) }}</span>
      <button class="ocr-remove" type="button" title="移除图片" aria-label="移除图片" @click="clearOcrImage">
        <Delete aria-hidden="true" />
      </button>
    </div>
    <div v-if="ocrFileError" class="ocr-error" data-testid="ocr-file-error">{{ ocrFileError }}</div>
    <div class="ocr-actions">
      <button
        class="rc-btn primary"
        type="button"
        data-testid="ocr-recognize"
        :disabled="!ocrFile || ocrRunning"
        @click="runOcrRecognize"
      >{{ ocrRunning ? '识别中…' : '开始识别' }}</button>
      <span v-if="ocrError" class="ocr-error" data-testid="ocr-error">{{ ocrError }}</span>
    </div>
    <div v-if="ocrText" class="ocr-result" data-testid="ocr-result">
      <div class="ocr-result-head">
        <span>识别文本（{{ ocrBlockCount }} 块）</span>
        <span class="ocr-result-actions">
          <button class="rc-link-btn" type="button" @click="ocrTextVisible = !ocrTextVisible">
            {{ ocrTextVisible ? '收起原文' : '查看原始返回' }}
          </button>
          <button class="rc-link-btn" type="button" @click="copyOcrText">复制</button>
        </span>
      </div>
      <pre class="ocr-result-text">{{ ocrText }}</pre>
      <pre v-if="ocrTextVisible && ocrRawText" class="ocr-result-raw" data-testid="ocr-raw">{{ ocrRawText }}</pre>
    </div>
  </div>
  <!-- 语音转文字试跑（0917 第一版，仅音频提取文字节点）：上传音频 → multipart 调后端
       /api/speech/transcriptions → 贴出转写文本。与 OCR 那套一样只存内存，暂不写节点配置。 -->
  <div v-if="isAudioText" class="rc-field ocr-field" data-testid="audio-transcribe-field">
    <label>语音转文字</label>
    <div class="ocr-picker">
      <input
        ref="audioFileInput"
        class="rc-file-input"
        data-testid="audio-file-input"
        type="file"
        :accept="AUDIO_ACCEPT"
        @change="onAudioFileChange"
      />
      <button class="rc-btn" type="button" data-testid="audio-pick-file" @click="audioFileInput?.click()">
        <Headset aria-hidden="true" />
        <span>{{ audioFile ? '更换音频' : '上传音频' }}</span>
      </button>
      <span class="ocr-hint">
        {{ SPEECH_AUDIO_EXTENSIONS.join(' / ') }}，最大 {{ Math.round(SPEECH_MAX_FILE_SIZE / 1024 / 1024) }}MB，
        单段不超过 {{ formatDuration(SPEECH_MAX_DURATION_SECONDS) }}
      </span>
    </div>
    <div v-if="audioFile" class="ocr-preview">
      <span class="ocr-file-name" :title="audioFile.name">{{ audioFile.name }}</span>
      <span class="ocr-file-size">
        {{ formatFileSize(audioFile.size) }}<template v-if="audioDuration"> · {{ formatDuration(audioDuration) }}</template>
      </span>
      <button class="ocr-remove" type="button" title="移除音频" aria-label="移除音频" @click="clearAudioFile">
        <Delete aria-hidden="true" />
      </button>
    </div>
    <div v-if="audioFileError" class="ocr-error" data-testid="audio-file-error">{{ audioFileError }}</div>
    <label class="audio-language">
      <span>语言</span>
      <select v-model="audioLanguage" class="rc-select" data-testid="audio-language">
        <option value="">自动识别</option>
        <option v-for="item in SPEECH_LANGUAGE_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
      </select>
    </label>
    <div class="ocr-actions">
      <button
        class="rc-btn primary"
        type="button"
        data-testid="audio-transcribe"
        :disabled="!audioFile || audioRunning || audioTooLong"
        :title="audioTooLong ? '音频超过单段时长上限，请先裁剪或分段' : ''"
        @click="runTranscribe"
      >{{ audioRunning ? '转写中…' : '开始转写' }}</button>
      <span v-if="audioRunning" class="ocr-hint">转写是同步长请求，长音频可能要等一会儿</span>
      <span v-if="audioError" class="ocr-error" data-testid="audio-error">{{ audioError }}</span>
    </div>
    <div v-if="audioResult" class="ocr-result" data-testid="audio-result">
      <div class="ocr-result-head">
        <span>转写文本（{{ audioResult.text.length }} 字{{ formatDuration(audioResult.duration) ? ` · ${formatDuration(audioResult.duration)}` : '' }}）</span>
        <span class="ocr-result-actions">
          <button class="rc-link-btn" type="button" @click="copyTranscription">复制</button>
        </span>
      </div>
      <pre class="ocr-result-text" data-testid="audio-result-text">{{ audioResult.text }}</pre>
      <div v-if="audioResult.traceId" class="audio-trace">traceId：{{ audioResult.traceId }}</div>
    </div>
  </div>
  <!-- 视频提取音频试跑（0917 第一版，仅视频提取音频节点）：上传视频 → multipart 调后端
       /api/media/extract-audio → 拿回音频试听/下载；勾选上传时后端改回 JSON + fileId。 -->
  <div v-if="isVideoAudio" class="rc-field ocr-field" data-testid="video-extract-field">
    <label>视频提取音频</label>
    <div class="ocr-picker">
      <input
        ref="videoFileInput"
        class="rc-file-input"
        data-testid="video-file-input"
        type="file"
        :accept="VIDEO_ACCEPT"
        @change="onVideoFileChange"
      />
      <button class="rc-btn" type="button" data-testid="video-pick-file" @click="videoFileInput?.click()">
        <VideoPlay aria-hidden="true" />
        <span>{{ videoFile ? '更换视频' : '上传视频' }}</span>
      </button>
      <span class="ocr-hint">{{ MEDIA_VIDEO_EXTENSIONS.join(' / ') }}，最大 {{ Math.round(MEDIA_MAX_FILE_SIZE / 1024 / 1024) }}MB</span>
    </div>
    <div v-if="videoFile" class="ocr-preview">
      <span class="ocr-file-name" :title="videoFile.name">{{ videoFile.name }}</span>
      <span class="ocr-file-size">
        {{ formatFileSize(videoFile.size) }}<template v-if="videoDuration"> · {{ formatDuration(videoDuration) }}</template>
      </span>
      <button class="ocr-remove" type="button" title="移除视频" aria-label="移除视频" @click="clearVideoFile">
        <Delete aria-hidden="true" />
      </button>
    </div>
    <div v-if="videoFileError" class="ocr-error" data-testid="video-file-error">{{ videoFileError }}</div>
    <div class="media-options">
      <label class="media-option">
        <span>输出格式</span>
        <select v-model="mediaFormat" class="rc-select" data-testid="media-format">
          <option v-for="item in MEDIA_AUDIO_FORMATS" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </label>
      <label class="media-option">
        <span>码率</span>
        <select v-model="mediaBitRate" class="rc-select" :disabled="!mediaFormatLossy" data-testid="media-bitrate">
          <option value="">默认</option>
          <option v-for="item in MEDIA_BIT_RATE_OPTIONS" :key="item.value" :value="String(item.value)">{{ item.label }}</option>
        </select>
      </label>
      <label class="media-option">
        <span>采样率</span>
        <select v-model="mediaSamplingRate" class="rc-select" data-testid="media-sampling-rate">
          <option value="">默认</option>
          <option v-for="item in MEDIA_SAMPLING_RATE_OPTIONS" :key="item.value" :value="String(item.value)">{{ item.label }}</option>
        </select>
      </label>
      <label class="media-option">
        <span>声道</span>
        <select v-model="mediaChannels" class="rc-select" data-testid="media-channels">
          <option value="">默认</option>
          <option v-for="item in MEDIA_CHANNEL_OPTIONS" :key="item.value" :value="String(item.value)">{{ item.label }}</option>
        </select>
      </label>
    </div>
    <label class="media-upload-switch">
      <input v-model="mediaUpload" type="checkbox" data-testid="media-upload-switch">
      <span>同时上传到文件服务（返回 fileId，便于后续落到节点产物）</span>
    </label>
    <div class="ocr-actions">
      <button
        class="rc-btn primary"
        type="button"
        data-testid="video-extract"
        :disabled="!videoFile || videoRunning"
        @click="runExtractAudio"
      >{{ videoRunning ? '提取中…' : '提取音频' }}</button>
      <span v-if="videoRunning" class="ocr-hint">转码是同步长请求，大视频可能要等几分钟</span>
      <span v-if="videoError" class="ocr-error" data-testid="video-error">{{ videoError }}</span>
    </div>
    <div v-if="extractedAudio" class="ocr-result" data-testid="video-result">
      <div class="ocr-result-head">
        <span>提取结果（{{ extractedAudio.filename }} · {{ formatFileSize(extractedAudio.size) }}<template v-if="videoDuration"> · 源 {{ formatDuration(videoDuration) }}</template>）</span>
        <span class="ocr-result-actions">
          <button class="rc-link-btn" type="button" @click="downloadExtractedAudio">下载</button>
        </span>
      </div>
      <audio v-if="videoAudioUrl" class="media-player" controls :src="videoAudioUrl" data-testid="video-audio-player" />
    </div>
    <div v-else-if="uploadedAudio" class="ocr-result" data-testid="video-upload-result">
      <div class="ocr-result-head">
        <span>已上传到文件服务</span>
        <span class="ocr-result-actions">
          <button class="rc-link-btn" type="button" @click="copyFileId">复制 fileId</button>
        </span>
      </div>
      <div class="ocr-result-text media-upload-meta">
        <div>文件名：{{ uploadedAudio.filename }}</div>
        <div>格式：{{ uploadedAudio.format }} · 大小：{{ formatFileSize(uploadedAudio.size) }}</div>
        <div>时长：{{ formatDuration(uploadedAudio.duration) || '未知' }}</div>
        <div class="media-fileid" data-testid="video-file-id">fileId：{{ uploadedAudio.fileId }}</div>
      </div>
    </div>
  </div>
  <!-- 文章生成摘要（0917 第一版，仅文章生成摘要节点）：上传/粘贴正文 → 调 /api/answer/data-process。
       系统提示词来自 cfg_llm_node_prompt（category=rule + node_type_name=文章生成摘要），
       下面只读展示实际会发出去的那一份，便于核对。 -->
  <div v-if="isArticleSummary" class="rc-field ocr-field" data-testid="article-summary-field">
    <label>文章生成摘要</label>
    <div class="ocr-picker">
      <input
        ref="articleFileInput"
        class="rc-file-input"
        data-testid="article-file-input"
        type="file"
        accept=".txt,.md,.markdown,.csv,.json,.log,.html,.htm,text/*"
        @change="onArticleFileChange"
      />
      <button class="rc-btn" type="button" data-testid="article-pick-file" @click="articleFileInput?.click()">
        <Document aria-hidden="true" />
        <span>上传文本</span>
      </button>
      <span class="ocr-hint">
        {{ ARTICLE_TEXT_EXTENSIONS.join(' / ') }}，也可直接粘贴；单次最多 {{ TRANSLATE_MAX_QUERY_BYTES }} 字节（中文约 2000 字）
      </span>
    </div>
    <div v-if="articleFileName" class="ocr-preview">
      <span class="ocr-file-name" :title="articleFileName">{{ articleFileName }}</span>
      <span class="ocr-file-size">{{ articleCharCount }} 字</span>
      <button class="ocr-remove" type="button" title="清空正文" aria-label="清空正文" @click="clearArticle">
        <Delete aria-hidden="true" />
      </button>
    </div>
    <div v-if="articleFileError" class="ocr-error" data-testid="article-file-error">{{ articleFileError }}</div>
    <textarea
      class="rc-input rc-textarea article-text"
      :value="articleText"
      data-testid="article-text"
      placeholder="粘贴或上传要生成摘要的文章正文"
      @input="onArticleTextInput"
    />
    <div class="article-text-meta">
      <span>{{ articleCharCount }} 字</span>
      <button v-if="articleText" class="rc-link-btn" type="button" @click="clearArticle">清空</button>
    </div>
    <div class="rc-model-row">
      <span class="rc-model-fields">
        <label class="rc-inline-field">
          <span>模型供应商</span>
          <el-select
            :model-value="orchCfg.modelProviderCode ?? ''"
            class="rc-inline-select"
            size="small"
            :loading="providerLoading"
            placeholder="模型供应商"
            data-testid="article-model-provider"
            @change="onModelProviderChange"
          >
            <el-option v-for="item in providerOptions" :key="item.providerCode" :label="item.providerName" :value="item.providerCode" />
          </el-select>
        </label>
        <label class="rc-inline-field">
          <span>模型</span>
          <el-select
            :model-value="orchCfg.modelCode ?? ''"
            class="rc-inline-select"
            size="small"
            :loading="modelLoading"
            :disabled="!orchCfg.modelProviderCode || !providerOptions.length"
            placeholder="模型"
            data-testid="article-model"
            @change="onModelChange"
          >
            <el-option v-for="item in modelOptions" :key="item.modelCode" :label="item.modelName" :value="item.modelCode" />
          </el-select>
        </label>
      </span>
    </div>
    <div v-if="providerError || modelError" class="rc-help">{{ providerError || modelError }}</div>
    <div class="article-prompt">
      <button class="rc-link-btn" type="button" data-testid="article-prompt-toggle" @click="articlePromptOpen = !articlePromptOpen">
        {{ articlePromptOpen ? '收起系统提示词' : '查看系统提示词' }}
      </button>
      <span class="ocr-hint">来自提示词表（cfg_llm_node_prompt · 文章生成摘要）</span>
    </div>
    <pre v-if="articlePromptOpen" class="article-prompt-text" data-testid="article-prompt-text">{{ orchCfg.systemPrompt || '（未取到提示词模板）' }}</pre>
    <div v-if="!articlePromptReady" class="ocr-error" data-testid="article-prompt-missing">
      没有取到「文章生成摘要」的系统提示词模板（cfg_llm_node_prompt 里需要 category=rule、node_type_name=文章生成摘要 的一行），暂不能生成
    </div>
    <div class="ocr-actions">
      <button
        class="rc-btn primary"
        type="button"
        :class="{ 'is-generating': articleRunning }"
        data-testid="article-generate"
        :disabled="!canGenerateSummary && !articleRunning"
        @click="articleRunning ? cancelArticleSummary() : runArticleSummary()"
      >{{ articleRunning ? '生成中…（点击取消）' : '生成摘要' }}</button>
      <span v-if="articleError" class="ocr-error" data-testid="article-error">{{ articleError }}</span>
    </div>
    <div v-if="articleSummary || articleThinking" class="ocr-result" data-testid="article-result">
      <div class="ocr-result-head">
        <span>摘要{{ articleDone ? '' : '（生成中…）' }}</span>
        <span class="ocr-result-actions">
          <button class="rc-link-btn" type="button" @click="copyArticleSummary">复制</button>
        </span>
      </div>
      <pre class="ocr-result-text article-summary-text" data-testid="article-summary-text">{{ articleSummary || '等待模型输出…' }}</pre>
      <details v-if="articleThinking.trim()" class="article-thinking">
        <summary>思考过程</summary>
        <pre>{{ articleThinking }}</pre>
      </details>
    </div>
  </div>
  <!-- 翻译助手（0917 第一版，仅翻译助手节点）：上传/粘贴文本 → 选目标语言 → 调 /api/answer/data-process。
       系统提示词来自 cfg_llm_node_prompt 的「翻译」那一行（该行 category 为空，查模板时不带 category）。 -->
  <div v-if="isTranslate" class="rc-field ocr-field" data-testid="translate-field">
    <label>翻译助手</label>
    <div class="ocr-picker">
      <input
        ref="translateFileInput"
        class="rc-file-input"
        data-testid="translate-file-input"
        type="file"
        accept=".txt,.md,.markdown,.csv,.json,.log,.html,.htm,text/*"
        @change="onTranslateFileChange"
      />
      <button class="rc-btn" type="button" data-testid="translate-pick-file" @click="translateFileInput?.click()">
        <Document aria-hidden="true" />
        <span>上传文件</span>
      </button>
      <span class="ocr-hint">
        {{ ARTICLE_TEXT_EXTENSIONS.join(' / ') }}，也可直接粘贴；最多 {{ ARTICLE_MAX_CHARS }} 字
      </span>
    </div>
    <div v-if="translateFileName" class="ocr-preview">
      <span class="ocr-file-name" :title="translateFileName">{{ translateFileName }}</span>
      <span class="ocr-file-size">{{ translateCharCount }} 字</span>
      <button class="ocr-remove" type="button" title="清空原文" aria-label="清空原文" @click="clearTranslate">
        <Delete aria-hidden="true" />
      </button>
    </div>
    <div v-if="translateFileError" class="ocr-error" data-testid="translate-file-error">{{ translateFileError }}</div>
    <textarea
      class="rc-input rc-textarea article-text"
      :value="translateText_"
      data-testid="translate-text"
      placeholder="粘贴或上传要翻译的内容"
      @input="onTranslateTextInput"
    />
    <div class="article-text-meta">
      <span :class="{ 'translate-over-limit': translateTooLong }">
        {{ translateCharCount }} 字 · {{ translateByteCount }} / {{ TRANSLATE_MAX_QUERY_BYTES }} 字节
      </span>
      <button v-if="translateText_" class="rc-link-btn" type="button" @click="clearTranslate">清空</button>
    </div>
    <!-- 语言选择（0917 按设计稿改成"源语言 ⇄ 目标语言"）：两个下拉中间一个互换按钮 -->
    <div class="translate-langs" data-testid="translate-langs">
      <el-select
        v-model="translateSource"
        class="translate-lang-select"
        size="small"
        data-testid="translate-source"
      >
        <el-option :label="TRANSLATE_AUTO" :value="TRANSLATE_AUTO" />
        <el-option v-for="lang in TRANSLATE_LANGUAGES" :key="lang" :label="lang" :value="lang" />
      </el-select>
      <button
        class="translate-swap"
        type="button"
        :disabled="!canSwapLanguages"
        :title="canSwapLanguages ? '互换源语言与目标语言' : '源语言为自动检测时无法互换'"
        aria-label="互换源语言与目标语言"
        data-testid="translate-swap"
        @click="swapTranslateLanguages"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            d="M7 4 3.5 7.5 7 11M3.5 7.5H16M17 20l3.5-3.5L17 13M20.5 16.5H8"
            fill="none" stroke="currentColor" stroke-width="1.6"
            stroke-linecap="round" stroke-linejoin="round"
          />
        </svg>
      </button>
      <el-select
        v-model="translateTarget"
        class="translate-lang-select"
        size="small"
        data-testid="translate-target"
      >
        <el-option v-for="lang in TRANSLATE_LANGUAGES" :key="lang" :label="lang" :value="lang" />
      </el-select>
    </div>
    <div class="ocr-actions">
      <button
        class="rc-btn primary"
        type="button"
        data-testid="translate-generate"
        :disabled="!canTranslate && !translateRunning"
        :title="translateTooLong ? `单次最多 ${TRANSLATE_MAX_QUERY_BYTES} 字节（中文约 2000 字），请先分段` : ''"
        @click="translateRunning ? cancelTranslate() : runTranslate()"
      >{{ translateRunning ? '翻译中…（点击取消）' : '开始翻译' }}</button>
      <span v-if="translateTooLong" class="ocr-error" data-testid="translate-over-limit">
        内容 {{ translateByteCount }} 字节，超过单次上限 {{ TRANSLATE_MAX_QUERY_BYTES }} 字节（百度标准版按 UTF-8 字节算，中文约 2000 字），请分段翻译
      </span>
      <span v-if="translateError" class="ocr-error" data-testid="translate-error">{{ translateError }}</span>
    </div>
    <div v-if="translateResult" class="ocr-result" data-testid="translate-result">
      <div class="ocr-result-head">
        <span>
          译文（{{ translateTarget }}）
          <span v-if="translateDetectedFrom" class="translate-detected">· 检测到源语言：{{ translateDetectedFrom }}</span>
        </span>
        <span class="ocr-result-actions">
          <button class="rc-link-btn" type="button" @click="copyTranslation">复制</button>
          <button class="rc-link-btn" type="button" @click="downloadTranslation">下载</button>
        </span>
      </div>
      <pre class="ocr-result-text article-summary-text" data-testid="translate-result-text">{{ translateResult }}</pre>
    </div>
  </div>
  <!-- 文章打标签（0918 第一版，仅文章打标签节点）：上传/粘贴文本 → 调 /api/answer/data-process
       （系统提示词取自 cfg_llm_node_prompt 的「文章打标签」行）→ 解析模型输出的 JSON 标签体系。 -->
  <div v-if="isArticleTag" class="rc-field ocr-field" data-testid="article-tag-field">
    <label>文章打标签</label>
    <div class="ocr-picker">
      <input
        ref="tagFileInput"
        class="rc-file-input"
        data-testid="tag-file-input"
        type="file"
        accept=".txt,.md,.markdown,.csv,.json,.log,.html,.htm,text/*"
        @change="onTagFileChange"
      />
      <button class="rc-btn" type="button" data-testid="tag-pick-file" @click="tagFileInput?.click()">
        <Document aria-hidden="true" />
        <span>上传文本</span>
      </button>
      <span class="ocr-hint">
        {{ ARTICLE_TEXT_EXTENSIONS.join(' / ') }}，也可直接粘贴；最多 {{ ARTICLE_MAX_CHARS }} 字
      </span>
    </div>
    <div v-if="tagFileName" class="ocr-preview">
      <span class="ocr-file-name" :title="tagFileName">{{ tagFileName }}</span>
      <span class="ocr-file-size">{{ tagCharCount }} 字</span>
      <button class="ocr-remove" type="button" title="清空文本" aria-label="清空文本" @click="clearArticleTag">
        <Delete aria-hidden="true" />
      </button>
    </div>
    <div v-if="tagFileError" class="ocr-error" data-testid="tag-file-error">{{ tagFileError }}</div>
    <textarea
      class="rc-input rc-textarea article-text"
      :value="tagText"
      data-testid="tag-text"
      placeholder="粘贴或上传要标注的文本（新闻、帖子、评论…）"
      @input="onTagTextInput"
    />
    <div class="article-text-meta">
      <span>{{ tagCharCount }} 字</span>
      <button v-if="tagText" class="rc-link-btn" type="button" @click="clearArticleTag">清空</button>
    </div>
    <div class="rc-model-row">
      <span class="rc-model-fields">
        <label class="rc-inline-field">
          <span>模型供应商</span>
          <el-select
            :model-value="orchCfg.modelProviderCode ?? ''"
            class="rc-inline-select"
            size="small"
            :loading="providerLoading"
            placeholder="模型供应商"
            data-testid="tag-model-provider"
            @change="onModelProviderChange"
          >
            <el-option v-for="item in providerOptions" :key="item.providerCode" :label="item.providerName" :value="item.providerCode" />
          </el-select>
        </label>
        <label class="rc-inline-field">
          <span>模型</span>
          <el-select
            :model-value="orchCfg.modelCode ?? ''"
            class="rc-inline-select"
            size="small"
            :loading="modelLoading"
            :disabled="!orchCfg.modelProviderCode || !providerOptions.length"
            placeholder="模型"
            data-testid="tag-model"
            @change="onModelChange"
          >
            <el-option v-for="item in modelOptions" :key="item.modelCode" :label="item.modelName" :value="item.modelCode" />
          </el-select>
        </label>
      </span>
    </div>
    <div v-if="providerError || modelError" class="rc-help">{{ providerError || modelError }}</div>
    <div class="article-prompt">
      <button class="rc-link-btn" type="button" data-testid="tag-prompt-toggle" @click="tagPromptOpen = !tagPromptOpen">
        {{ tagPromptOpen ? '收起系统提示词' : '查看系统提示词' }}
      </button>
      <span class="ocr-hint">来自提示词表（cfg_llm_node_prompt · 文章打标签）</span>
    </div>
    <pre v-if="tagPromptOpen" class="article-prompt-text" data-testid="tag-prompt-text">{{ orchCfg.systemPrompt || '（未取到提示词模板）' }}</pre>
    <div v-if="!tagPromptReady" class="ocr-error" data-testid="tag-prompt-missing">
      没有取到「文章打标签」的系统提示词模板（cfg_llm_node_prompt 里需要 node_type_name=文章打标签 的一行），暂不能标注
    </div>
    <div class="ocr-actions">
      <button
        class="rc-btn primary"
        type="button"
        data-testid="tag-generate"
        :disabled="!canTag && !tagRunning"
        @click="tagRunning ? cancelArticleTag() : runArticleTag()"
      >{{ tagRunning ? '标注中…（点击取消）' : '开始打标签' }}</button>
      <span v-if="tagError" class="ocr-error" data-testid="tag-error">{{ tagError }}</span>
    </div>
    <!-- 结构化结果：摘要 + 各维度标签 + 置信度 + 依据；解析不出 JSON 时退回展示原始返回 -->
    <div v-if="tagResult" class="ocr-result tag-result" data-testid="tag-result">
      <div class="ocr-result-head">
        <span>标注结果</span>
        <span class="ocr-result-actions">
          <button class="rc-link-btn" type="button" @click="copyArticleTagResult">复制 JSON</button>
        </span>
      </div>
      <div class="tag-body">
        <div v-if="tagResult.summary" class="tag-summary" data-testid="tag-summary">{{ tagResult.summary }}</div>
        <div v-for="group in tagResult.groups" :key="group.key" class="tag-group">
          <span class="tag-group-label">{{ group.label }}</span>
          <span class="tag-chips">
            <span
              v-for="value in group.values"
              :key="value"
              class="tag-chip"
              :class="group.key === 'risk_level' ? `tone-${riskLevelTone(value)}` : ''"
            >{{ value }}</span>
          </span>
        </div>
        <div v-if="tagResult.confidence != null || tagResult.uncertain || tagResult.notes" class="tag-meta">
          <span v-if="tagResult.confidence != null">置信度 {{ tagResult.confidence.toFixed(2) }}</span>
          <span v-if="tagResult.uncertain" class="tag-uncertain">标记为不确定</span>
          <span v-if="tagResult.notes">{{ tagResult.notes }}</span>
        </div>
        <div v-if="tagResult.evidence.length" class="tag-evidence">
          <div v-for="item in tagResult.evidence" :key="item.label" class="tag-evidence-row">
            <b>{{ item.label }}依据</b><span>{{ item.text }}</span>
          </div>
        </div>
      </div>
      <button class="rc-link-btn tag-raw-toggle" type="button" data-testid="tag-raw-toggle" @click="tagRawOpen = !tagRawOpen">
        {{ tagRawOpen ? '收起原始返回' : '查看原始返回' }}
      </button>
      <pre v-if="tagRawOpen" class="ocr-result-raw" data-testid="tag-raw">{{ tagResult.raw }}</pre>
    </div>
    <div v-else-if="tagRawOutput" class="ocr-result" data-testid="tag-raw-result">
      <div class="ocr-result-head">
        <span>模型返回（不是 JSON，未做结构化展示）</span>
        <span class="ocr-result-actions">
          <button class="rc-link-btn" type="button" @click="copyArticleTagResult">复制</button>
        </span>
      </div>
      <pre class="ocr-result-text">{{ tagRawOutput }}</pre>
    </div>
  </div>
  <div class="rc-field">
    <textarea
      class="rc-input rc-textarea"
      :value="orchCfg.describe"
      :placeholder="describePlaceholder"
      @input="onDescribeChange"
    />
  </div>
  <div v-if="isRule" class="rc-model-row">
    <span class="rc-model-fields">
      <label class="rc-inline-field">
        <span>模型供应商</span>
        <el-select
          :model-value="orchCfg.modelProviderCode ?? ''"
          class="rc-inline-select"
          size="small"
          :loading="providerLoading"
          placeholder="模型供应商"
          data-testid="main-model-provider"
          @change="onModelProviderChange"
        >
          <el-option v-for="item in providerOptions" :key="item.providerCode" :label="item.providerName" :value="item.providerCode" />
        </el-select>
      </label>
      <label class="rc-inline-field">
        <span>模型</span>
        <el-select
          :model-value="orchCfg.modelCode ?? ''"
          class="rc-inline-select rc-inline-select-model"
          size="small"
          :loading="modelLoading"
          :disabled="!orchCfg.modelProviderCode || !providerOptions.length"
          placeholder="模型"
          data-testid="main-model"
          @change="onModelChange"
        >
          <el-option v-for="item in modelOptions" :key="item.modelCode" :label="item.modelName" :value="item.modelCode" />
        </el-select>
      </label>
    </span>
  </div>
  <div v-if="isRule" class="rc-generation-actions" data-testid="rule-generation-actions">
    <input
      v-if="!isMonitor"
      ref="excelFileInput"
      class="rc-file-input"
      data-testid="main-excel-file-input"
      type="file"
      accept=".xls,.xlsx"
      @change="onExcelFileChange"
    />
    <button
      v-if="!isMonitor"
      class="rc-btn rc-upload-btn"
      type="button"
      data-testid="main-upload-excel"
      @click="excelFileInput?.click()"
    >
      <UploadFilled aria-hidden="true" />
      <span>{{ selectedExcelFile ? '更换 Excel' : '上传 Excel' }}</span>
    </button>
    <button
      class="rc-btn primary"
      type="button"
      :class="{ 'is-generating': generating }"
      data-testid="main-generate-script"
      :aria-label="generating ? '取消生成脚本' : generateLabel"
      :title="generating ? '取消生成脚本' : generateLabel"
      @click="generating ? onCancelGenerate() : onGenerateScript()"
    >
      <span v-if="generating" class="rc-stop-icon" data-testid="stop-generation-icon" aria-hidden="true" />
      <template v-else>{{ generateLabel }}</template>
    </button>
    <button
      class="rc-btn"
      type="button"
      :disabled="!canTest"
      data-testid="main-test-script"
      @click="onTestScript"
    >
      {{ codeTestLoading ? '测试中...' : '测试脚本' }}
    </button>
  </div>
  <div v-if="isRule && !isMonitor && (selectedExcelFile || excelFileError)" class="rc-file-summary">
    <div v-if="selectedExcelFile" class="rc-file-selected">
      <span class="rc-file-name" :title="selectedExcelFile.name">{{ selectedExcelFile.name }}</span>
      <span class="rc-file-size">{{ formatExcelFileSize(selectedExcelFile.size) }}</span>
      <button type="button" class="rc-file-remove" title="移除 Excel 文件" aria-label="移除 Excel 文件" @click="removeExcelFile">
        <Delete aria-hidden="true" />
      </button>
    </div>
    <span v-if="excelFileError" class="rc-file-error">{{ excelFileError }}</span>
  </div>
  <div v-if="isRule && generationState !== 'done' && (generating || thinkingText.trim() || generationState === 'error')" class="rc-main-stream" data-testid="main-stream-thinking">
    <div class="rc-main-stream-head">
      <span>思考过程</span>
      <span>{{ generationState === 'error' ? '出错' : generating ? '生成中' : '已完成' }}</span>
    </div>
    <pre ref="mainThinkingRef" class="rc-main-stream-text">{{ thinkingText.trim() || (generating ? '等待模型返回思考过程…' : '暂无思考过程') }}</pre>
  </div>
  <div v-if="isRule && (orchCfg.script?.trim() || generationState === 'content' || generationState === 'done')" class="rc-main-result" data-testid="main-stream-result">
    <div class="rc-main-result-head">
      <span>生成结果</span>
      <button
        v-if="mainResultLabel"
        class="rc-main-result-link"
        type="button"
        :disabled="loadingResultScript"
        @click="downloadResultScriptToLocal"
      >
        {{ mainResultLabel }}
      </button>
    </div>
    <pre v-if="generating || generationState === 'content' || generationState === 'error'" ref="mainResultRef" class="rc-main-result-code">{{ orchCfg.script || '等待模型输出结果…' }}</pre>
  </div>
  <el-dialog v-model="monitorCodeTestVisible" title="脚本测试结果" width="820px" top="6vh" append-to-body data-testid="monitor-script-test-dialog">
    <div class="rc-code-test">
      <div class="rc-code-test-meta">
        <span>脚本路径</span>
        <b :title="orchCfg.scriptPath">{{ orchCfg.scriptPath || '未提供' }}</b>
      </div>
      <div v-if="codeTestLoading" class="rc-code-test-hint">测试中…</div>
      <div v-else-if="codeTestError" class="rc-code-test-hint error">{{ codeTestError }}</div>
      <pre v-else class="rc-code-test-output">{{ codeTestResult || '暂无返回结果' }}</pre>
    </div>
  </el-dialog>
  <AlertConfigPanel
    v-if="isMonitor"
    :node-id="id"
    :node-title="cfg?.title ?? ''"
    :source-label="sourceTableName"
    :script-path="orchCfg.scriptPath"
    @update:alert-config="setMonitorAlertConfig"
  />

  <template v-if="!isRule">
    <!-- 只读动作链摘要（0804 S3-4，方案 §3.1）：按 NextActionId 链表走出来的执行顺序，不可编辑 -->
    <div v-if="actionSummary" class="rc-list ni-rule-meta">
      <div class="rc-list-row"><b>动作链</b><span :title="actionSummary">{{ actionSummary }}</span></div>
    </div>
    <div v-if="parsedCapture?.warnings.length" class="rc-help">{{ parsedCapture.warnings.join('；') }}</div>
    <div class="rc-field"><label>切换已有配置</label>
      <div class="rc-input-group">
        <select v-model="switchSelected" class="rc-select grow" :disabled="switchLoading">
          <option value="">{{ switchLoading ? '加载中...' : (switchOptions.length ? '选择既有抓取配置' : '暂无既有抓取配置') }}</option>
          <option v-for="o in switchOptions" :key="o.ruleId" :value="o.ruleId">{{ o.name }} · {{ o.ruleId }}</option>
        </select>
        <button class="rc-input-btn" type="button" :disabled="!switchSelected || applyingSwitch" @click="onApplySwitch">
          {{ applyingSwitch ? '切换中...' : '应用' }}
        </button>
      </div>
      <div v-if="switchLoadError" class="rc-switch-load-error">
        <span>{{ switchLoadError }}</span>
        <button type="button" @click="retryLoadSwitchOptions">重试</button>
      </div>
    </div>
  </template>

  <div v-if="isRule && (providerError || modelError)" class="rc-help">{{ providerError || modelError }}</div>
  <!-- S6-1（方案 §4.1）：合并原 RuleScriptDialog（只读脚本查看）+ RuleSystemPromptDialog（编辑系统提示词）
       为一个双栏工作区——两个入口按钮（编辑系统提示词/全屏查看）现在打开同一个弹层，左右两栏一屏对照，
       面板内直接能生成/保存，不用退出去。 -->
  <RuleWorkbenchDialog
    v-model:open="workbenchOpen"
    :title="workbenchTitle"
    :script-label="scriptLabel"
    :system-prompt="orchCfg.systemPrompt ?? ''"
    :prompt-category="promptCategory"
    :prompt-list-category="promptListCategory"
    :prompt-category-groups="promptCategoryGroups"
    :input-table-name="sourceTableName"
    :output-table-name="orchCfg.outputTable"
    :source-id="isMonitor ? promptSourceId : ''"
    :source-cron="isMonitor ? sourceCron : ''"
    :thinking="thinkingText"
    :generation-state="generationState"
    :generation-message="generationMessage"
    :input-fields="orchCfg.inputFields ?? []"
    :output-fields="orchCfg.outputFields ?? []"
    :input-field-options="inputFieldOptions"
    :output-field-options="outputFieldOptions"
    :model-provider-code="orchCfg.modelProviderCode ?? ''"
    :model-code="orchCfg.modelCode ?? ''"
    :script="orchCfg.script ?? ''"
    :script-path="orchCfg.scriptPath"
    :generate-label="generateLabel"
    :save-label="saveLabel"
    :generating="generating"
    :saving="savingScript"
    :is-rule="isRule"
    :can-test="canTest"
    :describe="orchCfg.describe ?? ''"
    :describe-label="describeLabel"
    :hide-prompt-by-default="isRule"
    @update:system-prompt="onSystemPromptChange"
    @update:prompt-category="onPromptCategoryChange"
    @update:model-provider-code="onModelProviderChange"
    @update:model-code="onModelChange"
    @update:script="onScriptChange"
    @generate="onGenerateScript"
    @cancel-generate="onCancelGenerate"
    @save="onSaveScript"
    @test="onTestScript"
  />
</template>

<style scoped>
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; box-sizing: border-box; }
.rc-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-textarea { min-height: 74px; resize: vertical; line-height: 1.5; }
.rc-input-group { display: flex; align-items: stretch; width: 100%; }
.rc-input-group .rc-select.grow { border-radius: 7px 0 0 7px; flex: 1; }
.rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-select:disabled { background: #f8fafc; color: var(--rc-faint); }
.rc-input-btn { white-space: nowrap; padding: 0 12px; border: 1px solid #dbe3ee; border-left: 0; border-radius: 0 7px 7px 0; background: #fff; color: var(--rc-primary); cursor: pointer; font-size: 12px; font-weight: 600; }
.rc-input-btn:hover { background: var(--rc-primary-bg); }
.rc-input-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rc-switch-load-error { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-top: 6px; color: var(--rc-warn); font-size: 10px; line-height: 1.5; }
.rc-switch-load-error span { min-width: 0; }
.rc-switch-load-error button { flex: none; padding: 0; border: 0; background: transparent; color: var(--rc-primary); font-size: 10px; cursor: pointer; }
.rc-switch-load-error button:hover { text-decoration: underline; }
.rc-main-result-link { margin: 0; padding: 0; border: 0; background: transparent; color: #047857; font-size: 11px; font-weight: 700; cursor: pointer; text-align: right; }
.rc-main-result-link:disabled { opacity: 0.6; cursor: not-allowed; }
.rc-model-row { display: block; margin: -2px 0 8px; min-width: 0; }
.rc-model-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: center; gap: 10px; min-width: 0; }
.rc-inline-field { display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: center; gap: 6px; min-width: 0; color: var(--rc-muted); font-size: 11px; font-weight: 600; }
.rc-inline-field > span { flex: 0 0 auto; white-space: nowrap; }
.rc-inline-select { width: 100%; min-width: 0; }
.rc-inline-select-model { min-width: 0; }
.rc-generation-actions { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; min-width: 0; }
.rc-generation-actions > .rc-btn { flex: 1 1 0; min-width: 0; white-space: nowrap; }
.rc-generation-actions > .rc-btn.is-generating { flex: 0 0 32px; width: 32px; padding: 0; }
.rc-upload-btn { gap: 6px; }
.rc-upload-btn svg { width: 14px; height: 14px; }
.rc-file-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.rc-file-summary { margin: -2px 0 10px; min-width: 0; }
.rc-file-selected { display: inline-flex; align-items: center; gap: 7px; max-width: 100%; padding: 4px 6px 4px 9px; border: 1px solid #cbd5e1; border-radius: 6px; background: #f8fafc; color: var(--rc-text-2); font-size: 11px; }
.rc-file-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-file-size { flex: none; color: var(--rc-faint); font-variant-numeric: tabular-nums; }
.rc-file-remove { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; background: transparent; color: var(--rc-muted); cursor: pointer; }
.rc-file-remove:hover { color: #dc2626; }
.rc-file-remove svg { width: 14px; height: 14px; }
.rc-file-error { color: #b91c1c; font-size: 11px; line-height: 1.4; }
/* ---- OCR 识别试跑 ---- */
.ocr-field { padding: 0; border: 0; background: transparent; }
.ocr-picker { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/* 图标必须显式定尺寸：Element Plus 的 svg 默认按 1em 撑到 25px 上下，会把按钮内容挤窄，
   文字变成一个字一行、上下溢出把相邻控件盖住（0917 实测踩到）。同款写法见上面的 .rc-upload-btn svg。 */
.ocr-picker .rc-btn { height: 30px; padding: 0 11px; font-size: 12px; flex: none; white-space: nowrap; }
.ocr-picker .rc-btn svg { width: 14px; height: 14px; flex: none; }
.ocr-picker .rc-btn span { white-space: nowrap; }
.ocr-hint { color: var(--rc-faint); font-size: 10.5px; }
.ocr-preview { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 6px 8px; border: 1px solid #dbe3ee; border-radius: 8px; background: #f8fafc; }
.ocr-thumb { width: 44px; height: 44px; object-fit: cover; border: 1px solid #dbe3ee; border-radius: 6px; background: #fff; flex: none; }
.ocr-file-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--rc-text-2); font-size: 11.5px; }
.ocr-file-size { flex: none; color: var(--rc-faint); font-size: 10.5px; font-variant-numeric: tabular-nums; }
.ocr-remove { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; background: transparent; color: var(--rc-muted); cursor: pointer; flex: none; }
.ocr-remove:hover { color: #dc2626; }
.ocr-remove svg { width: 14px; height: 14px; }
.ocr-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.ocr-actions .rc-btn { height: 30px; padding: 0 12px; font-size: 12px; }
.ocr-error { color: #b91c1c; font-size: 11px; line-height: 1.5; word-break: break-all; }
.ocr-result { margin-top: 10px; border: 1px solid #dbe3ee; border-radius: 8px; overflow: hidden; background: #fff; }
.ocr-result-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; border-bottom: 1px solid #eef2f7; background: #f8fafc; color: var(--rc-text); font-size: 12px; font-weight: 700; }
.ocr-result-actions { display: inline-flex; align-items: center; gap: 10px; font-weight: 600; }
.ocr-result-text { margin: 0; max-height: 260px; overflow: auto; padding: 10px; color: var(--rc-text); font-size: 12px; line-height: 1.65; white-space: pre-wrap; word-break: break-word; }
.ocr-result-raw { margin: 0; max-height: 220px; overflow: auto; padding: 10px; border-top: 1px dashed var(--rc-border-soft); background: #0f172a; color: #dbeafe; font-family: var(--rc-mono, monospace); font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
/* ---- 语音转文字 ---- */
.audio-language { display: flex; align-items: center; gap: 8px; margin-top: 8px; color: var(--rc-muted); font-size: 11px; }
.audio-language > span { flex: none; }
.audio-language .rc-select { flex: 1; min-width: 0; padding: 5px 9px; }
.audio-trace { padding: 6px 10px; border-top: 1px dashed var(--rc-border-soft); color: var(--rc-faint); font-size: 10.5px; word-break: break-all; }
/* ---- 视频提取音频 ---- */
.media-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 10px; margin-top: 8px; }
.media-option { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: center; gap: 6px; color: var(--rc-muted); font-size: 11px; min-width: 0; }
.media-option > span { flex: none; white-space: nowrap; }
.media-option .rc-select { min-width: 0; padding: 5px 9px; }
.media-upload-switch { display: flex; align-items: center; gap: 6px; margin-top: 8px; color: var(--rc-muted); font-size: 11px; }
.media-upload-switch input { margin: 0; }
.media-player { display: block; width: 100%; padding: 10px; box-sizing: border-box; }
.media-upload-meta { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; }
.media-fileid { font-family: var(--rc-mono, monospace); word-break: break-all; }
/* ---- 文章生成摘要 ---- */
.article-text { min-height: 120px; max-height: 260px; }
.article-text-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 4px 0 8px; color: var(--rc-faint); font-size: 10.5px; }
.article-prompt { display: flex; align-items: center; gap: 8px; margin: 2px 0 6px; }
.article-prompt-text { margin: 0 0 8px; max-height: 220px; overflow: auto; padding: 10px; border: 1px solid #dbe3ee; border-radius: 8px; background: #f8fafc; color: var(--rc-text-2); font-size: 11px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.article-summary-text { min-height: 60px; }
.article-thinking { border-top: 1px dashed var(--rc-border-soft); }
.article-thinking summary { padding: 6px 10px; color: var(--rc-muted); font-size: 11px; cursor: pointer; }
.article-thinking pre { margin: 0; max-height: 180px; overflow: auto; padding: 0 10px 10px; color: var(--rc-text-2); font-size: 11px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
/* ---- 翻译助手 ---- */
/* 语言选择行：源语言 ⇄ 目标语言（0917 设计稿），两个下拉等宽、中间互换按钮 */
.translate-langs { display: flex; align-items: center; gap: 8px; margin: 2px 0 10px; }
.translate-lang-select { flex: 1 1 0; min-width: 0; }
.translate-swap { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--rc-primary); cursor: pointer; }
.translate-swap:hover:not(:disabled) { background: var(--rc-primary-bg); }
.translate-swap:disabled { color: var(--rc-faint); cursor: not-allowed; }
.translate-detected { color: var(--rc-faint); font-weight: 400; }
.translate-over-limit { color: #b91c1c; }
/* ---- 文章打标签 ---- */
.tag-body { display: flex; flex-direction: column; gap: 8px; padding: 10px; }
.tag-summary { color: var(--rc-text); font-size: 12.5px; font-weight: 600; line-height: 1.6; }
.tag-group { display: flex; align-items: flex-start; gap: 8px; font-size: 11.5px; }
.tag-group-label { flex: none; width: 60px; color: var(--rc-muted); }
.tag-chips { display: flex; flex-wrap: wrap; gap: 5px; min-width: 0; }
.tag-chip { padding: 1px 7px; border: 1px solid #dbe3ee; border-radius: 999px; background: #f8fafc; color: var(--rc-text-2); font-size: 11px; }
.tag-chip.tone-high { border-color: #fecaca; background: #fef2f2; color: #b91c1c; font-weight: 600; }
.tag-chip.tone-mid { border-color: #fed7aa; background: #fff7ed; color: #c2410c; font-weight: 600; }
.tag-chip.tone-low { border-color: #bfdbfe; background: #eff6ff; color: var(--rc-primary-ink); }
.tag-chip.tone-none { border-color: #e2e8f0; background: #f8fafc; color: var(--rc-muted); }
.tag-meta { display: flex; flex-wrap: wrap; gap: 10px; color: var(--rc-faint); font-size: 10.5px; }
.tag-uncertain { color: var(--rc-warn); }
.tag-evidence { display: flex; flex-direction: column; gap: 4px; padding-top: 6px; border-top: 1px dashed var(--rc-border-soft); color: var(--rc-text-2); font-size: 11px; line-height: 1.6; }
.tag-evidence-row { display: flex; gap: 6px; }
.tag-evidence-row b { flex: none; color: var(--rc-muted); font-weight: 600; }
.tag-raw-toggle { margin: 0 10px 10px; }
.rc-stop-icon { display: block; width: 10px; height: 10px; border-radius: 1px; background: currentColor; }
.rc-main-stream, .rc-main-result { margin: 10px 0 12px; border: 1px solid #dbe3ee; border-radius: 8px; overflow: hidden; background: #fff; }
.rc-main-stream { border-color: #1e293b; background: #0b1220; }
.rc-main-stream-head, .rc-main-result-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; font-size: 12px; font-weight: 700; }
.rc-main-stream-head { background: #111827; color: #e5eefc; }
.rc-main-stream-head span:last-child { color: #93c5fd; font-size: 11px; }
.rc-main-result-head { background: #f8fafc; color: var(--rc-text); border-bottom: 1px solid #eef2f7; }
.rc-main-result-head span:last-child { color: #047857; font-size: 11px; }
.rc-main-stream-text, .rc-main-result-code { margin: 0; max-height: 180px; overflow: auto; padding: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.rc-main-stream-text { color: #cbd5e1; border-top: 1px solid #1e293b; }
.rc-main-result-code { color: #dbeafe; background: #0f172a; }
.rc-code-test { display: flex; flex-direction: column; gap: 10px; }
.rc-code-test-meta { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--rc-text-2); }
.rc-code-test-meta span { color: var(--rc-faint); font-size: 11px; }
.rc-code-test-meta b { font-family: var(--rc-mono, monospace); word-break: break-all; }
.rc-code-test-hint { padding: 14px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #f8fafc; color: var(--rc-text-2); font-size: 12px; line-height: 1.6; }
.rc-code-test-hint.error { border-color: #fecaca; background: #fef2f2; color: #b91c1c; word-break: break-all; }
.rc-code-test-output { margin: 0; padding: 14px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #0f172a; color: #dbeafe; font-family: var(--rc-mono, monospace); font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-all; min-height: 180px; }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 11px; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-btn:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.rc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ni-section-title { margin: 16px 0 8px; padding-top: 12px; border-top: 1px dashed var(--rc-border-soft); color: var(--rc-muted); font-size: 12px; font-weight: 700; }
.ni-section-title:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
.ni-section-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ni-section-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 8px; flex: none; }
.ni-section-title-row .rc-btn { height: 28px; padding: 0 10px; font-size: 12px; }
.rc-list { border: 1px solid #eef2f7; border-radius: 8px; overflow: hidden; }
.rc-list-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 9px; border-top: 1px solid #eef2f7; font-size: 11px; color: var(--rc-text-2); }
.rc-list-row:first-child { border-top: 0; }
.rc-list-row b { color: var(--rc-text); font-weight: 600; flex-shrink: 0; }
.rc-list-row span, .rc-link-btn { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
.rc-link-btn { border: 0; background: transparent; color: var(--rc-primary); font: inherit; cursor: pointer; padding: 0; }
.rc-link-btn:hover { text-decoration: underline; }
.rc-link-btn:disabled { color: var(--rc-faint); cursor: not-allowed; text-decoration: none; }
.ni-rule-meta { margin: 10px 0 8px; }
.rc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.5; margin-top: 6px; }
</style>
