<script setup lang="ts">
// 模板结构预览（只读）。
//
// 结构来自模板定义：节点类型 + 数量 + 完整连接关系。实例内不可改——要改结构必须走
// 「修改当前实例并迁移到新模板 / 复制为新实例并另存为新模板」出口（1109 方案 §5.2；1110 复核 F02/R04）。
// 节点多于可用宽度时横向滚动，不折行。
import type { TemplateMeta } from '@/api/types/flowCenterCenter'

defineProps<{ template: TemplateMeta | null }>()

function nodeClass(kind: string) {
  return kind === 'rule' ? 'rule' : kind === 'out' ? 'out' : ''
}
</script>

<template>
  <div v-if="template" class="fc-struct" data-testid="flow-center-structure">
    <div class="fc-struct-head">
      结构预览
      <b>{{ template.structure.nodes.length }} 个节点 · {{ template.structure.branches.length }} 条分支</b>
      <i class="lock">只读 · 来自模板，实例内不可改</i>
    </div>
    <div class="fc-chain" role="list" aria-label="模板节点链">
      <template v-for="(node, index) in template.structure.nodes" :key="node.id">
        <span v-if="index > 0" class="arw" aria-hidden="true">›</span>
        <span class="node" :class="nodeClass(node.kind)" role="listitem">
          <i aria-hidden="true"></i>{{ node.label }}
          <small v-if="node.code">{{ node.code }}</small>
        </span>
      </template>
    </div>
  </div>
</template>