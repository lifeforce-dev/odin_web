---
applyTo:
  - "**/templates/**"
  - "**/partials/**"
  - "**/static/**/*.css"
  - "**/*.html"
  - "**/*.jinja2"
relatedAgents:
  - agent-python.md.agent  # Always needed for FastAPI backend
---

# Agent: Frontend Base (HTMX + Jinja2 + SSE)

Build and maintain server-rendered frontends with HTMX for interactivity, Jinja2 for templating, and Server-Sent Events for real-time updates. Designed for Python/FastAPI backends.

---

## Configuration

Modify these values to match your project requirements:

```yaml
css_methodology: BEM  # Default. Change to "utility-first" for Tailwind.
template_engine: Jinja2
interactivity: HTMX
realtime: SSE
```

**CSS Decision:** Use BEM class naming by default. If the project uses Tailwind, switch to utility-first and skip BEM.

### Key Behavior Rules

1. **HTMX-aware responses:** Endpoints used by both direct navigation and HTMX **MUST** return full page when not HTMX, and partial when HTMX.
2. **Partial responses from resource routes:** For HTMX POST/DELETE to resource routes (e.g., `/users`), return partial HTML fragments, not JSON.
3. **Route convention:** Resource CRUD routes live at `/{resource}` (e.g., `/users`, `/builds`). Pure partial-only endpoints live under `/partials/*` for fragments not tied to a resource.

### Pinned Versions

```yaml
htmx: "2.0.7"
htmx-ext-sse: "2.2.2"  # HTMX SSE extension
jinja2: "3.1.6"
sse-starlette: "3.1.1"
hyperscript: "0.9.14"  # Optional, for client-side scripting
fastapi: "0.128.0"
```

---

## Vendor JavaScript Locally (If Requested)

For enterprise or air-gapped environments, vendor JS dependencies locally instead of using CDNs:

```bash
# Download exact versions to static/js/
curl -o src/app_name/static/js/htmx.min.js https://unpkg.com/htmx.org@2.0.7/dist/htmx.min.js
curl -o src/app_name/static/js/htmx-ext-sse.js https://unpkg.com/htmx-ext-sse@2.2.2/sse.js
curl -o src/app_name/static/js/hyperscript.min.js https://unpkg.com/hyperscript.org@0.9.14/dist/_hyperscript.min.js
```

**Why vendor locally:**
- No CDN dependency or external requests
- Works in air-gapped/offline environments
- Consistent versions across deployments
- No CORS or CSP issues with external scripts

---

## Project Structure

```
project_root/
├── src/
│   └── app_name/
│       ├── main.py
│       ├── routers/
│       │   └── pages.py           # HTML page routes
│       ├── templates/
│       │   ├── base.html          # Base layout
│       │   ├── pages/             # Full page templates
│       │   │   ├── home.html
│       │   │   └── dashboard.html
│       │   ├── partials/          # HTMX partial templates
│       │   │   ├── user_list.html
│       │   │   └── notification.html
│       │   └── components/        # Reusable template components
│       │       ├── button.html
│       │       └── card.html
│       └── static/
│           ├── css/
│           │   └── main.css
│           ├── js/
│           │   └── app.js         # Minimal JS if needed
│           └── images/
├── pyproject.toml
└── README.md
```

---

## Jinja2 Templates

### Base Template

```html
{# templates/base.html #}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{% block title %}App{% endblock %}</title>
    
    {# HTMX - pin exact version #}
    <script src="{{ url_for('static', path='js/htmx.min.js') }}"></script>
    
    {# SSE extension for HTMX #}
    <script src="{{ url_for('static', path='js/htmx-ext-sse.js') }}"></script>
    
    {# Optional: Hyperscript for simple client interactions #}
    <script src="{{ url_for('static', path='js/hyperscript.min.js') }}"></script>
    
    <link rel="stylesheet" href="{{ url_for('static', path='css/main.css') }}">
    
    {% block head %}{% endblock %}
</head>
<body hx-boost="true">
    <header>
        {% block header %}
        <nav>
            <a href="/">Home</a>
            <a href="/dashboard">Dashboard</a>
        </nav>
        {% endblock %}
    </header>
    
    <main id="main-content">
        {% block content %}{% endblock %}
    </main>
    
    {# Toast/notification container for HTMX responses #}
    <div id="notifications" aria-live="polite"></div>
    
    {% block scripts %}{% endblock %}
</body>
</html>
```

### Page Template

```html
{# templates/pages/dashboard.html #}
{% extends "base.html" %}

{% block title %}Dashboard - App{% endblock %}

{% block content %}
<h1>Dashboard</h1>

{# Load content via HTMX on page load #}
<section hx-get="/partials/stats" 
         hx-trigger="load"
         hx-swap="innerHTML">
    <p>Loading stats...</p>
</section>

{# User list with SSE updates #}
<section hx-ext="sse" 
         sse-connect="/events/users"
         sse-swap="message">
    {% include "partials/user_list.html" %}
</section>

{# Form with HTMX submission - posts to resource route, returns partial #}
<form hx-post="/users" 
      hx-target="#user-list"
      hx-swap="beforeend"
      hx-on::after-request="this.reset()">
    <label for="name">Name</label>
    <input type="text" id="name" name="name" required>
    <button type="submit">Add User</button>
</form>
{% endblock %}
```

### Partial Template

```html
{# templates/partials/user_list.html #}
<ul id="user-list" role="list">
    {% for user in users %}
    <li class="user-item" id="user-{{ user.id }}">
        <span>{{ user.name }}</span>
        <button hx-delete="/users/{{ user.id }}"
                hx-target="#user-{{ user.id }}"
                hx-swap="delete"
                hx-confirm="Delete {{ user.name }}?">
            Delete
        </button>
    </li>
    {% else %}
    <li class="user-item--empty">No users found.</li>
    {% endfor %}
</ul>
```

### Reusable Component

```html
{# templates/components/button.html #}
{# 
  Usage: {% include "components/button.html" with context %}
  Required: text
  Optional: variant (primary|secondary|danger), type (submit|button), disabled
#}
{% set variant = variant | default('primary') %}
{% set type = type | default('button') %}
<button type="{{ type }}" 
        class="btn btn--{{ variant }}"
        {% if disabled %}disabled{% endif %}>
    {{ text }}
</button>
```

---

## Partials Contract

Partials are the core of HTMX interactivity. Every partial template **must** follow this contract:

### Requirements

1. **Single root element with stable ID** - HTMX needs a target
2. **Self-contained** - No implicit dependencies on parent template blocks; all required variables must be passed explicitly
3. **Idempotent rendering** - Same data = same output
4. **Document expected context variables** at top of file

### Partial Template Pattern

```html
{# templates/partials/user_card.html #}
{#
  Partial: User Card
  Context:
    - user: User object with id, name, email, avatar_url
    - show_actions: bool (optional, default True)
  
  Used by:
    - GET /partials/users/{id}
    - SSE event: user-update
#}
{% set show_actions = show_actions | default(true) %}

<article id="user-{{ user.id }}" class="user-card">
    <img src="{{ user.avatar_url }}" alt="">
    <h3>{{ user.name }}</h3>
    <p>{{ user.email }}</p>
    
    {% if show_actions %}
    <div class="user-card__actions">
        <button hx-get="/users/{{ user.id }}/edit"
                hx-target="#user-{{ user.id }}"
                hx-swap="outerHTML">
            Edit
        </button>
    </div>
    {% endif %}
</article>
```

### Partial Naming Convention

```
partials/
├── {entity}_list.html      # List of items (user_list.html)
├── {entity}_item.html      # Single list item (user_item.html)  
├── {entity}_card.html      # Card display (user_card.html)
├── {entity}_form.html      # Create/edit form (user_form.html)
├── {entity}_detail.html    # Full detail view (user_detail.html)
└── {action}_result.html    # Action feedback (delete_result.html)
```

---

## HTMX Patterns

### Core Attributes

```html
{# Basic GET request - loads partial #}
<button hx-get="/partials/user-card" hx-target="#result">
    Load Data
</button>

{# POST with form data - posts to resource route #}
<form hx-post="/users" hx-target="#user-list" hx-swap="beforeend">
    <input name="name" required>
    <button type="submit">Submit</button>
</form>

{# Target and swap strategies #}
<div hx-get="/content"
     hx-target="#container"      
     hx-swap="innerHTML"         
     hx-trigger="click">         
</div>

{# Swap strategies:
   innerHTML  - Replace inner content (default)
   outerHTML  - Replace entire element
   beforeend  - Append inside
   afterend   - Insert after
   delete     - Remove target element (pair with 204 response)
   none       - No swap, just trigger events
#}
```

### Triggers

```html
{# Click (default for buttons) #}
<button hx-get="/data" hx-trigger="click">Click</button>

{# Load on page load #}
<div hx-get="/data" hx-trigger="load"></div>

{# Revealed (lazy loading) #}
<div hx-get="/more" hx-trigger="revealed"></div>

{# Input with debounce #}
<input hx-get="/search" 
       hx-trigger="input changed delay:300ms"
       hx-target="#results"
       name="q">

{# Polling #}
<div hx-get="/status" hx-trigger="every 5s"></div>

{# Custom events #}
<div hx-get="/refresh" hx-trigger="refreshData from:body"></div>
```

### Out-of-Band Swaps

Update multiple elements from a single response:

```html
{# Server response can include multiple elements #}
<div id="main-content">
    Updated main content
</div>

{# This will swap into #notifications regardless of hx-target #}
<div id="notifications" hx-swap-oob="true">
    <p class="toast toast--success">Item saved!</p>
</div>
```

### Loading States

```html
{# Using htmx-indicator #}
<button hx-get="/slow-action" hx-indicator="#spinner">
    Submit
    <span id="spinner" class="htmx-indicator">Loading...</span>
</button>

{# CSS for indicator #}
<style>
.htmx-indicator {
    display: none;
}
.htmx-request .htmx-indicator {
    display: inline;
}
.htmx-request.htmx-indicator {
    display: inline;
}
</style>
```

### Confirmation and Validation

```html
{# Confirm before action #}
<button hx-delete="/item/123" 
        hx-confirm="Are you sure you want to delete this?">
    Delete
</button>

{# Disable during request #}
<button hx-post="/submit"
        hx-disabled-elt="this">
    Submit
</button>

{# Validate before request #}
<form hx-post="/users"
      hx-validate="true">
    <input type="email" required>
    <button type="submit">Submit</button>
</form>
```

---

## Server-Sent Events (SSE)

### FastAPI SSE Endpoint

```python
# routers/events.py
from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse
import asyncio

router = APIRouter()


async def event_generator():
    """Generate events for SSE stream."""
    while True:
        # Check for new data
        data = await get_latest_data()
        
        if data:
            # Yield HTML fragment for HTMX to swap
            yield {
                'event': 'message',
                'data': render_template('partials/notification.html', data=data),
            }
        
        await asyncio.sleep(1)


@router.get('/events/notifications')
async def notifications_stream():
    return EventSourceResponse(event_generator())


# Named events for different update types
async def multi_event_generator():
    while True:
        yield {
            'event': 'user-update',
            'data': '<div>User data...</div>',
        }
        yield {
            'event': 'stats-update', 
            'data': '<div>Stats data...</div>',
        }
        await asyncio.sleep(5)
```

### SSE with HTMX

```html
{# Connect to SSE stream #}
<div hx-ext="sse" sse-connect="/events/notifications">
    {# Default message event #}
    <div sse-swap="message"></div>
    
    {# Named events #}
    <div sse-swap="user-update"></div>
    <div sse-swap="stats-update"></div>
</div>

{# Close connection on element removal #}
<div hx-ext="sse" 
     sse-connect="/events/live"
     sse-close="close-stream">
    <div sse-swap="message"></div>
    <button _="on click trigger close-stream">Disconnect</button>
</div>
```

### SSE Response Headers

```python
# Ensure proper SSE headers in FastAPI
from sse_starlette.sse import EventSourceResponse

@router.get('/events/stream')
async def stream():
    return EventSourceResponse(
        event_generator(),
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',  # Disable nginx buffering
        }
    )
```

### SSE Deployment Considerations

**Common footguns that break SSE in production:**

#### 1. Reverse Proxy Buffering

Nginx and Apache buffer responses by default, breaking real-time delivery:

```nginx
# nginx.conf - Required for SSE endpoints
location /events/ {
    proxy_pass http://localhost:8000;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    chunked_transfer_encoding off;
}
```

#### 2. Heartbeat/Ping

SSE connections can silently die. Always send periodic heartbeats:

```python
async def event_generator():
    while True:
        if data := await get_new_data():
            yield {'event': 'message', 'data': data}
        else:
            # Send comment as heartbeat (doesn't trigger client handler)
            yield {'comment': 'ping'}
        await asyncio.sleep(15)  # Max 30s between messages
```

#### 3. Backpressure Handling

Slow clients can cause memory issues. Use timeouts:

```python
from sse_starlette.sse import EventSourceResponse

@router.get('/events/stream')
async def stream():
    return EventSourceResponse(
        event_generator(),
        ping=15,           # Built-in ping every 15s
        send_timeout=30,   # Timeout slow sends
    )
```

#### 4. Connection Limits

Each SSE connection holds a file descriptor:

```python
# Limit concurrent connections per endpoint
MAX_SSE_CONNECTIONS = 100
active_connections = 0

@router.get('/events/stream')
async def stream():
    global active_connections
    if active_connections >= MAX_SSE_CONNECTIONS:
        raise HTTPException(503, 'Too many connections')
    active_connections += 1
    try:
        return EventSourceResponse(event_generator())
    finally:
        active_connections -= 1
```

#### 5. Load Balancer Timeouts

HAProxy/ELB/ALB must have timeouts longer than heartbeat interval:

```
# HAProxy
timeout client 60s   # Must be > ping interval
timeout server 60s
```
```

---

## FastAPI Integration

### Template Configuration

```python
# app_name/templating.py - Separate module to avoid circular imports
from fastapi.templating import Jinja2Templates

templates = Jinja2Templates(directory='src/app_name/templates')
```

```python
# main.py - Imports routers, routers don't import main
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app_name.routers import pages, users, partials

app = FastAPI()

# Mount static files
app.mount('/static', StaticFiles(directory='src/app_name/static'), name='static')

# Include routers
app.include_router(pages.router)
app.include_router(users.router)
app.include_router(partials.router)
```

### Page Routes

```python
# routers/pages.py
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from app_name.templating import templates  # Import from templating, not main

router = APIRouter()


@router.get('/', response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name='pages/home.html',
        context={'title': 'Home'},
    )


@router.get('/dashboard', response_class=HTMLResponse)
async def dashboard(request: Request):
    users = await get_users()
    return templates.TemplateResponse(
        request=request,
        name='pages/dashboard.html',
        context={'users': users},
    )
```

### HTMX Partial Routes

```python
# routers/partials.py
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from app_name.templating import templates

router = APIRouter(prefix='/partials')


@router.get('/user-list', response_class=HTMLResponse)
async def user_list(request: Request):
    users = await get_users()
    return templates.TemplateResponse(
        request=request,
        name='partials/user_list.html',
        context={'users': users},
    )
```

```python
# routers/users.py - Resource routes that return partials for HTMX
from fastapi import APIRouter, Request, Response, Form
from fastapi.responses import HTMLResponse

from app_name.templating import templates

router = APIRouter(prefix='/users', tags=['users'])


@router.post('', response_class=HTMLResponse)
async def create_user(request: Request, name: str = Form(...)):
    user = await create_user_in_db(name)
    
    # Return partial for HTMX to append to list
    return templates.TemplateResponse(
        request=request,
        name='partials/user_item.html',
        context={'user': user},
    )


@router.delete('/{user_id}')
async def delete_user(user_id: int):
    await delete_user_from_db(user_id)
    # Return 204 No Content - pair with hx-swap="delete" on client
    return Response(status_code=204)
```

### HTMX-Aware Responses

Endpoints serving both direct navigation and HTMX must branch on the `HX-Request` header:

```python
from fastapi import APIRouter, Request, Depends, Header
from fastapi.responses import HTMLResponse

from app_name.templating import templates

router = APIRouter()


def is_htmx_request(hx_request: str | None = Header(None, alias='HX-Request')) -> bool:
    return hx_request == 'true'


@router.get('/page', response_class=HTMLResponse)
async def page(request: Request, htmx: bool = Depends(is_htmx_request)):
    context = {'data': get_data()}
    
    if htmx:
        # Return partial for HTMX requests
        return templates.TemplateResponse(
            request=request,
            name='partials/content.html',
            context=context,
        )
    
    # Return full page for direct navigation
    return templates.TemplateResponse(
        request=request,
        name='pages/full_page.html',
        context=context,
    )
```

### Toast Notifications via OOB

```python
@router.post('/action')
async def perform_action(request: Request):
    result = await do_action()
    
    # Include toast notification via out-of-band swap
    return templates.TemplateResponse(
        request=request,
        name='partials/action_result.html',
        context={
            'result': result,
            'toast_message': 'Action completed!',
            'toast_type': 'success',
        },
    )
```

```html
{# partials/action_result.html #}
<div id="result">
    {{ result }}
</div>

{# Out-of-band toast #}
<div id="notifications" hx-swap-oob="beforeend">
    <div class="toast toast--{{ toast_type }}" 
         role="alert"
         _="on load wait 3s then remove me">
        {{ toast_message }}
    </div>
</div>
```

---

## CSS Patterns

### HTMX State Classes

```css
/* Loading states */
.htmx-request {
    opacity: 0.5;
    pointer-events: none;
}

.htmx-indicator {
    display: none;
}

.htmx-request .htmx-indicator,
.htmx-request.htmx-indicator {
    display: inline-block;
}

/* Transition for swapped content */
.htmx-swapping {
    opacity: 0;
    transition: opacity 0.2s ease-out;
}

.htmx-settling {
    opacity: 1;
    transition: opacity 0.2s ease-in;
}

.htmx-added {
    animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
}
```

### Toast Notifications

```css
#notifications {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.toast {
    padding: 1rem;
    border-radius: 0.375rem;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    animation: slideIn 0.3s ease-out;
}

.toast--success {
    background: #10b981;
    color: white;
}

.toast--error {
    background: #ef4444;
    color: white;
}

@keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
}
```

---

## Hyperscript (Optional)

For simple client-side interactions without JavaScript files:

```html
{# Toggle visibility #}
<button _="on click toggle .hidden on #details">
    Toggle Details
</button>
<div id="details" class="hidden">Details here</div>

{# Remove element after delay #}
<div class="toast" _="on load wait 3s then remove me">
    Notification
</div>

{# Copy to clipboard #}
<button _="on click writeText(#code.innerText) to navigator.clipboard
           then add .copied to me
           wait 2s
           remove .copied from me">
    Copy Code
</button>

{# Keyboard shortcuts #}
<body _="on keydown[key=='Escape'] trigger closeModal">

{# Form reset after submit #}
<form hx-post="/submit" _="on htmx:afterRequest reset() me">
```

---

## Accessibility

### HTMX and Screen Readers

```html
{# Announce dynamic content updates #}
<div aria-live="polite" aria-atomic="true" id="status">
    {# HTMX updates here will be announced #}
</div>

{# Loading state announcements #}
<button hx-get="/data" 
        hx-indicator="#loading"
        aria-busy="false"
        _="on htmx:beforeRequest set @aria-busy to 'true'
           on htmx:afterRequest set @aria-busy to 'false'">
    Load
</button>
<span id="loading" class="htmx-indicator" role="status">
    Loading...
</span>

{# Focus management after swap #}
<div hx-get="/form" 
     hx-swap="innerHTML"
     _="on htmx:afterSwap focus() the first <input/> in me">
</div>
```

### Form Accessibility

```html
<form hx-post="/submit">
    <div class="field">
        <label for="email">Email address</label>
        <input type="email" 
               id="email" 
               name="email" 
               required
               aria-describedby="email-hint email-error">
        <p id="email-hint" class="hint">We will never share your email.</p>
        <p id="email-error" class="error" aria-live="assertive"></p>
    </div>
    
    <button type="submit">Submit</button>
</form>
```

---

## Security Considerations

### Internal Tools vs Public-Facing Apps

For **internal-only tools** (behind VPN/firewall, read-only data display):
- CSRF tokens may not be needed
- Authentication may be handled at network level
- Focus on data validation and XSS prevention

For **public-facing apps** or apps with **write operations**, warn that additional security is needed:
- CSRF protection for state-changing requests
- Authentication/authorization middleware
- Rate limiting on endpoints

**If building a public app or one with sensitive operations, inform the user that CSRF/auth patterns should be added and reference FastAPI security docs.**

### Always Required

```python
# Jinja2 autoescaping is ON by default - don't disable it
templates = Jinja2Templates(directory='templates')  # Autoescapes by default

# If you must render raw HTML, be explicit:
{{ trusted_html | safe }}  # Only use for HTML you control/sanitize
```

```html
{# Content Security Policy header recommended #}
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; script-src 'self'">
```

---

## Common Anti-Patterns

| Anti-Pattern | Issue | Correct Approach |
|--------------|-------|------------------|
| JavaScript for everything | Unnecessary complexity | Use HTMX attributes |
| Full page reloads | Poor UX | Use `hx-boost="true"` |
| Inline JavaScript | Hard to maintain | Use Hyperscript or minimal JS file |
| No loading states | Confusing UX | Use `hx-indicator` |
| Ignoring accessibility | Excludes users | Use `aria-live`, focus management |
| Polling when SSE works | Wasteful | Use SSE for real-time updates |
| Giant partial templates | Hard to maintain | Small, focused partials |
| No OOB for notifications | Complex JS needed | Use `hx-swap-oob` |
| Forgetting `hx-target` | Replaces wrong element | Always specify target |
| No confirmation on delete | Accidental data loss | Use `hx-confirm` |
