<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'submit', payload: Record<string, unknown>): void
}>()

const open = computed({
  get: () => props.visible,
  set: (v: boolean) => emit('update:visible', v),
})

const STEP_LABELS = ['源配置', '表配置', '登录配置', '完成']
const active = ref(0)

const form = reactive({
  name: '',
  url: '',
  snatchType: 'list',
  category: '/基金类/支付宝评论',
  cycle: '每日',
  mainTable: '',
  dedupKey: '',
  needLogin: false,
  loginUrl: '',
  account: '',
})

watch(open, (v) => {
  if (v) active.value = 0
})

function next() {
  if (active.value === 0 && (!form.name || !form.url)) {
    ElMessage.warning('请填写源名称与源 URL')
    return
  }
  if (active.value === 1 && !form.mainTable) {
    ElMessage.warning('请填写输出主表')
    return
  }
  if (active.value < 3) active.value++
}
function prev() {
  if (active.value > 0) active.value--
}
function submit() {
  emit('submit', { ...form })
  open.value = false
}
</script>

<template>
  <el-dialog v-model="open" title="新建采集源" width="720px" :close-on-click-modal="false">
    <el-steps :active="active" finish-status="success" align-center class="ca-w-steps">
      <el-step v-for="s in STEP_LABELS" :key="s" :title="s" />
    </el-steps>

    <div class="ca-w-body">
      <!-- 1 源配置 -->
      <el-form v-show="active === 0" label-width="92px" label-position="right">
        <el-form-item label="源名称" required>
          <el-input v-model="form.name" placeholder="如 600519-贵州茅台-公司公告" />
        </el-form-item>
        <el-form-item label="源 URL" required>
          <el-input v-model="form.url" placeholder="StockNotice-600519" />
        </el-form-item>
        <el-form-item label="抓取类型">
          <el-select v-model="form.snatchType" style="width: 100%">
            <el-option label="列表抓取" value="list" />
            <el-option label="详情抓取" value="detail" />
            <el-option label="文件下载" value="file" />
          </el-select>
        </el-form-item>
        <el-form-item label="源分类">
          <el-select v-model="form.category" style="width: 100%">
            <el-option label="基金类 / 支付宝评论" value="/基金类/支付宝评论" />
            <el-option label="基金类 / 天天基金" value="/基金类/天天基金" />
            <el-option label="股票类 / 公告" value="/股票类/公告" />
            <el-option label="舆情类 / 微博" value="/舆情类/微博" />
          </el-select>
        </el-form-item>
        <el-form-item label="采集周期">
          <el-select v-model="form.cycle" style="width: 100%">
            <el-option v-for="c in ['实时', '每日', '每周', '每月']" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
      </el-form>

      <!-- 2 表配置 -->
      <el-form v-show="active === 1" label-width="92px" label-position="right">
        <el-form-item label="输出主表" required>
          <el-input v-model="form.mainTable" placeholder="如 2101001 或 sense_data.TB_XXX" />
        </el-form-item>
        <el-form-item label="去重键">
          <el-input v-model="form.dedupKey" placeholder="如 feed_id" />
        </el-form-item>
        <div class="ca-w-hint">字段、预处理函数、列宽等明细在 M5 实体编辑器补齐；此处先建立主表与去重键。</div>
      </el-form>

      <!-- 3 登录配置 -->
      <el-form v-show="active === 2" label-width="92px" label-position="right">
        <el-form-item label="需要登录">
          <el-switch v-model="form.needLogin" />
        </el-form-item>
        <template v-if="form.needLogin">
          <el-form-item label="登录 URL">
            <el-input v-model="form.loginUrl" placeholder="https://..." />
          </el-form-item>
          <el-form-item label="账号">
            <el-input v-model="form.account" placeholder="登录账号（凭据只存引用，不存明文）" />
          </el-form-item>
        </template>
        <div class="ca-w-hint">凭据按 CredentialRef 只存引用、不落明文；真实接入前走鉴权代理。</div>
      </el-form>

      <!-- 4 完成 -->
      <div v-show="active === 3" class="ca-w-confirm">
        <dl class="rc-kv">
          <dt>源名称</dt><dd>{{ form.name || '—' }}</dd>
          <dt>源 URL</dt><dd>{{ form.url || '—' }}</dd>
          <dt>抓取类型</dt><dd>{{ form.snatchType }}</dd>
          <dt>源分类</dt><dd>{{ form.category }}</dd>
          <dt>采集周期</dt><dd>{{ form.cycle }}</dd>
          <dt>输出主表</dt><dd>{{ form.mainTable || '—' }}</dd>
          <dt>去重键</dt><dd>{{ form.dedupKey || '—' }}</dd>
          <dt>登录</dt><dd>{{ form.needLogin ? '需要登录' : '免登录' }}</dd>
        </dl>
        <div class="rc-mini-card">演示环境：提交后仅记录草稿，不写入真实后端。</div>
      </div>
    </div>

    <template #footer>
      <div class="ca-w-foot">
        <el-button v-if="active > 0" @click="prev">上一步</el-button>
        <el-button v-if="active < 3" type="primary" @click="next">下一步</el-button>
        <el-button v-else type="primary" @click="submit">完成创建</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.ca-w-steps {
  margin-bottom: 8px;
}
.ca-w-body {
  min-height: 240px;
  padding: 18px 8px 4px;
}
.ca-w-hint {
  margin-top: 6px;
  padding: 10px 12px;
  border: 1px solid #dbeafe;
  border-radius: var(--rc-radius-sm);
  background: #f8fbff;
  color: var(--rc-muted);
  font-size: 12px;
}
.ca-w-confirm {
  padding: 4px 8px;
}
.ca-w-confirm .rc-mini-card {
  margin-top: 16px;
}
</style>
