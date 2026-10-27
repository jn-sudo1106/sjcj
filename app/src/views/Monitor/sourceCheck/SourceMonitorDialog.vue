<script setup lang="ts">
// 复刻旧平台 `page/config/modules/MonitorModal.vue`。
//
// 旧版整个组件只做两件事：
//   1. `showModal(record, ids)`：把 `record.sourceId`（或调用方直接给的 ids）存进 `this.ids`，置 visible；
//   2. 弹窗里塞 `<monitor-list :ins="ids" />`。
//
// 关键就在 `ids` 这一路：MonitorList.created() 里
//   `this.queryParam.ids = this.ins.join(','); this.queryParam.sourceId = this.ins[0]; this.sid = this.ins[0]`
// —— 列表按该源过滤，列表里的「加监控」再拿 `queryParam.sourceId` 去预填表单的「数据源」。
// 少这一层，新增监控的「数据源」就是空的，后端拿不到值。所以这个壳不是装饰，是数据源字段的来源。
//
// 新版把 MonitorList 换成已迁移的 `./index.vue`（源监控列表），用它的**嵌入形态**：
// 只去掉卡片壳（外层已经是弹窗），**筛选表单整套保留**（在用 / 告警状态 / 源ID / 名称、查询与加监控）——
// 与旧版 MonitorModal 里的 MonitorList 完全一致。传进去的 sourceId 是筛选与「加监控」的初值，
// 用户在「源ID」里仍可改选。
import { ref } from 'vue'
import SourceCheck from './index.vue'

const open = ref(false)
const sourceId = ref('')

/** 对齐旧 MonitorModal.showModal(record)：只取源 ID，行上其余字段丢弃 */
function showModal(id?: string) {
  sourceId.value = id ?? ''
  open.value = true
}
defineExpose({ showModal })
</script>

<template>
  <el-dialog
    v-model="open"
    class="smon-dialog"
    data-testid="source-monitor-dialog"
    title="监控"
    width="min(1400px, 96vw)"
    top="4vh"
    append-to-body
    destroy-on-close
  >
    <div class="smon-body">
      <SourceCheck embedded :source-id="sourceId" />
    </div>
  </el-dialog>
</template>

<style scoped>
/* 列表外壳（.sc-shell）是 `height: fit-content`、没有自己的滚动容器，
   所以这里不能给它固定高度（那会白留一块、或把内容挤出去），只用上限 + 自身滚动：
   内容少时弹窗随内容收缩，内容多时封在 74vh 内滚，底部字段不会掉出视口。 */
.smon-body {
  max-height: 74vh;
  min-height: 360px;
  overflow: auto;
}

/* 弹窗内筛选行沿用列表的弹性列与控件自适应宽度，空间不足时整列换行。 */
.smon-body :deep(.sc-filter-row > .el-col) {
  flex: 1 1 200px;
  max-width: none;
}
/* 按钮栏（查询 / 加监控）按内容宽，不参与平分，免得被拉出一段空白 */
.smon-body :deep(.sc-filter-row > .el-col:last-child) {
  flex: 0 0 auto;
}
.smon-body :deep(.sc-filter-form .el-select),
.smon-body :deep(.sc-filter-form .el-input),
.smon-body :deep(.sc-filter-form .el-input-number),
.smon-body :deep(.sc-filter-form .ss-wrap) {
  width: 100%;
}
</style>
