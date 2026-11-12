<script setup lang="ts">
// 新增 / 编辑队列告警配置 —— 1:1 迁移旧 data-view `src/page/config/modules/BaseEdit.vue` 中
// MQ_CHECK 这一套表单（QueueCheck.vue 里的 `<base-edit-modal ref="baseAdd|baseEdit">`）。
//
// 旧版行为逐条对齐：
//   · 表单体是「列定义驱动的描述表」：a-descriptions bordered :column="4"，每项按 col.span 占格；
//     列上带 tips 的字段，label 右侧挂个问号提示（MQ_CHECK 的 tips 只配在描述 / 消费速率高于 /
//     自定义检测出错 / 告警提示四列上）。
//   · 打开时先把每个可编辑字段置 null，再 Object.assign(form, record) —— 所以**编辑态提交体里除了
//     表单字段，还带着记录上那些不在列里的原始字段**（queueId / state / lastMsg / lastRun /
//     createDt / updateDt …），由 buildPayload 按旧口径再删。
//   · 新增态预填 `{ queueName: 当前队列名, isDelete: 0 }`。
//   · isDelete 控件是 INT_BOOL：是(1) / 否(0) 下拉。
//
// 有意偏差：
//   1. 提交由本组件直接调 addQueueCheck / updateQueueCheck（旧版抛回给 QueueCheck.vue 再调），
//      字段剔除口径不变。
//   2. 旧版没做前端必填拦截，而且**拦不住**：它把 `:rules` 挂在 a-input 上、外面根本没有
//      a-form-model-item，validate() 恒为 true。这里同样不做拦截，交给后端兜底，不擅自加红线。
//   3. 弹窗宽度：旧版 `document.body.clientWidth - 300`，这里用等价的 `calc(100vw - 300px)`，
//      省掉手动 resize 监听。
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { MqCheck } from '@/api'
import { addQueueCheck, updateQueueCheck } from '@/api/queueCheck'

defineOptions({ name: 'MqQueueCheckEditDialog' })

const emit = defineEmits<{ (e: 'saved'): void }>()

/** 可编辑字段（旧 editCols / addCols 去掉 noAdd / noEdit 之后剩下的那批，顺序按 MQ_CHECK 列序） */
interface CheckField {
  key: string
  title: string
  /** 旧 a-descriptions 的占格数（:column="4"，所以 2 = 半行、4 = 整行） */
  span: number
  tips?: string
  type?: 'text' | 'textarea' | 'bool'
}

const FIELDS: CheckField[] = [
  { key: 'queueName', title: '队列名', span: 2 },
  { key: 'queueDesc', title: '描述', span: 2, tips: '队列用途说明' },
  { key: 'maxSize', title: '队列积压超过', span: 2 },
  { key: 'minConsumer', title: '消费者数低于', span: 2 },
  { key: 'minRate', title: '消费速率低于', span: 2 },
  { key: 'maxRate', title: '消费速率高于', span: 2, tips: '如一些网站出异常，导致不正常快速消费完' },
  { key: 'check', title: '自定义检测出错', span: 4, tips: '非必填，脚本返回 true 时表示有异常', type: 'textarea' },
  { key: 'checkMsg', title: '告警提示', span: 2, tips: '非必填，动态检测异常时提示信息定义' },
  { key: 'isDelete', title: '是否禁用', span: 2, type: 'bool' },
]

const open = ref(false)
const loading = ref(false)
const isEdit = ref(false)
/** 旧：编辑弹窗 title 默认「编辑」，新增弹窗写死「新增数据」 */
const title = computed(() => (isEdit.value ? '编辑' : '新增数据'))

const form = reactive<Record<string, unknown>>({})
/** 编辑时记录上「不属于任何可编辑字段」的原样带回字段（旧 Object.assign 的效果） */
const extra = ref<Record<string, unknown>>({})

function resetForm() {
  Object.keys(form).forEach((key) => delete form[key])
  FIELDS.forEach((field) => {
    form[field.key] = null
  })
}

const textVal = (key: string): string => (form[key] == null ? '' : String(form[key]))
function setVal(key: string, value: unknown) {
  form[key] = value
}

/**
 * 打开弹窗。
 * @param record  编辑态传原始行；不传 = 新增
 * @param prefill 新增态预填字段（对应旧 handleAdd 里的 param）
 */
function openDialog(record?: MqCheck | null, prefill?: Record<string, unknown>) {
  isEdit.value = !!record
  const source = (record ?? {}) as Record<string, unknown>
  // 可编辑字段之外的键原样带回（旧 Object.assign(this.form, record) 的副作用，提交时要用）
  const keys = new Set(FIELDS.map((field) => field.key))
  const rest: Record<string, unknown> = {}
  Object.keys(source).forEach((key) => {
    if (!keys.has(key)) rest[key] = source[key]
  })
  extra.value = rest

  resetForm()
  Object.assign(form, source, prefill ?? {})
  open.value = true
}

function closeDialog() {
  open.value = false
  extra.value = {}
  resetForm()
}

/** 旧 addCallback / updateCallback 的字段剔除口径：createDt/updateDt 一律不带；
 *  编辑态再剔除 lastRun/nextRun（后端自己维护，前端带回去会被当成要手改） */
function buildPayload(): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...extra.value, ...form }
  delete payload.createDt
  delete payload.updateDt
  if (isEdit.value) {
    delete payload.lastRun
    delete payload.nextRun
  }
  return payload
}

async function onSubmit() {
  const payload = buildPayload()
  loading.value = true
  try {
    if (isEdit.value) {
      await updateQueueCheck(payload)
    } else {
      await addQueueCheck(payload)
    }
    ElMessage.success('保存成功')
    emit('saved')
    closeDialog()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    loading.value = false
  }
}

defineExpose({ openDialog })
</script>

<template>
  <el-dialog
    v-model="open"
    :title="title"
    width="min(1100px, calc(100vw - 300px))"
    destroy-on-close
    :close-on-click-modal="false"
    append-to-body
    @close="closeDialog"
  >
    <el-form :model="form" label-position="right" @submit.prevent>
      <!-- 旧 a-descriptions bordered size="small" :column="4" -->
      <el-descriptions border :column="4" size="small" class="qce-desc">
        <el-descriptions-item
          v-for="field in FIELDS"
          :key="field.key"
          :span="field.span"
          :label="field.title"
        >
          <template v-if="field.tips" #label>
            <span class="qce-label">
              {{ field.title }}
              <el-tooltip :content="field.tips" placement="top-start">
                <span class="qce-tip">?</span>
              </el-tooltip>
            </span>
          </template>

          <!-- isDelete：旧 type='INT_BOOL' → 是(1) / 否(0) -->
          <el-select
            v-if="field.type === 'bool'"
            :model-value="form[field.key]"
            class="qce-ctl"
            @update:model-value="(v: unknown) => setVal(field.key, v)"
          >
            <el-option :value="1" label="是 (1)" />
            <el-option :value="0" label="否 (0)" />
          </el-select>
          <el-input
            v-else-if="field.type === 'textarea'"
            :model-value="textVal(field.key)"
            type="textarea"
            :rows="3"
            @update:model-value="(v: string) => setVal(field.key, v)"
          />
          <el-input
            v-else
            :model-value="textVal(field.key)"
            class="qce-ctl"
            :placeholder="field.tips"
            @update:model-value="(v: string) => setVal(field.key, v)"
          />
        </el-descriptions-item>
      </el-descriptions>
    </el-form>

    <template #footer>
      <el-button @click="closeDialog">取消</el-button>
      <el-button type="primary" :loading="loading" @click="onSubmit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.qce-desc :deep(.el-descriptions__label) {
  width: 120px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.qce-desc :deep(.el-descriptions__cell) {
  padding: 4px 8px;
}
.qce-ctl {
  width: 100%;
}
.qce-label {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.qce-tip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border: 1px solid var(--rc-faint, #94a3b8);
  border-radius: 50%;
  color: var(--rc-faint, #94a3b8);
  font-size: 10px;
  line-height: 1;
  cursor: help;
}
</style>
