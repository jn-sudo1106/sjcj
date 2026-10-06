<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type SiteCodeVersion } from '@/api/runnerManagement'

type CatalogRow = SiteCodeVersion & { environments: ('test' | 'prd')[] }
const auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin')
const rows = ref<CatalogRow[]>([])
const keyword = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const detail = ref<(SiteCodeVersion & { code: string }) | null>(null)
const detailOpen = ref(false)
const publishOpen = ref(false)
const selectedVersion = ref<CatalogRow | null>(null)
const publishEnvironment = ref<'test' | 'prd'>('test')
const repositoryPath = ref('')
const repositoryDraft = ref('')
const repositoryError = ref('')
const savingRepository = ref(false)
const gitRemote = ref('')
const gitRemoteDraft = ref('')
const gitBranch = ref('main')
const gitBranchDraft = ref('main')
const gitError = ref('')
const savingGit = ref(false)
const filtered = computed(() => rows.value.filter((row) =>
  [row.configId, row.queueName, row.siteHost, row.deliveryPath, row.scriptDigest]
    .some((value) => value.toLowerCase().includes(keyword.value.trim().toLowerCase())),
))

async function load() {
  loading.value = true
  error.value = ''
  try {
    rows.value = await runnerManagementApi.siteCodeCatalog()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function loadRepository() {
  repositoryError.value = ''
  try {
    const setting = await runnerManagementApi.siteCodeRepository()
    repositoryPath.value = setting.path
    repositoryDraft.value = setting.path
    gitRemote.value = setting.remoteUrl || ''
    gitRemoteDraft.value = setting.remoteUrl || ''
    gitBranch.value = setting.branch || 'main'
    gitBranchDraft.value = setting.branch || 'main'
  } catch (e) {
    repositoryError.value = e instanceof Error ? e.message : String(e)
  }
}

async function saveGit() {
  const remoteUrl = gitRemoteDraft.value.trim()
  const branch = gitBranchDraft.value.trim()
  if (!branch || (remoteUrl === gitRemote.value && branch === gitBranch.value)) return
  savingGit.value = true
  gitError.value = ''
  try {
    const setting = await runnerManagementApi.updateSiteCodeGit(remoteUrl, branch)
    gitRemote.value = setting.remoteUrl
    gitRemoteDraft.value = setting.remoteUrl
    gitBranch.value = setting.branch
    gitBranchDraft.value = setting.branch
    ElMessage.success(remoteUrl ? 'Git 地址已保存，现有代码已推送' : '已取消 Git 远程推送')
    await load()
  } catch (e) {
    gitError.value = e instanceof Error ? e.message : String(e)
  } finally {
    savingGit.value = false
  }
}

async function saveRepository() {
  const path = repositoryDraft.value.trim()
  if (!path || path === repositoryPath.value) return
  savingRepository.value = true
  repositoryError.value = ''
  try {
    const setting = await runnerManagementApi.updateSiteCodeRepository(path)
    repositoryPath.value = setting.path
    repositoryDraft.value = setting.path
    ElMessage.success('代码仓库路径已更新，已有代码和 Git 历史已迁移')
    await load()
  } catch (e) {
    repositoryError.value = e instanceof Error ? e.message : String(e)
  } finally {
    savingRepository.value = false
  }
}

function absoluteCodePath(relative: string) {
  if (!repositoryPath.value) return relative
  const separator = repositoryPath.value.includes('\\') ? '\\' : '/'
  return `${repositoryPath.value.replace(/[\\/]$/, '')}${separator}${relative.replaceAll('/', separator)}`
}

async function showDetail(row: CatalogRow) {
  try {
    detail.value = await runnerManagementApi.siteCodeContent(row.scriptDigest)
    detailOpen.value = true
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
}

function openPublish(row: CatalogRow) {
  selectedVersion.value = row
  publishEnvironment.value = 'test'
  publishOpen.value = true
}

async function publishConfiguration() {
  const row = selectedVersion.value
  if (!row) return
  saving.value = true
  try {
    await runnerManagementApi.bindSiteCode({
      configId: row.configId, queueName: row.queueName,
      environment: publishEnvironment.value, scriptDigest: row.scriptDigest,
    })
    publishOpen.value = false
    ElMessage.success(`运行配置已发布到${publishEnvironment.value === 'test' ? '测试' : '生产'}环境`)
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  } finally {
    saving.value = false
  }
}

onMounted(() => { void Promise.all([load(), loadRepository()]) })
</script>

<template>
  <div class="rc-card scm-main" data-testid="settings-site-code">
    <div class="scm-repository">
      <b>服务器代码仓库路径</b>
      <div class="scm-repository-row">
        <el-input v-model="repositoryDraft" :disabled="!canWrite || savingRepository || !repositoryPath" placeholder="服务器绝对路径，例如 E:\ce\site-scripts" data-testid="site-code-repository-path" />
        <el-button v-if="canWrite" type="primary" :loading="savingRepository" :disabled="!repositoryPath || !repositoryDraft.trim() || repositoryDraft.trim() === repositoryPath" data-testid="site-code-repository-save" @click="saveRepository">保存路径</el-button>
      </div>
      <small>保存后会移动现有代码仓库和 Git 历史；目标应是服务器上尚未使用的新目录。</small>
      <span v-if="repositoryError" class="scm-error" role="alert">路径设置失败：{{ repositoryError }}</span>
      <b>Git 远程地址</b>
      <div class="scm-repository-row">
        <el-input v-model="gitRemoteDraft" :disabled="!canWrite || savingGit || !repositoryPath" placeholder="https://git.example.com/group/site-scripts.git" data-testid="site-code-git-url" />
        <el-input v-model="gitBranchDraft" :disabled="!canWrite || savingGit || !repositoryPath" class="scm-branch" placeholder="分支，如 main" data-testid="site-code-git-branch" />
        <el-button v-if="canWrite" type="primary" :loading="savingGit" :disabled="!repositoryPath || !gitBranchDraft.trim() || (gitRemoteDraft.trim() === gitRemote && gitBranchDraft.trim() === gitBranch)" data-testid="site-code-git-save" @click="saveGit">保存 Git 配置</el-button>
      </div>
      <small>配置后会推送现有及后续代码。服务器需预先配置 Git 凭据或 SSH 密钥；地址中不要填写账号密码。留空地址可停用远程推送。</small>
      <span v-if="gitError" class="scm-error" role="alert">Git 设置失败：{{ gitError }}</span>
    </div>
    <div class="rc-toolbar wrap">
      <el-input v-model="keyword" clearable placeholder="ConfigId、队列、网站或版本" style="width: 270px" />
      <button class="rc-btn" type="button" :disabled="loading" @click="load">刷新</button>
      <span class="scm-note">代码版本共用；发布运行配置时再选择测试或生产。</span>
    </div>
    <div v-if="error" class="scm-error" role="alert">代码列表加载失败：{{ error }}</div>
    <div v-loading="loading" class="rc-table-scroll scm-table">
      <table class="rc-data-table">
        <thead><tr><th>ConfigId</th><th>队列</th><th>代码用途</th><th>下发文件</th><th>Git 提交</th><th>版本摘要</th><th>采用环境</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="row in filtered" :key="row.scriptDigest">
            <td>{{ row.configId }}</td><td>{{ row.queueName }}</td>
            <td>{{ row.siteHost || '队列通用' }}</td><td>{{ row.deliveryPath }}</td>
            <td :title="row.gitCommit">{{ row.gitCommit.slice(0, 12) }}</td>
            <td :title="row.scriptDigest">{{ row.scriptDigest.slice(0, 16) }}</td>
            <td>{{ row.environments.map((env) => env === 'test' ? '测试' : '生产').join('、') || '未采用' }}</td>
            <td>
              <el-button link type="primary" @click="showDetail(row)">详情</el-button>
              <el-button v-if="canWrite" link type="primary" :disabled="saving" @click="openPublish(row)">发布配置</el-button>
            </td>
          </tr>
          <tr v-if="!loading && !filtered.length"><td colspan="8">{{ error ? '服务不可用' : '暂无代码版本' }}</td></tr>
        </tbody>
      </table>
    </div>
    <el-drawer v-model="detailOpen" :title="detail ? `节点代码 · ${detail.deliveryPath}` : '节点代码'" size="min(640px, 94vw)">
      <template v-if="detail">
        <dl class="scm-detail">
          <dt>ConfigId</dt><dd>{{ detail.configId }}</dd>
          <dt>队列</dt><dd>{{ detail.queueName }}</dd>
          <dt>服务器文件路径</dt><dd>{{ absoluteCodePath(detail.storagePath) }}</dd>
          <dt>Git 地址</dt><dd>{{ detail.gitUrl }}</dd>
          <dt>Runner 下发路径</dt><dd>{{ detail.deliveryPath }}</dd>
          <dt>Git 提交</dt><dd>{{ detail.gitCommit }}</dd>
          <dt>摘要</dt><dd>{{ detail.scriptDigest }}</dd>
          <dt>生成提示词</dt><dd>{{ detail.prompt || '—' }}</dd>
          <dt>来源 URL</dt><dd>{{ detail.url || '—' }}</dd>
        </dl>
        <pre class="scm-code">{{ detail.code }}</pre>
      </template>
    </el-drawer>
    <el-dialog v-model="publishOpen" title="发布节点代码运行配置" width="min(500px, 94vw)" append-to-body>
      <template v-if="selectedVersion">
        <p>节点 #{{ selectedVersion.configId }} · 队列 {{ selectedVersion.queueName }}</p>
        <p>{{ selectedVersion.deliveryPath }} · {{ selectedVersion.scriptDigest.slice(0, 20) }}</p>
        <el-form label-width="90px">
          <el-form-item label="运行环境">
            <el-select v-model="publishEnvironment" style="width: 100%" data-testid="code-publish-environment">
              <el-option label="测试" value="test" /><el-option label="生产" value="prd" />
            </el-select>
          </el-form-item>
        </el-form>
      </template>
      <template #footer><el-button @click="publishOpen = false">取消</el-button><el-button type="primary" :loading="saving" data-testid="code-publish-confirm" @click="publishConfiguration">发布</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.scm-main { display: flex; flex: 1; min-height: 0; flex-direction: column; }
.scm-repository { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--rc-border, #e5e7eb); }
.scm-repository b { font-size: 13px; }
.scm-repository-row { display: flex; gap: 8px; align-items: center; }
.scm-repository-row .el-input { flex: 1; min-width: 0; }
.scm-repository-row .scm-branch { flex: 0 0 150px; }
.scm-repository small { color: var(--rc-muted); }
.scm-table { flex: 1; min-height: 0; overflow: auto; }
.scm-table td { white-space: nowrap; }
.scm-note { margin-left: auto; color: var(--rc-muted); font-size: 12px; }
.scm-error { margin: 0 12px 8px; padding: 10px; border-radius: 6px; background: #fef2f2; color: #b91c1c; font-size: 12px; }
.scm-detail { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 8px; font-size: 12px; }
.scm-detail dt { color: var(--rc-muted); }
.scm-detail dd { margin: 0; overflow-wrap: anywhere; }
.scm-code { padding: 12px; border-radius: 6px; background: #f8fafc; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
</style>
