<script setup lang="ts">
// 「指标」弹窗 —— 1:1 迁移旧 data-view `src/page/base/measure/MeasureShow.vue`。
//
// 入口（旧 DatasetList）：
//   · 表格「指标数」标签 ┐
//   · 操作列「指标」     ┘ → handleShowMeasure(record) → showModal(record.sourceId, record.entryTypeId, record.datasetId)
// （旧 CommJobList / QueueCheck 也各挂了一个 MeasureShow，那两页不在本次范围里。）
//
// 旧形态（AntDV a-modal）：
//   `:width="document.body.clientWidth - 100"` + `style="top: 20px"` + `:footer="null"`
//   + `:destroyOnClose="true"` + **没有 title**（渲染成一条空标题栏 + 右上角关闭 X），
//   弹窗里装的是**整页组件** MeasureList（左分类树 + 搜索栏 + 操作下拉 + 表格 + 分页）。
//
// 新版照抄这个形态：el-dialog 里直接放 MetricCenter 的「指标列表」页组件
// `indicatorsList/index.vue`，入参走 props（旧版同样是 props：`:dataset-id / :sourceId / :entryTypeId`）。
// 于是从数据集页点「指标」不再跳页签，而是原地弹窗 —— 关掉后仍停在数据集列表上（旧版行为）。
//
// 有意偏差：
//   1. 旧 `MeasureShow` 还有个 `read` prop，透传给 MeasureList；但 MeasureList 里**从头到尾没用过**
//      （props 里声明了、模板与方法一次都没引用），而 DatasetList 也只写
//      `<measure-show ref="showMeasure">` 不传它 → 恒为 false 的死 prop，不迁。
//   2. 旧 `handleCancel`（点 X / 点遮罩）会 `$emit('refresh')`，但 DatasetList 的 `<measure-show>`
//      没挂 @refresh 监听 → 纯空转。这里不发这个事件：关掉弹窗**不刷新**数据集列表，
//      「指标数」要等下次点「查询」才更新（与旧版一致，别顺手加刷新）。
//   3. 宽度：旧版无下限，jsdom / 极端窄屏下 `clientWidth - 100` 会算出负数；这里兜一个 320px 的底。
//   4. 弹窗里装的整页组件自带白底 + 边框 + 圆角 + 16px 内边距，直接放进来会出现「框中框」；
//      旧 MeasureList 的根节点是 `a-card :bordered="false"`（本来就没有外框），所以这里在
//      `.msd-body` 作用域内把外框抹掉对齐（见 style）。
import { reactive, ref } from 'vue'
import IndicatorsList from '../indicatorsList/index.vue'

defineOptions({ name: 'MeasureShowDialog' })

/** 旧 showModal 的三个入参（旧 props 类型是 Number，路由传来的可能是字符串，两个都收） */
type IdLike = string | number | null | undefined

const visible = ref(false)
const width = ref('100%')
/** 每次 open 递增，作为内嵌列表的 key：`destroy-on-close` 只在「关闭动画走完」之后才销毁内容
 *  （el-dialog 内部是 leave 过渡结束才把 rendered 置回 false）。如果用户点掉弹窗、动画还没结束
 *  就去点另一行的「指标」，内容不会被销毁重建 —— 而内嵌的指标列表只在 mounted 时读一次 props，
 *  于是会拿着上一条数据集的筛选条件不放。key 一变就强制重建，与旧版 `destroyOnClose` 的意图一致。 */
const openSeq = ref(0)
const cur = reactive<{ sourceId: IdLike; entryTypeId: IdLike; datasetId: IdLike }>({
  sourceId: null,
  entryTypeId: null,
  datasetId: null,
})

/** 旧 `showModal(sourceId, entryTypeId, datasetId)` */
function open(sourceId?: IdLike, entryTypeId?: IdLike, datasetId?: IdLike) {
  cur.sourceId = sourceId ?? null
  cur.entryTypeId = entryTypeId ?? null
  cur.datasetId = datasetId ?? null
  // 旧 `this.width = document.body.clientWidth - 100`（a-modal 的 width 收 number，单位 px）
  const bodyWidth = typeof document === 'undefined' ? 0 : document.body.clientWidth
  width.value = `${Math.max(320, bodyWidth - 100)}px`
  openSeq.value += 1
  visible.value = true
}

defineExpose({ open })
</script>

<template>
  <!-- footer：旧版 `:footer="null"`（没有底部按钮）→ 不提供 #footer 插槽，el-dialog 自然不渲染页脚。
       title：旧版没传 → 保持不传（空标题栏 + 关闭 X），不要顺手加标题。
       destroy-on-close：等价旧 `:destroyOnClose="true"` —— 每次打开都重新挂载里面的指标列表。 -->
  <el-dialog v-model="visible" :width="width" top="20px" append-to-body :destroy-on-close="true">
    <div class="msd-body">
      <IndicatorsList
        :key="openSeq"
        :source-id="cur.sourceId"
        :entry-type-id="cur.entryTypeId"
        :dataset-id="cur.datasetId"
      />
    </div>
  </el-dialog>
</template>

<style scoped>
/* 旧 a-modal 的内容区没有高度上限、超出就整体滚动；这里给内容区一个上限让弹窗自己滚
   （指标列表 20 条 × 34px 会超过一屏，不给上限会把弹窗撑出视野）。 */
.msd-body {
  max-height: calc(100vh - 150px);
  overflow: auto;
}
/* 抹掉内嵌整页组件的外框（见文件头偏差第 4 条）。 */
.msd-body :deep(.ml-shell) {
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
}
</style>
