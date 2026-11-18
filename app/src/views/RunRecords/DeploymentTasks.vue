<script setup lang="ts">
import DeploymentResourcesTab from '@/views/Settings/DeploymentResourcesTab.vue'
defineProps<{ sourceScopeId?: string }>()
</script>

<template>
  <DeploymentResourcesTab tasks-only :source-scope-id="sourceScopeId" />
</template>
