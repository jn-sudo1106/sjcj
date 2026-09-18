<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { siteApi, sourceApi, type Site, type SourceCategory } from '@/api'

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

/**
 * 能不能删这个标签。
 *
 * **只剩一个时不能删**：后端把空串当作"未提供"跳过（2026-09-16 实测，旧平台删最后一个
 * 标签同样失败、界面却提示成功），清到零个做不到。与其让人删完保存、刷新发现还在，
 * 不如当场禁掉并说明。后端支持空串清空后，去掉这个判断即可。
 */
// 新建态不受这个限制：标签还没落过库，删的只是本地草稿。
const canRemoveTag = computed(() => isCreate.value || tags.value.length > 1)
const removeHint = computed(() => (canRemoveTag.value ? '移除该标签' : '后端暂不支持清空全部标签，至少保留一个'))

function addTag(raw: string) {
  const name = raw.trim().replace(/^#+/, '').trim()
  if (!name || tags.value.includes(name)) { tagInput.value = ''; return }
  tags.value = [...tags.value, name]
  tagInput.value = ''
}
function removeTag(name: string) {
  if (!canRemoveTag.value) return
  tags.value = tags.value.filter((t) => t !== name)
}

// form.categoryPath 存的其实是选中项的 categoryId（字段名是历史遗留，实际内容是 id
// 不是斜杠路径）。
//
// 2026-09-18：原来是把「根 + 一层子级」拍平成 `父 / 子` 的 el-select，**只有两级**——
// 而真实目录是三级往上（财经资讯 / 财经媒体 / 中央级媒体）。三级以下的目录在这里
// 根本选不到，用户只能先挑个二级再进详情改。改成与查询那边同一个 el-tree-select
// （懒加载子级），区别只是这里**单选**。
async function loadCategoryChildren(
  node: { level: number; data: SourceCategory },
  resolve: (nodes: SourceCategory[]) => void,
) {
  if (node.level === 0) {
    resolve(props.categories)
    return
  }
  if (node.data.children?.length) {
    resolve(node.data.children)
    return
  }
  try {
    resolve(await sourceApi.sourceCategories(node.data.id))
  } catch {
    resolve([])   // 取不到子级不影响选当前这级
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
    ElMessage.warning('请填写网站名称和分类')
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
      <el-form-item label="所属分类" required>
        <!-- 与查询那边同一个树选择器，只是单选（不加 multiple）。
             check-strictly：允许直接选中间层级——网站本来就可以只挂到二级目录上。 -->
        <el-tree-select
          v-model="form.categoryPath"
          placeholder="请选择分类"
          style="width: 100%"
          clearable
          filterable
          check-strictly
          :data="categories"
          :cache-data="categoryCacheData"
          :props="{ label: 'name', children: 'children' }"
          node-key="id"
          lazy
          :load="loadCategoryChildren"
        />
      </el-form-item>
      <el-form-item label="标签">
        <div class="ca-site-tags" data-testid="site-tag-editor">
          <span v-for="t in tags" :key="t" class="ca-site-tag">
            {{ t }}
            <i
              class="ca-site-tag-x"
              :class="{ disabled: !canRemoveTag }"
              :title="removeHint"
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
.ca-site-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; width: 100%; }
.ca-site-tag {
  display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 4px 0 9px;
  border: 1px solid var(--rc-border); border-radius: 12px; background: var(--rc-primary-bg);
  color: var(--rc-primary-ink); font-size: 12px;
}
.ca-site-tag-x { font-style: normal; cursor: pointer; color: var(--rc-faint); padding: 0 3px; border-radius: 50%; }
.ca-site-tag-x:hover { color: var(--rc-error); background: var(--rc-error-bg, #fee2e2); }
.ca-site-tag-x.disabled { cursor: not-allowed; opacity: 0.35; }
.ca-site-tag-x.disabled:hover { color: var(--rc-faint); background: transparent; }
.ca-site-tag-input { width: 160px; }
.ca-site-form :deep(.el-input__wrapper),
.ca-site-form :deep(.el-select__wrapper) { min-height: 34px; border-radius: 6px; box-shadow: 0 0 0 1px var(--rc-border) inset; }
</style>
