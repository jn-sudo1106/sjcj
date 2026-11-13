<script setup lang="ts">
// 二次确认按钮组件（P3-1 业务组件沉淀 · plan §F.1/F.2）
//
// 替代散落的 confirmDanger 函数（5 个文件实测：SourceTab/TableView/EntryTab/RuleAssets/ConfigTab，
// 18+ 次调用）。原函数 (title, body, run) => Promise<{message?}> 三参数 + 内部 ElMessageBox.confirm 模板。
//
// 两种用法：
//   1. 普通危险操作：
//      <ConfirmButton text="批量删除" type="danger" title="批量删除（高危）"
//        body="将删除选中源..." :action="() => sourceApi.deleteSource(selectedIds)" />
//   2. 简单操作（不需要异步）：
//      <ConfirmButton text="重置" type="primary" title="确认重置？"
//        :action="() => handleReset()" />
//
// Props（除 text/action 外都可省略）：
//   text: string                       按钮文字（必填）
//   action: () => Promise<{ message?: string } | void>  点击确认后调用的动作（必填）
//   type?: 'primary' | 'danger' | 'default'  el-button type（默认 'default'）
//   title?: string                     弹框标题（默认 '提示'）
//   body?: string                      弹框内容（默认 '确认执行？'）
//   successMessage?: string            成功后 toast 文字（不传则用 action 返回的 message，或 '操作已提交'）
//   size?: 'small' | 'default'         el-button size（默认 'default'）
//   confirmButtonText?: string         弹框确认按钮文字（默认 '确认执行'）
//   cancelButtonText?: string          弹框取消按钮文字（默认 '取消'）
//   buttonProps?: Record<string, unknown>  透传给 el-button 的其他 props
import { ElMessage, ElMessageBox } from 'element-plus'
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  text: string
  action: () => Promise<{ message?: string } | void> | { message?: string } | void
  type?: 'primary' | 'danger' | 'default'
  title?: string
  body?: string
  successMessage?: string
  size?: 'small' | 'default'
  confirmButtonText?: string
  cancelButtonText?: string
  buttonProps?: Record<string, unknown>
}>(), {
  type: 'default',
  title: '提示',
  body: '确认执行？',
  successMessage: '',
  size: 'default',
  confirmButtonText: '确认执行',
  cancelButtonText: '取消',
  buttonProps: () => ({}),
})

const loading = ref(false)

async function onClick() {
  if (loading.value) return
  try {
    await ElMessageBox.confirm(props.body, props.title, {
      type: 'warning',
      confirmButtonText: props.confirmButtonText,
      cancelButtonText: props.cancelButtonText,
    })
  } catch {
    return // 用户取消
  }
  loading.value = true
  try {
    const res = await Promise.resolve(props.action())
    const message = props.successMessage || (res && typeof res === 'object' ? res.message : '') || '操作已提交'
    ElMessage.success(message)
  } catch (e) {
    ElMessage.error((e as Error).message || '操作失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <el-button
    :type="type"
    :size="size"
    :loading="loading"
    v-bind="buttonProps"
    @click="onClick"
  >
    {{ text }}
  </el-button>
</template>
