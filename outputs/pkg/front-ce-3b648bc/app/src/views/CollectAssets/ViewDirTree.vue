<script setup lang="ts">
/**
 * 「我的视图」目录树（2026-10-13 目录版，原型 `设计稿/原型设计/源管理_我的视图_目录树原型_2026-10-13.html`）。
 * 多级目录（10-14 定：没有根目录、父目录不汇总）；每行显示目录自己的源数、绑了来源组的出「组」标记，
 * 悬停出「⋯」：新建子目录 / 添加源 / 重命名 / 删除。只负责展示和发事件，改树由父级做。
 */
import { computed, ref } from 'vue'
import { ArrowRight, Folder, FolderOpened, MoreFilled } from '@element-plus/icons-vue'
import { childrenOf, type ViewTree } from './viewDirs'

export type DirCommand = 'newChild' | 'addSources' | 'rename' | 'delete'

const props = defineProps<{
  tree: ViewTree
  selected: string
  /** 目录 ID → 源数 */
  counts: Record<string, number>
  groupName: (id: string) => string
}>()
const emit = defineEmits<{
  select: [id: string]
  command: [command: DirCommand, id: string]
}>()

const collapsed = ref(new Set<string>())
function toggle(id: string) {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsed.value = next
}

/** 按展开状态拍平成行（自上而下、同级按 sortNo） */
const rows = computed(() => {
  const out: { id: string; name: string; depth: number; hasKids: boolean; groups: string[] }[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const d of childrenOf(props.tree, parentId)) {
      const hasKids = childrenOf(props.tree, d.id).length > 0
      out.push({ id: d.id, name: d.name, depth, hasKids, groups: d.groups })
      if (hasKids && !collapsed.value.has(d.id)) walk(d.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
})
const groupsTip = (groups: string[]) => `绑定了来源组：${groups.map(props.groupName).join('、')}`
</script>

<template>
  <div class="vdt" data-testid="view-dir-tree">
    <div
      v-for="row in rows"
      :key="row.id"
      class="vdt-row"
      :class="{ on: selected === row.id }"
      :style="{ paddingLeft: `${4 + row.depth * 16}px` }"
      data-testid="view-dir-node"
      :data-dir="row.id"
      @click="emit('select', row.id)"
    >
      <button v-if="row.hasKids" class="vdt-caret btn" :class="{ open: !collapsed.has(row.id) }" type="button" :aria-label="collapsed.has(row.id) ? '展开' : '收起'" @click.stop="toggle(row.id)"><el-icon><ArrowRight /></el-icon></button>
      <span v-else class="vdt-caret" />
      <el-icon class="vdt-ico"><component :is="row.hasKids && !collapsed.has(row.id) ? FolderOpened : Folder" /></el-icon>
      <span class="vdt-name" :title="row.name">{{ row.name }}</span>
      <span v-if="row.groups.length" class="vdt-group" :title="groupsTip(row.groups)">组</span>
      <span class="vdt-count">{{ counts[row.id] ?? 0 }}</span>
      <el-dropdown trigger="click" @command="(c: DirCommand) => emit('command', c, row.id)" @click.stop>
        <button class="vdt-more" type="button" title="目录操作" aria-label="目录操作" data-testid="view-dir-more" @click.stop><el-icon><MoreFilled /></el-icon></button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="newChild">新建子目录</el-dropdown-item>
            <el-dropdown-item command="addSources">添加源 / 绑定来源组</el-dropdown-item>
            <el-dropdown-item command="rename">重命名</el-dropdown-item>
            <el-dropdown-item command="delete" divided><span class="vdt-danger">删除目录</span></el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
    <div v-if="!rows.length" class="vdt-empty">还没有目录，点下面「＋ 目录」新建，再往目录里添加源</div>
  </div>
</template>

<style scoped>
/* 行样式对齐「我的分组」的来源组列表（SourceGroupTab .sg-item）：13px、行高约 34、选中浅蓝底不加粗 */
.vdt { display: flex; flex-direction: column; gap: 2px; }
.vdt-row { display: flex; align-items: center; gap: 4px; height: 34px; padding: 0 4px 0 10px; border-radius: 6px; cursor: pointer; color: var(--rc-text); font-size: 13px; }
.vdt-row:hover { background: #f1f5f9; }
.vdt-row.on { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.vdt-caret { flex: none; width: 16px; height: 16px; display: inline-grid; place-items: center; color: var(--rc-faint); font-size: 12px; }
.vdt-caret.btn { border: 0; background: none; padding: 0; cursor: pointer; border-radius: 4px; }
.vdt-caret.btn:hover { color: var(--rc-text); }
.vdt-caret .el-icon { transition: transform .15s; }
.vdt-caret.open .el-icon { transform: rotate(90deg); }
.vdt-ico { flex: none; margin-right: 2px; color: #94a3b8; font-size: 15px; }
.vdt-row.on .vdt-ico { color: var(--el-color-primary); }
.vdt-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vdt-group { flex: none; padding: 0 5px; border-radius: 4px; background: #ecfdf5; color: #047857; font-size: 11px; line-height: 16px; }
.vdt-count { flex: none; min-width: 16px; text-align: right; color: var(--rc-faint); font-size: 11px; }
.vdt-more { visibility: hidden; flex: none; width: 22px; height: 22px; display: inline-grid; place-items: center; border: 0; border-radius: 4px; background: none; color: var(--rc-faint); cursor: pointer; }
.vdt-row:hover .vdt-more, .vdt-row.on .vdt-more { visibility: visible; }
.vdt-more:hover { background: #e2e8f0; color: var(--rc-text); }
.vdt-danger { color: var(--el-color-danger); }
.vdt-empty { padding: 10px 8px; color: var(--rc-faint); font-size: 12px; line-height: 1.6; }
</style>
