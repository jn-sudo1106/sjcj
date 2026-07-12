<script setup lang="ts">
import { computed, type Component } from 'vue'
import { ChatLineRound, Coin, Collection, TrendCharts } from '@element-plus/icons-vue'
import type { OverviewPanorama } from '../../api/types'
import platformIcon from '../../assets/overview/platform.png'

const props = defineProps<{ panorama: OverviewPanorama }>()
const emit = defineEmits<{ select: [categoryId: string] }>()

const branchIcons: { match: string; icon: Component }[] = [
  { match: '基金', icon: Coin },
  { match: '股票', icon: TrendCharts },
  { match: '舆情', icon: ChatLineRound },
]

function branchIcon(label: string): Component {
  return branchIcons.find((item) => label.includes(item.match))?.icon ?? Collection
}

function branchStatus(error: number): { cls: string; text: string } {
  if (error > 0) return { cls: 'error', text: `${error} 异常` }
  return { cls: 'healthy', text: '状态正常' }
}

const columnCount = computed(() => Math.min(4, Math.max(1, props.panorama.branches.length)))
const rowCount = computed(() => Math.ceil(props.panorama.branches.length / columnCount.value))
const stageHeight = computed(() => 320 + Math.max(0, rowCount.value - 1) * 120)

const connectorPaths = computed(() => {
  return props.panorama.branches.map((branch, index) => {
    const column = index % columnCount.value
    const row = Math.floor(index / columnCount.value)
    const startX = ((column + 0.5) / columnCount.value) * 1000
    const startY = 112 + row * 120
    const targetY = stageHeight.value - 76
    return {
      id: branch.id,
      path: `M ${startX} ${startY} C ${startX} ${startY + 54}, 500 ${targetY - 74}, 500 ${targetY}`,
    }
  })
})
</script>

<template>
  <div class="af">
    <div v-if="panorama.branches.length" class="af-stage" :style="{ minHeight: `${stageHeight}px` }">
      <div class="af-grid" aria-hidden="true" />
      <div class="af-glow" aria-hidden="true" />

      <svg class="af-links" :viewBox="`0 0 1000 ${stageHeight}`" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="af-link-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#60a5fa" stop-opacity="0.3" />
            <stop offset="0.56" stop-color="#2563eb" stop-opacity="0.72" />
            <stop offset="1" stop-color="#06b6d4" stop-opacity="0.96" />
          </linearGradient>
        </defs>
        <g v-for="link in connectorPaths" :key="link.id">
          <path :d="link.path" class="af-link-halo" />
          <path :d="link.path" class="af-link-flow" />
        </g>
      </svg>

      <div
        class="af-branches"
        :style="{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }"
      >
        <button
          v-for="branch in panorama.branches"
          :key="branch.id"
          class="af-branch"
          type="button"
          :data-panorama-branch="branch.id"
          :aria-label="`${branch.label}，${branch.total} 个网站，${branch.sourceCount} 个子源，${branchStatus(branch.error).text}`"
          @click="emit('select', branch.id)"
        >
          <span class="af-branch-head">
            <span class="af-branch-icon"><el-icon><component :is="branchIcon(branch.label)" /></el-icon></span>
            <span class="af-branch-title">
              <b>{{ branch.label }}</b>
              <small>{{ branch.total }} 个网站 · {{ branch.sourceCount }} 个子源</small>
            </span>
            <span class="af-branch-state" :class="branchStatus(branch.error).cls">
              {{ branchStatus(branch.error).text }}
            </span>
          </span>
          <span class="af-children">
            <span
              v-for="child in branch.children"
              :key="child.id"
              class="af-child"
              :class="{ error: child.error > 0 }"
              :data-panorama-child="child.id"
              :title="`${child.total} 个网站 · ${child.sourceCount} 个子源`"
            >
              <span>{{ child.label }}</span>
              <b>{{ child.total }}</b>
            </span>
          </span>
        </button>
      </div>

      <button class="af-hub" type="button" aria-label="查看全部采集资产" @click="emit('select', '')">
        <span class="af-hub-rings" aria-hidden="true"><i /><i /><i /></span>
        <img :src="platformIcon" alt="" class="af-platform-icon" />
        <span class="af-hub-label">
          <b>统一数据平台</b>
          <small>{{ panorama.total }} 个网站 · {{ panorama.sourceCount }} 个子源</small>
        </span>
      </button>

      <div v-if="panorama.unclassified" class="af-unclassified">
        待归类 {{ panorama.unclassified }} 个网站
      </div>
    </div>

    <div v-else class="af-empty">
      <span class="af-empty-icon"><el-icon><Collection /></el-icon></span>
      <b>暂无采集网站</b>
      <small>创建采集网站后将在这里形成分类全景</small>
    </div>
  </div>
</template>

<style scoped>
.af {
  min-height: 320px;
  background: linear-gradient(180deg, #ffffff 0%, #f7fbff 66%, #f2f9ff 100%);
}

.af-stage {
  position: relative;
  min-height: 320px;
  overflow: hidden;
  isolation: isolate;
}

.af-grid,
.af-glow,
.af-links {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.af-grid {
  z-index: -3;
  opacity: 0.72;
  background-image:
    linear-gradient(rgba(37, 99, 235, 0.052) 1px, transparent 1px),
    linear-gradient(90deg, rgba(37, 99, 235, 0.052) 1px, transparent 1px);
  background-size: 30px 30px;
  mask-image: linear-gradient(to bottom, transparent 0%, #000 28%, #000 82%, transparent 100%);
  transform: perspective(480px) rotateX(56deg) scale(1.22) translateY(74px);
  transform-origin: center bottom;
}

.af-glow {
  z-index: -2;
  background:
    radial-gradient(ellipse at 50% 82%, rgba(37, 99, 235, 0.2), transparent 24%),
    radial-gradient(ellipse at 50% 76%, rgba(6, 182, 212, 0.14), transparent 42%);
}

.af-links {
  z-index: 1;
  width: 100%;
  height: 100%;
}

.af-link-halo,
.af-link-flow {
  fill: none;
  vector-effect: non-scaling-stroke;
}

.af-link-halo {
  stroke: rgba(37, 99, 235, 0.12);
  stroke-width: 7;
}

.af-link-flow {
  stroke: url(#af-link-gradient);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-dasharray: 5 9;
  animation: af-flow 5s linear infinite;
  filter: drop-shadow(0 0 4px rgba(6, 182, 212, 0.45));
}

.af-branches {
  position: relative;
  z-index: 4;
  display: grid;
  gap: 18px;
  padding: 18px 22px 0;
}

.af-branch {
  position: relative;
  min-width: 0;
  min-height: 102px;
  padding: 13px 14px 12px;
  border: 1px solid rgba(147, 197, 253, 0.56);
  border-radius: 12px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(239, 248, 255, 0.88)),
    rgba(255, 255, 255, 0.9);
  box-shadow:
    0 12px 26px rgba(37, 99, 235, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.95);
  color: #0f1e46;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
}

.af-branch::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: linear-gradient(180deg, #2563eb, #06b6d4);
}

.af-branch:hover,
.af-branch:focus-visible {
  border-color: rgba(37, 99, 235, 0.72);
  box-shadow: 0 16px 34px rgba(37, 99, 235, 0.15), 0 0 0 3px rgba(37, 99, 235, 0.08);
  transform: translateY(-2px);
  outline: none;
}

.af-branch-head {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 9px;
  align-items: center;
}

.af-branch-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid rgba(147, 197, 253, 0.52);
  border-radius: 10px;
  color: #2563eb;
  background: linear-gradient(145deg, #fff, #eaf4ff);
  font-size: 19px;
  box-shadow: 0 6px 14px rgba(37, 99, 235, 0.1);
}

.af-branch-title {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.af-branch-title b {
  font-size: 13px;
  line-height: 1.2;
}

.af-branch-title small {
  margin-top: 3px;
  color: #64748b;
  font-size: 11px;
}

.af-branch-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #15803d;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}

.af-branch-state::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 12%, transparent);
}

.af-branch-state.running {
  color: #2563eb;
}

.af-branch-state.error {
  color: #dc2626;
}

.af-children {
  display: flex;
  gap: 6px;
  margin-top: 11px;
  overflow: hidden;
}

.af-child {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  border: 1px solid rgba(191, 219, 254, 0.72);
  border-radius: 999px;
  background: rgba(239, 246, 255, 0.84);
  color: #475569;
  font-size: 10px;
  white-space: nowrap;
}

.af-child span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.af-child b {
  color: #1d4ed8;
  font-size: 10px;
}

.af-child.error {
  border-color: rgba(254, 202, 202, 0.82);
  background: rgba(254, 242, 242, 0.84);
}

.af-child.error b {
  color: #dc2626;
}

.af-hub {
  position: absolute;
  left: 50%;
  bottom: 2px;
  z-index: 5;
  width: 330px;
  height: 208px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  transform: translateX(-50%);
}

.af-hub:hover .af-platform-icon,
.af-hub:focus-visible .af-platform-icon {
  transform: translateY(-3px) scale(1.025);
  filter: drop-shadow(0 20px 22px rgba(37, 99, 235, 0.24));
}

.af-hub:focus-visible {
  border-radius: 18px;
  outline: 3px solid rgba(37, 99, 235, 0.2);
  outline-offset: 2px;
}

.af-platform-icon {
  position: relative;
  z-index: 2;
  display: block;
  width: 246px;
  height: 198px;
  margin: 0 auto;
  object-fit: contain;
  mix-blend-mode: multiply;
  filter: drop-shadow(0 18px 18px rgba(37, 99, 235, 0.18));
  transition: transform 0.28s ease, filter 0.28s ease;
}

.af-hub-rings,
.af-hub-rings i {
  position: absolute;
  left: 50%;
  border: 1px solid rgba(37, 99, 235, 0.2);
  border-radius: 50%;
  transform: translateX(-50%);
}

.af-hub-rings {
  bottom: 20px;
  z-index: 1;
  width: 310px;
  height: 88px;
  border-color: rgba(6, 182, 212, 0.18);
  background: radial-gradient(ellipse, rgba(37, 99, 235, 0.16), transparent 66%);
  animation: af-breathe 6s ease-in-out infinite;
}

.af-hub-rings i:nth-child(1) { bottom: 10px; width: 256px; height: 64px; }
.af-hub-rings i:nth-child(2) { bottom: 20px; width: 194px; height: 44px; }
.af-hub-rings i:nth-child(3) { bottom: 28px; width: 126px; height: 26px; }

.af-hub-label {
  position: absolute;
  left: 50%;
  bottom: 0;
  z-index: 4;
  display: flex;
  min-width: 156px;
  flex-direction: column;
  padding: 7px 16px 6px;
  border: 1px solid rgba(147, 197, 253, 0.72);
  border-radius: 12px;
  color: #fff;
  background: linear-gradient(135deg, #2563eb, #2475ef 60%, #06a9c8);
  box-shadow: 0 10px 22px rgba(37, 99, 235, 0.24);
  transform: translateX(-50%);
}

.af-hub-label b {
  font-size: 12px;
  line-height: 1.15;
}

.af-hub-label small {
  margin-top: 3px;
  color: rgba(255, 255, 255, 0.82);
  font-size: 9px;
  white-space: nowrap;
}

.af-unclassified {
  position: absolute;
  right: 16px;
  bottom: 12px;
  z-index: 6;
  padding: 5px 9px;
  border: 1px solid #fde68a;
  border-radius: 999px;
  color: #b45309;
  background: rgba(255, 251, 235, 0.92);
  font-size: 10px;
  font-weight: 700;
}

.af-empty {
  display: flex;
  min-height: 320px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #64748b;
}

.af-empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  margin-bottom: 10px;
  border-radius: 14px;
  color: #2563eb;
  background: #eff6ff;
  font-size: 22px;
}

.af-empty b {
  color: #334155;
  font-size: 13px;
}

.af-empty small {
  margin-top: 5px;
  font-size: 11px;
}

@keyframes af-flow {
  to { stroke-dashoffset: -56; }
}

@keyframes af-breathe {
  0%, 100% { opacity: 0.72; transform: translateX(-50%) scale(0.97); }
  50% { opacity: 1; transform: translateX(-50%) scale(1.03); }
}

@media (max-width: 800px) {
  .af,
  .af-stage {
    min-height: 0;
  }

  .af-stage {
    display: flex;
    flex-direction: column-reverse;
    gap: 12px;
    padding: 14px;
    min-height: 0 !important;
  }

  .af-grid,
  .af-glow,
  .af-links,
  .af-hub-rings {
    display: none;
  }

  .af-branches {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 10px;
    padding: 0;
  }

  .af-branch {
    min-height: 96px;
  }

  .af-branch-head {
    grid-template-columns: 32px minmax(0, 1fr);
  }

  .af-branch-state {
    grid-column: 2;
  }

  .af-hub {
    position: relative;
    left: auto;
    bottom: auto;
    width: 100%;
    height: 84px;
    border: 1px solid #dbeafe;
    border-radius: 12px;
    background: linear-gradient(135deg, #fff, #eff8ff);
    transform: none;
  }

  .af-platform-icon {
    position: absolute;
    left: 14px;
    top: 4px;
    width: 82px;
    height: 74px;
    margin: 0;
  }

  .af-hub-label {
    left: 104px;
    top: 17px;
    bottom: auto;
    align-items: flex-start;
    color: #0f1e46;
    background: transparent;
    border: 0;
    box-shadow: none;
    transform: none;
  }

  .af-hub-label small {
    color: #64748b;
  }
}

@media (prefers-reduced-motion: reduce) {
  .af-link-flow,
  .af-hub-rings {
    animation: none;
  }

  .af-branch,
  .af-platform-icon {
    transition: none;
  }
}
</style>
