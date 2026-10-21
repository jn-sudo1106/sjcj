<script setup lang="ts">
// 「加入业务目录」选目录（2026-10-21）。业务目录树懒加载（-2「业务分类」下），单选一个目录。
// 一个源可以放进多个业务目录（10-21 定暂不限制），已经在里面的后端跳过。
import { ref } from 'vue'
import { dirPath, loadDirChildren, type DirNode } from '@/api/sourceDirs'

defineProps<{ count: number }>()
const emit = defineEmits<{ close: []; pick: [categoryId: string, name: string] }>()

const visible = ref(true)
const chosen = ref<DirNode | null>(null)
const loadError = ref('')

type TreeNode = { level: number; data: DirNode }
async function load(node: TreeNode, resolve: (data: DirNode[]) => void) {
  try {
    const list = await loadDirChildren('biz', node.level === 0 ? '' : node.data.id)
    loadError.value = ''
    resolve(list)
  } catch (error) {
    loadError.value = `业务目录加载失败：${(error as Error)?.message ?? String(error)}`
    resolve([])
  }
}
function close() {
  visible.value = false
  emit('close')
}
function confirm() {
  if (!chosen.value) return
  emit('pick', chosen.value.id, dirPath(chosen.value.id).join(' / ') || chosen.value.name)
}
</script>

<template>
  <el-dialog :model-value="visible" :title="`把 ${count} 个源加入业务目录`" width="460px" append-to-body data-testid="biz-dir-picker" @close="close">
    <div class="bdp-tree">
      <el-tree
        lazy
        :load="load"
        node-key="id"
        :props="{ label: 'name', isLeaf: () => false }"
        highlight-current
        :expand-on-click-node="false"
        @node-click="(data: DirNode) => (chosen = data)"
      />
    </div>
    <div v-if="loadError" class="bdp-err">{{ loadError }}</div>
    <div class="bdp-hint">{{ chosen ? `加入到「${dirPath(chosen.id).join(' / ') || chosen.name}」` : '选一个业务目录' }}；一个源可以放进多个业务目录，已在里面的会跳过</div>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :disabled="!chosen" data-testid="biz-dir-picker-ok" @click="confirm">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.bdp-tree { max-height: 320px; overflow: auto; border: 1px solid var(--rc-border); border-radius: 8px; padding: 6px; }
.bdp-err { margin-top: 6px; color: var(--rc-error); font-size: 12px; }
.bdp-hint { margin-top: 8px; color: var(--rc-faint); font-size: 12px; }
</style>
