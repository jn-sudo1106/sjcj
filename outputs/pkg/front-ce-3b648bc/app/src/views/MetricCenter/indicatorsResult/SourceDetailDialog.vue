<script setup lang="ts">
// 源详情弹层 —— 迁移旧 data-view `src/page/base/detail/SourceDetail.vue`。
//
// 旧形态只有一层壳：`<base-detail-drawer :cols="detailCols">` + `showModal(sourceId)` 拉详情再 showDrawer。
// `detailCols` = `SOURCE.BASE + SOURCE.OTHER` 剔除 `noDetail`——这部分已经落在
// `indicatorsResult/columns.ts` 的 `sourceDetailColumns()` 里（含新旧字段名映射说明）。
// 所以本文件只负责三件事：
//   1. 按 `sourceId` 调 `sourceApi.sourceDetail` 拿 `Source`；
//   2. 把结果交给共享的 `ColumnDetailDrawer`（同一套 cols / 同一套渲染分支）；
//   3. 给 `remark` 列注入 `save`——旧列配置里 `save` 是直接闭包 `updateSource({sourceId, remark, author, tags})` 的，
//      新平台对应 `sourceApi.updateSourceMark(sourceId, {tags, remark})`。
//
// 有意偏差（1 处）：
//   旧 save 会连 `author`（责任人）一起提交；新平台的 `updateSourceMark` **刻意不发 author**
//   （见其文档注释：「0831 明确暂不做，不发比发空串安全」）。这里沿用新平台口径，只写 tags + remark。
//
// 旧 `handleDetailSaved`（保存后按 record.sourceId 重新 loadInfo）在新平台由 ColumnDetailDrawer
// 的 `save` 分支自带「保存成功」提示 + `emit('save')`，本组件在 emit 里刷新一次详情即可。
import { ref } from 'vue'
import { ElNotification } from 'element-plus'
import { sourceApi } from '@/api'
import ColumnDetailDrawer from '../shared/ColumnDetailDrawer.vue'
import { sourceDetailColumns } from './columns'
import type { ColumnDef } from '../shared/types'

defineOptions({ name: 'SourceDetailDialog' })

const drawer = ref<InstanceType<typeof ColumnDetailDrawer> | null>(null)
const sourceId = ref('')

/** remark 列注入 save（其余列原样透传） */
const cols: ColumnDef[] = sourceDetailColumns().map((col) =>
  col.dataIndex === 'remark'
    ? {
        ...col,
        save: (record: Record<string, unknown>) =>
          sourceApi.updateSourceMark(String(record.sourceId ?? ''), {
            tags: record.tags as string[] | undefined,
            remark: String(record.remark ?? ''),
          }),
      }
    : col,
)

async function load(id: string) {
  try {
    const source = await sourceApi.sourceDetail(id)
    if (!source) {
      ElNotification.error({ message: '获取信息源详情失败：无数据' })
      return
    }
    // Source 的字段名就是 cols 里 dataIndex 的名字（见 columns.ts 的逐条对照），直接透传
    drawer.value?.open(source as unknown as Record<string, unknown>, '信息源')
  } catch (err) {
    ElNotification.error({ message: `获取信息源详情失败${err instanceof Error ? err.message : String(err)}` })
  }
}

/** 旧 `showModal(id)` */
function open(id: string) {
  sourceId.value = id
  return load(id)
}

/** 旧 `handleDetailSaved`：保存备注后按当前 sourceId 重新加载 */
function onSaved() {
  if (sourceId.value) return load(sourceId.value)
  return undefined
}

defineExpose({ open })
</script>

<template>
  <ColumnDetailDrawer ref="drawer" :cols="cols" @save="onSaved" />
</template>
