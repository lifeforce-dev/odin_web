import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
      // No upTo: hardware back minimizes the app here (src/router/up.ts).
    },
    {
      // The living token board + component gallery with a theme dropdown;
      // grows as components land (see src/styles/contract.ts). Dev-only,
      // exempt from the up-map like home.
      path: '/gallery',
      name: 'gallery',
      component: () => import('@/views/GalleryView.vue'),
    },
    {
      // Circuit builder flow. Two routes only; up is workbench -> circuits
      // -> home.
      path: '/circuits',
      name: 'circuits',
      component: () => import('@/views/CircuitsView.vue'),
      meta: { upTo: { name: 'home' }, upLabel: 'Home' },
    },
    {
      path: '/circuits/:id',
      name: 'circuit-workbench',
      component: () => import('@/views/CircuitWorkbenchView.vue'),
      props: true,
      meta: { upTo: { name: 'circuits' }, upLabel: 'Circuits' },
    },
    {
      // Workout flow. The circuit is auto-selected (up-next rule in
      // domain/workout.ts), so the start route carries no params; the
      // set route keys to the exercise, everything else derives from
      // session facts.
      path: '/workout',
      name: 'workout-start',
      component: () => import('@/views/WorkoutStartView.vue'),
      meta: { upTo: { name: 'home' }, upLabel: 'Home' },
    },
    {
      path: '/workout/:exerciseId',
      name: 'workout-set',
      component: () => import('@/views/WorkoutSetView.vue'),
      props: true,
      meta: { upTo: { name: 'workout-start' }, upLabel: 'Workout' },
    },
    {
      // setIndex is the one route-carried fact: which set this rest
      // logs, captured at the START REST transition - the arrival
      // auto-log changes what a re-derivation would answer.
      // Final mode derives from session facts, never a route flag.
      path: '/workout/:exerciseId/rest/:setIndex(\\d+)',
      name: 'rest',
      component: () => import('@/views/RestView.vue'),
      props: (route) => ({
        exerciseId: String(route.params.exerciseId),
        setIndex: Number(route.params.setIndex),
      }),
      meta: {
        // The non-destructive FALLBACK destination for a hardware back
        // that races ahead of RestView's mount; once mounted, the
        // screen's registered override owns the rollback semantics.
        upTo: (route) => ({
          name: 'workout-set',
          params: { exerciseId: route.params.exerciseId },
        }),
        upLabel: 'Roll Back Set',
      },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
      meta: { upTo: { name: 'home' }, upLabel: 'Home' },
    },
  ],
});

export default router;
