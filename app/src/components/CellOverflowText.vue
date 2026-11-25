<!--
  表格里的长文本单元格：定宽显示省略号，**只有真的被截断时**才在悬停显示全文。

  为什么不用 el-table 自带的 show-overflow-tooltip：它在鼠标进入时用 Range 量文本宽度，
  数据查询的业务列是自定义 slot 渲染（span/链接/文件按钮），实测在数据中心那张表上量不出溢出，
  悬停不出提示；这里改成自己量 span 的 scrollWidth，判定稳定，且不影响列宽和省略号。
-->
<template>
  <el-tooltip :disabled="!overflow" :content="text" placement="top" :show-after="120">
    <span ref="textEl" class="cell-overflow-text" @mouseenter="measure">{{ text }}</span>
  </el-tooltip>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'

const props = defineProps<{ text: string }>()

const textEl = ref<HTMLElement>()
const overflow = ref(false)

function measure() {
  const el = textEl.value
  if (!el) return
  overflow.value = el.scrollWidth > el.clientWidth + 1
}

watch(() => props.text, () => { nextTick(measure) })
onMounted(() => { nextTick(measure) })
</script>

<style scoped>
.cell-overflow-text { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>