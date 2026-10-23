<script setup lang="ts">
// 向量表数据浏览（旧 ai-chat-view「基础配置 → 向量表数据浏览」src/demo/VectorDataShowTop.vue，
// 1015 迁入问数配置组「基础配置」页内 tab，见 router/tabs.ts 的 BASE_CONFIG_TABS）。
//
// 旧版形态 1:1 保留：左侧一列可增删的「窗口」tab，每个窗口一份互不干扰的查询区（选表 + 文本搜索 + JSON 结果）。
// 窗口的新增/关闭用 el-tabs 的 editable（旧 @edit(targetKey, action) 同签名），只剩一个窗口时不给关闭按钮
// （旧 :closable="panes.length > 1"）；每个窗口的状态在自己的 VectorDataPanel 实例里，切窗口不丢结果。
// 旧版的 @change="callback" 只 console.log(val)、没有任何行为，不迁。
import { ref } from 'vue'
import VectorDataPanel from './VectorDataPanel.vue'

defineOptions({ name: 'VectorDataShowPage' })

interface VectorWindowPane {
  title: string
  key: string
}

const panes = ref<VectorWindowPane[]>([{ title: '窗口 1', key: '1' }])
const activeKey = ref('1')
// 旧 newTabIndex 从 2 起（首屏已占 1）；标题文案照旧版：首屏「窗口 1」带空格，新增的「窗口N」不带
let newTabIndex = 2

function addPane() {
  const key = `${newTabIndex++}`
  panes.value.push({ title: `窗口${key}`, key })
  activeKey.value = key
}

function removePane(targetKey: string) {
  const index = panes.value.findIndex((pane) => pane.key === targetKey)
  if (index === -1) return
  panes.value.splice(index, 1)
  if (activeKey.value !== targetKey) return
  // 旧版：关掉当前窗口后回落到前一个，没有前一个就落第一个
  // （只剩一个窗口时旧版/这里都不给关闭按钮，index 必然还在剩余窗口内）
  const next = panes.value[Math.min(Math.max(index - 1, 0), panes.value.length - 1)]!
  activeKey.value = next.key
}

function onEdit(targetKey: string | undefined, action: 'remove' | 'add') {
  if (action === 'add') {
    addPane()
    return
  }
  if (targetKey != null) removePane(String(targetKey))
}
</script>

<template>
  <div class="vd-windows">
    <el-tabs v-model="activeKey" type="border-card" tab-position="left" editable class="vd-window-tabs" @edit="onEdit">
      <el-tab-pane v-for="pane in panes" :key="pane.key" :name="pane.key" :label="pane.title" :closable="panes.length > 1">
        <vector-data-panel />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.vd-windows {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.vd-window-tabs {
  width: 100%;
}
.vd-window-tabs :deep(.el-tabs__content) {
  padding: 10px;
}
.vd-window-tabs :deep(.el-tabs__header.is-left) {
  width: 92px;
}
</style>
