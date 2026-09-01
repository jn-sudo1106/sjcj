<script setup lang="ts">
/**
 * 源视图「发任务」的统一确认弹窗（0831 X2-5）。
 * 勾选 / 按条件全量两条路共用这一块：范围、命中数、跳过的停用/参数源、登陆策略。
 * 分批失败无法撤回，所以在确认前就把这件事写出来，别等发出去了再解释。
 */
import { ref } from 'vue'

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
  confirm: [skip: number]
  close: []
}>()

const skip = ref(0)
const loginOpts = [
  { value: 0, label: '[0]默认' },
  { value: 1, label: '[1]不登陆' },
  { value: 2, label: '[2]强制登陆' },
]
</script>

<template>
  <div class="lcd-backdrop" data-testid="launch-confirm-dialog" @click.self="emit('close')">
    <div class="lcd-card">
      <div class="lcd-title">发任务</div>
      <p class="lcd-scope">
        <template v-if="mode === 'selected'">已勾选 {{ hitCount }} 个源</template>
        <template v-else>按当前筛选：{{ filterText }}，命中 {{ hitCount }} 个源</template>
      </p>
      <ul class="lcd-stats">
        <li>将发送 <b data-testid="launch-send-count">{{ sendCount }}</b> 个</li>
        <li v-if="disabledCount">跳过已停用 {{ disabledCount }} 个</li>
        <li v-if="paramCount">
          跳过参数源 {{ paramCount }} 个
          <span class="lcd-hint">参数源请勾选后单独发送</span>
          <span v-if="paramNames.length" class="lcd-params">{{ paramNames.join('、') }}</span>
        </li>
      </ul>
      <div class="lcd-skip">
        <span>登陆策略</span>
        <label v-for="opt in loginOpts" :key="opt.value">
          <input v-model.number="skip" type="radio" :value="opt.value" :data-testid="`launch-skip-${opt.value}`" />
          {{ opt.label }}
        </label>
      </div>
      <p class="lcd-warn">任务发出去就收不回来。分批发送时某一批失败，已发出的那几批不会回滚。</p>
      <div class="lcd-actions">
        <button class="rc-btn" type="button" :disabled="sending" data-testid="launch-cancel" @click="emit('close')">取消</button>
        <button
          class="rc-btn primary"
          type="button"
          data-testid="launch-confirm"
          :disabled="sending || sendCount <= 0"
          @click="emit('confirm', skip)"
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
.lcd-stats { margin: 0 0 12px; padding: 0 0 0 18px; color: var(--rc-text-2); font-size: 12px; line-height: 1.7; }
.lcd-stats b { color: var(--rc-text); }
.lcd-hint { margin-left: 6px; color: var(--rc-faint); font-size: 11px; }
.lcd-params { display: block; margin-top: 2px; color: var(--rc-muted); font-size: 11px; }
.lcd-skip { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 10px; color: var(--rc-muted); font-size: 11px; }
.lcd-skip label { display: inline-flex; align-items: center; gap: 4px; color: var(--rc-text-2); cursor: pointer; }
.lcd-warn { margin: 0 0 14px; color: #9a3412; font-size: 11px; line-height: 1.5; }
.lcd-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
