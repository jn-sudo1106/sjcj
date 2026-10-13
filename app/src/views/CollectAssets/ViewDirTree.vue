<script setup lang="ts">
/**
 * 「我的视图」目录树（2026-10-13 目录版，原型 `设计稿/原型设计/源管理_我的视图_目录树原型_2026-10-13.html`）。
 * 第一行是「全部（根目录）」，下面是多级目录；每行显示源数（父目录汇总子目录）、绑了来源组的出「组」标记，
 * 悬停出「⋯」：新建子目录 / 添加源 / 重命名 / 删除（根目录只有添加源）。只负责展示和发事件，改树由父级做。
 */
import { computed, ref } from 'vue'
import { Folder, FolderOpened, Files, MoreFilled } from '@element-plus/icons-vue'
import { ROOT_ID, childrenOf, type ViewTree } from './viewDirs'

export type DirCommand = 'newChild' | 'addSources' | 'rename' | 'delete'

const props = defineProps<{
  tree: ViewTree
  selected: string
  /** 目录 ID（含 ROOT_ID）→ 看到的源数 */
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
      class="vdt-row"
      :class="{ on: selected === ROOT_ID }"
      data-testid="view-dir-root"
      title="根目录：这个视图里的全部源；也可以直接在这里添加源、绑定来源组"
      @click="emit('select', ROOT_ID)"
    >
      <span class="vdt-caret" />
      <el-icon class="vdt-ico"><Files /></el-icon>
      <span class="vdt-name">全部（根目录）</span>
      <span v-if="tree.root.groups.length" class="vdt-group" :title="groupsTip(tree.root.groups)">组</span>
      <span class="vdt-count">{{ counts[ROOT_ID] ?? 0 }}</span>
      <el-dropdown trigger="click" @command="(c: DirCommand) => emit('command', c, ROOT_ID)" @click.stop>
        <button class="vdt-more" type="button" title="根目录操作" aria-label="根目录操作" @click.stop><el-icon><MoreFilled /></el-icon></button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="newChild">新建目录</el-dropdown-item>
            <el-dropdown-item command="addSources">添加源 / 绑定来源组</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
    <div
      v-for="row in rows"
      :key="row.id"
      class="vdt-row"
      :class="{ on: selected === row.id }"
      :style="{ paddingLeft: `${8 + (row.depth + 1) * 14}px` }"
      data-testid="view-dir-node"
      :data-dir="row.id"
      @click="emit('select', row.id)"
    >
      <button v-if="row.hasKids" class="vdt-caret btn" type="button" :aria-label="collapsed.has(row.id) ? '展开' : '收起'" @click.stop="toggle(row.id)">{{ collapsed.has(row.id) ? '▸' : '▾' }}</button>
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
    <div v-if="!rows.length" class="vdt-empty">还没有目录，点下面「＋ 目录」新建；也可以直接往根目录添加源</div>
  </div>
</template>

<style scoped>
.vdt { display: flex; flex-direction: column; gap: 1px; }
.vdt-row { display: flex; align-items: center; gap: 4px; height: 32px; padding: 0 6px 0 8px; border-radius: 6px; cursor: pointer; color: var(--rc-text); font-size: 13px; }
.vdt-row:hover { background: #f1f5f9; }
.vdt-row.on { background: var(--el-color-primary-light-9); color: var(--el-color-primary); font-weight: 600; }
.vdt-caret { flex: none; width: 16px; text-align: center; color: var(--rc-faint); font-size: 10px; }
.vdt-caret.btn { border: 0; background: none; padding: 0; cursor: pointer; }
.vdt-ico { flex: none; color: #94a3b8; }
.vdt-row.on .vdt-ico { color: var(--el-color-primary); }
.vdt-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vdt-group { flex: none; padding: 0 5px; border-radius: 4px; background: #ecfdf5; color: #047857; font-size: 10px; font-weight: 600; }
.vdt-count { flex: none; color: var(--rc-faint); font-size: 11px; font-weight: 400; }
.vdt-more { visibility: hidden; flex: none; width: 22px; height: 22px; display: inline-grid; place-items: center; border: 0; border-radius: 4px; background: none; color: var(--rc-faint); cursor: pointer; }
.vdt-row:hover .vdt-more, .vdt-row.on .vdt-more { visibility: visible; }
.vdt-more:hover { background: #e2e8f0; color: var(--rc-text); }
.vdt-danger { color: var(--el-color-danger); }
.vdt-empty { padding: 10px 8px; color: var(--rc-faint); font-size: 12px; line-height: 1.6; }
</style>
