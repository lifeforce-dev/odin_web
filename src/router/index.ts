import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      // The living token board + component gallery with a theme dropdown;
      // grows as components land (see src/styles/contract.ts).
      path: '/gallery',
      name: 'gallery',
      component: () => import('@/views/GalleryView.vue'),
    },
    {
      // Circuit builder flow (epic 02). Two routes only; back stack is
      // workbench -> circuits -> home (task 02-02).
      path: '/circuits',
      name: 'circuits',
      component: () => import('@/views/CircuitsView.vue'),
    },
    {
      path: '/circuits/:id',
      name: 'circuit-workbench',
      component: () => import('@/views/CircuitWorkbenchView.vue'),
      props: true,
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
    },
  ],
});

export default router;
