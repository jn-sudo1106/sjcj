<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { siteApi, type Site, type SourceCategory } from '@/api'

const props = defineProps<{
  visible: boolean
  site: Site | null
  categories: SourceCategory[]
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'saved': []
}>()

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
const canRemoveTag = computed(() => tags.value.length > 1)
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

// categoryPath 存的其实是选中项的 categoryId（见下方 el-option :value="option.path"，
// path 字段名是历史遗留，实际内容是 id 不是斜杠路径）。
const siteCategoryOptions = computed(() => props.categories.flatMap((group) => [
  { path: group.id, label: group.name },
  ...(group.children ?? []).map((child) => ({ path: child.id, label: `${group.name} / ${child.name}` })),
]))

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
  emit('update:visible', true)
}

async function save() {
  const categoryId = form.categoryPath
  if (!form.name.trim() || !categoryId) {
    ElMessage.warning('请填写网站名称和分类')
    return
  }
  saving.value = true
  try {
    const res = await siteApi.siteUpdate({ siteId: form.siteId, name: form.name, dirId: categoryId, tags: tags.value })
    if (!res?.ok) throw new Error(res?.message)
    ElMessage.success(res.message || '网站基本信息已保存')
    emit('update:visible', false)
    emit('saved')
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : '保存网站基本信息失败')
  } finally {
    saving.value = false
  }
}

// 父组件通过 v-if 挂载时传入 site，自动填充表单
watch(() => props.site, (s) => { if (s) openEditor(s) }, { immediate: true })

defineExpose({ openEditor })
</script>

<template>
  <el-dialog :model-value="visible" class="ca-site-editor" title="编辑网站基本信息" width="520px" align-center destroy-on-close @closed="emit('update:visible', false)" @update:model-value="(v: boolean) => emit('update:visible', v)">
    <div v-if="site" class="ca-site-summary">
      <span>网站 ID：<b>{{ site.siteId }}</b></span><span>源：<b>{{ site.sourceCount }}</b></span><span>数据量：<b>{{ (site.dataCount ?? 0).toLocaleString() }} 条</b></span>
    </div>
    <el-form class="ca-site-form" label-position="top">
      <el-form-item label="网站名称" required><el-input v-model="form.name" placeholder="请输入网站名称" /></el-form-item>
      <el-form-item label="所属分类" required>
        <el-select v-model="form.categoryPath" filterable placeholder="请选择分类" style="width: 100%"><el-option v-for="option in siteCategoryOptions" :key="option.path" :label="option.label" :value="option.path" /></el-select>
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
    <template #footer><el-button @click="emit('update:visible', false)">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
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
