# Agent: Vue.js Builder

Build and maintain Vue 3 applications with Composition API following modern best practices.

**Note:** This agent should be combined with `agent-frontend-base.md.agent` for complete frontend standards.

---

## Configuration

Modify these values to match your project requirements:

```yaml
vue_version: "3.5"
build_tool: Vite
state_management: Pinia
router: Vue Router 4
styling: Tailwind CSS  # or CSS Modules, SCSS
testing: Vitest + Vue Test Utils
package_manager: pnpm  # or npm, yarn
```

### Pinned Versions

```yaml
vue: "3.5.x"
vite: "6.x"
pinia: "2.x"
vue-router: "4.x"
vitest: "2.x"
"@vue/test-utils": "2.x"
typescript: "5.x"
```

---

## Project Structure

```
project_root/
├── src/
│   ├── App.vue
│   ├── main.ts
│   ├── components/
│   │   ├── ui/              # Reusable UI components
│   │   │   ├── BaseButton.vue
│   │   │   └── BaseInput.vue
│   │   └── features/        # Feature-specific components
│   │       └── UserCard.vue
│   ├── composables/         # Composition functions
│   │   ├── useAuth.ts
│   │   └── useFetch.ts
│   ├── stores/              # Pinia stores
│   │   ├── index.ts
│   │   └── userStore.ts
│   ├── views/               # Route components
│   │   ├── HomeView.vue
│   │   └── UserView.vue
│   ├── router/
│   │   └── index.ts
│   ├── services/            # API services
│   │   └── api.ts
│   ├── types/               # TypeScript types
│   │   └── index.ts
│   └── assets/
├── tests/
│   ├── components/
│   └── composables/
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## Composition API (Required)

**Always use Composition API with `<script setup>`.** Options API is deprecated for new code.

### Basic Component Structure

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useUserStore } from '@/stores/userStore';
import BaseButton from '@/components/ui/BaseButton.vue';

// Props with TypeScript
interface Props {
  userId: number;
  showDetails?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showDetails: false,
});

// Emits with TypeScript
const emit = defineEmits<{
  select: [userId: number];
  close: [];
}>();

// Reactive state
const isLoading = ref(false);
const error = ref<string | null>(null);

// Store
const userStore = useUserStore();

// Computed
const displayName = computed(() => {
  return userStore.currentUser?.name ?? 'Guest';
});

// Methods
function handleSelect() {
  emit('select', props.userId);
}

// Lifecycle
onMounted(async () => {
  await loadData();
});

async function loadData() {
  isLoading.value = true;
  error.value = null;
  
  try {
    await userStore.fetchUser(props.userId);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load';
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <div class="user-card">
    <p v-if="isLoading">Loading...</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <template v-else>
      <h2>{{ displayName }}</h2>
      <div v-if="showDetails">
        <!-- details -->
      </div>
      <BaseButton @click="handleSelect">Select</BaseButton>
    </template>
  </div>
</template>

<style scoped>
.user-card {
  padding: 1rem;
  border-radius: 0.5rem;
  background: var(--color-surface);
}

.error {
  color: var(--color-error);
}
</style>
```

---

## Composables

Extract reusable logic into composables:

```typescript
// src/composables/useFetch.ts
import { ref, shallowRef } from 'vue';

interface UseFetchOptions {
  immediate?: boolean;
}

export function useFetch<T>(url: string, options: UseFetchOptions = {}) {
  const data = shallowRef<T | null>(null);
  const error = ref<Error | null>(null);
  const isLoading = ref(false);

  async function execute() {
    isLoading.value = true;
    error.value = null;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      data.value = await response.json();
    } catch (e) {
      error.value = e instanceof Error ? e : new Error('Unknown error');
    } finally {
      isLoading.value = false;
    }
  }

  if (options.immediate) {
    execute();
  }

  return {
    data,
    error,
    isLoading,
    execute,
  };
}


// src/composables/useAuth.ts
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/userStore';

export function useAuth() {
  const router = useRouter();
  const userStore = useUserStore();

  const isAuthenticated = computed(() => !!userStore.currentUser);
  const currentUser = computed(() => userStore.currentUser);

  async function login(email: string, password: string) {
    await userStore.login(email, password);
    router.push('/dashboard');
  }

  async function logout() {
    await userStore.logout();
    router.push('/login');
  }

  return {
    isAuthenticated,
    currentUser,
    login,
    logout,
  };
}
```

---

## Pinia Stores

```typescript
// src/stores/userStore.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api } from '@/services/api';
import type { User } from '@/types';

export const useUserStore = defineStore('user', () => {
  // State
  const currentUser = ref<User | null>(null);
  const users = ref<User[]>([]);
  const isLoading = ref(false);

  // Getters
  const isAuthenticated = computed(() => currentUser.value !== null);
  
  const userById = computed(() => {
    return (id: number) => users.value.find(u => u.id === id);
  });

  // Actions
  async function fetchUser(id: number) {
    isLoading.value = true;
    try {
      const user = await api.getUser(id);
      currentUser.value = user;
    } finally {
      isLoading.value = false;
    }
  }

  async function login(email: string, password: string) {
    const response = await api.login(email, password);
    currentUser.value = response.user;
    localStorage.setItem('token', response.token);
  }

  async function logout() {
    await api.logout();
    currentUser.value = null;
    localStorage.removeItem('token');
  }

  function $reset() {
    currentUser.value = null;
    users.value = [];
    isLoading.value = false;
  }

  return {
    // State
    currentUser,
    users,
    isLoading,
    // Getters
    isAuthenticated,
    userById,
    // Actions
    fetchUser,
    login,
    logout,
    $reset,
  };
});
```

---

## Vue Router

```typescript
// src/router/index.ts
import { createRouter, createWebHistory } from 'vue-router';
import { useUserStore } from '@/stores/userStore';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { guest: true },
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/views/DashboardView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/users/:id',
      name: 'user',
      component: () => import('@/views/UserView.vue'),
      props: route => ({ userId: Number(route.params.id) }),
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
    },
  ],
});

// Navigation guard
router.beforeEach((to) => {
  const userStore = useUserStore();

  if (to.meta.requiresAuth && !userStore.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }

  if (to.meta.guest && userStore.isAuthenticated) {
    return { name: 'dashboard' };
  }
});

export default router;
```

---

## Component Patterns

### Props and Emits

```vue
<script setup lang="ts">
// Props with validation
interface Props {
  title: string;
  count?: number;
  items: string[];
  status: 'pending' | 'active' | 'complete';
}

const props = withDefaults(defineProps<Props>(), {
  count: 0,
});

// Typed emits
const emit = defineEmits<{
  update: [value: string];
  submit: [];
  'item-click': [item: string, index: number];
}>();

// v-model support
const modelValue = defineModel<string>({ required: true });
// Usage: <MyInput v-model="text" />

// Named v-model
const checked = defineModel<boolean>('checked', { default: false });
// Usage: <MyCheckbox v-model:checked="isChecked" />
</script>
```

### Slots

```vue
<!-- BaseCard.vue -->
<script setup lang="ts">
defineSlots<{
  default: () => any;
  header?: () => any;
  footer?: (props: { close: () => void }) => any;
}>();

function close() {
  // close logic
}
</script>

<template>
  <div class="card">
    <header v-if="$slots.header" class="card__header">
      <slot name="header" />
    </header>
    
    <div class="card__body">
      <slot />
    </div>
    
    <footer v-if="$slots.footer" class="card__footer">
      <slot name="footer" :close="close" />
    </footer>
  </div>
</template>

<!-- Usage -->
<BaseCard>
  <template #header>
    <h2>Card Title</h2>
  </template>
  
  <p>Card content goes here.</p>
  
  <template #footer="{ close }">
    <button @click="close">Close</button>
  </template>
</BaseCard>
```

### Provide/Inject

```typescript
// Parent component or App.vue
import { provide, ref } from 'vue';
import type { InjectionKey } from 'vue';

interface ThemeContext {
  theme: Ref<'light' | 'dark'>;
  toggleTheme: () => void;
}

export const ThemeKey: InjectionKey<ThemeContext> = Symbol('theme');

const theme = ref<'light' | 'dark'>('light');
const toggleTheme = () => {
  theme.value = theme.value === 'light' ? 'dark' : 'light';
};

provide(ThemeKey, { theme, toggleTheme });


// Child component (any depth)
import { inject } from 'vue';
import { ThemeKey } from '@/keys';

const themeContext = inject(ThemeKey);
if (!themeContext) {
  throw new Error('Theme context not provided');
}

const { theme, toggleTheme } = themeContext;
```

---

## Async Components and Suspense

```vue
<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

const HeavyComponent = defineAsyncComponent({
  loader: () => import('./HeavyComponent.vue'),
  loadingComponent: LoadingSpinner,
  errorComponent: ErrorDisplay,
  delay: 200,
  timeout: 10000,
});
</script>

<template>
  <Suspense>
    <template #default>
      <HeavyComponent />
    </template>
    <template #fallback>
      <LoadingSpinner />
    </template>
  </Suspense>
</template>
```

---

## Form Handling

```vue
<script setup lang="ts">
import { ref, computed } from 'vue';

interface FormData {
  email: string;
  password: string;
  rememberMe: boolean;
}

const form = ref<FormData>({
  email: '',
  password: '',
  rememberMe: false,
});

const errors = ref<Partial<Record<keyof FormData, string>>>({});
const isSubmitting = ref(false);

const isValid = computed(() => {
  return form.value.email.includes('@') && form.value.password.length >= 8;
});

function validate(): boolean {
  errors.value = {};
  
  if (!form.value.email.includes('@')) {
    errors.value.email = 'Invalid email address';
  }
  
  if (form.value.password.length < 8) {
    errors.value.password = 'Password must be at least 8 characters';
  }
  
  return Object.keys(errors.value).length === 0;
}

async function handleSubmit() {
  if (!validate()) return;
  
  isSubmitting.value = true;
  try {
    await submitForm(form.value);
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <form @submit.prevent="handleSubmit">
    <div class="field">
      <label for="email">Email</label>
      <input
        id="email"
        v-model="form.email"
        type="email"
        :class="{ error: errors.email }"
      >
      <span v-if="errors.email" class="error-message">{{ errors.email }}</span>
    </div>
    
    <div class="field">
      <label for="password">Password</label>
      <input
        id="password"
        v-model="form.password"
        type="password"
        :class="{ error: errors.password }"
      >
      <span v-if="errors.password" class="error-message">{{ errors.password }}</span>
    </div>
    
    <div class="field">
      <label>
        <input v-model="form.rememberMe" type="checkbox">
        Remember me
      </label>
    </div>
    
    <button type="submit" :disabled="!isValid || isSubmitting">
      {{ isSubmitting ? 'Submitting...' : 'Submit' }}
    </button>
  </form>
</template>
```

---

## Testing

```typescript
// tests/components/UserCard.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import UserCard from '@/components/UserCard.vue';

describe('UserCard', () => {
  it('renders user name', () => {
    const wrapper = mount(UserCard, {
      props: {
        userId: 1,
      },
      global: {
        plugins: [
          createTestingPinia({
            initialState: {
              user: {
                currentUser: { id: 1, name: 'John Doe' },
              },
            },
          }),
        ],
      },
    });

    expect(wrapper.text()).toContain('John Doe');
  });

  it('emits select event on button click', async () => {
    const wrapper = mount(UserCard, {
      props: { userId: 42 },
      global: {
        plugins: [createTestingPinia()],
      },
    });

    await wrapper.find('button').trigger('click');

    expect(wrapper.emitted('select')).toEqual([[42]]);
  });
});


// tests/composables/useFetch.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFetch } from '@/composables/useFetch';

describe('useFetch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('fetches data successfully', async () => {
    const mockData = { id: 1, name: 'Test' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    }));

    const { data, error, execute } = useFetch('/api/test');
    await execute();

    expect(data.value).toEqual(mockData);
    expect(error.value).toBeNull();
  });

  it('handles fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }));

    const { data, error, execute } = useFetch('/api/test');
    await execute();

    expect(data.value).toBeNull();
    expect(error.value).toBeInstanceOf(Error);
  });
});
```

---

## Common Anti-Patterns

| Anti-Pattern | Issue | Correct Approach |
|--------------|-------|------------------|
| Options API in new code | Inconsistent, harder to type | Use Composition API |
| `this` in `<script setup>` | Does not exist in setup | Use refs and composables |
| Mutating props | One-way data flow violation | Emit events, use v-model |
| Watchers for everything | Often unnecessary | Use computed properties |
| Business logic in components | Hard to test, reuse | Extract to composables/stores |
| `$refs` for everything | Imperative, fragile | Use reactive data |
| `v-if` + `v-for` on same element | Ambiguous behavior | Wrap in `<template>` |
| Giant components | Hard to maintain | Extract smaller components |
| Direct store state mutation | Bypasses reactivity tracking | Use store actions |
| Inline styles everywhere | Hard to maintain | Use CSS classes |
