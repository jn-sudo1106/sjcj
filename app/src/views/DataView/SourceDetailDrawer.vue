<script setup lang="ts">
import { onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { sourceApi, type Source } from '../../api'
import { sourceRunStateInfo } from '@/constants/runState'

const props = defineProps<{ modelValue: boolean; sourceId?: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const state = reactive<{ loading: boolean; source: Source | null }>({ loading: false, source: null })

// 只 watch modelValue 的话，抽屉已经打开时切换到另一个 sourceId（父级复用同一个抽屉实例，
// 只改 sourceId 不会让 modelValue 从 false→true）不会触发重新加载，导致内容空着——两个都要 watch。
watch([() => props.modelValue, () => props.sourceId], async ([open, sourceId]) => {
  if (!open) return
  if (!sourceId) {
    ElMessage.error('请先选择源ID')
    emit('update:modelValue', false)
    return
  }
  state.loading = true
  state.source = null
  try {
    state.source = await sourceApi.sourceDetail(sourceId)
  } catch (error) {
    ElMessage.error(`获取信息源详情失败${error instanceof Error ? error.message : String(error)}`)
  } finally {
    state.loading = false
  }
})

// ---- 展示口径 1:1 对齐旧平台 `page/base/detail/SourceDetail.vue`（2026-10-16）----
// 旧版自己不写模板：它把 `allColumns.SOURCE.BASE + SOURCE.OTHER` 里未标 `noDetail` 的列交给
// `config/modules/BaseDetail.vue`，渲染成 `<a-descriptions :column="4" bordered size="small">`
// ——「label / value」带框表格，一个字段一行、span 2 的并排两个、span 4 的独占一行。
// 这里按同一份清单、同一顺序、同一组中文标签重排，去掉旧版标了 noDetail 的「数据 / 定时 / 步骤 / 操作」四列。
// 值的口径也照抄旧 `utils/filter.js`：
//   state    → stateFilter：C 正常 / E 出错 / L 处理中 / AC 已审核 / W 待处理
//   isDelete → enableFilter：是[1] / 否[0]
//   keepLast → 原样 0 / 1（旧 BaseDetail 没给 INT_BOOL 分支，直接出原值）
// 唯一去重：「大类」(templetCode) 与「类别」(classify) 在旧库是两个字段，而新端 `sourceFromLegacy`
// 已把它们合并进单个 `category`，这里只保留「大类」一项，不做同值两行。

/** 空值统一占位（旧版是空白单元格，这里沿用新端的 '—'） */
function dash(value: unknown): string {
  return value == null || value === '' ? '—' : String(value)
}
/** 旧 enableFilter */
function enableText(value?: boolean): string {
  return value == null ? '—' : value ? '是[1]' : '否[0]'
}
/** 旧 keepLast 的 INT_BOOL 原值口径 */
function intBoolText(value?: boolean): string {
  return value == null ? '—' : value ? '1' : '0'
}

// ---- 「备注」可编辑（1:1 迁移旧 remark 列 + BaseDetail.saveItem）----
// 旧 `column.config` 里 remark 是唯一带 `save` 回调的列：span 4 独占一行、textarea 可编辑、
// 按钮三态（保存 / 保存中 / 已保存），成功后 1.5s 复位，并 emit save 让外层重拉详情。
// 保存体照抄旧回调：`updateSource({ sourceId, remark, author, tags })` —— author / tags 必须一起带上，
// 只发 remark 会把这两个字段清空（见 sourceApi.updateSource 的注释）。
const remarkDraft = ref('')
const remarkSaving = ref(false)
const remarkSaved = ref(false)
let remarkResetTimer: ReturnType<typeof setTimeout> | undefined

// 每次拉到（或切换）源时把草稿同步成详情里的值，并复位"已保存"态
watch(
  () => state.source,
  (source) => {
    remarkDraft.value = source?.remark ?? ''
    remarkSaved.value = false
  },
)
onUnmounted(() => clearTimeout(remarkResetTimer))

async function saveRemark() {
  const source = state.source
  if (!source || remarkSaving.value) return
  remarkSaving.value = true
  try {
    const ack = await sourceApi.updateSource({
      sourceId: source.sourceId,
      remark: remarkDraft.value,
      author: source.owner,
      tags: Array.isArray(source.tags) ? source.tags.join(',') : (source.tags ?? ''),
    })
    if (!ack.ok) throw new Error(ack.message || '保存失败')
    ElMessage.success('保存成功')
    source.remark = remarkDraft.value
    remarkSaved.value = true
    clearTimeout(remarkResetTimer)
    remarkResetTimer = setTimeout(() => {
      remarkSaved.value = false
    }, 1500)
  } catch (error) {
    ElMessage.error(`保存失败: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    remarkSaving.value = false
  }
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    title="源详情"
    size="min(850px, 92vw)"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div v-loading="state.loading">
      <el-descriptions v-if="state.source" :column="4" border size="small" class="dv-src-desc">
        <!-- 旧 SOURCE.BASE（源ID / 名称 / URL / 配置ID / 流程ID / 最新 / 主表 / 断点续传 / 域） -->
        <el-descriptions-item label="源ID" :span="2">{{ dash(state.source.sourceId) }}</el-descriptions-item>
        <el-descriptions-item label="名称" :span="2">{{ dash(state.source.name) }}</el-descriptions-item>
        <el-descriptions-item label="URL" :span="4">
          <a
            v-if="state.source.url"
            class="dv-a"
            :href="state.source.url"
            target="_blank"
            rel="noopener noreferrer"
          >{{ state.source.url }}</a>
          <span v-else>—</span>
        </el-descriptions-item>
        <el-descriptions-item label="配置ID" :span="2">{{ dash(state.source.configId) }}</el-descriptions-item>
        <el-descriptions-item label="流程ID" :span="2">{{ dash(state.source.flowId) }}</el-descriptions-item>
        <el-descriptions-item label="最新" :span="2">{{ dash(state.source.lastInsertAt) }}</el-descriptions-item>
        <el-descriptions-item label="主表" :span="2">{{ dash(state.source.mainTable) }}</el-descriptions-item>
        <el-descriptions-item label="断点续传" :span="2">{{ intBoolText(state.source.resume) }}</el-descriptions-item>
        <el-descriptions-item label="域" :span="2">{{ dash(state.source.domain) }}</el-descriptions-item>

        <!-- 旧 SOURCE.OTHER（大类 / 数量 / 登陆配置 / 上次URL / 目录 / 目录路径 / 核心参数 /
             子类别 / 标签 / 责任人 / 备注 / 优先级 / 禁用 / 日期 / 更新时间 / 状态 / 上次任务 / 上次成功） -->
        <el-descriptions-item label="大类" :span="2">{{ dash(state.source.category) }}</el-descriptions-item>
        <el-descriptions-item label="数量" :span="2">{{ dash(state.source.dataCount) }}</el-descriptions-item>
        <el-descriptions-item label="登陆配置" :span="2">{{ dash(state.source.authConfig) }}</el-descriptions-item>
        <el-descriptions-item label="上次URL" :span="4">
          <a
            v-if="state.source.lastUrl"
            class="dv-a"
            :href="state.source.lastUrl"
            target="_blank"
            rel="noopener noreferrer"
          >{{ state.source.lastUrl }}</a>
          <span v-else>—</span>
        </el-descriptions-item>
        <el-descriptions-item label="目录" :span="2">{{ dash(state.source.dirId) }}</el-descriptions-item>
        <el-descriptions-item label="目录路径" :span="2">{{ dash(state.source.categoryPath) }}</el-descriptions-item>
        <el-descriptions-item label="核心参数" :span="4">{{ dash(state.source.coreParam) }}</el-descriptions-item>
        <el-descriptions-item label="子类别" :span="2">{{ dash(state.source.subCategory) }}</el-descriptions-item>
        <el-descriptions-item label="标签" :span="2">{{ state.source.tags?.join('、') || '—' }}</el-descriptions-item>
        <el-descriptions-item label="责任人" :span="2">{{ dash(state.source.owner) }}</el-descriptions-item>
        <!-- 旧 remark 列是整份清单里唯一带 save 回调的可编辑字段：span 4 独占一行，
             textarea（minRows 2 / maxRows 8）+ 右侧「保存」按钮三态 -->
        <el-descriptions-item label="备注" :span="4">
          <div class="dv-remark">
            <el-input
              v-model="remarkDraft"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 8 }"
              placeholder="无"
              data-testid="source-remark-input"
            />
            <el-button
              type="primary"
              size="small"
              :loading="remarkSaving"
              :disabled="remarkSaved"
              data-testid="source-remark-save"
              @click="saveRemark"
            >{{ remarkSaved ? '已保存' : remarkSaving ? '保存中' : '保存' }}</el-button>
          </div>
        </el-descriptions-item>
        <el-descriptions-item label="优先级" :span="2">{{ dash(state.source.priority) }}</el-descriptions-item>
        <el-descriptions-item label="禁用" :span="2">{{ enableText(state.source.disabled) }}</el-descriptions-item>
        <el-descriptions-item label="日期" :span="2">{{ dash(state.source.createdAt) }}</el-descriptions-item>
        <el-descriptions-item label="更新时间" :span="2">{{ dash(state.source.updatedAt) }}</el-descriptions-item>
        <el-descriptions-item label="状态" :span="2"><span :title="sourceRunStateInfo(state.source.state).hint">{{ sourceRunStateInfo(state.source.state).label }}</span></el-descriptions-item>
        <el-descriptions-item label="上次任务" :span="2">{{ dash(state.source.lastTaskAt) }}</el-descriptions-item>
        <el-descriptions-item label="上次成功" :span="2">{{ dash(state.source.lastSuccessAt) }}</el-descriptions-item>
      </el-descriptions>
    </div>
  </el-drawer>
</template>

<style scoped>
/* 值列里的长文本（URL / 核心参数 / 备注）：在单元格内断行，不撑破表格 */
.dv-src-desc :deep(.el-descriptions__content) {
  word-break: break-all;
  overflow-wrap: anywhere;
}
.dv-a {
  color: var(--rc-primary-ink);
  cursor: pointer;
  text-decoration: none;
}
.dv-a:hover {
  text-decoration: underline;
}
/* 备注：textarea 撑满、按钮贴右且不缩（同旧 BaseDetail.vue 的 .text-area-edit）。
   这里要显式把 word-break 还原：上面给值单元格加的 break-all 会让 textarea 里的英文单词被硬断。 */
.dv-remark {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
}
.dv-remark :deep(.el-textarea) {
  flex: 1;
  min-width: 0;
}
.dv-remark :deep(.el-textarea__inner) {
  word-break: normal;
  overflow-wrap: break-word;
}
.dv-remark :deep(.el-button) {
  flex: none;
  margin-top: 2px;
}
</style>
