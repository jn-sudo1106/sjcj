<script setup lang="ts">
// 服务器代码仓库（1007）：多个仓库 + 按节点抓取类型（configType）分类。
// 节点代码首次保存时按分类进仓库，未分类进默认仓库；改分类只影响之后新建的代码，已有代码不搬动。
// 新建仓库只在服务器上初始化本地 Git 仓库，远程仓库由管理员在 Git 平台自行准备。
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { useDictStore } from '@/stores/dict'
import { runnerManagementApi, type CodeRepoRule, type CodeRepository } from '@/api/runnerManagement'

const auth = useAuthStore()
const dict = useDictStore()
const canWrite = computed(() => auth.role === 'admin')
const repos = ref<CodeRepository[]>([])
const rules = ref<CodeRepoRule[]>([])
const ruleDraft = reactive<Record<string, string>>({})
const loading = ref(false)
const error = ref('')
const savingRules = ref(false)
const busyRepoId = ref('')

const dialogOpen = ref(false)
const dialogSaving = ref(false)
const dialogError = ref('')
const editing = ref<CodeRepository | null>(null)
const form = reactive({ name: '', path: '', remoteUrl: '', branch: 'main' })

/** 字典展示串「[90] - 网页抓取」→ 编号与名称；字典里没有但已有分类的编号也要列出来，便于改回默认。 */
const configTypes = computed(() => {
  const parsed = dict.snatchTypes.flatMap((display) => {
    const match = display.match(/^\[([^\]]+)\]\s*-\s*(.+)$/)
    return match ? [{ code: match[1], name: match[2].trim() }] : []
  })
  const known = new Set(parsed.map((type) => type.code))
  const orphans = rules.value.filter((rule) => !known.has(rule.configType))
    .map((rule) => ({ code: rule.configType, name: '字典中已不存在' }))
  return [...parsed, ...orphans]
})
const typeNames = computed(() => new Map(configTypes.value.map((type) => [type.code, type.name])))
const defaultRepo = computed(() => repos.value.find((repo) => repo.isDefault))
const activeRepos = computed(() => repos.value.filter((repo) => repo.status === 'ACTIVE'))
const changedRules = computed<CodeRepoRule[]>(() => {
  const saved = new Map(rules.value.map((rule) => [rule.configType, rule.repoId]))
  return configTypes.value
    .filter((type) => (ruleDraft[type.code] ?? '') !== (saved.get(type.code) ?? ''))
    .map((type) => ({ configType: type.code, repoId: ruleDraft[type.code] ?? '' }))
})

function message(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

function resetRuleDraft() {
  for (const key of Object.keys(ruleDraft)) delete ruleDraft[key]
  for (const rule of rules.value) ruleDraft[rule.configType] = rule.repoId
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [repoList, ruleList] = await Promise.all([runnerManagementApi.codeRepositories(), runnerManagementApi.codeRepoRules()])
    repos.value = repoList
    rules.value = ruleList
    resetRuleDraft()
  } catch (e) {
    error.value = message(e)
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  Object.assign(form, { name: '', path: '', remoteUrl: '', branch: 'main' })
  dialogError.value = ''
  dialogOpen.value = true
}

function openEdit(repo: CodeRepository) {
  editing.value = repo
  Object.assign(form, { name: repo.name, path: repo.path, remoteUrl: repo.remoteUrl, branch: repo.branch })
  dialogError.value = ''
  dialogOpen.value = true
}

async function submitRepository() {
  const input = { name: form.name.trim(), path: form.path.trim(), remoteUrl: form.remoteUrl.trim(), branch: form.branch.trim() }
  if (!input.name || !input.path || !input.branch) {
    dialogError.value = '请填写仓库名称、服务器路径和分支'
    return
  }
  dialogSaving.value = true
  dialogError.value = ''
  try {
    const repo = editing.value
    if (!repo) {
      await runnerManagementApi.createCodeRepository(input)
      ElMessage.success('代码仓库已创建')
    } else {
      if (input.path !== repo.path) await runnerManagementApi.moveCodeRepository(repo.repoId, input.path)
      const changes: { name?: string; remoteUrl?: string; branch?: string } = {}
      if (input.name !== repo.name) changes.name = input.name
      if (input.remoteUrl !== repo.remoteUrl) changes.remoteUrl = input.remoteUrl
      if (input.branch !== repo.branch) changes.branch = input.branch
      if (Object.keys(changes).length) await runnerManagementApi.updateCodeRepository(repo.repoId, changes)
      ElMessage.success(changes.remoteUrl ? '仓库已保存，已有代码已推送到新的远程地址' : '仓库已保存')
    }
    dialogOpen.value = false
    await load()
  } catch (e) {
    dialogError.value = message(e)
    // 路径迁移成功、远程设置失败时，列表要反映已经生效的那一半。
    if (editing.value) await load()
  } finally {
    dialogSaving.value = false
  }
}

async function toggleStatus(repo: CodeRepository, enabled: boolean) {
  busyRepoId.value = repo.repoId
  try {
    await runnerManagementApi.updateCodeRepository(repo.repoId, { status: enabled ? 'ACTIVE' : 'DISABLED' })
    await load()
  } catch (e) {
    ElMessage.error(message(e))
  } finally {
    busyRepoId.value = ''
  }
}

async function setDefault(repo: CodeRepository) {
  busyRepoId.value = repo.repoId
  try {
    await runnerManagementApi.setDefaultCodeRepository(repo.repoId)
    ElMessage.success(`「${repo.name}」已设为默认仓库`)
    await load()
  } catch (e) {
    ElMessage.error(message(e))
  } finally {
    busyRepoId.value = ''
  }
}

async function saveRules() {
  if (!changedRules.value.length) return
  savingRules.value = true
  try {
    await runnerManagementApi.saveCodeRepoRules(changedRules.value)
    ElMessage.success('分类已保存；之后新建的节点代码按新分类进入仓库')
    await load()
  } catch (e) {
    ElMessage.error(message(e))
  } finally {
    savingRules.value = false
  }
}

onMounted(() => { void load() })
</script>

<template>
  <div class="rc-card crp-main" data-testid="settings-code-repos">
    <section class="crp-section">
      <div class="crp-head">
        <b>代码仓库</b>
        <span class="crp-note">节点代码首次保存时按配置类型进入对应仓库，未分类的类型进入默认仓库。</span>
        <button class="rc-btn" type="button" :disabled="loading" @click="load">刷新</button>
        <el-button v-if="canWrite" type="primary" size="small" data-testid="code-repo-create" @click="openCreate">新建仓库</el-button>
      </div>
      <div v-if="error" class="crp-error" role="alert">代码仓库加载失败：{{ error }}</div>
      <div v-loading="loading" class="rc-table-scroll">
        <table class="rc-data-table crp-table">
          <thead><tr><th>名称</th><th>服务器路径</th><th>Git 远程地址</th><th>分支</th><th>配置类型</th><th>代码数</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="repo in repos" :key="repo.repoId" :data-testid="`code-repo-${repo.repoId}`">
              <td>{{ repo.name }}<span v-if="repo.isDefault" class="crp-tag">默认</span></td>
              <td class="crp-ellipsis" :title="repo.path">{{ repo.path }}</td>
              <td class="crp-ellipsis" :title="repo.remoteUrl">{{ repo.remoteUrl || '仅本地' }}</td>
              <td>{{ repo.branch }}</td>
              <td class="crp-types">
                <span v-for="code in repo.configTypes" :key="code" class="crp-type" :title="typeNames.get(code)">[{{ code }}] {{ typeNames.get(code) ?? '' }}</span>
                <span v-if="repo.isDefault" class="crp-muted">及未分类的类型</span>
                <span v-else-if="!repo.configTypes.length" class="crp-muted">—</span>
              </td>
              <td>{{ repo.codeCount }}</td>
              <td>
                <span class="crp-status">
                  <el-switch
                    size="small"
                    :model-value="repo.status === 'ACTIVE'"
                    :disabled="!canWrite || repo.isDefault || busyRepoId === repo.repoId"
                    :title="repo.isDefault ? '默认仓库不能停用' : ''"
                    @change="(value: string | number | boolean) => toggleStatus(repo, Boolean(value))"
                  />
                  <span :class="repo.status === 'ACTIVE' ? 'crp-on' : 'crp-off'">{{ repo.status === 'ACTIVE' ? '启用' : '停用' }}</span>
                </span>
              </td>
              <td>
                <el-button v-if="canWrite" link type="primary" @click="openEdit(repo)">编辑</el-button>
                <el-button v-if="canWrite && !repo.isDefault && repo.status === 'ACTIVE'" link type="primary" :disabled="busyRepoId === repo.repoId" @click="setDefault(repo)">设为默认</el-button>
              </td>
            </tr>
            <tr v-if="!loading && !repos.length"><td colspan="8">{{ error ? '服务不可用' : '暂无代码仓库' }}</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="crp-section">
      <div class="crp-head">
        <b>配置类型分类</b>
        <span class="crp-note">修改只影响之后新建的节点代码；已有代码留在原仓库，后续版本也继续提交到原仓库。</span>
        <template v-if="canWrite">
          <el-button size="small" :disabled="!changedRules.length || savingRules" @click="resetRuleDraft">撤销</el-button>
          <el-button type="primary" size="small" :loading="savingRules" :disabled="!changedRules.length" data-testid="code-repo-rules-save" @click="saveRules">保存分类</el-button>
        </template>
      </div>
      <div class="crp-rules">
        <label v-for="type in configTypes" :key="type.code" class="crp-rule" :data-testid="`code-repo-rule-${type.code}`">
          <span class="crp-ellipsis" :title="`[${type.code}] ${type.name}`">[{{ type.code }}] {{ type.name }}</span>
          <el-select v-model="ruleDraft[type.code]" size="small" :disabled="!canWrite" class="crp-rule-select">
            <el-option :label="`默认仓库（${defaultRepo?.name ?? '未设置'}）`" value="" />
            <el-option v-for="repo in activeRepos" :key="repo.repoId" :label="repo.name" :value="repo.repoId" />
          </el-select>
        </label>
      </div>
    </section>

    <el-dialog v-model="dialogOpen" :title="editing ? '编辑代码仓库' : '新建代码仓库'" width="min(520px, 94vw)" append-to-body>
      <el-form label-width="96px" @submit.prevent>
        <el-form-item label="仓库名称">
          <el-input v-model="form.name" maxlength="60" placeholder="如 网页抓取代码" data-testid="code-repo-name" />
        </el-form-item>
        <el-form-item label="服务器路径">
          <el-input v-model="form.path" placeholder="服务器绝对路径，例如 E:\ce\code-web" data-testid="code-repo-path" />
          <small class="crp-hint">{{ editing ? '修改后会把仓库目录和 Git 历史移动到新路径，目标须是尚未使用的新目录。' : '填写新目录或空目录，服务器会在此初始化 Git 仓库；不能与其他仓库互相包含。' }}</small>
        </el-form-item>
        <el-form-item label="Git 远程地址">
          <el-input v-model="form.remoteUrl" placeholder="可选，如 https://git.example.com/group/code-web.git" data-testid="code-repo-remote" />
          <small class="crp-hint">远程仓库需先在 Git 平台上建好；地址里不要填写账号密码，凭据由服务器 Git 配置提供。留空表示仅保存在服务器本地。</small>
        </el-form-item>
        <el-form-item label="分支">
          <el-input v-model="form.branch" placeholder="main" data-testid="code-repo-branch" />
        </el-form-item>
      </el-form>
      <p v-if="dialogError" class="crp-error" role="alert">{{ dialogError }}</p>
      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="dialogSaving" data-testid="code-repo-submit" @click="submitRepository">{{ editing ? '保存' : '创建' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.crp-main { display: flex; flex: 1; min-height: 0; flex-direction: column; overflow: auto; }
.crp-section { padding: 14px 16px; border-bottom: 1px solid var(--rc-border); }
.crp-section:last-of-type { border-bottom: 0; }
.crp-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.crp-head b { font-size: 13px; }
.crp-note { flex: 1; min-width: 0; color: var(--rc-muted); font-size: 12px; }
.crp-table td { white-space: nowrap; }
.crp-ellipsis { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crp-tag { margin-left: 6px; padding: 1px 6px; border-radius: 4px; background: var(--rc-primary-bg); color: var(--rc-primary); font-size: 11px; }
.crp-types { white-space: normal !important; max-width: 300px; }
.crp-type { display: inline-block; margin: 0 4px 2px 0; padding: 1px 6px; border-radius: 4px; background: #f1f5f9; font-size: 11px; }
.crp-muted { color: var(--rc-muted); font-size: 12px; }
.crp-status { display: inline-flex; align-items: center; gap: 6px; }
.crp-on { color: var(--rc-primary); font-size: 12px; }
.crp-off { color: var(--rc-muted); font-size: 12px; }
.crp-rules { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 6px 16px; }
.crp-rule { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12px; }
.crp-rule > span { flex: 1; min-width: 0; }
.crp-rule-select { flex: 0 0 170px; }
.crp-hint { display: block; margin-top: 4px; color: var(--rc-muted); font-size: 12px; line-height: 1.5; }
.crp-error { margin: 0 0 8px; padding: 10px; border-radius: 6px; background: var(--rc-error-bg); color: var(--rc-error); font-size: 12px; }
</style>
