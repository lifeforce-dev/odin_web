---
applyTo: "**/*"
relatedAgents:
  - agent-python.agent.md
  - agent-fastapi.agent.md
  - agent-sqlite.agent.md
  - agent-vue.agent.md
  - agent-css.agent.md
  - agent-zone_control-designer.agent.md
  - agent-auth-sec.agent.md
---

# Agent: Full Stack Vue Implementation

Implement features across a Python/FastAPI backend with Vue frontend, coordinating database, API, and UI layers.

**IMPORTANT**: When implementing gameplay-affecting changes for ZoneControl, always consult the zone_control-designer agent first to ensure alignment with the game design document.

---

## Stack Configuration

Specify versions in your project or override here:

```yaml
python: "3.12"
fastapi: "0.115+"
pydantic: "2.x"
vue: "3.x"
typescript: "5.x"
database: "SQLite"  # or PostgreSQL, etc.
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (Vue 3 + TypeScript)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Components  │  │ Composables │  │ API Client      │  │
│  │ (views/UI)  │  │ (logic)     │  │ (fetch wrapper) │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTP/JSON
┌───────────────────────────▼─────────────────────────────┐
│  Backend (FastAPI + Pydantic)                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Routers     │  │ Services    │  │ Repositories    │  │
│  │ (endpoints) │  │ (logic)     │  │ (DB access)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└───────────────────────────┬─────────────────────────────┘
                            │ SQL
                    ┌───────▼───────┐
                    │   Database    │
                    │   (SQLite)    │
                    └───────────────┘
```

---

## Implementation Workflow

When implementing a feature, work through the layers in order:

### 1. Database Layer
- Define or update schema (migrations if applicable)
- Create repository functions for data access
- Keep SQL in repository layer only

### 2. API Layer
- Define Pydantic models for request/response
- Create router endpoints
- Business logic goes in service layer, not routers
- Handle errors with appropriate HTTP status codes

### 3. Frontend API Client
- Add typed fetch functions matching backend endpoints
- Handle loading, error, and success states
- Types should match Pydantic models

### 4. Frontend UI
- Create/update Vue components
- Use composables for shared logic
- Connect to API client
- Handle loading and error states in UI

---

## Cross-Cutting Concerns

### Type Safety Across Boundaries

Keep frontend TypeScript types synchronized with backend Pydantic models:

```python
# Backend: app/models/user.py
class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    created_at: datetime
```

```typescript
// Frontend: src/types/user.ts
interface UserResponse {
  id: number
  name: string
  email: string
  created_at: string  // ISO date string
}
```

### Error Handling Pattern

**Backend:**
```python
from fastapi import HTTPException

# In router
if not item:
    raise HTTPException(status_code=404, detail="Item not found")
```

**Frontend:**
```typescript
// In API client
async function fetchItem(id: number): Promise<Item> {
  const response = await fetch(`/api/items/${id}`)
  if (!response.ok) {
    throw new ApiError(response.status, await response.text())
  }
  return response.json()
}

// In component/composable
const { data, error, loading } = useAsyncData(() => fetchItem(id))
```

### API Client Pattern

```typescript
// src/api/client.ts
const API_BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  
  if (!response.ok) {
    const detail = await response.text()
    throw new ApiError(response.status, detail)
  }
  
  return response.json()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data: unknown) => 
    request<T>(path, { method: 'POST', body: JSON.stringify(data) }),
  // ... put, delete, etc.
}
```

---

## File Organization

### Backend
```
app/
├── main.py              # FastAPI app, lifespan, middleware
├── routers/             # Route handlers (thin, delegate to services)
│   └── items.py
├── services/            # Business logic
│   └── items.py
├── repositories/        # Database access
│   └── items.py
├── models/              # Pydantic models
│   ├── requests.py
│   └── responses.py
├── database.py          # DB connection, session management
└── config.py            # Settings via pydantic-settings
```

### Frontend
```
src/
├── main.ts
├── App.vue
├── api/                 # API client layer
│   ├── client.ts
│   └── items.ts
├── components/          # Reusable UI components
├── composables/         # Shared reactive logic
│   └── useItems.ts
├── views/               # Page-level components
│   └── ItemsView.vue
├── types/               # TypeScript interfaces
│   └── items.ts
└── router/              # Vue Router config
```

---

## Common Patterns

### Composable for API Data

```typescript
// src/composables/useItems.ts
import { ref, onMounted } from 'vue'
import { api } from '@/api/client'
import type { Item } from '@/types/items'

export function useItems() {
  const items = ref<Item[]>([])
  const loading = ref(false)
  const error = ref<Error | null>(null)

  async function fetchItems() {
    loading.value = true
    error.value = null
    try {
      items.value = await api.get<Item[]>('/items')
    } catch (e) {
      error.value = e as Error
    } finally {
      loading.value = false
    }
  }

  onMounted(fetchItems)

  return { items, loading, error, refresh: fetchItems }
}
```

### FastAPI Router Pattern

```python
# app/routers/items.py
from fastapi import APIRouter, Depends, HTTPException
from app.services.items import ItemService
from app.models.items import ItemCreate, ItemResponse

router = APIRouter(prefix="/items", tags=["items"])

@router.get("", response_model=list[ItemResponse])
async def list_items(service: ItemService = Depends()):
    return await service.list_all()

@router.post("", response_model=ItemResponse, status_code=201)
async def create_item(data: ItemCreate, service: ItemService = Depends()):
    return await service.create(data)

@router.get("/{item_id}", response_model=ItemResponse)
async def get_item(item_id: int, service: ItemService = Depends()):
    item = await service.get_by_id(item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    return item
```

---

## Checklist for New Features

- [ ] Database schema/migrations if needed
- [ ] Repository functions for data access
- [ ] Pydantic request/response models
- [ ] Service layer with business logic
- [ ] Router endpoints
- [ ] TypeScript types matching Pydantic models
- [ ] API client functions
- [ ] Vue composable for data fetching (if reusable)
- [ ] Vue components/views
- [ ] Error handling at all layers
- [ ] Loading states in UI
