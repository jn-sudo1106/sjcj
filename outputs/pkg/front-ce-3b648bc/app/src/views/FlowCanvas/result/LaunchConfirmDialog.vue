<script setup lang="ts">
import { computed } from 'vue'
import { LAUNCH_BATCH_SIZE } from './useSourceLaunch'

/**
 * 源视图「发任务」的统一确认弹窗（0831 X2-5）。
 * 勾选 / 按条件全量两条路共用这一块。
 * 文案对齐旧平台的一句话确认（「是否确定要发送抓取任务，本次[ N ]条?」），
 * 只在**确实需要**时才多说：勾选数与发送数对不上时说明跳过了什么，真的会分批时才提回滚。
 *
 * ⚠️ 这里**不放登陆策略**（2026-09-17 移除）。它在旧平台属于参数弹窗 `SourceParam.vue`，
 * 跟「所有参数」`all`、指定队列 `queue` 同一层——只有参数源填参数时才需要做这个决定。
 * 批量发抓取那条路（旧 `SourceList.sendBatch`）压根不传 `skip`：
 *   `sendWithParamsCallback(this.selectedRowKeys, {})`  // 后面的 all/include/skip/queue 全是 undefined
 * 0831 做这个弹窗时把它提了上来，等于给一个本来不需要做决定的操作凭空加了个选项，
 * 三个单选摆在那儿还会让人以为批量发抓取得先想清楚登陆怎么处理。参数源仍走 SourceParamModal，
 * 那里该有的登陆策略照旧。
 */

const props = defineProps<{
  mode: 'selected' | 'query'
  hitCount: number
  sendCount: number
  disabledCount: number
  paramCount: number
  paramNames: string[]
  filterText: string
  sending?: boolean
}>()

const emit = defineEmits<{
  confirm: []
  close: []
}>()

/** 勾选数与实际发送数对不上时，才需要解释少掉的那些 */
const skipped = computed(() => props.disabledCount > 0 || props.paramCount > 0)
/** 不会分批就不提回滚——那是分批才有的问题 */
const willBatch = computed(() => props.sendCount > LAUNCH_BATCH_SIZE)

</script>

<template>
  <div class="lcd-backdrop" data-testid="launch-confirm-dialog" @click.self="emit('close')">
    <div class="lcd-card">
      <div class="lcd-title">发任务</div>
      <p class="lcd-scope">
        <template v-if="mode === 'selected'">
          是否确定要发送抓取任务，本次 <b data-testid="launch-send-count">{{ sendCount }}</b> 条？
        </template>
        <template v-else>
          按当前筛选：{{ filterText }}，命中 {{ hitCount }} 个源，
          将发送 <b data-testid="launch-send-count">{{ sendCount }}</b> 条，是否继续？
        </template>
      </p>
      <!-- 只有真的跳过了东西才多说一句：勾选数与发送数不一致时，人得知道少的那些去哪了 -->
      <p v-if="skipped" class="lcd-skipped" data-testid="launch-skipped">
        已跳过
        <template v-if="disabledCount">停用 {{ disabledCount }} 个</template>
        <template v-if="disabledCount && paramCount">、</template>
        <template v-if="paramCount">参数源 {{ paramCount }} 个（请勾选后单独发送）</template>
      </p>
      <!-- 只有真的会分批才警告：单批发完不存在"前几批已发出"的问题 -->
      <p v-if="willBatch" class="lcd-warn">超过 {{ LAUNCH_BATCH_SIZE }} 个会分批发送，中途某批失败时，已发出的那几批不会回滚。</p>
      <div class="lcd-actions">
        <button class="rc-btn" type="button" :disabled="sending" data-testid="launch-cancel" @click="emit('close')">取消</button>
        <button
          class="rc-btn primary"
          type="button"
          data-testid="launch-confirm"
          :disabled="sending || sendCount <= 0"
          @click="emit('confirm')"
        >{{ sending ? '发送中…' : `确认发送 ${sendCount} 个` }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lcd-backdrop { position: fixed; inset: 0; z-index: 91; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, .28); }
.lcd-card { width: min(480px, calc(100vw - 48px)); padding: 16px; border: 1px solid var(--rc-border); border-radius: 12px; background: #fff; box-shadow: 0 24px 64px -22px rgba(15, 23, 42, .45); }
.lcd-title { margin-bottom: 6px; color: var(--rc-text); font-size: 13px; font-weight: 800; }
.lcd-scope { margin: 0 0 10px; color: var(--rc-text-2); font-size: 12px; line-height: 1.5; }
.lcd-scope b { color: var(--rc-text); }
.lcd-skipped { margin: 0 0 10px; color: var(--rc-muted); font-size: 12px; line-height: 1.6; }
.lcd-hint { margin-left: 6px; color: var(--rc-faint); font-size: 11px; }
.lcd-params { display: block; margin-top: 2px; color: var(--rc-muted); font-size: 11px; }
.lcd-warn { margin: 0 0 14px; color: #9a3412; font-size: 11px; line-height: 1.5; }
.lcd-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
