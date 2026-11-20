<script setup lang="ts">
import { ArrowRight, Close } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  clamp, fitFloatingRect, FLOATING_MARGIN, LAUNCHER_SIZE, PANEL_SIZE, resizeEdges,
  resizeFloatingRect, type FloatingRect, type ResizeEdge,
} from './askFloatingGeometry'

const props = defineProps<{ full: boolean; fullTarget: HTMLElement | null; workspace: HTMLElement | null; userId: number | null }>()
const router = useRouter()
const route = useRoute()
const ChatWorkspace = defineAsyncComponent(() => import('@/views/TemplateConfig/AiChat/index.vue'))
const launcherEl = ref<HTMLButtonElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const open = ref(false)
const floatOpenCount = ref(0)
const started = ref(props.full)
const modalOpen = ref(false)
const navigating = ref(false)
const panelVisible = computed(() => open.value && !props.full && !modalOpen.value)

const bounds = shallowRef<FloatingRect>({ x: 12, y: 68, width: 1000, height: 600 })
const jobRect = shallowRef<FloatingRect | null>(null)
type Position = { x: number; y: number }
type Preferences = { launcher?: Position; panel?: Position; size?: typeof PANEL_SIZE }
const preferences = shallowRef<Preferences>({})
const storageKey = computed(() => props.userId == null ? null : `rc:ai-ask-floating:v1:${props.userId}`)

watch(storageKey, (key) => {
  preferences.value = {}
  if (!key) return
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}') as Preferences | null
    const valid = (position?: Position) => position && Number.isFinite(position.x) && Number.isFinite(position.y)
    preferences.value = {
      launcher: valid(saved?.launcher) ? saved?.launcher : undefined,
      panel: valid(saved?.panel) ? saved?.panel : undefined,
      size: saved?.size && Number.isFinite(saved.size.width) && Number.isFinite(saved.size.height) ? saved.size : undefined,
    }
  } catch {
    // 浏览器禁用本地存储时仍可在当前页面使用。
  }
}, { immediate: true })

type Action = 'launcher' | 'move' | ResizeEdge
interface Gesture {
  action: Action
  pointerId: number
  x: number
  y: number
  dx: number
  dy: number
  initial: FloatingRect
  target: HTMLElement
  surface: HTMLElement
  moved: boolean
}
let gesture: Gesture | undefined
let frame = 0
let blockedClick = false

function avoidJob(rect: FloatingRect): FloatingRect {
  const job = jobRect.value
  if (!job || rect.x + rect.width <= job.x || rect.x >= job.x + job.width ||
      rect.y + rect.height <= job.y || rect.y >= job.y + job.height) return rect
  const area = bounds.value
  const above = job.y - FLOATING_MARGIN - rect.height
  const left = job.x - FLOATING_MARGIN - rect.width
  if (above >= area.y) return { ...rect, y: above }
  if (left >= area.x) return { ...rect, x: left }
  // 空间紧张时作业条仍显示在浮窗上方，用户可将浮窗拖离其区域。
  return rect
}

function place(saved: Position | undefined, rect: FloatingRect) {
  const area = bounds.value
  return fitFloatingRect(saved ? {
    ...rect,
    x: area.x + saved.x * (area.width - rect.width),
    y: area.y + saved.y * (area.height - rect.height),
  } : rect, area)
}

const launcher = computed(() => {
  const area = bounds.value
  return avoidJob(place(preferences.value.launcher, {
    x: area.x + area.width - LAUNCHER_SIZE - 12,
    y: area.y + area.height - LAUNCHER_SIZE - 84,
    width: LAUNCHER_SIZE, height: LAUNCHER_SIZE,
  }))
})

const panel = computed(() => {
  const area = bounds.value
  const size = preferences.value.size ?? PANEL_SIZE
  const width = clamp(size.width, Math.min(320, area.width), Math.min(800, area.width))
  const height = clamp(size.height, Math.min(300, area.height), area.height)
  const button = launcher.value
  const gap = FLOATING_MARGIN
  const after = button.x + button.width + gap
  const before = button.x - width - gap
  const x = before >= area.x ? before : after + width <= area.x + area.width ? after : button.x + button.width - width
  return avoidJob(place(preferences.value.panel, { x, y: button.y + button.height - height, width, height }))
})

function rectStyle(rect: FloatingRect) {
  return { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }
}

function save(action: Action, rect: FloatingRect, dx = 0, dy = 0) {
  const area = bounds.value
  const position = {
    x: (rect.x - area.x) / Math.max(1, area.width - rect.width),
    y: (rect.y - area.y) / Math.max(1, area.height - rect.height),
  }
  const next = { ...preferences.value }
  if (action === 'launcher') next.launcher = position
  else {
    next.panel = position
    if (action !== 'move') {
      const previous = next.size ?? PANEL_SIZE
      next.size = {
        width: dx && (action.includes('w') || action.includes('e')) ? rect.width : previous.width,
        height: dy && (action.includes('n') || action.includes('s')) ? rect.height : previous.height,
      }
    }
  }
  preferences.value = next
  try {
    if (storageKey.value) localStorage.setItem(storageKey.value, JSON.stringify(next))
  } catch {
    // 当前页面继续使用内存偏好。
  }
}

function adjusted(action: Action, initial: FloatingRect, dx: number, dy: number) {
  if (action === 'launcher' || action === 'move') {
    return fitFloatingRect({ ...initial, x: initial.x + dx, y: initial.y + dy }, bounds.value)
  }
  return resizeFloatingRect(initial, bounds.value, action, dx, dy)
}

function begin(event: PointerEvent, action: Action) {
  if (event.button !== 0 || gesture) return
  const target = event.currentTarget as HTMLElement
  const surface = action === 'launcher' ? launcherEl.value : panelEl.value
  if (!surface) return
  blockedClick = false
  gesture = {
    action, target, surface, pointerId: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0,
    initial: action === 'launcher' ? launcher.value : panel.value, moved: false,
  }
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', finish, true)
  window.addEventListener('pointercancel', cancelPointer, true)
  window.addEventListener('blur', cancel)
  target.setPointerCapture?.(event.pointerId)
}

function move(event: PointerEvent) {
  const current = gesture
  if (!current || current.pointerId !== event.pointerId) return
  const dx = event.clientX - current.x
  const dy = event.clientY - current.y
  if (!current.moved && Math.hypot(dx, dy) < 5) return
  if (!current.moved) current.surface.classList.add('is-manipulating')
  current.moved = true
  current.dx = dx
  current.dy = dy
  if (!frame) frame = requestAnimationFrame(drawGesture)
}

function drawGesture() {
  frame = 0
  const current = gesture
  if (!current) return
  const { action, initial, dx, dy, surface } = current
  const rect = adjusted(action, initial, dx, dy)
  const base = action === 'launcher' ? launcher.value : panel.value
  // 移动过程只更新合成位移，松手后再提交布局坐标。缩放才更新内容尺寸。
  surface.style.transform = `translate3d(${rect.x - base.x}px, ${rect.y - base.y}px, 0)`
  if (action !== 'launcher' && action !== 'move') {
    surface.style.width = `${rect.width}px`
    surface.style.height = `${rect.height}px`
  }
}

function cancel() {
  const current = gesture
  gesture = undefined
  window.removeEventListener('pointermove', move, true)
  window.removeEventListener('pointerup', finish, true)
  window.removeEventListener('pointercancel', cancelPointer, true)
  window.removeEventListener('blur', cancel)
  cancelAnimationFrame(frame)
  frame = 0
  if (current?.moved) {
    current.surface.classList.remove('is-manipulating')
    current.surface.style.removeProperty('transform')
    if (current.action !== 'launcher' && current.action !== 'move') {
      current.surface.style.width = `${panel.value.width}px`
      current.surface.style.height = `${panel.value.height}px`
    }
  }
  if (current?.target.hasPointerCapture?.(current.pointerId)) current.target.releasePointerCapture(current.pointerId)
}

function cancelPointer(event: PointerEvent) {
  if (gesture?.pointerId === event.pointerId) cancel()
}

function lostCapture(event: PointerEvent) {
  // 仍按住时由窗口继续跟踪，避免指针跨出小抓手就中断。
  if (!event.buttons) cancelPointer(event)
}

function finish(event: PointerEvent) {
  const current = gesture
  if (!current || current.pointerId !== event.pointerId) return
  const dx = event.clientX - current.x
  const dy = event.clientY - current.y
  if (current.moved || Math.hypot(dx, dy) >= 5) {
    blockedClick = current.action === 'launcher'
    save(current.action, adjusted(current.action, current.initial, dx, dy), dx, dy)
  }
  cancel()
}

const arrows: Record<string, [number, number]> = { ArrowLeft: [-16, 0], ArrowUp: [0, -16], ArrowRight: [16, 0], ArrowDown: [0, 16] }
function adjustWithKeys(event: KeyboardEvent, action: Action) {
  if (event.target !== event.currentTarget) return
  const step = arrows[event.key]
  if (!step) return
  const [dx, dy] = step
  if (action !== 'launcher' && action !== 'move' &&
      (dx ? !/[ew]/.test(action) : !/[ns]/.test(action))) return
  event.preventDefault()
  save(action, adjusted(action, action === 'launcher' ? launcher.value : panel.value, dx, dy), dx, dy)
}

function toggle(event: MouseEvent) {
  if (blockedClick && event.detail > 0) {
    blockedClick = false
    return
  }
  blockedClick = false
  if (open.value) close(true)
  else {
    floatOpenCount.value += 1
    started.value = true
    open.value = true
    nextTick(() => (panelEl.value?.querySelector('textarea') ?? panelEl.value)?.focus())
  }
}

function close(restoreFocus = false) {
  cancel()
  open.value = false
  if (restoreFocus) nextTick(() => launcherEl.value?.focus())
}

function escape(event: KeyboardEvent) {
  if (!event.defaultPrevented) close(true)
}

async function openFull() {
  if (navigating.value) return
  navigating.value = true
  try {
    await router.push('/ai-chat')
    if (router.currentRoute.value.path !== '/ai-chat') ElMessage.warning('无法打开完整工作台')
  } catch {
    ElMessage.error('打开完整工作台失败，请重试')
  } finally {
    navigating.value = false
  }
}

watch(() => props.full, (full) => {
  if (full) {
    started.value = true
    close()
  }
})
watch(() => route.fullPath, cancel)

const overlaySelector = '.el-overlay'
let layoutObserver: ResizeObserver | undefined
let layerObserver: MutationObserver | undefined
let jobEl: HTMLElement | null = null
let measureFrame = 0
function measure() {
  const view = window.visualViewport
  const x = (view?.offsetLeft ?? 0) + FLOATING_MARGIN
  const y = Math.max(view?.offsetTop ?? 0, props.workspace?.getBoundingClientRect().top ?? 0) + FLOATING_MARGIN
  bounds.value = {
    x, y,
    width: Math.max(0, (view?.width ?? window.innerWidth) - 2 * FLOATING_MARGIN),
    height: Math.max(0, (view?.offsetTop ?? 0) + (view?.height ?? window.innerHeight) - y - FLOATING_MARGIN),
  }
  const nextJob = document.querySelector<HTMLElement>('.ljb')
  if (nextJob !== jobEl) {
    if (jobEl) layoutObserver?.unobserve(jobEl)
    jobEl = nextJob
    if (jobEl) layoutObserver?.observe(jobEl)
  }
  const job = jobEl?.getBoundingClientRect()
  jobRect.value = job?.width && job.height ? { x: job.left, y: job.top, width: job.width, height: job.height } : null
  modalOpen.value = Array.from(document.querySelectorAll<HTMLElement>(overlaySelector))
    .some((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' &&
      !!el.querySelector('.el-drawer, .el-dialog, .el-message-box'))
  if (modalOpen.value && open.value) close()
}
function scheduleMeasure() {
  if (measureFrame) return
  measureFrame = requestAnimationFrame(() => {
    measureFrame = 0
    measure()
  })
}
watch(() => props.workspace, (next, previous) => {
  if (previous) layoutObserver?.unobserve(previous)
  if (next) layoutObserver?.observe(next)
  scheduleMeasure()
})
onMounted(() => {
  measure()
  window.addEventListener('resize', scheduleMeasure)
  window.visualViewport?.addEventListener('resize', scheduleMeasure)
  window.visualViewport?.addEventListener('scroll', scheduleMeasure)
  if (typeof ResizeObserver !== 'undefined') {
    layoutObserver = new ResizeObserver(scheduleMeasure)
    if (props.workspace) layoutObserver.observe(props.workspace)
    if (jobEl) layoutObserver.observe(jobEl)
  }
  layerObserver = new MutationObserver((records) => {
    const selector = `${overlaySelector}, .ljb`
    if (records.some(({ type, target, addedNodes, removedNodes }) => type === 'attributes'
      ? target instanceof Element && target.matches(selector)
      : [...addedNodes, ...removedNodes].some((node) => node instanceof Element &&
        (node.matches(selector) || node.querySelector(selector))))) scheduleMeasure()
  })
  layerObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] })
})
onBeforeUnmount(() => {
  cancel()
  cancelAnimationFrame(measureFrame)
  window.removeEventListener('resize', scheduleMeasure)
  window.visualViewport?.removeEventListener('resize', scheduleMeasure)
  window.visualViewport?.removeEventListener('scroll', scheduleMeasure)
  layerObserver?.disconnect()
  layoutObserver?.disconnect()
})
</script>

<template>
  <button
    v-show="!full && !modalOpen && !open"
    ref="launcherEl"
    type="button"
    class="ask-launcher"
    aria-label="AI 问数"
    aria-controls="ai-ask-float-panel"
    :aria-expanded="panelVisible"
    title="AI 问数 · 可拖动"
    :style="rectStyle(launcher)"
    @click="toggle"
    @keydown="adjustWithKeys($event, 'launcher')"
    @pointerdown="begin($event, 'launcher')"
    @lostpointercapture="lostCapture"
  >
    <svg viewBox="0 0 32 32" aria-hidden="true" fill="none">
      <path d="M16 7a10 10 0 0 0-8.5 15.3L6 27l5-2a10 10 0 0 0 15-8.7" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M24 2.5c.8 4.1 2.4 5.7 6.5 6.5-4.1.8-5.7 2.4-6.5 6.5-.8-4.1-2.4-5.7-6.5-6.5 4.1-.8 5.7-2.4 6.5-6.5Z" fill="currentColor" />
    </svg>
  </button>

  <section
    id="ai-ask-float-panel"
    v-show="panelVisible"
    ref="panelEl"
    class="ask-panel"
    role="dialog"
    aria-labelledby="ai-ask-float-title"
    tabindex="-1"
    :style="rectStyle(panel)"
    @keydown.esc="escape"
  >
    <header class="ask-panel-header">
      <div
        id="ai-ask-float-title"
        class="ask-panel-title"
        tabindex="0"
        aria-description="拖动标题或使用方向键移动浮窗"
        @keydown="adjustWithKeys($event, 'move')"
        @pointerdown="begin($event, 'move')"
        @lostpointercapture="lostCapture"
      ><span aria-hidden="true">✦</span> AI 问数</div>
      <button type="button" class="ask-open-full" :disabled="navigating" @click="openFull">
        打开完整工作台 <el-icon><ArrowRight /></el-icon>
      </button>
      <button type="button" class="ask-close" aria-label="收起问数" title="收起问数" @click="close(true)"><el-icon><Close /></el-icon></button>
    </header>
    <div class="ask-panel-content">
      <Teleport v-if="started && fullTarget" :to="fullTarget" :disabled="!full">
        <ChatWorkspace
          :compact="!full"
          :compact-visible="panelVisible"
          :float-open-count="floatOpenCount"
          :cache-owner-id="userId ?? undefined"
          @open-full="openFull"
        />
      </Teleport>
    </div>
    <button
      v-for="(label, edge) in resizeEdges"
      :key="edge"
      type="button"
      class="ask-resize"
      :class="`ask-resize--${edge}`"
      :aria-label="`从${label}调整问数浮窗大小`"
      @keydown="adjustWithKeys($event, edge)"
      @pointerdown="begin($event, edge)"
      @lostpointercapture="lostCapture"
    />
  </section>
</template>

<style scoped>
.ask-launcher, .ask-panel { position: fixed; z-index: 1001; }
.is-manipulating { will-change: transform; user-select: none; }
.is-manipulating.ask-launcher:hover { filter: none; }
.ask-launcher {
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 13px;
  background: linear-gradient(135deg, #1670ef, #5744d9);
  color: #fff;
  box-shadow: 0 5px 16px rgb(36 82 189 / 30%);
  cursor: grab;
  touch-action: none;
}
.ask-launcher svg { width: 28px; height: 28px; pointer-events: none; }
.ask-launcher:hover { filter: brightness(1.07); }
.ask-launcher:active, .ask-panel-title:active { cursor: grabbing; }
.ask-panel {
  display: flex;
  flex-direction: column;
  background: var(--rc-surface);
  border: 1px solid var(--rc-border);
  border-radius: 14px;
  box-shadow: 0 10px 36px rgb(15 23 42 / 18%);
}
.ask-panel-header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: 46px;
  border-bottom: 1px solid var(--rc-border);
  padding: 0 8px 0 13px;
  gap: 6px;
}
.ask-panel-title {
  display: flex;
  align-items: center;
  align-self: stretch;
  flex: 1;
  gap: 6px;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 650;
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.ask-panel-title span {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: var(--rc-primary-bg);
  color: var(--rc-primary);
}
.ask-open-full, .ask-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 0;
  background: transparent;
  border-radius: 6px;
  min-height: 32px;
  padding: 0 6px;
  color: var(--rc-primary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.ask-open-full {
  min-height: 28px;
  padding-inline: 8px;
  background: var(--rc-primary-bg);
}
.ask-close { min-width: 32px; color: var(--rc-muted); font-size: 15px; }
.ask-open-full:hover { background: color-mix(in srgb, var(--rc-primary) 14%, var(--rc-surface)); }
.ask-close:hover { background: var(--rc-bg); }
.ask-panel-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-radius: 0 0 14px 14px;
  container: ask-float-content / size;
}
.ask-resize { position: absolute; touch-action: none; border: 0; background: transparent; padding: 0; }
.ask-resize--n, .ask-resize--s { left: 12px; right: 12px; height: 9px; cursor: ns-resize; }
.ask-resize--n { top: -4px; }
.ask-resize--s { bottom: -4px; }
.ask-resize--w, .ask-resize--e { top: 12px; bottom: 12px; width: 9px; cursor: ew-resize; }
.ask-resize--w { left: -4px; }
.ask-resize--e { right: -4px; }
.ask-resize--ne, .ask-resize--nw, .ask-resize--se, .ask-resize--sw { width: 20px; height: 20px; }
.ask-resize--nw, .ask-resize--sw { left: -4px; }
.ask-resize--ne, .ask-resize--se { right: -4px; }
.ask-resize--nw, .ask-resize--ne { top: -4px; }
.ask-resize--sw, .ask-resize--se { bottom: -4px; }
.ask-resize--nw, .ask-resize--se { cursor: nwse-resize; }
.ask-resize--ne, .ask-resize--sw { cursor: nesw-resize; }
.ask-resize--se::after {
  content: '';
  position: absolute;
  right: 7px;
  bottom: 7px;
  width: 8px;
  height: 8px;
  border-right: 1px solid var(--rc-muted);
  border-bottom: 1px solid var(--rc-muted);
  border-bottom-right-radius: 2px;
}
</style>
