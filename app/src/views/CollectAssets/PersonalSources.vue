<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { useUiStore } from '@/stores/ui'
import { useSourceGroupsStore, type SourceGroup } from '@/stores/sourceGroups'
import type { Source } from '@/api'
import SourceOverviewView from '@/views/FlowCanvas/result/SourceOverviewView.vue'
import GroupSourcePicker from './GroupSourcePicker.vue'
import GroupAssignmentDialog from './GroupAssignmentDialog.vue'
import { recordSiteVisit } from '@/utils/siteRecents'
import { trackClick } from '@/utils/logEvents'
const groups = useSourceGroupsStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const selected = computed(() => groups.groups.find(g => g.id === route.query.group))
const picker = ref(false)
const editor = ref(false)
const editingId = ref<string>()
const name = ref('')
const parentId = ref('')
const moving = ref(false)
const movingIds = ref<string[]>([])
const parentOptions = computed(() => groups.groups.filter(g => !g.parentId && g.id !== editingId.value))
watch(() => selected.value?.id, () => { picker.value = false; moving.value = false })
function select(id: string) { void router.replace({ path: '/collect', query: { tab: 'personal', group: id } }) }
function edit(group?: SourceGroup) {
  editingId.value = group?.id
  name.value = group?.name ?? ''
  parentId.value = group?.parentId ?? ''
  editor.value = true
}
function save() {
  try {
    const id = groups.saveGroup(name.value, parentId.value, editingId.value)
    editor.value = false
    select(id)
  } catch (e) { ElMessage.error(e instanceof Error ? e.message : '本机保存失败') }
}
async function removeGroup() {
  const group = selected.value
  if (!group) return
  try {
    await ElMessageBox.confirm(`删除「${group.name}」及其子分组？只删除个人分组关系，源和源数据会保留。`, '删除源分组', { type: 'warning', confirmButtonText: '删除分组', cancelButtonText: '取消' })
    groups.deleteGroup(group.id)
    void router.replace({ path: '/collect', query: { tab: 'personal' } })
  } catch (e) { if (e instanceof Error) ElMessage.error(e.message) }
}
async function remove(ids: string[]) {
  const group = selected.value
  if (!group) return
  try {
    await ElMessageBox.confirm(`从「${group.name}」移除这 ${ids.length} 个源？源本身和其他分组关系会保留。`, '移出分组', { confirmButtonText: '移出', cancelButtonText: '取消' })
    groups.removeMembers(group.id, ids)
  } catch (e) { if (e instanceof Error) ElMessage.error(e.message) }
}
function move(ids: string[]) { movingIds.value = [...ids]; moving.value = true }
function openSource(source: Source, view: 'overview' | 'data' = 'overview') {
  // 与 SourceGroupTab 同口径：从源进去也算打开了这个网站，并给源记一条 CLICK
  if (source.siteId && source.siteId !== '0') recordSiteVisit(source.siteId, source.siteName)
  trackClick('SOURCE', source.sourceId, source.name, {
    eventCode: 'source_open',
    eventName: '打开源',
    firstModule: '采集资产',
    pageName: '我的分组',
  })
  void router.push({ path: '/canvas', query: { sourceId: source.sourceId, ...(source.siteId && source.siteId !== '0' ? { siteId: source.siteId } : {}), view, returnTo: route.fullPath } })
}
</script>
<template>
  <div class="personal-sources">
    <aside class="group-nav">
      <div class="group-heading"><strong>我的源分组</strong><el-button size="small" :disabled="!groups.account" @click="edit()">新建分组</el-button></div>
      <div class="group-list">
        <button v-for="g in groups.options" :key="g.id" type="button" class="group-item" :class="{ active: selected?.id === g.id, child: g.parentId }" @click="select(g.id)"><span>{{ g.name }}</span><small>{{ g.sourceIds.length }}</small></button>
      </div>
      <p class="group-note">分组仅保存于当前账号、当前浏览器，不跨设备同步。一个源可加入多个分组。</p>
    </aside>
    <section class="group-content">
      <template v-if="selected">
        <div class="group-toolbar">
          <strong>{{ selected.name }}</strong><span class="group-note">仅当前分组直接关联的源</span>
          <div class="group-actions">
            <el-button size="small" @click="picker = true">添加源</el-button>
            <el-button size="small" @click="edit(selected)">编辑分组</el-button>
            <el-button size="small" type="danger" plain @click="removeGroup">删除分组</el-button>
            <el-button :icon="Refresh" size="small" circle title="刷新源列表" aria-label="刷新源列表" @click="ui.notifySourceListChanged()" />
          </div>
        </div>
        <SourceOverviewView :key="selected.id" current-site-id="" :scope-source-ids="selected.sourceIds" scope-empty-text="分组中还没有源，请点击「添加源」" @open-source="openSource" @open-source-data="openSource($event, 'data')" @open-site="router.push({ path: '/canvas', query: { siteId: $event, view: 'source', returnTo: route.fullPath } })">
          <template #selection-actions="{ ids }"><el-button size="small" @click="move(ids)">移动到分组</el-button><el-button size="small" @click="remove(ids)">移出分组</el-button></template>
        </SourceOverviewView>
      </template>
      <el-empty v-else :description="groups.groups.length ? '请选择一个分组查看源' : '尚未创建个人分组，可新建宏观组、地产组等'" />
    </section>
    <el-dialog v-model="editor" :title="editingId ? '编辑源分组' : '新建源分组'" width="480px" style="max-width: calc(100vw - 32px)" append-to-body>
      <el-form label-width="80px" @submit.prevent="save"><el-form-item label="分组名称"><el-input v-model="name" maxlength="40" show-word-limit placeholder="例如：宏观组、地产组" @keyup.enter="save" /></el-form-item><el-form-item label="上级分组"><el-select v-model="parentId" style="width: 100%"><el-option label="无（一级分组）" value="" /><el-option v-for="g in parentOptions" :key="g.id" :label="g.name" :value="g.id" /></el-select></el-form-item></el-form>
      <template #footer><el-button @click="editor = false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
    </el-dialog>
    <GroupSourcePicker v-if="selected" v-model="picker" :group-id="selected.id" />
    <GroupAssignmentDialog v-if="selected" v-model="moving" :source-ids="movingIds" :from-group="selected.id" />
  </div>
</template>
<style scoped>
.personal-sources { display: flex; flex: 1; min-height: 0; gap: 12px; }
.group-nav { width: 210px; flex-shrink: 0; display: flex; flex-direction: column; padding: 12px; border: 1px solid var(--rc-border-soft); border-radius: 10px; background: #fff; }
.group-heading, .group-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.group-heading { justify-content: space-between; font-size: 13px; }
.group-list { flex: 1; min-height: 0; overflow-y: auto; margin-top: 12px; }
.group-item { display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; padding: 9px 10px; border: 0; border-radius: 6px; background: transparent; color: var(--rc-text); cursor: pointer; text-align: left; }
.group-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group-item.child { padding-left: 26px; }
.group-item:hover { background: #f1f5f9; }
.group-item.active { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.group-note { font-size: 12px; color: var(--rc-muted); line-height: 1.6; }
.group-content { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.group-toolbar { padding: 10px 12px; background: #fff; border: 1px solid var(--rc-border-soft); border-radius: 8px; margin-bottom: 8px; font-size: 13px; }
.group-actions { display: flex; margin-left: auto; }
.group-content :deep(.sov-filter.is-compact) { flex-wrap: wrap; }
.group-content :deep(.sov-filter.is-compact label),
.group-content :deep(.sov-filter.is-compact .sov-field) { flex: 0 0 auto; }
@media (max-width: 1100px) { .group-nav { width: 170px; } }
@media (max-width: 700px) { .personal-sources { flex-direction: column; } .group-nav { width: auto; } .group-list { max-height: 140px; flex: auto; } }
</style>
