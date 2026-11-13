<script setup lang="ts">
defineProps<{ name: string }>()
</script>
<template>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <g v-if="name === 'star'"><path d="m12 2.7 3 6.1 6.7 1-4.85 4.75 1.15 6.7L12 18.1 6 21.25l1.15-6.7L2.3 9.8l6.7-1L12 2.7Z"/></g>
    <g v-if="name === 'clock'"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.7 2"/></g>
    <g v-if="name === 'database'"><ellipse cx="12" cy="5" rx="8.5" ry="3"/><path d="M3.5 5v7c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3V5M3.5 12v7c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3v-7"/></g>
    <g v-if="name === 'alert'"><path d="M10.1 3.7c.83-1.45 2.95-1.45 3.78 0l8 14a2.2 2.2 0 0 1-1.9 3.3H4.02a2.2 2.2 0 0 1-1.9-3.3Z"/><path d="M12 9v5.2M12 18h.01"/></g>
    <g v-if="name === 'reload'"><path d="M20 6v5h-5M4 18v-5h5"/><path d="M5.6 10A7.7 7.7 0 0 1 19 7.1L20 11M4 13l1 4A7.7 7.7 0 0 0 18.4 14"/></g>
    <g v-if="name === 'sliders'"><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2" fill="white"/><circle cx="16" cy="12" r="2" fill="white"/><circle cx="10" cy="18" r="2" fill="white"/></g>
    <g v-if="name === 'globe'"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 2.5 4.5 5.5 4.5 9S15 18.5 12 21M12 3c-3 2.5-4.5 5.5-4.5 9S9 18.5 12 21"/></g>
    <g v-if="name === 'check'"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5.5-6"/></g>
    <g v-if="name === 'chevron'"><path d="m9 6 6 6-6 6"/></g>
    <g v-if="name === 'bell'"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9M10 21h4"/></g>
    <g v-if="name === 'help'"><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2.25c-1 .8-2 1.1-2 2.75M12 17h.01"/></g>
    <g v-if="name === 'file'"><path d="M7 2h7l5 5v14H5V2zM14 2v5h5M8 12h8M8 16h8"/></g>
    <g v-if="name === 'table'"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10M15 10v10"/></g>
  </svg>
</template>
