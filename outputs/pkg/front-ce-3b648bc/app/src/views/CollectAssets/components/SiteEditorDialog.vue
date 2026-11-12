<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { siteApi, sourceApi, type Site, type SourceCategory } from '@/api'
import { dirPath, loadDirChildren, searchDirs } from '@/api/sourceDirs'

/**
 * 网站基本信息弹窗：**新建与编辑共用一套表单**（2026-09-18）。
 *
 * 旧平台也是这么做的——`SiteList.vue` 的新增/编辑是同一个 `base-edit-modal`，
 * 只换标题和提交函数（`api = isAdd ? addSite : updateSite`）。共用的好处是字段口径
 * 天然一致：用户在"新建"里填的三项，就是他在"编辑"里看到的三项。
 */
const props = withDefaults(defineProps<{
  visible: boolean
  site: Site | null
  categories: SourceCategory[]
  /** 'create' = 新建网站（不带源）；缺省为编辑。 */
  mode?: 'create' | 'edit'
}>(), { mode: 'edit' })

const emit = defineEmits<{
  'update:visible': [value: boolean]
  /** 新建时带上新网站的 ID，调用方据此决定要不要跳过去 */
  'saved': [siteId?: string]
}>()

const isCreate = computed(() => props.mode === 'create')

const saving = ref(false)
const form = reactive({ siteId: '', name: '', categoryPath: '' })

// ---- 网站标签（0915-14）----
// 打标签就在这个弹窗里（2026-09-16 定），三个入口——卡片右键/⋯、表格铅笔、源侧栏右键——
// 共用它，不再单独做快捷打标弹层：网站标签是低频的属性设置，不像源标签那样要一行行随手打。
const tags = ref<string[]>([])
const tagOptions = ref<string[]>([])
const tagInput = ref('')
const tagLoading = ref(false)

async function loadTagOptions() {
  tagLoading.value = true
  try {
    tagOptions.value = await siteApi.siteTags()
  } catch {
    tagOptions.value = []   // 候选拿不到不影响手输
  } finally {
    tagLoading.value = false
  }
}

// 标签可以删光了（0918-01）。此前"只剩一个时禁删"是因为 site/update 传空串清不掉，
// 现在清空改走 site/batchChangeTags（见 api/index.ts 的 siteSetTags），限制随之拿掉。

function addTag(raw: string) {
  const name = raw.trim().replace(/^#+/, '').trim()
  if (!name || tags.value.includes(name)) { tagInput.value = ''; return }
  tags.value = [...tags.value, name]
  tagInput.value = ''
}
function removeTag(name: string) {
  tags.value = tags.value.filter((t) => t !== name)
}

// 网站的 categoryId 选择业务目录；原有网站的目录 ID 在用户未调整时保留。
const searchHits = ref<SourceCategory[]>([])
const searching = ref(false)
const searchKeyword = ref('')
const categoryError = ref('')
const categoryTreeData = computed(() => searchKeyword.value ? searchHits.value : [])

async function loadCategoryChildren(
  node: { level: number; data: SourceCategory },
  resolve: (nodes: SourceCategory[]) => void,
) {
  try {
    const nodes = await loadDirChildren('biz', node.level === 0 ? '' : node.data.id)
    categoryError.value = ''
    resolve(nodes)
  } catch (error) {
    categoryError.value = `业务目录加载失败：${error instanceof Error ? error.message : String(error)}`
    resolve([])
  }
}

let searchSeq = 0
async function searchCategory(keyword: string) {
  const wd = keyword.trim()
  const seq = ++searchSeq
  searchKeyword.value = wd
  if (!wd) {
    searchHits.value = []
    searching.value = false
    return
  }
  searching.value = true
  try {
    const hits = await searchDirs('biz', wd)
    if (seq !== searchSeq) return
    categoryError.value = ''
    const labeled = hits.map((hit) => ({ id: hit.id, name: dirPath(hit.id).join(' / ') || hit.name }))
    const seen = new Map<string, number>()
    for (const item of labeled) seen.set(item.name, (seen.get(item.name) ?? 0) + 1)
    searchHits.value = labeled.map((item) => (
      (seen.get(item.name) ?? 0) > 1 ? { ...item, name: `${item.name}（#${item.id}）` } : item
    ))
  } catch (error) {
    if (seq === searchSeq) {
      searchHits.value = []
      categoryError.value = `业务目录搜索失败：${error instanceof Error ? error.message : String(error)}`
    }
  } finally {
    if (seq === searchSeq) searching.value = false
  }
}

/**
 * 懒加载树的回显。
 *
 * 编辑一个挂在深层目录下的网站时，那层节点还没被展开加载过，el-tree-select 找不到
 * node-key 对应的节点，只能显示一个光秃秃的 ID（2026-09-18 用户报的就是这个：分类栏
 * 显示 `9009302`）。
 *
 * **不能指望 `site.categoryPath`**：它映射自后端的 `categoryName`，而 `sitePaged` 实测
 * 恒为 null（2026-09-18 生产实测两条样本都是 null）。所以打开弹窗时按 dirId 单独查一次
 * 分类拿名字。查不到就退回显示 ID——不值得为一个标签把弹窗拦下来。
 */
const categoryLabel = ref('')
const categoryCacheData = computed(() => {
  const id = form.categoryPath
  if (!id || !categoryLabel.value) return []
  // ⚠️ 字段名要跟 `node-key` 和 `:props` 走，**不是**固定的 `{ value, label }`：
  // el-tree-select 内部用 getNodeValByProp('value'|'label', node) 取值，
  // value 回退到 node-key（这里是 `id`）、label 用 props.label（这里是 `name`）。
  // 先前按文档示例写成 {value,label}，请求发了、名字也拿到了，界面上照旧显示裸 ID。
  return [{ id, name: categoryLabel.value }]
})

async function loadCategoryLabel(dirId?: string) {
  categoryLabel.value = ''
  if (!dirId) return
  // 列表里带了展示名就直接用，省一次请求（真实后端目前不给，留着兼容以后补上的情况）
  const fromList = props.site?.categoryPath
  if (fromList) {
    categoryLabel.value = fromList.split('/').filter(Boolean).join(' / ')
    return
  }
  try {
    const hit = await sourceApi.categoryById(dirId)
    if (hit?.name && form.categoryPath === dirId) categoryLabel.value = hit.name
  } catch {
    /* 查不到就显示 ID，不打断编辑 */
  }
}

function openEditor(site: Site) {
  void searchCategory('')
  categoryError.value = ''
  Object.assign(form, {
    siteId: site.siteId,
    name: site.name,
    // 读方向 site.categoryPath 是后端拼好的展示串（如 "/财经资讯/社交平台"），跟下拉选项的
    // value（categoryId）不是一套东西，直接填进去必然选不中——改用 site.dirId（真实 categoryId）。
    categoryPath: site.dirId ?? '',
  })
  tags.value = [...(site.tags ?? [])]
  tagInput.value = ''
  void loadTagOptions()
  void loadCategoryLabel(site.dirId)
  emit('update:visible', true)
}

/** 新建态：清空表单（没有 site 可读） */
function openCreator() {
  void searchCategory('')
  categoryError.value = ''
  Object.assign(form, { siteId: '', name: '', categoryPath: '' })
  tags.value = []
  tagInput.value = ''
  categoryLabel.value = ''
  void loadTagOptions()
  emit('update:visible', true)
}

/**
 * 新建网站。
 *
 * 走 `siteApi.siteCreate(site, [])`——**源数组给空**，适配层的建源循环不执行，
 * 只打一条 `site/add` 就返回（见 api/index.ts 的 siteCreate）。这正是"先建个空网站、
 * 再用批量导入往里灌源"的用法，不需要后端改任何东西。
 *
 * 标签要**建完再补一次** `site/update`：`site/add` 的入参只有 siteName / stdSiteName /
 * categoryId，不吃 tags。补写失败不算建站失败——网站已经建出来了，提示里说清楚即可。
 */
async function createSite(categoryId: string) {
  const name = form.name.trim()
  const res = await siteApi.siteCreate(
    { siteId: '', name, category: '', dirId: categoryId, owner: 'admin', sourceCount: 0, errorCount: 0, tags: [] },
    [],
  )
  if (!res?.ok) throw new Error(res?.message)
  const siteId = res.siteId
  if (tags.value.length && siteId) {
    const tagged = await siteApi.siteUpdate({ siteId, name, dirId: categoryId, tags: tags.value })
    if (!tagged?.ok) {
      ElMessage.warning(`网站「${name}」已创建，但标签未能保存（${tagged?.message || '原因未知'}），可在编辑里重试`)
      return siteId
    }
  }
  ElMessage.success(res.message || `网站「${name}」已创建`)
  return siteId
}

async function save() {
  const categoryId = form.categoryPath
  if (!form.name.trim() || !categoryId) {
    ElMessage.warning('请填写网站名称并选择业务目录')
    return
  }
  saving.value = true
  try {
    let newSiteId: string | undefined
    if (isCreate.value) {
      newSiteId = await createSite(categoryId)
    } else {
      const res = await siteApi.siteUpdate({ siteId: form.siteId, name: form.name, dirId: categoryId, tags: tags.value })
      if (!res?.ok) throw new Error(res?.message)
      ElMessage.success(res.message || '网站基本信息已保存')
    }
    emit('update:visible', false)
    emit('saved', newSiteId)
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : (isCreate.value ? '新建网站失败' : '保存网站基本信息失败'))
  } finally {
    saving.value = false
  }
}

// 父组件通过 v-if 挂载时传入 site，自动填充表单；新建态没有 site，清空表单。
watch(() => props.site, (s) => {
  if (s) openEditor(s)
  else if (isCreate.value) openCreator()
}, { immediate: true })

defineExpose({ openEditor, openCreator })
</script>

<template>
  <el-dialog :model-value="visible" class="ca-site-editor" :title="isCreate ? '新建网站' : '编辑网站基本信息'" width="520px" align-center destroy-on-close @closed="emit('update:visible', false)" @update:model-value="(v: boolean) => emit('update:visible', v)">
    <div v-if="site" class="ca-site-summary">
      <span>网站 ID：<b>{{ site.siteId }}</b></span><span>源：<b>{{ site.sourceCount }}</b></span><span>数据量：<b>{{ (site.dataCount ?? 0).toLocaleString() }} 条</b></span>
    </div>
    <el-form class="ca-site-form" label-position="top">
      <el-form-item label="网站名称" required><el-input v-model="form.name" placeholder="请输入网站名称" /></el-form-item>
      <el-form-item label="业务目录" required>
        <!-- 与查询那边同一个树选择器，只是单选（不加 multiple）。
             check-strictly：允许直接选中间层级——网站本来就可以只挂到二级目录上。 -->
        <el-tree-select
          v-model="form.categoryPath"
          placeholder="选择业务目录，可搜索或逐级展开"
          data-testid="site-biz-directory"
          style="width: 100%"
          clearable
          filterable
          remote
          :remote-method="searchCategory"
          :loading="searching"
          check-strictly
          :data="categoryTreeData"
          :cache-data="categoryCacheData"
          :props="{ label: 'name', children: 'children' }"
          node-key="id"
          :lazy="!searchKeyword"
          :load="loadCategoryChildren"
        />
        <div v-if="categoryError" class="ca-site-category-error" role="alert">{{ categoryError }}</div>
      </el-form-item>
      <el-form-item label="标签">
        <div class="ca-site-tags" data-testid="site-tag-editor">
          <span v-for="t in tags" :key="t" class="ca-site-tag">
            {{ t }}
            <i
              class="ca-site-tag-x"
              title="移除该标签"
              data-testid="site-tag-remove"
              @click="removeTag(t)"
            >×</i>
          </span>
          <el-select
            v-model="tagInput"
            class="ca-site-tag-input"
            filterable
            allow-create
            default-first-option
            :reserve-keyword="false"
            :loading="tagLoading"
            placeholder="输入或选择标签"
            data-testid="site-tag-input"
            @change="addTag"
          >
            <el-option v-for="opt in tagOptions.filter((o) => !tags.includes(o))" :key="opt" :label="opt" :value="opt" />
          </el-select>
        </div>
      </el-form-item>
    </el-form>
    <template #footer><el-button @click="emit('update:visible', false)">取消</el-button><el-button type="primary" :loading="saving" @click="save">{{ isCreate ? '创建' : '保存' }}</el-button></template>
  </el-dialog>
</template>

<style scoped>
.ca-site-summary { display: flex; gap: 14px; margin-bottom: 18px; color: var(--rc-faint); font-size: 12px; }
.ca-site-summary b { color: var(--rc-text-2); font-weight: 600; }
.ca-site-form :deep(.el-form-item) { margin-bottom: 16px; }
.ca-site-form :deep(.el-form-item__label) { padding-bottom: 5px; color: var(--rc-text-2); font-size: 12px; line-height: 1.2; }
/* 标签区：已选的做成 chips，右侧留一个可输入可选的下拉（候选来自 site/siteTags） */
.ca-site-category-error { color: var(--rc-error); font-size: 12px; line-height: 1.5; }
.ca-site-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; width: 100%; }
.ca-site-tag {
  display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 4px 0 9px;
  border: 1px solid var(--rc-border); border-radius: 12px; background: var(--rc-primary-bg);
  color: var(--rc-primary-ink); font-size: 12px;
}
.ca-site-tag-x { font-style: normal; cursor: pointer; color: var(--rc-faint); padding: 0 3px; border-radius: 50%; }
.ca-site-tag-x:hover { color: var(--rc-error); background: var(--rc-error-bg, #fee2e2); }
.ca-site-tag-input { width: 160px; }
.ca-site-form :deep(.el-input__wrapper),
.ca-site-form :deep(.el-select__wrapper) { min-height: 34px; border-radius: 6px; box-shadow: 0 0 0 1px var(--rc-border) inset; }
</style>
