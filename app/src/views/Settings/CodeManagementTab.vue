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
const repoFilter = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const detail = ref<(SiteCodeVersion & { code: string }) | null>(null)
const detailOpen = ref(false)
const publishOpen = ref(false)
const selectedVersion = ref<CatalogRow | null>(null)
const publishEnvironment = ref<'test' | 'prd'>('test')
// 仓库的路径、Git 远程和配置类型分类在「系统设置 → 代码仓库」维护；这里只按代码所属仓库展示和筛选。
const repoOptions = computed(() => [...new Map(rows.value
  .filter((row) => row.repoId)
  .map((row) => [row.repoId!, row.repoName || row.repoId!])).entries()])
const filtered = computed(() => rows.value.filter((row) =>
  (!repoFilter.value || row.repoId === repoFilter.value)
  && [row.configId, row.queueName, row.siteHost, row.deliveryPath, row.scriptDigest, row.repoName ?? '']
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

function absoluteCodePath(repoPath: string | null | undefined, relative: string) {
  if (!repoPath) return relative
  const separator = repoPath.includes('\\') ? '\\' : '/'
  return `${repoPath.replace(/[\\/]$/, '')}${separator}${relative.replaceAll('/', separator)}`
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

onMounted(() => { void load() })
</script>

<template>
  <div class="rc-card scm-main" data-testid="settings-site-code">
    <div class="rc-toolbar wrap">
      <el-input v-model="keyword" clearable placeholder="ConfigId、队列、网站、仓库或版本" style="width: 270px" />
      <el-select v-model="repoFilter" clearable placeholder="全部仓库" style="width: 180px" data-testid="site-code-repo-filter">
        <el-option v-for="[id, name] in repoOptions" :key="id" :label="name" :value="id" />
      </el-select>
      <button class="rc-btn" type="button" :disabled="loading" @click="load">刷新</button>
      <span class="scm-note">代码版本共用；发布运行配置时再选择测试或生产。代码仓库在「代码仓库」页维护。</span>
    </div>
    <div v-if="error" class="scm-error" role="alert">代码列表加载失败：{{ error }}</div>
    <div v-loading="loading" class="rc-table-scroll scm-table">
      <table class="rc-data-table">
        <thead><tr><th>ConfigId</th><th>仓库</th><th>队列</th><th>代码用途</th><th>下发文件</th><th>Git 提交</th><th>版本摘要</th><th>采用环境</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="row in filtered" :key="row.scriptDigest">
            <td>{{ row.configId }}</td><td>{{ row.repoName || '—' }}</td><td>{{ row.queueName }}</td>
            <td>{{ row.siteHost || '队列通用' }}</td><td>{{ row.deliveryPath }}</td>
            <td :title="row.gitCommit">{{ row.gitCommit.slice(0, 12) }}</td>
            <td :title="row.scriptDigest">{{ row.scriptDigest.slice(0, 16) }}</td>
            <td>{{ row.environments.map((env) => env === 'test' ? '测试' : '生产').join('、') || '未采用' }}</td>
            <td>
              <el-button link type="primary" @click="showDetail(row)">详情</el-button>
              <el-button v-if="canWrite" link type="primary" :disabled="saving" @click="openPublish(row)">发布配置</el-button>
            </td>
          </tr>
          <tr v-if="!loading && !filtered.length"><td colspan="9">{{ error ? '服务不可用' : '暂无代码版本' }}</td></tr>
        </tbody>
      </table>
    </div>
    <el-drawer v-model="detailOpen" :title="detail ? `节点代码 · ${detail.deliveryPath}` : '节点代码'" size="min(640px, 94vw)">
      <template v-if="detail">
        <dl class="scm-detail">
          <dt>ConfigId</dt><dd>{{ detail.configId }}</dd>
          <dt>队列</dt><dd>{{ detail.queueName }}</dd>
          <dt>代码仓库</dt><dd>{{ detail.repoName || '—' }}</dd>
          <dt>服务器文件路径</dt><dd>{{ absoluteCodePath(detail.repoPath, detail.storagePath) }}</dd>
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
.scm-table { flex: 1; min-height: 0; overflow: auto; }
.scm-table td { white-space: nowrap; }
.scm-note { margin-left: auto; color: var(--rc-muted); font-size: 12px; }
.scm-error { margin: 0 12px 8px; padding: 10px; border-radius: 6px; background: #fef2f2; color: #b91c1c; font-size: 12px; }
.scm-detail { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 8px; font-size: 12px; }
.scm-detail dt { color: var(--rc-muted); }
.scm-detail dd { margin: 0; overflow-wrap: anywhere; }
.scm-code { padding: 12px; border-radius: 6px; background: #f8fafc; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
</style>
