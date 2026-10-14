<script setup lang="ts">
// 源列表选择弹窗内的「分类树」——1:1 迁移旧平台
//   data-view/src/page/config/modules/CategoryTree.vue
//
// 旧形态（AntDV）：`编辑分类 / 退出编辑` 开关 + `搜索分类` + `「+」新增根节点` +
//   节点「…」菜单（新增子节点 / 新增根节点 / 详情 / 编辑 / 批量增加子节点 / 删除）+
//   复选多选筛选 + 拖拽排序；默认 `check`（可勾选）、`read=false`（可编辑）。
//
// 新形态：Element Plus `el-tree` 复刻同一套交互。增删改不新造接口，统一走本项目既有
//   `categoryApi`（与 `components/category/CategoryManager.vue` 同源，已内置红线保护：
//   update **不带 parentId**，否则后端 500）。
//
// 对外只暴露一个语义：分类筛选变化 → `emit('filter', ids)`；返回空数组表示「全部」。
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Plus, Edit, Delete, Search, More, Refresh, DocumentAdd, InfoFilled, CirclePlus, Folder, FolderOpened,
} from '@element-plus/icons-vue'
import { sourceApi, categoryApi, clearCategoryCache, type SourceCategory } from '@/api'

const props = withDefaults(
  defineProps<{
    /** 是否显示复选框做多选筛选（旧 CategoryTree `check` prop，默认 true） */
    checkable?: boolean
    /** 只读：隐藏「编辑分类」与节点「…」操作（旧 CategoryTree `read` prop） */
    read?: boolean
  }>(),
  { checkable: true, read: false },
)

const emit = defineEmits<{
  /** 分类筛选变化：返回当前勾选/选中的分类 ID 列表（空数组 = 全部） */
  filter: [ids: string[]]
}>()

// ---- 树数据与懒加载 ----
const treeKey = ref(0)
const treeRef = ref()
const rootCategories = ref<SourceCategory[]>([])
const expandedKeySet = reactive(new Set<string>())
const expandedKeys = computed(() => Array.from(expandedKeySet))

async function loadTreeNodes(node: { level: number; data: SourceCategory }, resolve: (data: SourceCategory[]) => void) {
  try {
    if (node.level === 0) {
      const roots = await sourceApi.sourceCategories()
      rootCategories.value = roots
      resolve(roots)
      return
    }
    resolve(await sourceApi.sourceCategories(String(node.data?.id ?? '')))
  } catch {
    resolve([])
  }
}

/** 重建整棵树（清缓存 + 重新挂载懒加载树；搜索态下重跑检索） */
function reloadTree() {
  clearCategoryCache()
  treeKey.value++
  selectedIds.value = []
  emit('filter', [])
  if (isSearching.value) void doSearch()
}

function onNodeExpand(data: SourceCategory) {
  if (data?.id) expandedKeySet.add(String(data.id))
}
function onNodeCollapse(data: SourceCategory) {
  if (data?.id) expandedKeySet.delete(String(data.id))
}

// ---- 搜索分类（旧 CategoryTree.handleQuery → categoryQuery） ----
const keyword = ref('')
const searching = ref(false)
const searchTreeData = ref<SourceCategory[]>([])
const isSearching = computed(() => !!keyword.value.trim())

/** 命中结果是**平铺**的，按 parentId 装回层级树（父节点不在命中集里的当根节点） */
function buildSearchTree(hits: (SourceCategory & { path?: string })[]): SourceCategory[] {
  if (!hits.length) return []
  const idMap = new Map<string, SourceCategory>()
  hits.forEach((item) => idMap.set(String(item.id), { ...item, children: [] }))
  const roots: SourceCategory[] = []
  hits.forEach((item) => {
    const node = idMap.get(String(item.id))!
    const pId = item.parentId ? String(item.parentId) : ''
    if (pId && idMap.has(pId)) idMap.get(pId)!.children!.push(node)
    else roots.push(node)
  })
  return roots.length ? roots : hits
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  if (!keyword.value.trim()) {
    searchTreeData.value = []
    return
  }
  searchTimer = setTimeout(() => void doSearch(), 300)
}
function handleClearSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  keyword.value = ''
  searchTreeData.value = []
}
async function doSearch() {
  const kw = keyword.value.trim()
  if (!kw) {
    searchTreeData.value = []
    return
  }
  searching.value = true
  try {
    searchTreeData.value = buildSearchTree(await sourceApi.searchCategories(kw))
  } catch (err) {
    searchTreeData.value = []
    ElMessage.error(`搜索失败: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    searching.value = false
  }
}

// ---- 筛选：复选（多）+ 点节点名（单） ----
const selectedIds = ref<string[]>([])
function emitFilter(ids: string[]) {
  // 去重：node-click 的 setCheckedKeys 会同时触发 check 事件，避免重复请求
  if (ids.join(',') === selectedIds.value.join(',')) return
  selectedIds.value = ids
  emit('filter', ids)
}
function onCheck() {
  emitFilter(((treeRef.value?.getCheckedKeys?.() ?? []) as string[]).map(String))
}
/** 旧 treeNodeClick：点节点名把勾选收敛为「仅该节点」（单选下钻） */
function onNodeClick(data: SourceCategory) {
  const ids = data?.id ? [String(data.id)] : []
  if (!props.checkable) {
    emitFilter(ids)
    return
  }
  treeRef.value?.setCheckedKeys?.(ids)
  emitFilter(ids)
}
/** 清空勾选 → 全部 */
function clearSelection() {
  treeRef.value?.setCheckedKeys?.([])
  emitFilter([])
}

// ---- 编辑开关 ----
const editing = ref(false)

// ---- 新增 / 编辑单个分类 ----
const formVisible = ref(false)
const isEdit = ref(false)
const submitting = ref(false)
const form = reactive({
  categoryId: '',
  categoryName: '',
  parentId: '0',
  parentName: '顶级目录',
  seq: 0,
  remark: '',
})

function openAddRoot() {
  isEdit.value = false
  form.categoryId = ''
  form.categoryName = ''
  form.parentId = '0'
  form.parentName = '顶级根目录 (parentId: 0)'
  const maxSeq = rootCategories.value.reduce((max, c) => Math.max(max, c.seq ?? 0), 0)
  form.seq = maxSeq ? maxSeq + 10 : 10
  form.remark = ''
  formVisible.value = true
}
function openAddSub(parent: SourceCategory) {
  isEdit.value = false
  form.categoryId = ''
  form.categoryName = ''
  form.parentId = String(parent.id)
  form.parentName = `${parent.name} (#${parent.id})`
  const maxSeq = (parent.children ?? []).reduce((max, c) => Math.max(max, c.seq ?? 0), 0)
  form.seq = maxSeq ? maxSeq + 10 : 10
  form.remark = ''
  formVisible.value = true
}
function openEdit(node: SourceCategory) {
  isEdit.value = true
  form.categoryId = String(node.id)
  form.categoryName = node.name
  form.parentId = node.parentId ? String(node.parentId) : '0'
  form.parentName = node.parentId && String(node.parentId) !== '0' ? `#${node.parentId}` : '顶级根目录'
  form.seq = node.seq ?? 0
  form.remark = node.remark ?? ''
  formVisible.value = true
}
async function submitForm() {
  const name = form.categoryName.trim()
  if (!name) {
    ElMessage.warning('请输入分类名称')
    return
  }
  submitting.value = true
  try {
    if (isEdit.value) {
      // 红线：update 绝不带 parentId（旧 CategoryTree.updateCallback 明确 delete parentId）
      await categoryApi.update({
        categoryId: form.categoryId,
        categoryName: name,
        seq: Number(form.seq) || 0,
        remark: form.remark.trim() || undefined,
      })
      ElMessage.success('分类修改成功')
    } else {
      await categoryApi.add({
        categoryName: name,
        parentId: form.parentId,
        seq: Number(form.seq) || 0,
        remark: form.remark.trim() || undefined,
      })
      ElMessage.success('分类新增成功')
    }
    formVisible.value = false
    reloadTree()
  } catch (err) {
    ElMessage.error(`操作失败: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    submitting.value = false
  }
}

// ---- 详情（右侧 el-drawer，对齐 2026-08-11 详情弹层约定） ----
const detailVisible = ref(false)
const detailRow = ref<SourceCategory | null>(null)
function openDetail(node: SourceCategory) {
  detailRow.value = node
  detailVisible.value = true
}

// ---- 批量增加子节点 ----
const batchVisible = ref(false)
const batchParentId = ref('0')
const batchParentName = ref('顶级根目录')
const batchText = ref('')
const batchSubmitting = ref(false)
function openBatchAdd(parent: SourceCategory) {
  batchParentId.value = String(parent.id)
  batchParentName.value = `${parent.name} (#${parent.id})`
  batchText.value = ''
  batchVisible.value = true
}
async function submitBatch() {
  const txt = batchText.value.trim()
  if (!txt) {
    ElMessage.warning('请输入要批量添加的分类')
    return
  }
  batchSubmitting.value = true
  try {
    await categoryApi.addBatch(batchParentId.value, txt)
    ElMessage.success('批量增加成功')
    batchVisible.value = false
    reloadTree()
  } catch (err) {
    ElMessage.error(`批量增加失败: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    batchSubmitting.value = false
  }
}

// ---- 删除 ----
async function handleDelete(node: SourceCategory) {
  try {
    await ElMessageBox.confirm(
      `是否确认删除，目录ID:${node.id}，目录名:${node.name}`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '放弃', confirmButtonClass: 'el-button--danger' },
    )
  } catch {
    return
  }
  try {
    await categoryApi.delete(String(node.id))
    ElMessage.success('删除成功')
    reloadTree()
  } catch (err) {
    ElMessage.error(`删除失败,错误信息:${err instanceof Error ? err.message : String(err)}`)
  }
}

// ---- 节点「…」菜单路由 ----
function onNodeCommand(cmd: string, node: SourceCategory) {
  if (cmd === 'addSub') openAddSub(node)
  else if (cmd === 'addRoot') openAddRoot()
  else if (cmd === 'detail') openDetail(node)
  else if (cmd === 'edit') openEdit(node)
  else if (cmd === 'addBatch') openBatchAdd(node)
  else if (cmd === 'delete') void handleDelete(node)
}

// ---- 拖拽排序（旧 CategoryTree.onDrop → updateCategory） ----
async function onNodeDrop(dragNode: any, dropNode: any, dropType: string) {
  const draggingId = String(dragNode?.data?.id ?? '')
  if (!draggingId) return

  let parentId = ''
  if (dropType === 'inner') {
    parentId = String(dropNode?.data?.id ?? '')
  } else {
    const parent = dropNode?.parent
    parentId = parent && parent.data && parent.data.id ? String(parent.data.id) : '0'
  }

  if (!parentId || parentId === '0') {
    // 拖到根级：parentId=0 会让后端 500（见 categoryApi.update 红线），不支持，回滚
    ElMessage.warning('暂不支持拖拽到根级，请用「编辑」调整父级')
    reloadTree()
    return
  }

  try {
    if (dropType === 'inner') {
      await categoryApi.update({ categoryId: draggingId, categoryName: dragNode.data.name, parentId })
    } else {
      // 同父级内重排：按调换后的顺序重算排序权重（DESC：数值越大越靠前）
      const siblings = (dropNode?.parent?.childNodes ?? []).map((n: any) => n.data) as SourceCategory[]
      const total = siblings.length
      for (let idx = 0; idx < total; idx++) {
        const s = siblings[idx]
        const newSeq = (total - idx) * 10
        if (s.seq !== newSeq) {
          await categoryApi.update({ categoryId: String(s.id), categoryName: s.name, seq: newSeq })
        }
      }
    }
    ElMessage.success('拖动节点更新成功')
  } catch (err) {
    ElMessage.error(`拖动节点更新失败: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    reloadTree()
  }
}

const hasChecked = computed(() => selectedIds.value.length > 0)

defineExpose({ clearSelection, reloadTree })
</script>

<template>
  <div class="sct-root">
    <!-- 工具条：编辑开关（左）+ 新增根节点（编辑态）+ 刷新（右） -->
    <div class="sct-toolbar">
      <div class="sct-toolbar-left">
        <button
          v-if="!read"
          type="button"
          class="sct-edit-toggle"
          :class="{ active: editing }"
          @click="editing = !editing"
        >
          {{ editing ? '退出编辑' : '编辑分类' }}
        </button>
        <el-dropdown v-if="editing && !read" trigger="click" @command="openAddRoot">
          <button type="button" class="sct-add-btn" title="新增根节点" aria-label="新增根节点">
            <el-icon><Plus /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="addRoot">新增根节点</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
      <button type="button" class="sct-refresh" title="刷新" aria-label="刷新分类" @click="reloadTree">
        <el-icon><Refresh /></el-icon>
      </button>
    </div>

    <el-input
      v-model="keyword"
      class="sct-search"
      placeholder="搜索分类"
      clearable
      :prefix-icon="Search"
      @input="onSearchInput"
      @clear="handleClearSearch"
      @keyup.enter="doSearch"
    />

    <div class="sct-tree-wrap">
      <button
        v-if="!isSearching"
        type="button"
        class="sct-all"
        :class="{ active: !hasChecked }"
        @click="clearSelection"
      >
        全部
      </button>

      <div v-if="isSearching && !searchTreeData.length && !searching" class="sct-empty">无匹配分类</div>

      <!-- 搜索结果（层级树形展示，不再懒加载） -->
      <el-tree
        v-else-if="isSearching"
        ref="treeRef"
        class="sct-tree"
        :data="searchTreeData"
        :props="{ label: 'name', children: 'children' }"
        node-key="id"
        default-expand-all
        :show-checkbox="checkable"
        :check-strictly="true"
        @check="onCheck"
        @node-click="onNodeClick"
      >
        <template #default="{ data }">
          <div class="sct-node">
            <span class="sct-node-name" :title="data.name">{{ data.name }}</span>
            <span v-if="data.count != null" class="sct-node-count">{{ data.count }}</span>
          </div>
        </template>
      </el-tree>

      <!-- 常规懒加载分类树 -->
      <el-tree
        v-else
        ref="treeRef"
        :key="treeKey"
        class="sct-tree"
        lazy
        :load="loadTreeNodes"
        :props="{ label: 'name', children: 'children', isLeaf: 'isLeaf' }"
        node-key="id"
        :default-expanded-keys="expandedKeys"
        :show-checkbox="checkable"
        :check-strictly="true"
        highlight-current
        :draggable="editing && !read"
        :expand-on-click-node="true"
        @node-expand="onNodeExpand"
        @node-collapse="onNodeCollapse"
        @check="onCheck"
        @node-click="onNodeClick"
        @node-drop="onNodeDrop"
      >
        <template #default="{ node, data }">
          <div class="sct-node" :class="{ 'is-editing': editing && !read }">
            <el-icon class="sct-node-icon"><FolderOpened v-if="node.expanded" /><Folder v-else /></el-icon>
            <span class="sct-node-name" :title="data.name">{{ data.name }}</span>
            <span v-if="data.count != null" class="sct-node-count">{{ data.count }}</span>
            <el-dropdown
              v-if="editing && !read"
              trigger="click"
              class="sct-node-more"
              @command="(cmd: string) => onNodeCommand(cmd, data)"
            >
              <el-icon class="sct-more-icon" title="更多" @click.stop><More /></el-icon>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="addSub"><el-icon><Plus /></el-icon>新增子节点</el-dropdown-item>
                  <el-dropdown-item command="addRoot"><el-icon><CirclePlus /></el-icon>新增根节点</el-dropdown-item>
                  <el-dropdown-item command="detail"><el-icon><InfoFilled /></el-icon>详情</el-dropdown-item>
                  <el-dropdown-item command="edit"><el-icon><Edit /></el-icon>编辑</el-dropdown-item>
                  <el-dropdown-item command="addBatch"><el-icon><DocumentAdd /></el-icon>批量增加子节点</el-dropdown-item>
                  <el-dropdown-item command="delete" divided><el-icon><Delete /></el-icon>删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </template>
      </el-tree>
    </div>

    <!-- 新增 / 编辑单个分类 -->
    <el-dialog
      v-model="formVisible"
      :title="isEdit ? '目录编辑' : '新增目录'"
      width="420px"
      append-to-body
      destroy-on-close
    >
      <el-form label-width="80px" size="small" class="sct-form">
        <el-form-item label="父目录">
          <el-input :model-value="form.parentName" disabled />
        </el-form-item>
        <el-form-item label="目录名" required>
          <el-input v-model="form.categoryName" placeholder="请输入目录名" maxlength="50" show-word-limit />
        </el-form-item>
        <el-form-item label="排序(DESC)">
          <el-input-number v-model="form.seq" :min="0" :max="99999" controls-position="right" style="width: 100%" />
          <div class="sct-form-tip">数值越大越靠前（排序 DESC）。</div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" placeholder="可选备注" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="formVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="submitting" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>

    <!-- 批量增加子节点 -->
    <el-dialog v-model="batchVisible" title="批量增加目录" width="520px" append-to-body destroy-on-close>
      <el-form label-width="80px" size="small" class="sct-form">
        <el-form-item label="父目录ID">
          <el-input :model-value="batchParentName" disabled />
        </el-form-item>
        <el-form-item label="目录列表" required>
          <el-input
            v-model="batchText"
            type="textarea"
            :rows="12"
            placeholder="按行批量，以分割符 ; 分割上下层   例: 目录1;子目录2"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="batchVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="batchSubmitting" @click="submitBatch">开始导入</el-button>
      </template>
    </el-dialog>

    <!-- 目录详情（右侧抽屉） -->
    <el-drawer v-model="detailVisible" title="目录详情" size="360px" append-to-body destroy-on-close>
      <el-descriptions v-if="detailRow" :column="1" border size="small">
        <el-descriptions-item label="目录ID">{{ detailRow.id }}</el-descriptions-item>
        <el-descriptions-item label="目录名">{{ detailRow.name }}</el-descriptions-item>
        <el-descriptions-item label="父目录">{{ detailRow.parentId || '0' }}</el-descriptions-item>
        <el-descriptions-item label="排序(DESC)">{{ detailRow.seq ?? '—' }}</el-descriptions-item>
        <el-descriptions-item label="备注">{{ detailRow.remark || '—' }}</el-descriptions-item>
      </el-descriptions>
    </el-drawer>
  </div>
</template>

<style scoped>
.sct-root {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.sct-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.sct-toolbar-left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sct-edit-toggle {
  padding: 5px 10px;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius-sm, 6px);
  background: #fff;
  color: var(--rc-text-2, #334155);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.sct-edit-toggle:hover {
  border-color: #bfdbfe;
  color: var(--rc-primary-ink, #1d4ed8);
  background: var(--rc-primary-bg, #eff6ff);
}
.sct-edit-toggle.active {
  border-color: #bfdbfe;
  background: var(--rc-primary-bg, #eff6ff);
  color: var(--rc-primary-ink, #1d4ed8);
  font-weight: 700;
}
.sct-add-btn,
.sct-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius-sm, 6px);
  background: #fff;
  color: var(--rc-text-2, #334155);
  cursor: pointer;
}
.sct-add-btn:hover,
.sct-refresh:hover {
  border-color: #bfdbfe;
  background: var(--rc-primary-bg, #eff6ff);
  color: var(--rc-primary-ink, #1d4ed8);
}
.sct-search {
  margin-bottom: 6px;
}
.sct-tree-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}
.sct-all {
  display: block;
  width: 100%;
  min-height: 32px;
  margin-bottom: 2px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--rc-primary-ink, #1d4ed8);
  text-align: left;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.sct-all.active,
.sct-all:hover {
  background: var(--rc-primary-soft, #eff6ff);
}
.sct-tree {
  background: transparent;
}
.sct-tree :deep(.el-tree-node__content) {
  height: 32px;
  margin: 1px 0;
  border-radius: 6px;
  color: var(--rc-text-2, #334155);
  font-size: 13px;
}
.sct-tree :deep(.el-tree-node__content:hover) {
  background: var(--rc-primary-soft, #eff6ff);
}
.sct-node {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  padding-right: 6px;
}
.sct-node-icon {
  flex: none;
  color: var(--rc-muted, #94a3b8);
  font-size: 14px;
}
.sct-node-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sct-node-count {
  flex: none;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.sct-node-more {
  margin-left: auto;
  flex: none;
}
.sct-more-icon {
  color: var(--rc-muted, #94a3b8);
  cursor: pointer;
  font-size: 15px;
  padding: 2px;
  border-radius: 4px;
}
.sct-more-icon:hover {
  color: var(--rc-primary-ink, #1d4ed8);
  background: #fff;
}
.sct-empty {
  padding: 20px 10px;
  text-align: center;
  color: var(--rc-muted, #94a3b8);
  font-size: 12px;
}
.sct-form {
  padding-top: 6px;
}
.sct-form-tip {
  margin-top: 4px;
  color: var(--rc-muted, #94a3b8);
  font-size: 11px;
  line-height: 1.3;
}
</style>
