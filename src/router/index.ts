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
      // Circuit builder flow. Two routes only; the back stack is
      // workbench -> circuits -> home.
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
      // Workout flow. The circuit is auto-selected (up-next rule in
      // domain/workout.ts), so the start route carries no params; the
      // set route keys to the exercise, everything else derives from
      // session facts.
      path: '/workout',
      name: 'workout-start',
      component: () => import('@/views/WorkoutStartView.vue'),
    },
    {
      path: '/workout/:exerciseId',
      name: 'workout-set',
      component: () => import('@/views/WorkoutSetView.vue'),
      props: true,
    },
    {
      // setIndex is the one route-carried fact: which set this rest
      // logs, captured at the START REST transition - the arrival
      // auto-log (03-03) changes what a re-derivation would answer.
      // Final mode derives from session facts, never a route flag.
      path: '/workout/:exerciseId/rest/:setIndex(\\d+)',
      name: 'rest',
      component: () => import('@/views/RestView.vue'),
      props: (route) => ({
        exerciseId: String(route.params.exerciseId),
        setIndex: Number(route.params.setIndex),
      }),
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
    },
  ],
});

export default router;
