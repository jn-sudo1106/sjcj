<script setup lang="ts">
// 流程中心左栏：流程模板列表 + 「全部流程 / 未归类」入口（1109 方案 §5.1）。
//
// 只负责展示与选中态：模板数据由页面传入（当前接 C02 templateMetas，后端未落地时走 mock），
// 点击只是切换右栏列表，不在这里发请求。
// 视觉跟随项目设计系统（tokens.css 的 rc-* 观感），不再使用原型演示页的自定义样式。
import type { TemplateMeta } from '@/api/types/flowCenterCenter'

defineProps<{
  templates: TemplateMeta[]
  /** 全部流程总数（真实 flowPaged 的 total） */
  allCount: number
  unclassifiedCount: number
  /** 当前选中的模板 ID；空串表示没选模板 */
  selectedId: string
  /** 视图：模板列表 / 全部流程 / 未归类核对 */
  view: 'template' | 'all' | 'unclassified'
  loading?: boolean
}>()

const emit = defineEmits<{
  'select-template': [id: string]
  'select-all': []
  'select-unclassified': []
}>()

function shapeText(tpl: TemplateMeta) {
  return tpl.structure.nodes
    .filter(node => node.kind !== 'start' && node.kind !== 'end')
    .map(node => node.label)
}
</script>

<template>
  <aside class="fc-rail" data-testid="flow-center-rail">
    <div class="fc-rail-head">
      流程模板
      <em>{{ templates.length }} 个</em>
    </div>
    <div class="fc-rail-body">
      <button
        v-for="tpl in templates"
        :key="tpl.id"
        type="button"
        class="fc-rail-item"
        :class="{ on: view === 'template' && tpl.id === selectedId }"
        :data-testid="`flow-template-${tpl.id}`"
        @click="emit('select-template', tpl.id)"
      >
        <div class="fc-rail-name">
          <span class="dot" aria-hidden="true"></span>{{ tpl.name }}
        </div>
        <div class="fc-rail-shape">
          <template v-for="(label, index) in shapeText(tpl)" :key="`${tpl.id}-${index}`">
            <i v-if="index > 0" aria-hidden="true">›</i>{{ label }}
          </template>
        </div>
        <div class="fc-rail-meta">
          <span>实例 <b>{{ tpl.instanceCount }}</b></span>
          <span>源 <b>{{ tpl.sourceCount }}</b></span>
        </div>
      </button>
      <div v-if="loading && !templates.length" class="fc-rail-note">模板加载中…</div>
      <div v-else-if="!templates.length" class="fc-rail-note">当前账号还没有可用的流程模板。</div>

      <div class="fc-rail-divider"></div>
      <button
        type="button"
        class="fc-rail-entry"
        :class="{ on: view === 'all' }"
        data-testid="flow-center-all"
        @click="emit('select-all')"
      >
        全部流程
        <span class="n">{{ allCount.toLocaleString('zh-CN') }}</span>
      </button>
      <button
        type="button"
        class="fc-rail-entry warn"
        :class="{ on: view === 'unclassified' }"
        data-testid="flow-center-unclassified"
        @click="emit('select-unclassified')"
      >
        未归类 / 结构待核对
        <span class="n">{{ unclassifiedCount.toLocaleString('zh-CN') }}</span>
      </button>
      <div class="fc-rail-note">
        模板数、实例数、源数均为<b>当前账号可见</b>范围；「全部流程」「未归类」保留给管理与历史排查。
      </div>
    </div>
  </aside>
</template>