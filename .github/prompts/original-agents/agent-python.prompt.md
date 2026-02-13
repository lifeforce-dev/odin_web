---
applyTo: "**/*.py"
relatedAgents:
  - agent-sqlite.md.agent      # When working with database/
  - agent-frontend-base.md.agent  # When working with templates/
---

# Agent: Python 3.12+ & FastAPI Backend Standards

## Overview

This agent governs Python 3.12+ development with FastAPI backends, Docker deployment, and modern tooling. It combines language standards, web framework patterns, infrastructure, and plugin architecture into a single reference.

---

## Quick Start Checklist for New Modules

Before implementing a new feature module, verify:

1. [ ] `pyproject.toml` has dependencies with compatible release specifiers (`~=`)
2. [ ] Module follows `client.py` + `service/` subfolder pattern (if both external + internal logic)
3. [ ] Router factory returns `APIRouter`, doesn't create at module level
4. [ ] All public functions/classes have type annotations and docstrings
5. [ ] `__all__` exports defined in `__init__.py`
6. [ ] Tests exist in `tests/` mirroring source structure
7. [ ] Dockerfile multi-stage build updated if new system deps needed

---

## Pinned Versions

When generating **example code** in responses, use these exact versions to avoid hallucinating non-existent APIs. When generating `pyproject.toml`, prefer compatible release specifiers (`~=`) to allow patch updates.

| Package     | Version  | pyproject.toml example   |
| ----------- | -------- | ------------------------ |
| Python      | 3.12+    | `requires-python = ">=3.12"` |
| FastAPI     | 0.115.12 | `fastapi~=0.115.12`      |
| Pydantic    | 2.11.4   | `pydantic~=2.11.4`       |
| Uvicorn     | 0.35.0   | `uvicorn[standard]~=0.35.0` |
| Starlette   | 0.46.2   | (comes with FastAPI)     |
| httpx       | 0.28.1   | `httpx~=0.28.1`          |
| SQLAlchemy  | 2.0.41   | `sqlalchemy~=2.0.41`     |
| Alembic     | 1.15.2   | `alembic~=1.15.2`        |
| pytest      | 8.3.5    | `pytest~=8.3.5`          |
| ruff        | 0.11.10  | `ruff~=0.11.10`          |

---

## Project Structure

```text
project_root/
├── pyproject.toml          # Single source of truth for deps and tools
├── src/
│   └── package_name/
│       ├── __init__.py
│       ├── __main__.py     # Entry point: python -m package_name
│       ├── main.py         # FastAPI app factory
│       ├── config.py       # Settings via pydantic-settings
│       ├── dependencies.py # Shared FastAPI dependencies
│       ├── models/         # Pydantic schemas
│       ├── routers/        # API route modules
│       ├── services/       # Business logic
│       └── plugins/        # Plugin architecture (if needed)
├── tests/
│   ├── conftest.py
│   └── ...
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── docker-compose.override.yml
└── .github/
    └── workflows/
```

---

## pyproject.toml Reference

```toml
[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "package-name"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi~=0.115.12",
    "pydantic~=2.11.4",
    "pydantic-settings~=2.8.1",
    "uvicorn[standard]~=0.35.0",
    "httpx~=0.28.1",
]

[project.optional-dependencies]
dev = [
    "pytest~=8.3.5",
    "pytest-asyncio~=0.26.0",
    "pytest-cov~=6.1.1",
    "ruff~=0.11.10",
    "pyright~=1.1.400",
    "pre-commit~=4.2.0",
]

[project.scripts]
package-name = "package_name.__main__:main"

[project.entry-points."package_name.plugins"]
# Plugin discovery - see Plugin Architecture section

[tool.setuptools.packages.find]
where = ["src"]

[tool.ruff]
target-version = "py312"
line-length = 100
src = ["src", "tests"]

[tool.ruff.lint]
select = [
    "E",      # pycodestyle errors
    "W",      # pycodestyle warnings
    "F",      # Pyflakes
    "I",      # isort
    "B",      # flake8-bugbear
    "C4",     # flake8-comprehensions
    "UP",     # pyupgrade
    "SIM",    # flake8-simplify
    "TCH",    # flake8-type-checking
    "RUF",    # Ruff-specific
]
ignore = ["E501"]  # Line length handled by formatter

[tool.ruff.lint.isort]
known-first-party = ["package_name"]

[tool.pyright]
pythonVersion = "3.12"
typeCheckingMode = "strict"
include = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
addopts = "-v --tb=short"
```

---

## Coding Standards

### Type Annotations

**Required everywhere.** No untyped public APIs.

```python
# Always annotate function signatures
def process_items(items: list[str], limit: int = 10) -> dict[str, int]:
    ...

# Use modern generic syntax (3.12+)
def first[T](items: list[T]) -> T | None:
    return items[0] if items else None

# Use | for unions, not Union
def fetch(url: str) -> Response | None:
    ...

# Type aliases for complex types
type UserMap = dict[str, User]
type Handler = Callable[[Request], Response]
```

### Strings

- Use **double quotes** for strings: `"hello"`
- Use **f-strings** for interpolation: `f"Hello, {name}"`
- Use **triple double quotes** for docstrings: `"""Docstring."""`

### Imports

Order: stdlib > third-party > local. Use absolute imports.

```python
import logging
from collections.abc import Callable
from pathlib import Path

import httpx
from pydantic import BaseModel

from package_name.utils import helper
```

### Module Exports

Define `__all__` in modules with public APIs to make exports explicit:

```python
# package_name/models/user.py
__all__ = ["User", "UserCreate", "UserUpdate"]

class User(BaseModel):
    ...

class UserCreate(BaseModel):
    ...

class UserUpdate(BaseModel):
    ...
```

### Modern Python Features (3.12+)

```python
# Use native generics, not typing module
list[str]           # not List[str]
dict[str, int]      # not Dict[str, int]
tuple[int, ...]     # not Tuple[int, ...]
type[MyClass]       # not Type[MyClass]

# Use | for union types
str | None          # not Optional[str]
int | str           # not Union[int, str]

# Use type statement for aliases (3.12+)
type Vector = list[float]

# Use match statements for complex conditionals
match status:
    case "pending":
        handle_pending()
    case "complete" | "done":
        handle_complete()
    case _:
        handle_unknown()

# Use structural pattern matching
match response:
    case {"status": 200, "data": data}:
        return data
    case {"status": status, "error": msg}:
        raise APIError(status, msg)
```

### Data Classes and Models

Use `@dataclass` for simple data containers, Pydantic `BaseModel` for validation.

```python
from dataclasses import dataclass
from pydantic import BaseModel, Field

# Simple data container
@dataclass(frozen=True, slots=True)
class Point:
    x: float
    y: float

# Validated external data
class UserInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: str
    age: int = Field(ge=0, le=150)
```

### Error Handling

```python
# Use specific exceptions
class ConfigurationError(Exception):
    """Raised when configuration is invalid."""

# Include context in errors
def load_config(path: Path) -> Config:
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")
    
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        raise ConfigurationError(f"Invalid JSON in {path}: {e}") from e
    
    return Config.model_validate(data)

# Use early returns to reduce nesting
def process(data: Data | None) -> Result:
    if data is None:
        raise ValueError("data is required")
    
    if not data.is_valid:
        raise ValueError(f"Invalid data: {data.validation_error}")
    
    return do_processing(data)
```

### File and Path Operations

**Always use `pathlib`**, never `os.path`.

```python
from pathlib import Path

# Path operations
config_path = Path("config") / "settings.json"
config_path.parent.mkdir(parents=True, exist_ok=True)

# Reading/writing
content = config_path.read_text()
config_path.write_text(json.dumps(data))

# Iteration
for py_file in Path("src").rglob("*.py"):
    process(py_file)
```

### Logging

Use f-strings directly in log calls for readability. This is a deliberate choice—the minor performance cost of f-string evaluation is acceptable for code clarity, and in practice hot paths should use structured logging or metrics instead.

```python
import logging

logger = logging.getLogger(__name__)

def process_user(user_id: int) -> None:
    logger.info(f"Processing user {user_id}")
    try:
        result = do_work(user_id)
        logger.debug(f"Result for user {user_id}: {result}")
    except ValueError as e:
        logger.error(f"Failed to process user {user_id}: {e}")
        raise
```

---

## Module Organization Pattern

For modules with both external clients and internal business logic, use this structure:

```text
package_name/
└── weather/
    ├── __init__.py      # Re-exports public API
    ├── client.py        # External API client (httpx)
    ├── models.py        # Pydantic models for this domain
    └── service/
        ├── __init__.py
        ├── forecast.py  # Business logic using client
        └── alerts.py    # More business logic
```

```python
# weather/__init__.py
__all__ = ["WeatherClient", "WeatherService", "Forecast", "Alert"]

from package_name.weather.client import WeatherClient
from package_name.weather.models import Alert, Forecast
from package_name.weather.service import WeatherService
```

```python
# weather/client.py
"""External weather API client."""
import httpx

class WeatherClient:
    """Thin wrapper around external weather API."""
    
    def __init__(self, api_key: str, base_url: str = "https://api.weather.com") -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers={"Authorization": f"Bearer {api_key}"},
        )
    
    async def get_forecast(self, location: str) -> dict:
        """Fetch raw forecast data from API."""
        response = await self._client.get(f"/forecast/{location}")
        response.raise_for_status()
        return response.json()
```

```python
# weather/service/__init__.py
__all__ = ["WeatherService"]

from package_name.weather.service.forecast import WeatherService
```

```python
# weather/service/forecast.py
"""Weather business logic."""
from package_name.weather.client import WeatherClient
from package_name.weather.models import Forecast

class WeatherService:
    """Business logic layer for weather operations."""
    
    def __init__(self, client: WeatherClient) -> None:
        self._client = client
    
    async def get_forecast(self, location: str) -> Forecast:
        """Get processed forecast with business rules applied."""
        raw = await self._client.get_forecast(location)
        return Forecast.model_validate(raw)
```

---

## FastAPI Patterns

### App Factory

```python
# main.py
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from package_name.config import Settings
from package_name.routers import health, users

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Startup
    app.state.settings = Settings()
    yield
    # Shutdown
    pass

def create_app() -> FastAPI:
    app = FastAPI(
        title="API",
        lifespan=lifespan,
    )
    app.include_router(health.router)
    app.include_router(users.router, prefix="/users", tags=["users"])
    return app

app = create_app()
```

### Router Factory Pattern

Routers should be created via factory functions, not at module level:

```python
# routers/users.py
from fastapi import APIRouter, Depends

from package_name.dependencies import get_db
from package_name.models.user import User, UserCreate

def create_router() -> APIRouter:
    router = APIRouter()
    
    @router.get("/")
    async def list_users(db = Depends(get_db)) -> list[User]:
        ...
    
    @router.post("/")
    async def create_user(user: UserCreate, db = Depends(get_db)) -> User:
        ...
    
    return router

router = create_router()
```

### Configuration with pydantic-settings

```python
# config.py
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )
    
    debug: bool = False
    database_url: str = Field(alias="DATABASE_URL")
    api_key: str = Field(alias="API_KEY")
    
    @property
    def is_development(self) -> bool:
        return self.debug
```

### Dependency Injection

```python
# dependencies.py
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request

from package_name.config import Settings

def get_settings(request: Request) -> Settings:
    return request.app.state.settings

SettingsDep = Annotated[Settings, Depends(get_settings)]

async def get_db(settings: SettingsDep) -> AsyncIterator[Database]:
    db = Database(settings.database_url)
    try:
        yield db
    finally:
        await db.close()

DatabaseDep = Annotated[Database, Depends(get_db)]
```

### Response Models

```python
# models/responses.py
from pydantic import BaseModel

class ErrorResponse(BaseModel):
    detail: str
    code: str | None = None

class PaginatedResponse[T](BaseModel):
    items: list[T]
    total: int
    page: int
    page_size: int
    
    @property
    def has_next(self) -> bool:
        return self.page * self.page_size < self.total
```

### Exception Handlers

```python
# exceptions.py
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

class AppError(Exception):
    def __init__(self, message: str, code: str, status_code: int = 400) -> None:
        self.message = message
        self.code = code
        self.status_code = status_code

def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.message, "code": exc.code},
        )
```

---

## Plugin Architecture

For extensible applications, use entry points:

```toml
# pyproject.toml
[project.entry-points."package_name.plugins"]
builtin = "package_name.plugins.builtin:BuiltinPlugin"
```

```python
# plugins/base.py
from abc import ABC, abstractmethod

class PluginBase(ABC):
    """Base class for plugins."""
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Plugin identifier."""
        ...
    
    @abstractmethod
    async def initialize(self) -> None:
        """Called on app startup."""
        ...
    
    @abstractmethod
    async def shutdown(self) -> None:
        """Called on app shutdown."""
        ...
```

```python
# plugins/loader.py
from importlib.metadata import entry_points

from package_name.plugins.base import PluginBase

def load_plugins(group: str = "package_name.plugins") -> list[PluginBase]:
    """Load all registered plugins."""
    plugins: list[PluginBase] = []
    eps = entry_points(group=group)
    
    for ep in eps:
        plugin_class = ep.load()
        plugins.append(plugin_class())
    
    return plugins
```

---

## Testing Patterns

### Fixtures

```python
# conftest.py
import pytest
from fastapi.testclient import TestClient

from package_name.main import create_app

@pytest.fixture
def app():
    return create_app()

@pytest.fixture
def client(app):
    return TestClient(app)
```

### Async Tests

```python
# tests/test_users.py
import pytest

@pytest.mark.asyncio
async def test_create_user(client):
    response = client.post("/users/", json={"name": "Test", "email": "test@example.com"})
    assert response.status_code == 201
    assert response.json()["name"] == "Test"
```

### Mocking External Services

```python
from unittest.mock import AsyncMock

@pytest.fixture
def mock_weather_client():
    client = AsyncMock(spec=WeatherClient)
    client.get_forecast.return_value = {"temp": 72, "conditions": "sunny"}
    return client

async def test_weather_service(mock_weather_client):
    service = WeatherService(client=mock_weather_client)
    forecast = await service.get_forecast("NYC")
    assert forecast.temp == 72
```

---

## Docker Deployment

### Multi-Stage Dockerfile

```dockerfile
# docker/Dockerfile
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Build stage - install dependencies
FROM base AS builder

RUN pip install build

COPY pyproject.toml .
COPY src/ src/

RUN python -m build --wheel
RUN pip wheel --no-deps --wheel-dir /wheels dist/*.whl

# Runtime stage
FROM base AS runtime

# Install tini for proper signal handling
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd --create-home --shell /bin/bash app
USER app

COPY --from=builder /wheels /wheels
RUN pip install --user /wheels/*.whl

ENV PATH="/home/app/.local/bin:$PATH"

EXPOSE 8000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "package_name.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Docker Compose

```yaml
# docker/docker-compose.yml
services:
  api:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/app
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: app
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d app"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

### Development Override

```yaml
# docker/docker-compose.override.yml
services:
  api:
    build:
      target: base
    volumes:
      - ../src:/app/src:ro
    command: >
      uvicorn package_name.main:app
      --host 0.0.0.0
      --port 8000
      --reload
      --reload-dir /app/src
    environment:
      - DEBUG=true
```

### Nginx Reverse Proxy

```nginx
# docker/nginx.conf
upstream api {
    server api:8000;
}

server {
    listen 80;
    server_name localhost;

    location / {
        proxy_pass http://api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # For SSE endpoints, add: proxy_buffering off;
    # See agent-frontend-base.md.agent for full SSE configuration.
}
```

---

## Anti-Patterns to Avoid

| Don't | Do Instead |
|-------|------------|
| `from typing import List, Dict, Optional` | `list[str]`, `dict[str, int]`, `str \| None` |
| `os.path.join()` | `Path() / "subdir"` |
| Global mutable state | Dependency injection |
| `@app.on_event("startup")` | `lifespan` context manager |
| `print()` for debugging | `logging.debug()` |
| Bare `except:` | `except SpecificError:` |
| `requirements.txt` for apps | `pyproject.toml` |
| `setup.py` | `pyproject.toml` with setuptools |
| Router at module level without factory | Router factory function |
| `Union[X, None]` | `X \| None` |
| `Optional[X]` | `X \| None` |

---

## File Templates

### `__main__.py`

```python
"""Entry point for python -m package_name."""
import uvicorn

from package_name.config import Settings

def main() -> None:
    settings = Settings()
    uvicorn.run(
        "package_name.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.debug,
    )

if __name__ == "__main__":
    main()
```

### `__init__.py` with exports

```python
"""Package public API."""
__all__ = ["create_app", "Settings"]

from package_name.config import Settings
from package_name.main import create_app
```

---

## Version Checking

When unsure about an API, verify against pinned versions. Do not invent parameters or methods.

```python
# Correct FastAPI 0.115+ patterns
from fastapi import FastAPI
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield

app = FastAPI(lifespan=lifespan)  # Not on_event decorators
```

```python
# Correct Pydantic v2 patterns
from pydantic import BaseModel, Field, ConfigDict

class Model(BaseModel):
    model_config = ConfigDict(strict=True)  # Not class Config
    
    name: str = Field(min_length=1)  # Not @validator
```

---

## OPTIONAL: Authentication Patterns

> **Skip this section** for internal tools, prototypes, or apps where auth is handled at the network level (VPN, reverse proxy, etc.). Include only when the app itself must authenticate users.

### JWT Authentication (When Needed)

```python
# dependencies.py - Add only if app requires user authentication
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel

from package_name.config import Settings

security = HTTPBearer()


class TokenPayload(BaseModel):
    sub: str  # user_id
    exp: datetime


def create_access_token(user_id: str, settings: Settings) -> str:
    """Create JWT access token."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    settings: Settings = Depends(get_settings),
) -> str:
    """Validate JWT and return user_id. Raise 401 if invalid."""
    token = credentials.credentials
    
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token payload")
        return user_id
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


# Type alias for dependency injection
CurrentUser = Annotated[str, Depends(get_current_user)]
```

```python
# Usage in router (only if auth is needed)
from package_name.dependencies import CurrentUser

@router.get("/me")
async def get_current_user_info(user_id: CurrentUser) -> dict:
    return {"user_id": user_id}
```

### Config for Auth (When Needed)

```python
# config.py - Add these fields only if using JWT
class Settings(BaseSettings):
    # ... other fields ...
    
    # Auth settings - only include if app needs authentication
    secret_key: str = Field(alias="SECRET_KEY")
    access_token_expire_minutes: int = 30
```

### Dependencies for Auth (pyproject.toml)

```toml
# Add only if using JWT authentication
dependencies = [
    # ... other deps ...
    "python-jose[cryptography]~=3.3.0",
]
```
