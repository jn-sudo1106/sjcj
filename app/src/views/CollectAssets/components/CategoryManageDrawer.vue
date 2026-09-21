<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, Search, Refresh, Folder, FolderOpened, DocumentAdd, Close, Top, Bottom } from '@element-plus/icons-vue'
import { sourceApi, categoryApi, clearCategoryCache, type SourceCategory } from '@/api'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'refresh': []
}>()

// ---- 树与检索状态 ----
const treeKey = ref(0)
const movingNodeId = ref('')
const keyword = ref('')
const searching = ref(false)
const searchTreeData = ref<SourceCategory[]>([])
const isSearching = computed(() => !!keyword.value.trim())

// 记录展开的节点 key，以便刷新或移动时不丢失展开上下文
const expandedKeySet = reactive(new Set<string>())
const expandedKeys = computed(() => Array.from(expandedKeySet))

function onNodeExpand(data: SourceCategory) {
  if (data?.id) expandedKeySet.add(String(data.id))
}

function onNodeCollapse(data: SourceCategory) {
  if (data?.id) expandedKeySet.delete(String(data.id))
}

// 缓存根分类列表以便快速计算新增权重及搜索兜底
const rootCategories = ref<SourceCategory[]>([])

function buildSearchTree(hits: SourceCategory[]): SourceCategory[] {
  if (!hits.length) return []
  const idMap = new Map<string, SourceCategory>()
  hits.forEach((item) => {
    idMap.set(String(item.id), { ...item, children: [] })
  })
  const roots: SourceCategory[] = []
  hits.forEach((item) => {
    const node = idMap.get(String(item.id))!
    const pId = item.parentId ? String(item.parentId) : ''
    if (pId && idMap.has(pId)) {
      idMap.get(pId)!.children!.push(node)
    } else {
      roots.push(node)
    }
  })
  return roots.length > 0 ? roots : hits
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  if (!keyword.value.trim()) {
    searchTreeData.value = []
    return
  }
  searchTimer = setTimeout(() => {
    void doSearch()
  }, 300)
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
    const hits = await sourceApi.searchCategories(kw)
    // 客户端兜底：如果根分类缓存中有匹配项且后端平铺结果未收录，补充进来保证体验完整
    const extraRoots: SourceCategory[] = []
    rootCategories.value.forEach((rc) => {
      if (rc.name.toLowerCase().includes(kw.toLowerCase()) && !hits.some((h) => String(h.id) === String(rc.id))) {
        extraRoots.push(rc)
      }
    })
    searchTreeData.value = buildSearchTree([...hits, ...extraRoots])
  } catch (err) {
    searchTreeData.value = []
    ElMessage.error(`搜索失败: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    searching.value = false
  }
}

const drawerVisible = ref(false)
watch(() => props.modelValue, (val) => {
  drawerVisible.value = val
  if (val) {
    handleClearSearch()
    treeKey.value++
  }
}, { immediate: true })
watch(drawerVisible, (val) => {
  emit('update:modelValue', val)
})

// 树节点懒加载
async function loadTreeNodes(node: any, resolve: (data: SourceCategory[]) => void) {
  try {
    const parentId = node.level === 0 ? undefined : String(node.data.id ?? '')
    const list = await sourceApi.sourceCategories(parentId)
    if (node.level === 0) {
      rootCategories.value = list
    }
    resolve(list)
  } catch {
    resolve([])
  }
}

// 重新加载树
function reloadTree() {
  clearCategoryCache()
  treeKey.value++
  if (isSearching.value) {
    void doSearch()
  }
}

// ---- 上移 / 下移排序逻辑 ----
function getNodeSiblings(node: any): any[] {
  if (!node || !node.parent) return []
  return node.parent.childNodes || []
}

function isFirstSibling(node: any): boolean {
  const siblings = getNodeSiblings(node)
  if (!siblings.length) return true
  return String(siblings[0]?.data?.id ?? '') === String(node?.data?.id ?? '')
}

function isLastSibling(node: any): boolean {
  const siblings = getNodeSiblings(node)
  if (!siblings.length) return true
  return String(siblings[siblings.length - 1]?.data?.id ?? '') === String(node?.data?.id ?? '')
}

async function moveNode(node: any, direction: 'up' | 'down') {
  const siblings = getNodeSiblings(node)
  const currentIndex = siblings.findIndex((n: any) => String(n.data?.id) === String(node?.data?.id))
  if (currentIndex === -1) return
  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
  if (targetIndex < 0 || targetIndex >= siblings.length) return

  const targetNode = siblings[targetIndex]
  const currentData = node.data
  const targetData = targetNode.data

  movingNodeId.value = String(currentData.id)

  try {
    const currSeq = typeof currentData.seq === 'number' ? currentData.seq : undefined
    const targetSeq = typeof targetData.seq === 'number' ? targetData.seq : undefined
    const canDirectSwap = currSeq !== undefined && targetSeq !== undefined && currSeq !== targetSeq

    if (canDirectSwap) {
      // 两个相邻节点已有互不相等的有效 seq：直接互换双方 seq
      // ⚠️ 切勿传 parentId！老平台 CategoryTree.vue:359 updateCallback 明确 delete obj.parentId
      // 传 parentId（尤其是根节点 0）会导致后端 /v1/category/update 报 500: 服务器异常
      await categoryApi.update({
        categoryId: currentData.id,
        categoryName: currentData.name,
        seq: targetSeq,
      })
      await categoryApi.update({
        categoryId: targetData.id,
        categoryName: targetData.name,
        seq: currSeq,
      })
    } else {
      // 存在重复或未赋权（如全是 0 或 undefined）：
      // 重新根据调换后的顺序由大到小阶梯赋权（老平台 column.config.js 明确定义「排序(DESC)」：数值越大越靠前）
      const reordered = [...siblings]
      reordered[currentIndex] = targetNode
      reordered[targetIndex] = node

      const total = reordered.length
      for (let idx = 0; idx < total; idx++) {
        const s = reordered[idx]
        // DESC 降序：顶端最大，向下递减
        const newSeq = (total - idx) * 10
        if (s.data.seq !== newSeq) {
          s.data.seq = newSeq
          await categoryApi.update({
            categoryId: s.data.id,
            categoryName: s.data.name,
            seq: newSeq,
          })
        }
      }
    }

    ElMessage.success(direction === 'up' ? '已上移' : '已下移')
    reloadTree()
    emit('refresh')
  } catch (err) {
    ElMessage.error(`移动失败: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    movingNodeId.value = ''
  }
}

// ---- 新建 / 编辑单个分类弹窗 ----
const editDialogVisible = ref(false)
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
  editDialogVisible.value = true
}

function openAddSub(parent: { id: string; name: string; children?: SourceCategory[] }) {
  isEdit.value = false
  form.categoryId = ''
  form.categoryName = ''
  form.parentId = parent.id
  form.parentName = `${parent.name} (#${parent.id})`
  const maxSeq = (parent.children || []).reduce((max, c) => Math.max(max, c.seq ?? 0), 0)
  form.seq = maxSeq ? maxSeq + 10 : 10
  form.remark = ''
  editDialogVisible.value = true
}

function openEdit(node: { id: string; name: string; seq?: number; remark?: string; parentId?: string }) {
  isEdit.value = true
  form.categoryId = node.id
  form.categoryName = node.name
  form.parentId = node.parentId ?? '0'
  form.parentName = node.parentId && node.parentId !== '0' ? `#${node.parentId}` : '顶级根目录'
  form.seq = node.seq ?? 0
  form.remark = node.remark ?? ''
  editDialogVisible.value = true
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
    editDialogVisible.value = false
    reloadTree()
    emit('refresh')
  } catch (err) {
    ElMessage.error(`操作失败: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    submitting.value = false
  }
}

// ---- 批量新增分类弹窗 ----
const batchDialogVisible = ref(false)
const batchParentId = ref('0')
const batchParentName = ref('顶级根目录')
const batchText = ref('')
const batchSubmitting = ref(false)

function openBatchAdd(parent?: { id: string; name: string }) {
  batchParentId.value = parent ? parent.id : '0'
  batchParentName.value = parent ? `${parent.name} (#${parent.id})` : '顶级根目录 (parentId: 0)'
  batchText.value = ''
  batchDialogVisible.value = true
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
    ElMessage.success('批量新增分类成功')
    batchDialogVisible.value = false
    reloadTree()
    emit('refresh')
  } catch (err) {
    ElMessage.error(`批量新增失败: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    batchSubmitting.value = false
  }
}

// ---- 删除分类 ----
async function handleDelete(node: { id: string; name: string }) {
  try {
    await ElMessageBox.confirm(
      `确定要删除分类「${node.name}」（ID: #${node.id}）吗？删除后其子分类可能会被级联移除，操作不可撤销。`,
      '删除确认',
      {
        type: 'warning',
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      },
    )
    await categoryApi.delete(node.id)
    ElMessage.success('分类已删除')
    reloadTree()
    emit('refresh')
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(`删除失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}
</script>

<template>
  <el-drawer
    v-model="drawerVisible"
    size="480px"
    :destroy-on-close="true"
    :show-close="false"
    class="ca-category-drawer"
  >
    <template #header>
      <div class="ca-drawer-header">
        <div class="ca-drawer-title-wrap">
          <span class="ca-drawer-indicator"></span>
          <span class="ca-drawer-title">分类管理</span>
        </div>
        <div class="ca-drawer-actions">
          <el-button type="primary" size="small" :icon="Plus" class="ca-header-btn" @click="openAddRoot">
            新增根分类
          </el-button>
          <el-button size="small" :icon="DocumentAdd" class="ca-header-btn" @click="openBatchAdd()">
            批量添加
          </el-button>
          <button type="button" class="ca-icon-btn" title="刷新分类" @click="reloadTree">
            <el-icon :size="14"><Refresh /></el-icon>
          </button>
          <button type="button" class="ca-icon-btn ca-close-btn" title="关闭" @click="drawerVisible = false">
            <el-icon :size="14"><Close /></el-icon>
          </button>
        </div>
      </div>
    </template>

    <div class="ca-drawer-content">
      <!-- 搜索栏 -->
      <div class="ca-search-bar">
        <el-input
          v-model="keyword"
          placeholder="搜索分类名称..."
          clearable
          size="default"
          :prefix-icon="Search"
          @input="onSearchInput"
          @keyup.enter="doSearch"
          @clear="handleClearSearch"
        />
      </div>

      <!-- 分类目录树容器 -->
      <div class="ca-tree-wrap">
        <!-- 搜索无匹配提示 -->
        <div v-if="isSearching && !searchTreeData.length && !searching" class="ca-empty-tip">
          无匹配分类
        </div>

        <!-- 搜索结果树（层级树形展示，包含全部节点悬浮操作） -->
        <el-tree
          v-else-if="isSearching"
          :data="searchTreeData"
          :props="{ label: 'name', children: 'children' }"
          node-key="id"
          default-expand-all
          class="ca-category-tree"
        >
          <template #default="{ node, data }">
            <div class="ca-tree-node-row">
              <div class="ca-node-info">
                <el-icon class="ca-folder-icon">
                  <FolderOpened v-if="node.expanded" />
                  <Folder v-else />
                </el-icon>
                <span class="ca-node-label" :title="data.name">{{ data.name }}</span>
                <span class="ca-node-id" title="分类 ID">#{{ data.id }}</span>
                <span v-if="data.count != null" class="ca-node-count">{{ data.count }}</span>
              </div>
              <div class="ca-node-actions">
                <el-button link type="primary" size="small" :icon="Edit" title="修改分类" @click.stop="openEdit(data)" />
                <el-button link type="success" size="small" :icon="Plus" title="添加子分类" @click.stop="openAddSub(data)" />
                <el-button link type="info" size="small" :icon="DocumentAdd" title="批量添加子级" @click.stop="openBatchAdd(data)" />
                <el-button link type="danger" size="small" :icon="Delete" title="删除分类" @click.stop="handleDelete(data)" />
              </div>
            </div>
          </template>
        </el-tree>

        <!-- 常规懒加载目录树 -->
        <el-tree
          v-else
          :key="treeKey"
          lazy
          :load="loadTreeNodes"
          :props="{ label: 'name', children: 'children', isLeaf: 'isLeaf' }"
          node-key="id"
          :default-expanded-keys="expandedKeys"
          class="ca-category-tree"
          @node-expand="onNodeExpand"
          @node-collapse="onNodeCollapse"
        >
          <template #default="{ node, data }">
            <div class="ca-tree-node-row">
              <div class="ca-node-info">
                <el-icon class="ca-folder-icon">
                  <FolderOpened v-if="node.expanded" />
                  <Folder v-else />
                </el-icon>
                <span class="ca-node-label" :title="data.name">{{ data.name }}</span>
                <span class="ca-node-id" title="分类 ID">#{{ data.id }}</span>
                <span v-if="data.count != null" class="ca-node-count">{{ data.count }}</span>
              </div>
              <div class="ca-node-actions">
                <el-button
                  link
                  type="primary"
                  size="small"
                  :icon="Top"
                  title="上移"
                  :disabled="isFirstSibling(node) || !!movingNodeId"
                  @click.stop="moveNode(node, 'up')"
                />
                <el-button
                  link
                  type="primary"
                  size="small"
                  :icon="Bottom"
                  title="下移"
                  :disabled="isLastSibling(node) || !!movingNodeId"
                  @click.stop="moveNode(node, 'down')"
                />
                <el-button link type="primary" size="small" :icon="Edit" title="修改分类" @click.stop="openEdit(data)" />
                <el-button link type="success" size="small" :icon="Plus" title="添加子分类" @click.stop="openAddSub(data)" />
                <el-button link type="info" size="small" :icon="DocumentAdd" title="批量添加子级" @click.stop="openBatchAdd(data)" />
                <el-button link type="danger" size="small" :icon="Delete" title="删除分类" @click.stop="handleDelete(data)" />
              </div>
            </div>
          </template>
        </el-tree>
      </div>

      <!-- 底部状态说明栏 -->
      <div class="ca-drawer-footer">
        <span class="ca-footer-tip">悬浮节点可快捷「↑ 上移 / ↓ 下移」、编辑、添加子级或删除</span>
        <button type="button" class="ca-footer-link" @click="openBatchAdd()">批量导入</button>
      </div>
    </div>

    <!-- 新建 / 编辑单个分类弹窗 -->
    <el-dialog
      v-model="editDialogVisible"
      :title="isEdit ? '编辑分类' : '新增分类'"
      width="420px"
      append-to-body
      destroy-on-close
    >
      <el-form label-width="85px" size="small" class="ca-dialog-form">
        <el-form-item label="所属父级">
          <el-input :model-value="form.parentName" disabled />
        </el-form-item>
        <el-form-item label="分类名称" required>
          <el-input v-model="form.categoryName" placeholder="请输入分类名称" maxlength="50" show-word-limit />
        </el-form-item>
        <el-form-item label="排序权重">
          <el-input-number v-model="form.seq" :min="0" :max="99999" controls-position="right" style="width: 100%" />
          <div class="text-[11px] text-slate-400 mt-1 leading-tight">
            权重数值越大越靠前（排序 DESC）。日常排序推荐直接在列表悬浮使用 <b>↑ 上移 / ↓ 下移</b> 快捷按钮。
          </div>
        </el-form-item>
        <el-form-item label="备注说明">
          <el-input v-model="form.remark" placeholder="可选备注说明" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="ca-dialog-footer">
          <el-button size="small" @click="editDialogVisible = false">取消</el-button>
          <el-button size="small" type="primary" :loading="submitting" @click="submitForm">
            确定保存
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 批量新增子分类弹窗 -->
    <el-dialog
      v-model="batchDialogVisible"
      title="批量新增分类"
      width="500px"
      append-to-body
      destroy-on-close
    >
      <el-form label-width="85px" size="small" class="ca-dialog-form">
        <el-form-item label="父级目录">
          <el-input :model-value="batchParentName" disabled />
        </el-form-item>
        <el-form-item label="分类列表" required>
          <div class="w-full">
            <div class="text-[11px] text-slate-400 mb-1 leading-tight">
              每行一条，使用分号 <code>;</code> 分割上下层（例如：<span class="text-blue-600 font-mono">财经媒体;主流媒体</span>）
            </div>
            <el-input
              v-model="batchText"
              type="textarea"
              :rows="7"
              placeholder="财经资讯&#10;海外社媒;Twitter&#10;海外社媒;YouTube&#10;上海发展;政务通知"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="ca-dialog-footer">
          <el-button size="small" @click="batchDialogVisible = false">取消</el-button>
          <el-button size="small" type="primary" :loading="batchSubmitting" @click="submitBatch">
            开始导入
          </el-button>
        </div>
      </template>
    </el-dialog>
  </el-drawer>
</template>

<style scoped>
/* 抽屉整体容器深度定制：填满视口高度，去除多层嵌套卡片感 */
.ca-category-drawer :deep(.el-drawer) {
  box-shadow: -4px 0 24px rgba(15, 23, 42, 0.08);
}
.ca-category-drawer :deep(.el-drawer__header) {
  margin-bottom: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--rc-border-soft, #f1f5f9);
  background: #ffffff;
}
.ca-category-drawer :deep(.el-drawer__body) {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0;
  overflow: hidden;
  background: #ffffff;
}

/* 抽屉顶部自定义 Header */
.ca-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.ca-drawer-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ca-drawer-indicator {
  width: 3px;
  height: 15px;
  background-color: var(--rc-primary, #2563eb);
  border-radius: 2px;
}
.ca-drawer-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--rc-text, #0f172a);
}
.ca-drawer-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ca-header-btn {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  border-radius: var(--rc-radius-sm, 6px);
}
.ca-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius-sm, 6px);
  background: #ffffff;
  color: var(--rc-muted, #64748b);
  cursor: pointer;
  transition: all 0.15s ease;
}
.ca-icon-btn:hover {
  border-color: var(--rc-primary, #2563eb);
  color: var(--rc-primary, #2563eb);
  background: var(--rc-primary-bg, #eff6ff);
}
.ca-close-btn:hover {
  border-color: #fca5a5;
  color: #dc2626;
  background: #fef2f2;
}

/* 抽屉内容容器：纵向撑满，单主滚动条 */
.ca-drawer-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: #ffffff;
}

/* 搜索栏：全宽紧凑 */
.ca-search-bar {
  padding: 10px 16px;
  border-bottom: 1px solid var(--rc-border-soft, #f1f5f9);
  background: #ffffff;
  flex-shrink: 0;
}
.ca-search-bar :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--rc-border, #e2e8f0) inset;
  border-radius: var(--rc-radius-sm, 6px);
  height: 32px;
}
.ca-search-bar :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px #cbd5e1 inset;
}
.ca-search-bar :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px var(--rc-primary, #2563eb) inset;
}
.ca-empty-tip {
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
  padding: 48px 0;
}

/* 树容器：全高平铺，去除浮动灰框 */
.ca-tree-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  min-height: 0;
  background: #ffffff;
}

/* 树节点样式 */
.ca-category-tree :deep(.el-tree-node__content) {
  height: 36px;
  border-radius: 6px;
  padding-right: 8px;
  margin-bottom: 2px;
  transition: background 0.15s ease;
}
.ca-category-tree :deep(.el-tree-node__content:hover) {
  background: #f1f5f9;
}
.ca-category-tree :deep(.el-tree-node__expand-icon) {
  font-size: 13px;
  color: #94a3b8;
}
.ca-category-tree :deep(.el-tree-node__expand-icon.is-leaf) {
  color: transparent;
}

/* 树形引导虚线（对齐老平台层级视觉） */
.ca-category-tree :deep(.el-tree-node__children) {
  padding-left: 14px;
  border-left: 1px dashed #e2e8f0;
  margin-left: 12px;
}

.ca-tree-node-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-width: 0;
}
.ca-node-info {
  display: flex;
  align-items: center;
  gap: 7px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.ca-folder-icon {
  color: #2563eb;
  font-size: 15px;
  flex-shrink: 0;
}
.ca-node-label {
  font-weight: 500;
  color: var(--rc-text, #0f172a);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* ID 仅在 hover 时轻量展示，平常隐藏，保持视觉纯净 */
.ca-node-id {
  font-size: 11px;
  color: #94a3b8;
  font-family: ui-monospace, SFMono-Regular, monospace;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.ca-tree-node-row:hover .ca-node-id {
  opacity: 1;
}
.ca-node-count {
  font-size: 11px;
  background: #f1f5f9;
  color: #64748b;
  padding: 0 6px;
  border-radius: 999px;
  line-height: 18px;
  font-weight: 500;
  flex-shrink: 0;
}

/* 节点操作按钮：hover 平滑展示 */
.ca-node-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  opacity: 0;
  transition: opacity 0.15s ease;
  flex-shrink: 0;
}
.ca-tree-node-row:hover .ca-node-actions {
  opacity: 1;
}
.ca-node-actions :deep(.el-button) {
  padding: 4px;
  height: 24px;
  width: 24px;
  margin-left: 0;
  border-radius: 4px;
}
.ca-node-actions :deep(.el-button:hover) {
  background: rgba(0, 0, 0, 0.05);
}

/* 底部状态/说明条 */
.ca-drawer-footer {
  height: 38px;
  padding: 0 16px;
  background: #f8fafc;
  border-top: 1px solid var(--rc-border-soft, #f1f5f9);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.ca-footer-tip {
  font-size: 11px;
  color: #94a3b8;
}
.ca-footer-link {
  border: none;
  background: transparent;
  color: var(--rc-primary, #2563eb);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  padding: 0;
}
.ca-footer-link:hover {
  text-decoration: underline;
}

.ca-dialog-form {
  padding-top: 10px;
}
.ca-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
