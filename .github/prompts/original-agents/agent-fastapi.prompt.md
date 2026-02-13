---
applyTo:
  - "**/routers/**"
  - "**/main.py"
  - "**/dependencies.py"
  - "**/schemas/**"
relatedAgents:
  - agent-python.md.agent  # Always needed for Python standards
  - agent-sqlite.md.agent  # When using SQLite database
---

# Agent: FastAPI Builder

Build and maintain FastAPI applications following modern Python and API best practices.

---

## Configuration

Modify these values to match your project requirements:

```yaml
python_version: "3.12"
fastapi_version: "0.115.x"
async_orm: SQLAlchemy  # or Tortoise-ORM
validation: pydantic v2
auth: OAuth2/JWT  # or API keys
```

### Pinned Versions

```yaml
fastapi: "0.115.x"
uvicorn: "0.34.x"
pydantic: "2.x"
sqlalchemy: "2.x"
httpx: "0.28.x"  # For testing
```

---

## Project Structure

```
project_root/
├── src/
│   └── app_name/
│       ├── __init__.py
│       ├── main.py              # FastAPI app entry
│       ├── config.py            # Settings management
│       ├── dependencies.py      # Shared dependencies
│       ├── routers/
│       │   ├── __init__.py
│       │   ├── users.py
│       │   └── items.py
│       ├── models/              # Database models
│       │   ├── __init__.py
│       │   └── user.py
│       ├── schemas/             # Pydantic models
│       │   ├── __init__.py
│       │   └── user.py
│       └── services/            # Business logic
│           ├── __init__.py
│           └── user_service.py
├── tests/
│   ├── conftest.py
│   └── test_users.py
├── pyproject.toml
└── README.md
```

---

## Application Setup

### Main Application

```python
# src/app_name/main.py
from contextlib import asynccontextmanager
from fastapi import FastAPI

from app_name.config import settings
from app_name.routers import users, items


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await initialize_database()
    yield
    # Shutdown
    await cleanup_resources()


app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    lifespan=lifespan,
)

app.include_router(users.router, prefix='/users', tags=['users'])
app.include_router(items.router, prefix='/items', tags=['items'])


@app.get('/health')
async def health_check() -> dict[str, str]:
    return {'status': 'healthy'}
```

### Configuration with Pydantic Settings

```python
# src/app_name/config.py
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file='.env',
        env_file_encoding='utf-8',
        case_sensitive=False,
    )
    
    app_name: str = 'MyApp'
    version: str = '0.1.0'
    debug: bool = False
    
    database_url: str
    secret_key: str
    
    # Optional with defaults
    log_level: str = 'INFO'
    cors_origins: list[str] = ['http://localhost:3000']


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
```

---

## Pydantic Schemas

### Request and Response Models

```python
# src/app_name/schemas/user.py
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, ConfigDict


class UserBase(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=100)


class UserCreate(UserBase):
    password: str = Field(min_length=8)


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    name: str | None = Field(default=None, min_length=1, max_length=100)


class UserResponse(UserBase):
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    created_at: datetime
    is_active: bool


class UserList(BaseModel):
    items: list[UserResponse]
    total: int
    page: int
    page_size: int
```

### Validation Patterns

```python
from pydantic import BaseModel, field_validator, model_validator
from typing import Self


class OrderCreate(BaseModel):
    product_id: int
    quantity: int = Field(gt=0, le=100)
    
    @field_validator('product_id')
    @classmethod
    def validate_product_exists(cls, v: int) -> int:
        # Note: For async validation, do in endpoint/service
        if v <= 0:
            raise ValueError('product_id must be positive')
        return v


class DateRange(BaseModel):
    start_date: datetime
    end_date: datetime
    
    @model_validator(mode='after')
    def validate_date_range(self) -> Self:
        if self.end_date <= self.start_date:
            raise ValueError('end_date must be after start_date')
        return self
```

---

## Router Patterns

```python
# src/app_name/routers/users.py
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app_name.dependencies import get_db, get_current_user
from app_name.schemas.user import UserCreate, UserResponse, UserUpdate, UserList
from app_name.services.user_service import UserService
from app_name.models.user import User

router = APIRouter()


@router.post('/', response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_data: UserCreate,
    db: AsyncSession = Depends(get_db),
) -> User:
    service = UserService(db)
    
    if await service.get_by_email(user_data.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail='Email already registered',
        )
    
    return await service.create(user_data)


@router.get('/', response_model=UserList)
async def list_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> dict:
    service = UserService(db)
    users, total = await service.list(page=page, page_size=page_size)
    
    return {
        'items': users,
        'total': total,
        'page': page,
        'page_size': page_size,
    }


@router.get('/{user_id}', response_model=UserResponse)
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
) -> User:
    service = UserService(db)
    user = await service.get(user_id)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail='User not found',
        )
    
    return user


@router.patch('/{user_id}', response_model=UserResponse)
async def update_user(
    user_id: int,
    user_data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    if current_user.id != user_id and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Not authorized to update this user',
        )
    
    service = UserService(db)
    user = await service.update(user_id, user_data)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail='User not found',
        )
    
    return user


@router.delete('/{user_id}', status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Admin access required',
        )
    
    service = UserService(db)
    deleted = await service.delete(user_id)
    
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail='User not found',
        )
```

---

## Dependencies

```python
# src/app_name/dependencies.py
from collections.abc import AsyncGenerator
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app_name.database import async_session_maker
from app_name.models.user import User
from app_name.services.auth_service import AuthService

oauth2_scheme = OAuth2PasswordBearer(tokenUrl='auth/token')


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    auth_service = AuthService(db)
    user = await auth_service.get_user_from_token(token)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Invalid or expired token',
            headers={'WWW-Authenticate': 'Bearer'},
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='User account is disabled',
        )
    
    return user


async def get_admin_user(
    current_user: User = Depends(get_current_user),
) -> User:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Admin access required',
        )
    return current_user
```

---

## Service Layer

Keep business logic in services, not routes:

```python
# src/app_name/services/user_service.py
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app_name.models.user import User
from app_name.schemas.user import UserCreate, UserUpdate
from app_name.services.password_service import hash_password


class UserService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
    
    async def get(self, user_id: int) -> User | None:
        result = await self.db.execute(
            select(User).where(User.id == user_id)
        )
        return result.scalar_one_or_none()
    
    async def get_by_email(self, email: str) -> User | None:
        result = await self.db.execute(
            select(User).where(User.email == email)
        )
        return result.scalar_one_or_none()
    
    async def list(
        self,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[User], int]:
        offset = (page - 1) * page_size
        
        # Get total count
        count_result = await self.db.execute(select(func.count(User.id)))
        total = count_result.scalar_one()
        
        # Get paginated results
        result = await self.db.execute(
            select(User)
            .order_by(User.created_at.desc())
            .offset(offset)
            .limit(page_size)
        )
        users = list(result.scalars().all())
        
        return users, total
    
    async def create(self, data: UserCreate) -> User:
        user = User(
            email=data.email,
            name=data.name,
            password_hash=hash_password(data.password),
        )
        self.db.add(user)
        await self.db.flush()
        await self.db.refresh(user)
        return user
    
    async def update(self, user_id: int, data: UserUpdate) -> User | None:
        user = await self.get(user_id)
        if not user:
            return None
        
        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(user, field, value)
        
        await self.db.flush()
        await self.db.refresh(user)
        return user
    
    async def delete(self, user_id: int) -> bool:
        user = await self.get(user_id)
        if not user:
            return False
        
        await self.db.delete(user)
        return True
```

---

## Error Handling

```python
# src/app_name/exceptions.py
from fastapi import HTTPException, status


class AppException(Exception):
    def __init__(self, message: str, code: str | None = None) -> None:
        self.message = message
        self.code = code
        super().__init__(message)


class NotFoundError(AppException):
    pass


class ConflictError(AppException):
    pass


class AuthenticationError(AppException):
    pass


# Exception handlers in main.py
from fastapi import Request
from fastapi.responses import JSONResponse

@app.exception_handler(NotFoundError)
async def not_found_handler(request: Request, exc: NotFoundError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={'detail': exc.message, 'code': exc.code},
    )


@app.exception_handler(ConflictError)
async def conflict_handler(request: Request, exc: ConflictError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={'detail': exc.message, 'code': exc.code},
    )
```

---

## Testing

```python
# tests/conftest.py
import pytest
from collections.abc import AsyncGenerator
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app_name.main import app
from app_name.dependencies import get_db
from app_name.models.base import Base

TEST_DATABASE_URL = 'sqlite+aiosqlite:///:memory:'


@pytest.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine(TEST_DATABASE_URL)
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    session_maker = async_sessionmaker(engine, expire_on_commit=False)
    
    async with session_maker() as session:
        yield session
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db():
        yield db_session
    
    app.dependency_overrides[get_db] = override_get_db
    
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url='http://test',
    ) as ac:
        yield ac
    
    app.dependency_overrides.clear()


# tests/test_users.py
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_user(client: AsyncClient) -> None:
    response = await client.post(
        '/users/',
        json={
            'email': 'test@example.com',
            'name': 'Test User',
            'password': 'securepassword123',
        },
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data['email'] == 'test@example.com'
    assert data['name'] == 'Test User'
    assert 'id' in data
    assert 'password' not in data


@pytest.mark.asyncio
async def test_create_user_duplicate_email(client: AsyncClient) -> None:
    user_data = {
        'email': 'duplicate@example.com',
        'name': 'User',
        'password': 'password123',
    }
    
    await client.post('/users/', json=user_data)
    response = await client.post('/users/', json=user_data)
    
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_get_user_not_found(client: AsyncClient) -> None:
    response = await client.get('/users/999999')
    
    assert response.status_code == 404
```

---

## Common Anti-Patterns

| Anti-Pattern | Issue | Correct Approach |
|--------------|-------|------------------|
| Business logic in routes | Hard to test, duplicate code | Use service layer |
| Sync database calls | Blocks event loop | Use async SQLAlchemy/Tortoise |
| No input validation | Security risk | Use Pydantic models |
| Hardcoded config | Inflexible | Use pydantic-settings |
| No dependency injection | Hard to test | Use FastAPI Depends |
| Returning ORM models directly | Leaks implementation | Return Pydantic schemas |
| No error handling | Bad UX, info leakage | Custom exception handlers |
| No tests | Regression risk | Test with httpx + pytest |
