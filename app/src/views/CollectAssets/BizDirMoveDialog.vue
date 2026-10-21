<script setup lang="ts">
// 业务目录「移动到…」（10-21）：把勾选的源从左侧点选的目录移到另一个目录；也可以「仅移出」不放进别处。
// 目标单选——要同时放进多个目录用「添加源到业务目录」。先加入目标再移出，见 moveSourcesInBiz。
import { computed, ref } from 'vue'
import { ElMessage, type LoadFunction } from 'element-plus'
import { dirPath, loadDirChildren, moveSourcesInBiz, type DirNode } from '@/api/sourceDirs'

const props = defineProps<{
  sourceIds: string[]
  /** 从哪些目录移出（左侧点选的目录；勾父级时含子级） */
  fromDirIds: string[]
  fromLabel: string
}>()
const emit = defineEmits<{ close: []; saved: [] }>()

const visible = ref(true)
const mode = ref<'move' | 'remove'>('move')
const target = ref<DirNode | null>(null)
const saving = ref(false)
const error = ref('')
const loadError = ref('')
const fromSet = computed(() => new Set(props.fromDirIds))
const targetLabel = computed(() => (target.value ? dirPath(target.value.id).join(' / ') || target.value.name : ''))
const canSubmit = computed(() => !saving.value && props.sourceIds.length > 0 && (mode.value === 'remove' || !!target.value))

const load: LoadFunction = async (node, resolve) => {
  try {
    const list = await loadDirChildren('biz', node.level === 0 ? '' : String(node.data.id))
    loadError.value = ''
    resolve(list.map((n) => ({ ...n, disabled: fromSet.value.has(n.id) })))
  } catch (e) {
    loadError.value = `业务目录加载失败：${(e as Error)?.message ?? String(e)}`
    resolve([])
  }
}
function pick(node: DirNode & { disabled?: boolean }) {
  if (node.disabled) return
  target.value = node
  mode.value = 'move'
}
function close() {
  visible.value = false
  emit('close')
}
async function submit() {
  if (!canSubmit.value) return
  saving.value = true
  error.value = ''
  const toId = mode.value === 'move' ? target.value!.id : null
  try {
    await moveSourcesInBiz(props.fromDirIds, toId, props.sourceIds)
    ElMessage.success(toId ? `已把 ${props.sourceIds.length} 个源移到「${targetLabel.value}」` : `已把 ${props.sourceIds.length} 个源移出「${props.fromLabel}」`)
    emit('saved')
    close()
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    if ((e as { step?: string }).step === 'remove' && toId) {
      error.value = `已加入「${targetLabel.value}」，但从「${props.fromLabel}」移出失败：${msg}。可再点一次移动，已加入的会自动跳过。`
      emit('saved')
    } else {
      error.value = `${toId ? `加入「${targetLabel.value}」` : '移出'}失败：${msg}。源还在原目录，可重试。`
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="visible" :title="`移动 ${sourceIds.length} 个源`" width="520px" append-to-body data-testid="biz-dir-move" @update:model-value="(v: boolean) => { if (!v) close() }">
    <div class="bdm-row"><span class="bdm-k">从</span><b>{{ fromLabel }}</b></div>
    <div class="bdm-row bdm-to">
      <span class="bdm-k">到</span>
      <span v-if="mode === 'remove'" class="bdm-muted">不放进任何目录（仅移出）</span>
      <b v-else-if="target" data-testid="biz-dir-move-target">{{ targetLabel }}</b>
      <span v-else class="bdm-muted">在下面点选一个目录</span>
    </div>
    <div class="bdm-tree" :class="{ off: mode === 'remove' }" data-testid="biz-dir-move-tree">
      <el-tree
        lazy
        :load="load"
        node-key="id"
        highlight-current
        :expand-on-click-node="false"
        :props="{ label: 'name', isLeaf: () => false, disabled: 'disabled' }"
        @node-click="pick"
      >
        <template #default="{ data }">
          <span class="bdm-node" :class="{ disabled: data.disabled, on: mode === 'move' && target?.id === data.id }" :data-dir="data.id" data-testid="biz-dir-move-node">
            {{ data.name }}<span v-if="data.disabled" class="bdm-muted">（当前目录）</span>
          </span>
        </template>
      </el-tree>
    </div>
    <div v-if="loadError" class="bdm-err">{{ loadError }}</div>
    <label class="bdm-remove"><input v-model="mode" type="radio" value="remove" data-testid="biz-dir-move-remove-only">不放进任何目录，仅从「{{ fromLabel }}」移出</label>
    <div class="bdm-hint">源在其它业务目录里的归类不动；只解除归类，不删源。</div>
    <div v-if="error" class="bdm-err" role="alert" data-testid="biz-dir-move-error">{{ error }}</div>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canSubmit" data-testid="biz-dir-move-ok" @click="submit">{{ mode === 'remove' ? `移出 ${sourceIds.length} 个源` : `移动 ${sourceIds.length} 个源` }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.bdm-row { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; color: var(--rc-text); font-size: 13px; }
.bdm-k { flex: none; width: 20px; color: var(--rc-muted); }
.bdm-tree { max-height: min(360px, calc(100vh - 380px)); overflow: auto; padding: 6px; border: 1px solid var(--rc-border); border-radius: 8px; }
.bdm-tree.off { opacity: .45; }
.bdm-node { font-size: 13px; }
.bdm-node.on { color: #7c3aed; font-weight: 600; }
.bdm-node.disabled { color: var(--rc-faint); cursor: not-allowed; }
.bdm-muted { color: var(--rc-faint); font-size: 12px; }
.bdm-remove { display: flex; align-items: center; gap: 6px; margin-top: 10px; color: var(--rc-text-2); font-size: 13px; cursor: pointer; }
.bdm-remove input { margin: 0; accent-color: #7c3aed; }
.bdm-hint { margin-top: 6px; color: var(--rc-muted); font-size: 12px; }
.bdm-err { margin-top: 8px; color: var(--rc-error); font-size: 12px; overflow-wrap: anywhere; }
</style>
