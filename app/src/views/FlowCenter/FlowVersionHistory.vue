<script setup lang="ts">
/**
 * 流程中心抽屉标题行的「历史版本」下拉（2026-10-14）：列出全部版本，选一个就只读查看；
 * 选当前版本（草稿，或没有草稿时的运行版）= 回到正常编辑。只展示和发事件，切换由抽屉做。
 */
import { computed, ref } from 'vue'
import type { FlowVersionOverview } from '@/api'
import { groupVersions, type VersionItem } from './flowVersionHistory'

const props = defineProps<{
  overview: FlowVersionOverview | null
  /** 画布正在展示的版本 ID */
  viewing: string | null
  disabled?: boolean
}>()
const emit = defineEmits<{ select: [versionId: string] }>()

const open = ref(false)
const showDiscarded = ref(false)
const groups = computed(() => groupVersions(props.overview))

function pick(item: VersionItem) {
  open.value = false
  if (item.row.versionId !== props.viewing) emit('select', item.row.versionId)
}
</script>

<template>
  <el-popover v-model:visible="open" trigger="click" placement="bottom-start" :width="340" :disabled="disabled">
    <template #reference>
      <button class="fvh-trigger" type="button" :disabled="disabled" data-testid="flow-version-history">历史版本</button>
    </template>
    <div class="fvh" data-testid="flow-version-history-panel">
      <div class="fvh-head">历史版本 <small>选择后只读查看</small></div>
      <div class="fvh-list">
        <button
          v-for="item in groups.main"
          :key="item.row.versionId"
          class="fvh-row"
          :class="{ on: item.row.versionId === viewing }"
          type="button"
          data-testid="flow-version-history-row"
          @click="pick(item)"
        >
          <span class="fvh-title">{{ item.title }}</span>
          <span v-if="item.tag" class="fvh-tag" :class="{ run: item.tag === '运行中', draft: item.tag === '编辑中' }">{{ item.tag }}</span>
          <span class="fvh-meta">{{ item.meta }}</span>
        </button>
        <template v-if="groups.discarded.length">
          <button class="fvh-fold" type="button" data-testid="flow-version-history-fold" @click="showDiscarded = !showDiscarded">
            {{ showDiscarded ? '▾' : '▸' }} 已放弃 / 归档（{{ groups.discarded.length }}）
          </button>
          <template v-if="showDiscarded">
            <button
              v-for="item in groups.discarded"
              :key="item.row.versionId"
              class="fvh-row discarded"
              :class="{ on: item.row.versionId === viewing, unchanged: item.unchanged }"
              type="button"
              :title="item.unchanged ? '这个草稿和它的基线内容相同，放弃前没有改动' : undefined"
              data-testid="flow-version-history-discarded"
              @click="pick(item)"
            >
              <span class="fvh-title">{{ item.title }}</span>
              <span class="fvh-tag">{{ item.unchanged ? `${item.tag} · 未修改` : item.tag }}</span>
              <span class="fvh-meta">{{ item.meta }}</span>
            </button>
          </template>
        </template>
      </div>
    </div>
  </el-popover>
</template>

<style scoped>
.fvh-trigger { height: 22px; margin-left: 6px; padding: 0 8px; border: 1px solid var(--rc-border); border-radius: 5px; background: #fff; color: var(--rc-text-2); font-size: 11px; cursor: pointer; }
.fvh-trigger:hover:not(:disabled) { border-color: var(--rc-primary); color: var(--rc-primary); }
.fvh-trigger:disabled { opacity: .55; cursor: not-allowed; }
.fvh-head { padding: 0 2px 6px; font-size: 12px; font-weight: 600; color: var(--rc-text); }
.fvh-head small { margin-left: 6px; font-weight: 400; color: var(--rc-faint); }
.fvh-list { max-height: min(360px, 55vh); overflow-y: auto; }
.fvh-row { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 8px; border: 0; border-radius: 5px; background: transparent; font-size: 12px; text-align: left; cursor: pointer; }
.fvh-row:hover { background: #f1f5f9; }
.fvh-row.on { background: #eff6ff; }
.fvh-title { flex: none; min-width: 52px; font-weight: 600; color: var(--rc-text); }
.fvh-tag { flex: none; padding: 0 5px; border-radius: 4px; background: #e2e8f0; color: #475569; font-size: 10px; line-height: 16px; }
.fvh-tag.run { background: #dcfce7; color: #166534; }
.fvh-tag.draft { background: #fef3c7; color: #92400e; }
.fvh-meta { flex: 1; min-width: 0; overflow: hidden; color: var(--rc-faint); font-size: 11px; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.fvh-row.discarded .fvh-title { font-weight: 400; color: var(--rc-text-2); }
.fvh-row.unchanged { opacity: .6; }
.fvh-fold { width: 100%; margin-top: 4px; padding: 6px 8px; border: 0; border-top: 1px solid var(--rc-border-soft); background: transparent; color: var(--rc-text-2); font-size: 11px; text-align: left; cursor: pointer; }
</style>
