<script lang="ts">
/** 动作完成后通知父级刷新：编辑/重命名/删除/搬走/复制 */
export type SourceRowActionKind = 'edited' | 'renamed' | 'deleted' | 'moved' | 'copied'
</script>

<script setup lang="ts">
// 源行右键菜单 + 动作弹窗（2026-11-05，搜索结果侧栏用）。
//
// 站内「按网站看源」侧栏（SiteSourceSwitcher）早就有这套菜单，但它的动作结果写回自己的
// children 本地列表、页签和 flow store；搜索结果列表是跨网站的一次性快照，动作完成后
// 整表重取才准确。因此这里自包含：菜单和弹窗都在本组件，父级只处理 `changed`（重取列表 /
// 同步当前源）。动作口径与 SiteSourceSwitcher 的右键菜单保持一致，别在两个地方各改一半。
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { sourceApi, type Source } from '@/api'
import { urlOrPlaceholder } from '@/utils/source/placeholderUrl'
import { trackCreate, trackDelete, trackEdit } from '@/utils/logEvents'
import EditSourceDialog from './EditSourceDialog.vue'
import ChangeSiteDialog from '@/views/CollectAssets/ChangeSiteDialog.vue'
import CodeConfigButton from '../result/CodeConfigButton.vue'
import SnatchLauncher from './SnatchLauncher.vue'

const props = withDefaults(defineProps<{ pageName?: string }>(), { pageName: '搜索结果' })
const emit = defineEmits<{ changed: [kind: SourceRowActionKind, source: Source] }>()

const menu = reactive({ show: false, x: 0, y: 0, source: null as Source | null })
const menuElement = ref<HTMLElement>()
// 菜单尺寸只用来做视口边界翻转，取个够用的近似值即可（8 项 × 28px + 内边距）
const MENU_WIDTH = 148
const MENU_HEIGHT = 244

/** 由父级在行 `contextmenu` 里调用；坐标是视口坐标，菜单本身 position: fixed。 */
function open(event: MouseEvent, source: Source) {
  const left = Math.min(event.clientX, window.innerWidth - MENU_WIDTH - 8)
  const top = event.clientY + MENU_HEIGHT + 8 > window.innerHeight
    ? Math.max(8, event.clientY - MENU_HEIGHT)
    : event.clientY
  menu.show = true
  menu.x = Math.max(8, left)
  menu.y = top
  menu.source = source
}
function close() {
  menu.show = false
  menu.source = null
}

function onWindowPointerDown(event: PointerEvent | Event) {
  if (!menu.show) return
  // 捕获阶段先于菜单项的 click，点到菜单内部时不能关——否则 menu.source 被清空，动作拿不到源。
  const target = event.target
  if (menuElement.value && target instanceof Node && menuElement.value.contains(target)) return
  close()
}
function onWindowKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && menu.show) close()
}
function onWindowHide() {
  if (menu.show) close()
}
onMounted(() => {
  window.addEventListener('pointerdown', onWindowPointerDown, true)
  window.addEventListener('keydown', onWindowKeyDown)
  window.addEventListener('resize', onWindowHide)
  window.addEventListener('blur', onWindowHide)
  window.addEventListener('scroll', onWindowHide, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onWindowPointerDown, true)
  window.removeEventListener('keydown', onWindowKeyDown)
  window.removeEventListener('resize', onWindowHide)
  window.removeEventListener('blur', onWindowHide)
  window.removeEventListener('scroll', onWindowHide, true)
})
defineExpose({ open, close })

/** ElMessageBox 取消时 reject 的是 'cancel' / 'close' 字符串，不能当业务错误报出来。 */
function isDialogCancel(error: unknown) {
  return error === 'cancel' || error === 'close'
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

// ---- 编辑源（2026-11-05 新增：名称 / URL / 核心参数 / 业务目录 / 所属网站）----
const editTarget = ref<Source | null>(null)
function startEdit() {
  editTarget.value = menu.source
  close()
}
function onEdited(saved: Source) {
  const before = editTarget.value
  editTarget.value = null
  emit('changed', 'edited', before ? { ...before, ...saved } : saved)
}
function onDirectoriesChanged() {
  if (editTarget.value) emit('changed', 'edited', editTarget.value)
}

// ---- 重命名（搜索结果列表没有行内输入位，用弹窗填名称）----
async function startRename() {
  const source = menu.source
  if (!source) return
  close()
  let name = ''
  try {
    const answer = await ElMessageBox.prompt('请输入新的源名称', '重命名', {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValue: source.name,
      inputValidator: (value: string) => (value?.trim() ? true : '源名称不能为空'),
    })
    name = answer.value.trim()
  } catch (error) {
    if (!isDialogCancel(error)) ElMessage.error(`重命名失败：${errorText(error)}`)
    return
  }
  if (!name || name === source.name) return
  try {
    const res = await sourceApi.sourceUpdate({ ...source, name })
    if (!res?.ok) {
      ElMessage.warning(res?.message || '重命名失败，请重试')
      return
    }
    trackEdit('SOURCE', source.sourceId, name, {
      eventCode: 'source_rename',
      eventName: '重命名源',
      firstModule: '采集资产',
      pageName: props.pageName,
    })
    ElMessage.success(res?.message || '源已重命名')
    emit('changed', 'renamed', { ...source, name })
  } catch (error) {
    ElMessage.error(`重命名失败：${errorText(error)}`)
  }
}

// ---- 发起抓取 / 发指定队列：走 SnatchLauncher（有参数会先弹参数框）----
const snatchLauncher = ref<InstanceType<typeof SnatchLauncher>>()
async function launchFromMenu() {
  const source = menu.source
  if (!source || source.disabled) return
  close()
  await snatchLauncher.value?.launch(source.sourceId, {
    onSuccess: () => ElMessage.success(`已发起「${source.name}」抓取`),
  })
}
async function launchQueue() {
  const source = menu.source
  if (!source || source.disabled) return
  close()
  let queue = ''
  try {
    const answer = await ElMessageBox.prompt('请输入发送队列名称', '发指定队列', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputPlaceholder: '队列名',
    })
    queue = answer.value?.trim() ?? ''
  } catch (error) {
    if (!isDialogCancel(error)) ElMessage.error(`发起抓取失败：${errorText(error)}`)
    return
  }
  if (!queue) return
  await snatchLauncher.value?.launch(source.sourceId, {
    queue,
    onSuccess: () => ElMessage.success(`已发起「${source.name}」抓取（队列 ${queue}）`),
  })
}

// ---- 代码生成 ----
const codeSources = ref<Source[]>([])
const codeLauncher = ref<InstanceType<typeof CodeConfigButton>>()
async function generateCode() {
  const source = menu.source
  if (!source) return
  codeSources.value = [source]
  close()
  await nextTick()
  codeLauncher.value?.show()
}

// ---- 复制源（只制作源副本：新源沿用原源流程与配置，flag=0）----
const copyDlg = reactive({ show: false, source: null as Source | null, name: '', url: '', saving: false })
function openCopy() {
  const source = menu.source
  if (!source) return
  close()
  copyDlg.source = source
  copyDlg.name = `${source.name}_copy`
  copyDlg.url = source.url ?? ''
  copyDlg.show = true
}
function closeCopy() {
  copyDlg.show = false
  copyDlg.source = null
}
async function submitCopy() {
  const source = copyDlg.source
  const name = copyDlg.name.trim()
  if (!source || copyDlg.saving) return
  if (!name) {
    ElMessage.warning('请填写新源名称')
    return
  }
  copyDlg.saving = true
  try {
    const url = urlOrPlaceholder(copyDlg.url, `${source.sourceId}-${Date.now().toString(36)}`)
    const copied = await sourceApi.copySourceAndLocate({ sourceId: source.sourceId, name, url, flag: 0 })
    if (!copied.ok) {
      ElMessage.warning(copied.message)
      return
    }
    // 搜索结果跨网站：新源跟着原源归入同一个网站；原源没绑网站就保持未绑定。
    const siteId = source.siteId && source.siteId !== '0' && source.siteId !== '-1' ? source.siteId : ''
    if (siteId) {
      const bind = await sourceApi.changeSite([copied.sourceId], siteId)
      if (!bind.ok) {
        ElMessage.warning(bind.message || `源已复制（#${copied.sourceId}），但未能关联到原网站`)
      }
    }
    trackCreate('SOURCE', copied.sourceId, copied.name || name, {
      eventCode: 'source_copy',
      eventName: '复制源',
      firstModule: '采集资产',
      pageName: props.pageName,
      pageEntry: `源「${source.name}」`,
    })
    ElMessage.success(`已复制源「${copied.name || name}」`)
    const changed = { ...source, sourceId: copied.sourceId, name: copied.name || name }
    closeCopy()
    emit('changed', 'copied', changed)
  } catch (error) {
    ElMessage.error(`复制源失败：${errorText(error)}`)
  } finally {
    copyDlg.saving = false
  }
}

// ---- 更换网站（复用采集资产页的批量弹窗，一个源一条）----
const moveTarget = ref<Source | null>(null)
function openMove() {
  if (!menu.source) return
  moveTarget.value = menu.source
  close()
}
function onMoved() {
  const source = moveTarget.value
  moveTarget.value = null
  if (source) emit('changed', 'moved', source)
}

// ---- 删除源 ----
async function removeSource() {
  const source = menu.source
  if (!source) return
  close()
  try {
    await ElMessageBox.confirm(
      `将永久删除源「${source.name}」（ID ${source.sourceId}），该操作直接生效且不可恢复。确认删除？`,
      '删除源',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' },
    )
  } catch (error) {
    if (!isDialogCancel(error)) ElMessage.error(`删除失败：${errorText(error)}`)
    return
  }
  try {
    const res = await sourceApi.deleteSource([source.sourceId])
    if (!res?.ok) {
      ElMessage.warning(res?.message || '删除失败，请重试')
      return
    }
    trackDelete('SOURCE', source.sourceId, source.name, {
      eventCode: 'source_delete',
      eventName: '删除源',
      firstModule: '采集资产',
      pageName: props.pageName,
    })
    ElMessage.success(`源「${source.name}」已删除`)
    emit('changed', 'deleted', source)
  } catch (error) {
    ElMessage.error(`删除失败：${errorText(error)}`)
  }
}
</script>

<template>
  <div
    v-if="menu.show && menu.source"
    ref="menuElement"
    class="sra-menu"
    role="menu"
    aria-label="源操作"
    :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
    @click.stop
    @contextmenu.prevent
    @pointerdown.stop
  >
    <button type="button" role="menuitem" data-testid="search-menu-edit" @click="startEdit">编辑源</button>
    <button type="button" role="menuitem" data-testid="search-menu-rename" @click="startRename">重命名</button>
    <button
      type="button"
      role="menuitem"
      data-testid="search-menu-launch"
      :disabled="menu.source.disabled"
      @click="launchFromMenu"
    >发起抓取</button>
    <button type="button" role="menuitem" data-testid="search-menu-code" @click="generateCode">代码生成</button>
    <button
      type="button"
      role="menuitem"
      data-testid="search-menu-snatch-queue"
      :disabled="menu.source.disabled"
      @click="launchQueue"
    >发指定队列</button>
    <button type="button" role="menuitem" data-testid="search-menu-copy" @click="openCopy">复制源…</button>
    <button type="button" role="menuitem" data-testid="search-menu-move" @click="openMove">更换网站…</button>
    <button type="button" role="menuitem" class="danger" data-testid="search-menu-delete" @click="removeSource">删除源</button>
  </div>

  <EditSourceDialog
    v-if="editTarget"
    :open="true"
    :source="editTarget"
    quick
    @update:open="editTarget = null"
    @saved="onEdited"
    @directories-changed="onDirectoriesChanged"
  />

  <ChangeSiteDialog
    v-if="moveTarget"
    :source-ids="[moveTarget.sourceId]"
    @close="moveTarget = null"
    @saved="onMoved"
  />

  <div v-if="copyDlg.show" class="sra-backdrop" @click.self="closeCopy">
    <div class="sra-card" data-testid="search-copy-dialog" @click.stop>
      <div class="sra-card-title">复制源</div>
      <p class="sra-card-src">源「{{ copyDlg.source?.name }}」（ID {{ copyDlg.source?.sourceId }}）</p>
      <label class="sra-label">新源名称 <em>*</em></label>
      <input v-model="copyDlg.name" class="sra-input" data-testid="search-copy-name" placeholder="请输入新源名称" />
      <label class="sra-label">新源 URL</label>
      <input v-model="copyDlg.url" class="sra-input" data-testid="search-copy-url" placeholder="请输入新源 URL" />
      <p class="sra-warn">新源会归入原源的网站，并关联原源已关联的流程，与原源共用流程和配置。</p>
      <div class="sra-actions">
        <button class="rc-btn" type="button" @click="closeCopy">取消</button>
        <button
          class="rc-btn primary"
          type="button"
          data-testid="search-copy-submit"
          :disabled="!copyDlg.name.trim() || copyDlg.saving"
          @click="submitCopy"
        >{{ copyDlg.saving ? '复制中…' : '复制' }}</button>
      </div>
    </div>
  </div>

  <SnatchLauncher ref="snatchLauncher" />
  <CodeConfigButton ref="codeLauncher" :sources="codeSources" hide-trigger />
</template>

<style scoped>
.sra-menu {
  position: fixed;
  z-index: 3000;
  min-width: 132px;
  padding: 4px;
  background: #fff;
  border: 1px solid var(--rc-border);
  border-radius: 7px;
  box-shadow: 0 12px 28px -12px rgba(15, 23, 42, 0.38);
}
.sra-menu button {
  display: block;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--rc-text-2);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.sra-menu button:hover:not(:disabled) { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.sra-menu button:disabled { cursor: default; opacity: .45; }
.sra-menu button.danger { color: var(--rc-error); }
.sra-menu button.danger:hover:not(:disabled) { background: #fef2f2; color: var(--rc-error); }

.sra-backdrop { position: fixed; inset: 0; z-index: 3001; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(15, 23, 42, 0.34); }
.sra-card { box-sizing: border-box; width: min(420px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto; padding: 20px; background: #fff; border: 1px solid #dbe5f1; border-radius: 14px; box-shadow: 0 24px 64px -22px rgba(15, 23, 42, 0.45); }
.sra-card-title { margin-bottom: 14px; color: var(--rc-text); font-size: 16px; font-weight: 800; }
.sra-card-src { margin: 0 0 12px; color: var(--rc-text); font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.sra-label { display: block; margin: 0 0 6px; color: var(--rc-text-2); font-size: 12px; font-weight: 700; }
.sra-label em { color: #ef4444; font-style: normal; margin-left: 2px; }
.sra-input { box-sizing: border-box; width: 100%; height: 34px; margin-bottom: 12px; padding: 0 10px; border: 1px solid #cbd8e8; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 13px; outline: none; }
.sra-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.sra-warn { margin: 2px 0 0; padding: 7px 9px; border: 1px solid #fde68a; border-radius: 7px; background: #fffbeb; color: #92400e; font-size: 12px; line-height: 1.5; }
.sra-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--rc-border-soft); }
</style>