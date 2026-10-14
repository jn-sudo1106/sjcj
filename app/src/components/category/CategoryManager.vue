<script setup lang="ts">
// 分类目录维护（0924-03）：树 + 检索 + 增删改 + 上下移 + 批量添加。
// 原来是采集资产「全部分类」下拉底部唤起的抽屉（CategoryManageDrawer，2026-09-21），
// 0924 会上认为"放在查询页面有点奇怪"，迁到「系统设置 → 分类目录」整页展示，逻辑原样搬过来。
// 改完分类后采集资产那边的分类树缓存由 clearCategoryCache 清掉，切回去时静默重拉即可看到。
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, Search, Refresh, Folder, FolderOpened, DocumentAdd, Top, Bottom } from '@element-plus/icons-vue'
import { sourceApi, categoryApi, clearCategoryCache, type SourceCategory } from '@/api'

const emit = defineEmits<{
  /** 分类有增删改 / 排序变化，调用方需要刷新自己手里的分类数据时监听 */
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

/**
 * 全量目录树（1014）：el-tree 懒加载模式下未展开过的节点一律显示展开箭头，
 * 叶子节点（没有子目录）也被当成"可能有子级"，用户看着以为能展开。分类总量实测 159 个、
 * 最深 4 层，前端 BFS 一次性拉全成本可接受（同 expandCategoryIds 的口径），
 * 用**非懒加载** el-tree 渲染——el-tree 按 children 自动判断叶子，无子目录的节点不显示箭头。
 */
const fullTreeData = ref<SourceCategory[]>([])
async function loadFullTree() {
  try {
    const roots = await sourceApi.sourceCategories(undefined)
    rootCategories.value = roots
    // BFS 逐层拉子级，组装 children（并行度对齐 expandCategoryIds 的 8 路）
    const CONCURRENCY = 8
    let frontier = [...roots]
    for (let depth = 0; frontier.length && depth < 8; depth++) {
      const next: SourceCategory[] = []
      for (let i = 0; i < frontier.length; i += CONCURRENCY) {
        const batch = frontier.slice(i, i + CONCURRENCY)
        const childrenLists = await Promise.all(
          batch.map((parent) => sourceApi.sourceCategories(String(parent.id)).catch(() => [] as SourceCategory[])),
        )
        batch.forEach((parent, idx) => {
          parent.children = childrenLists[idx] ?? []
          next.push(...childrenLists[idx])
        })
      }
      frontier = next
    }
    fullTreeData.value = roots
  } catch {
    fullTreeData.value = []
  }
}

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

// 重新加载树
function reloadTree() {
  clearCategoryCache()
  treeKey.value++
  if (isSearching.value) {
    void doSearch()
  } else {
    // 非懒加载后刷新要重拉全量树（原懒加载树靠 el-tree 内部重挂载触发）
    void loadFullTree()
  }
}

onMounted(() => {
  void loadFullTree()
})

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
  <section class="cm-root">
    <!-- 顶部单行操作栏：查询与操作按钮在同一排，消除上层冗余的「分类目录」标题栏 -->
    <div class="ca-toolbar">
      <div class="ca-toolbar-left">
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
        <span v-if="!isSearching" class="ca-count-hint">共 {{ rootCategories.length }} 个一级分类</span>
        <span v-else class="ca-count-hint">搜索结果（按层级展示）</span>
      </div>

      <div class="ca-toolbar-actions">
        <el-button type="primary" size="small" :icon="Plus" class="ca-header-btn" @click="openAddRoot">
          新增根分类
        </el-button>
        <el-button size="small" :icon="DocumentAdd" class="ca-header-btn" @click="openBatchAdd()">
          批量添加
        </el-button>
        <el-tooltip content="刷新分类" placement="top" :show-after="120">
          <button type="button" class="ca-icon-btn" aria-label="刷新分类" @click="reloadTree">
            <el-icon :size="14"><Refresh /></el-icon>
          </button>
        </el-tooltip>
      </div>
    </div>

    <!-- 树形表格表头：列对齐，彻底消除通栏拉伸视线割裂 -->
    <div class="ca-table-head">
      <div class="ca-col ca-col-name">分类名称</div>
      <div class="ca-col ca-col-id">分类 ID</div>
      <div class="ca-col ca-col-seq">排序</div>
      <div class="ca-col ca-col-actions">操作</div>
    </div>

    <!-- 分类目录树容器 -->
    <div class="ca-tree-wrap">
      <!-- 搜索无匹配提示 -->
      <div v-if="isSearching && !searchTreeData.length && !searching" class="ca-empty-tip">
        无匹配分类
      </div>

      <!-- 搜索结果树（层级树形展示） -->
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
            <div class="ca-col ca-col-name">
              <el-icon class="ca-folder-icon">
                <FolderOpened v-if="node.expanded" />
                <Folder v-else />
              </el-icon>
              <span class="ca-node-label" :title="data.name">{{ data.name }}</span>
              <span v-if="data.count != null" class="ca-node-count">{{ data.count }}</span>
            </div>
            <div class="ca-col ca-col-id">#{{ data.id }}</div>
            <div class="ca-col ca-col-seq">{{ data.seq ?? '—' }}</div>
            <div class="ca-col ca-col-actions">
              <div class="ca-node-actions">
                <el-tooltip content="修改分类" placement="top" :show-after="120">
                  <el-button
                    link
                    type="primary"
                    size="small"
                    :icon="Edit"
                    aria-label="修改分类"
                    @click.stop="openEdit(data)"
                  />
                </el-tooltip>
                <el-tooltip content="添加子分类" placement="top" :show-after="120">
                  <el-button
                    link
                    type="success"
                    size="small"
                    :icon="Plus"
                    aria-label="添加子分类"
                    @click.stop="openAddSub(data)"
                  />
                </el-tooltip>
                <el-tooltip content="批量添加子级" placement="top" :show-after="120">
                  <el-button
                    link
                    type="info"
                    size="small"
                    :icon="DocumentAdd"
                    aria-label="批量添加子级"
                    @click.stop="openBatchAdd(data)"
                  />
                </el-tooltip>
                <el-tooltip content="删除分类" placement="top" :show-after="120">
                  <el-button
                    link
                    type="danger"
                    size="small"
                    :icon="Delete"
                    aria-label="删除分类"
                    @click.stop="handleDelete(data)"
                  />
                </el-tooltip>
              </div>
            </div>
          </div>
        </template>
      </el-tree>

      <!-- 常规目录树（1014 改非懒加载：全量预加载，el-tree 按 children 判叶子，无子目录不显示展开箭头） -->
      <el-tree
        v-else
        :key="treeKey"
        :data="fullTreeData"
        :props="{ label: 'name', children: 'children' }"
        node-key="id"
        :default-expanded-keys="expandedKeys"
        class="ca-category-tree"
        @node-expand="onNodeExpand"
        @node-collapse="onNodeCollapse"
      >
        <template #default="{ node, data }">
          <div class="ca-tree-node-row">
            <div class="ca-col ca-col-name">
              <el-icon class="ca-folder-icon">
                <FolderOpened v-if="node.expanded" />
                <Folder v-else />
              </el-icon>
              <span class="ca-node-label" :title="data.name">{{ data.name }}</span>
              <span v-if="data.count != null" class="ca-node-count">{{ data.count }}</span>
            </div>
            <div class="ca-col ca-col-id">#{{ data.id }}</div>
            <div class="ca-col ca-col-seq">{{ data.seq ?? '—' }}</div>
            <div class="ca-col ca-col-actions">
              <div class="ca-node-actions">
                <el-tooltip :content="isFirstSibling(node) ? '已在最顶部' : '上移'" placement="top" :show-after="120">
                  <span class="ca-btn-wrap">
                    <el-button
                      link
                      type="primary"
                      size="small"
                      :icon="Top"
                      aria-label="上移"
                      :disabled="isFirstSibling(node) || !!movingNodeId"
                      @click.stop="moveNode(node, 'up')"
                    />
                  </span>
                </el-tooltip>
                <el-tooltip :content="isLastSibling(node) ? '已在最底部' : '下移'" placement="top" :show-after="120">
                  <span class="ca-btn-wrap">
                    <el-button
                      link
                      type="primary"
                      size="small"
                      :icon="Bottom"
                      aria-label="下移"
                      :disabled="isLastSibling(node) || !!movingNodeId"
                      @click.stop="moveNode(node, 'down')"
                    />
                  </span>
                </el-tooltip>
                <el-tooltip content="修改分类" placement="top" :show-after="120">
                  <el-button
                    link
                    type="primary"
                    size="small"
                    :icon="Edit"
                    aria-label="修改分类"
                    @click.stop="openEdit(data)"
                  />
                </el-tooltip>
                <el-tooltip content="添加子分类" placement="top" :show-after="120">
                  <el-button
                    link
                    type="success"
                    size="small"
                    :icon="Plus"
                    aria-label="添加子分类"
                    @click.stop="openAddSub(data)"
                  />
                </el-tooltip>
                <el-tooltip content="批量添加子级" placement="top" :show-after="120">
                  <el-button
                    link
                    type="info"
                    size="small"
                    :icon="DocumentAdd"
                    aria-label="批量添加子级"
                    @click.stop="openBatchAdd(data)"
                  />
                </el-tooltip>
                <el-tooltip content="删除分类" placement="top" :show-after="120">
                  <el-button
                    link
                    type="danger"
                    size="small"
                    :icon="Delete"
                    aria-label="删除分类"
                    @click.stop="handleDelete(data)"
                  />
                </el-tooltip>
              </div>
            </div>
          </div>
        </template>
      </el-tree>
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
            权重数值越大越靠前（排序 DESC）。日常排序推荐直接在列表中使用 <b>↑ 上移 / ↓ 下移</b> 快捷按钮。
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
  </section>
</template>

<style scoped>
/* 整页容器：占满父级高度，只有树区域一个滚动条（滚动容器约定） */
.cm-root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: #ffffff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
}
/* 顶部统一单行工具栏：查询与操作按钮在同一排展示 */
.ca-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--rc-border-soft, #f1f5f9);
  background: #ffffff;
  flex-shrink: 0;
  gap: 12px;
}

.ca-toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.ca-search-bar {
  width: 260px;
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

.ca-count-hint {
  font-size: 12px;
  color: var(--rc-muted, #64748b);
  white-space: nowrap;
}

.ca-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.ca-header-btn {
  height: 32px;
  padding: 0 12px;
  font-size: 12px;
  border-radius: var(--rc-radius-sm, 6px);
}

.ca-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
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
.ca-empty-tip {
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
  padding: 48px 0;
}

/* 树形表格表头：统一对齐列宽，消除视线割裂 */
.ca-table-head {
  display: flex;
  align-items: center;
  height: 36px;
  background: #f8fafc;
  border-bottom: 1px solid var(--rc-border, #e2e8f0);
  padding: 0 24px 0 40px;
  font-size: 12px;
  font-weight: 600;
  color: var(--rc-muted, #64748b);
  flex-shrink: 0;
  user-select: none;
}

/* 树容器：全高平铺，单主滚动条 */
.ca-tree-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 4px 16px;
  min-height: 0;
  background: #ffffff;
}

/* 树节点样式：整行树形表格化呈现 */
.ca-category-tree :deep(.el-tree-node__content) {
  height: 38px;
  border-bottom: 1px solid #f8fafc;
  padding-right: 8px;
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

/* 树行内容（列布局） */
.ca-tree-node-row {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
}

/* 各列定义：表头与行内容共享 */
.ca-col-name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.ca-col-id {
  width: 130px;
  flex-shrink: 0;
  font-size: 12px;
  color: #94a3b8;
  font-family: ui-monospace, SFMono-Regular, monospace;
}

.ca-col-seq {
  width: 80px;
  flex-shrink: 0;
  text-align: center;
  font-size: 12px;
  color: #64748b;
}

.ca-col-actions {
  width: 190px;
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
}

/* 节点操作按钮：现有轻量彩色图标按钮（默认各色，无边框，hover 加微底色） */
.ca-node-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  opacity: 0.95;
  transition: opacity 0.15s ease;
}
.ca-tree-node-row:hover .ca-node-actions {
  opacity: 1;
}

.ca-btn-wrap {
  display: inline-flex;
  align-items: center;
}

.ca-node-actions :deep(.el-button) {
  padding: 4px;
  height: 24px;
  width: 24px;
  margin: 0;
  border-radius: 4px;
  border: none;
  font-size: 14px;
}

.ca-node-actions :deep(.el-button--primary.is-link) {
  color: var(--rc-primary, #2563eb);
}

.ca-node-actions :deep(.el-button--success.is-link) {
  color: var(--rc-ok, #16a34a);
}

.ca-node-actions :deep(.el-button--info.is-link) {
  color: #94a3b8;
}

.ca-node-actions :deep(.el-button--danger.is-link) {
  color: var(--rc-error, #ef4444);
}

.ca-node-actions :deep(.el-button:not(.is-disabled):hover) {
  background: rgba(0, 0, 0, 0.05);
}

.ca-node-actions :deep(.el-button.is-disabled) {
  cursor: not-allowed;
  opacity: 0.35;
  color: #cbd5e1 !important;
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
