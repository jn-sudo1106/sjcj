<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { dataApi, type DataTableMeta, type DataRow } from '../../api'

// 方案 §1.6-2/3：手动修改先取 entryDetail 的 showItems 反填表单；手动添加 SOURCE_ID/CONFIG_ID
// 从当前第一行推断（sourceApi 域尚未真实接入，不用 sourceDetail 兜底，改为可编辑输入框）。
// 提交前 null 字段剔除交给 dataApi.rowAdd/rowUpdate 内部处理（rowAdd 已有，rowUpdate 由调用方保证不传 null）。
const props = defineProps<{
  modelValue: boolean
  tableId: string
  tableMeta: DataTableMeta | null
  mode: 'add' | 'edit'
  row?: DataRow | null // edit 模式：当前行（取 dataId）
  firstRow?: DataRow | null // add 模式：当前查询结果第一行，用于推断 SOURCE_ID/CONFIG_ID
}>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const form = reactive<{ SOURCE_ID: string; CONFIG_ID: string; values: Record<string, string> }>({
  SOURCE_ID: '',
  CONFIG_ID: '',
  values: {},
})
const loading = ref(false)

const dynamicFields = computed(() => props.tableMeta?.fields ?? [])
const keyField = computed(() => props.tableMeta?.keyField)

// 字段多的表（动态列可达数十个）不加高度封顶会把整个表单撑出视口，保存按钮点不到。
// el-dialog 的居中定位不是简单的 vh 线性关系（且页面根节点 .dv-page 带了个 transform，
// 会劫持 position:fixed 的定位基准），静态 CSS calc() 猜不出通用公式——改成实测：
// 弹窗打开后量一下内容区离视口顶部的实际距离，直接算出还剩多少空间给它。
const bodyEl = ref<HTMLElement | null>(null)
const bodyMaxHeight = ref(400)
function recalcBodyHeight() {
  if (!bodyEl.value) return
  const top = bodyEl.value.getBoundingClientRect().top
  const FOOTER_RESERVE = 76 // footer 按钮高度 + 上下边距，估算即可，留够比精确更重要
  bodyMaxHeight.value = Math.max(160, window.innerHeight - top - FOOTER_RESERVE)
}
window.addEventListener('resize', recalcBodyHeight)
onBeforeUnmount(() => window.removeEventListener('resize', recalcBodyHeight))

watch(() => props.modelValue, async (v) => {
  if (!v) return
  form.values = {}
  if (props.mode === 'edit' && props.row) {
    form.SOURCE_ID = props.row.sourceId
    form.CONFIG_ID = props.row.configId ?? ''
    loading.value = true
    try {
      const detail = await dataApi.rowDetail(props.tableId, props.row.dataId)
      for (const item of detail?.showItems ?? []) {
        form.values[item.columnName] = item.value == null ? '' : String(item.value)
      }
    } catch (error) {
      ElMessage.error(`获取数据表详情失败${error instanceof Error ? error.message : String(error)}`)
    } finally {
      loading.value = false
    }
  } else {
    form.SOURCE_ID = props.firstRow?.sourceId ?? ''
    form.CONFIG_ID = props.firstRow?.configId ?? ''
  }
})

async function onSubmit() {
  const values: Record<string, unknown> = { ...form.values }
  // null/空字段提交前删除（方案 §1.6-3）
  Object.keys(values).forEach((k) => { if (values[k] === '' || values[k] == null) delete values[k] })

  try {
    if (props.mode === 'edit' && props.row) {
      await dataApi.rowUpdate(props.tableId, props.row.dataId, values)
      ElMessage.success('修改成功,请手动刷新后确认')
    } else {
      await dataApi.rowAdd(props.tableId, {
        SOURCE_ID: form.SOURCE_ID || undefined,
        CONFIG_ID: form.CONFIG_ID || undefined,
        ...values,
      })
      ElMessage.success('新增成功,请手动刷新后确认')
    }
    visible.value = false
    emit('saved')
  } catch (error) {
    ElMessage.error(`${props.mode === 'edit' ? '修改' : '新增'}失败:${error instanceof Error ? error.message : String(error)}`)
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="mode === 'edit' ? '手动修改' : '手动添加'" width="520px" @opened="recalcBodyHeight">
    <div v-if="keyField" class="rc-mini-card">去重列:{{ keyField }}</div>
    <div ref="bodyEl" class="red-body" :style="{ maxHeight: `${bodyMaxHeight}px` }">
      <el-form v-loading="loading" label-width="110px" label-position="left">
        <el-form-item label="SOURCE_ID">
          <el-input v-model="form.SOURCE_ID" />
        </el-form-item>
        <el-form-item label="CONFIG_ID">
          <el-input v-model="form.CONFIG_ID" />
        </el-form-item>
        <el-form-item v-for="f in dynamicFields" :key="f.columnName" :label="`${f.desc}(${f.columnName})`">
          <el-input v-model="form.values[f.columnName!]" />
        </el-form-item>
      </el-form>
    </div>
    <template #footer>
      <button class="rc-btn" type="button" @click="visible = false">取消</button>
      <button class="rc-btn primary" type="button" @click="onSubmit">保存</button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* max-height 由 recalcBodyHeight() 实测算出（行内 style 绑定），这里只留滚动/内边距 */
.red-body {
  overflow-y: auto;
  padding-right: 4px;
}
</style>
