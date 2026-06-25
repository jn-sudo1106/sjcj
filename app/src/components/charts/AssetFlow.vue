<script setup lang="ts">
import { computed } from 'vue'
import apiIcon from '../../assets/overview/api.png'
import databaseIcon from '../../assets/overview/database.png'
import fileIcon from '../../assets/overview/file.png'
import mqIcon from '../../assets/overview/mq.png'
import platformIcon from '../../assets/overview/platform.png'
import thirdPartyIcon from '../../assets/overview/third-party.png'
import webIcon from '../../assets/overview/web.png'

interface Ecosystem {
  sources: number
  configs: number
  tables: number
  params: number
}

const props = defineProps<{ ecosystem: Ecosystem }>()

const nodes = computed<{ key: string; label: string; value: number; icon: string; pos: string }[]>(() => [
  { key: 'third', label: '第三方平台', value: Math.max(1, props.ecosystem.sources - props.ecosystem.configs), icon: thirdPartyIcon, pos: 'left-top' },
  { key: 'web', label: '网页采集', value: props.ecosystem.sources, icon: webIcon, pos: 'left-bottom' },
  { key: 'db', label: '数据库', value: props.ecosystem.tables, icon: databaseIcon, pos: 'top' },
  { key: 'mq', label: 'MQ', value: Math.max(1, Math.round(props.ecosystem.configs / 2)), icon: mqIcon, pos: 'upper' },
  { key: 'api', label: 'API', value: props.ecosystem.configs, icon: apiIcon, pos: 'right-top' },
  { key: 'file', label: '文件', value: props.ecosystem.params, icon: fileIcon, pos: 'right-bottom' },
])
</script>

<template>
  <div class="af">
    <div class="af-field" aria-hidden="true">
      <span class="af-orbit o1" />
      <span class="af-orbit o2" />
      <span class="af-orbit o3" />
      <span class="af-line l1" />
      <span class="af-line l2" />
      <span class="af-line l3" />
      <span class="af-line l4" />
      <span class="af-line l5" />
      <span class="af-line l6" />
    </div>

    <div class="af-hub">
      <img :src="platformIcon" alt="" class="af-platform-icon" />
      <strong>统一数据平台</strong>
    </div>

    <div v-for="n in nodes" :key="n.key" class="af-node" :class="n.pos">
      <span class="af-icon"><img :src="n.icon" alt="" /></span>
      <span class="af-copy">
        <b>{{ n.label }}</b>
        <small>{{ n.value }} 个</small>
      </span>
    </div>
  </div>
</template>

<style scoped>
.af {
  position: relative;
  min-height: 252px;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 64%, rgba(37, 99, 235, 0.15), transparent 29%),
    linear-gradient(180deg, rgba(250, 253, 255, 0.3), #fff);
}

.af::before {
  content: '';
  position: absolute;
  inset: 16px 20px 0;
  background-image:
    linear-gradient(rgba(37, 99, 235, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(37, 99, 235, 0.05) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: radial-gradient(ellipse at center, #000 0%, transparent 72%);
}

.af-field,
.af-orbit,
.af-line {
  position: absolute;
  pointer-events: none;
}

.af-field {
  inset: 0;
}

.af-orbit {
  left: 50%;
  top: 58%;
  border: 1px solid rgba(37, 99, 235, 0.16);
  border-radius: 50%;
  transform: translate(-50%, -50%) rotateX(68deg);
}

.af-orbit.o1 {
  width: 250px;
  height: 110px;
}

.af-orbit.o2 {
  width: 390px;
  height: 170px;
  border-color: rgba(96, 165, 250, 0.16);
}

.af-orbit.o3 {
  width: 530px;
  height: 224px;
  border-color: rgba(6, 182, 212, 0.12);
}

.af-line {
  left: 50%;
  top: 58%;
  width: 235px;
  height: 1px;
  transform-origin: left center;
  background: linear-gradient(90deg, rgba(37, 99, 235, 0.28), transparent);
}

.af-line.l1 {
  transform: rotate(-155deg);
}

.af-line.l2 {
  transform: rotate(155deg);
}

.af-line.l3 {
  transform: rotate(-90deg);
  width: 116px;
}

.af-line.l4 {
  transform: rotate(90deg);
  width: 110px;
}

.af-line.l5 {
  transform: rotate(-25deg);
}

.af-line.l6 {
  transform: rotate(25deg);
}

.af-hub {
  position: absolute;
  left: 50%;
  top: 58px;
  z-index: 3;
  width: 252px;
  height: 190px;
  transform: translateX(-50%);
}

.af-hub::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 98px;
  z-index: -1;
  width: 220px;
  height: 100px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(37, 99, 235, 0.24), rgba(6, 182, 212, 0.12) 48%, transparent 72%);
  transform: translateX(-50%);
}

.af-platform-icon {
  display: block;
  width: 210px;
  height: 182px;
  margin: 0 auto;
  object-fit: contain;
  mix-blend-mode: multiply;
}

.af-hub strong {
  position: absolute;
  left: 50%;
  top: 148px;
  transform: translateX(-50%);
  white-space: nowrap;
  padding: 5px 14px;
  border-radius: 999px;
  background: linear-gradient(180deg, #3471fd 0%, #2e6bfd 58%, #2460f2 100%);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  box-shadow: 0 10px 20px rgba(46, 107, 253, 0.28);
}

.af-node {
  position: absolute;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 96px;
  min-height: 38px;
  padding: 5px 9px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 12px 28px rgba(37, 99, 235, 0.09);
}

.af-node.left-top {
  left: 6%;
  top: 32%;
}

.af-node.left-bottom {
  left: 5%;
  bottom: 22%;
}

.af-node.top {
  left: calc(50% - 108px);
  top: 8px;
}

.af-node.upper {
  left: calc(50% + 12px);
  top: 8px;
  bottom: auto;
}

.af-node.right-top {
  right: 5%;
  top: 28%;
}

.af-node.right-bottom {
  right: 6%;
  bottom: 22%;
}

.af-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 50%;
  background: #eff6ff;
  box-shadow: inset 0 0 0 1px rgba(191, 219, 254, 0.72);
}

.af-icon img {
  display: block;
  width: 22px;
  height: 22px;
  object-fit: contain;
}

.af-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.af-copy b {
  color: #0f1e46;
  font-size: 12px;
  line-height: 1.2;
}

.af-copy small {
  margin-top: 2px;
  color: #334155;
  font-size: 12px;
}

@media (max-width: 720px) {
  .af {
    display: grid;
    gap: 10px;
    min-height: 0;
    padding: 14px;
  }

  .af::before,
  .af-field,
  .af-hub {
    display: none;
  }

  .af-node {
    position: static;
    width: 100%;
  }
}
</style>
