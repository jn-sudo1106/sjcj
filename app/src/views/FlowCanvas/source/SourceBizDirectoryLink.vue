<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { bizMembership, dirPath } from '@/api/sourceDirs'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ sourceId: string }>()
const emit = defineEmits<{ navigate: [directoryId: string] }>()
const ui = useUiStore()
const directories = ref<{ id: string; path: string }[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')
const error = ref('')
const visible = ref(false)
const keyword = ref('')
const matches = computed(() => directories.value.filter(dir => dir.path.toLocaleLowerCase().includes(keyword.value.trim().toLocaleLowerCase())))
let sequence = 0

async function load() {
  const request = ++sequence
  const sourceId = props.sourceId
  state.value = 'loading'
  directories.value = []
  visible.value = false
  try {
    // 行只在源列表返回后挂载；所有行复用现有的会话缓存和同一个在途请求。
    const membership = await bizMembership()
    if (request !== sequence) return
    directories.value = (membership.get(sourceId) ?? []).map(id => ({ id, path: dirPath(id).join(' / ') || `#${id}` }))
    state.value = 'ready'
  } catch (cause) {
    if (request !== sequence) return
    state.value = 'error'
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
function navigate(id: string) {
  visible.value = false
  emit('navigate', id)
}
watch([() => props.sourceId, () => ui.sourceListRevision], load, { immediate: true })
onBeforeUnmount(() => { sequence++ })
</script>

<template>
  <div class="sbd-line" data-testid="source-biz-directory" @click.stop>
    <span class="sbd-label">业务目录：</span>
    <span v-if="state === 'loading'" class="sbd-muted" role="status">目录加载中…</span>
    <button v-else-if="state === 'error'" class="sbd-link" type="button" :title="error" @click="load">加载失败，重试</button>
    <template v-else-if="directories.length">
      <button class="sbd-link sbd-path" type="button" :title="`${directories[0]!.path} · 查看该目录下的源`" :aria-label="`查看业务目录 ${directories[0]!.path} 下的源`" @click="navigate(directories[0]!.id)">{{ directories[0]!.path }}</button>
      <el-popover v-if="directories.length > 1" v-model:visible="visible" trigger="click" placement="bottom-start" :width="360" @show="keyword = ''">
        <template #reference>
          <button class="sbd-link sbd-more" type="button" :aria-label="`查看全部 ${directories.length} 个业务目录`">+{{ directories.length - 1 }}</button>
        </template>
        <div class="sbd-picker">
          <div class="sbd-heading">所属业务目录（{{ directories.length }}）</div>
          <el-input v-model="keyword" size="small" clearable placeholder="搜索业务目录" aria-label="搜索业务目录" />
          <div class="sbd-list">
            <button v-for="dir in matches" :key="dir.id" class="sbd-option" type="button" :aria-label="`定位业务目录 ${dir.path}`" @click="navigate(dir.id)">
              <span>{{ dir.path }}</span><span class="sbd-action">定位</span>
            </button>
            <div v-if="!matches.length" class="sbd-muted sbd-empty">没有匹配的目录</div>
          </div>
        </div>
      </el-popover>
    </template>
    <span v-else class="sbd-muted">未归类</span>
  </div>
</template>

<style scoped>
.sbd-line { display: flex; align-items: center; gap: 2px; min-width: 0; margin-top: 5px; font-size: 12px; line-height: 18px; font-weight: 400; }
.sbd-label, .sbd-muted { color: var(--rc-muted); }
.sbd-label, .sbd-more { flex-shrink: 0; }
.sbd-link { border: 0; padding: 0; background: none; color: var(--rc-primary); font: inherit; cursor: pointer; }
.sbd-link:hover { text-decoration: underline; }
.sbd-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; text-align: left; }
.sbd-more { padding: 0 4px; margin-left: 2px; }
.sbd-heading { margin-bottom: 10px; color: var(--rc-text); font-weight: 600; }
.sbd-list { max-height: 240px; overflow-y: auto; margin-top: 8px; }
.sbd-option { display: flex; align-items: center; gap: 12px; width: 100%; padding: 9px 4px; border: 0; background: none; text-align: left; font: inherit; color: var(--rc-text); cursor: pointer; }
.sbd-option > span:first-child { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.sbd-option:hover { background: var(--rc-bg); }
.sbd-action { flex-shrink: 0; color: var(--rc-primary); font-size: 12px; }
.sbd-empty { padding: 12px 0; text-align: center; }
.sbd-link:focus-visible, .sbd-option:focus-visible { outline: 2px solid var(--rc-primary); outline-offset: 2px; }
</style>
