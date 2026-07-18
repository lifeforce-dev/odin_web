<script setup lang="ts">
import NotificationPrimer from '@/components/NotificationPrimer.vue';
import { useNotificationPrimer } from '@/composables/useNotificationPermission';

// The permission primer is a global overlay, not a per-screen concern:
// the rest flow (and later the stretch flow) raises it through the
// singleton, and it renders above whatever screen is active.
const { visible, copy, enable, dismiss } = useNotificationPrimer();
</script>

<template>
  <RouterView />
  <NotificationPrimer
    v-if="visible"
    :headline="copy.headline"
    :body="copy.body"
    @enable="() => void enable()"
    @dismiss="() => void dismiss()"
  />
</template>
