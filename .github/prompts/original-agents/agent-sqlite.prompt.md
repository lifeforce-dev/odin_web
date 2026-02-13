---
applyTo:
  - "**/database/**"
  - "**/migrations/**"
  - "**/*_repository.py"
  - "**/*.sql"
relatedAgents:
  - agent-python.md.agent  # Always needed for Python integration
---

# Agent: SQLite3 & Database Design

Best practices for SQLite3 database design, schema patterns, and Python integration. Optimized for small-to-medium applications, internal tools, and embedded databases.

---

## Configuration

Modify these values to match your project requirements:

```yaml
database: SQLite
python_driver: sqlite3  # stdlib, or aiosqlite for async
mode: WAL              # Write-Ahead Logging for concurrency
```

### When to Use SQLite

✅ **Good for:**
- Single-user or low-concurrency applications
- Internal tools and dashboards
- Embedded applications
- Development/testing databases
- Read-heavy workloads
- Data files under ~1TB

❌ **Consider PostgreSQL/MySQL when:**
- High write concurrency (many simultaneous writers)
- Multi-server deployments needing shared database
- Complex replication requirements
- Need for advanced features (JSONB queries, full-text search at scale)

---

## Project Structure

```
project_root/
├── src/
│   └── app_name/
│       ├── database/
│       │   ├── __init__.py
│       │   ├── connection.py    # Connection management
│       │   ├── schema.py        # Schema definitions
│       │   ├── migrations/      # Schema migrations
│       │   │   ├── 001_initial.sql
│       │   │   └── 002_add_indexes.sql
│       │   └── queries/         # Named SQL queries (optional)
│       │       ├── users.sql
│       │       └── builds.sql
│       ├── repositories/        # Data access layer
│       │   ├── __init__.py
│       │   ├── base.py
│       │   └── user_repository.py
│       └── models/              # Domain models
│           └── user.py
├── data/                        # Database files (gitignored)
│   └── app.db
├── pyproject.toml
└── README.md
```

---

## Connection Management

### Basic Connection (Sync)

```python
# database/connection.py
import sqlite3
from pathlib import Path
from contextlib import contextmanager
from typing import Generator

DATABASE_PATH = Path('data/app.db')


def get_connection() -> sqlite3.Connection:
    """Create a new database connection with recommended settings."""
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    
    conn = sqlite3.connect(
        DATABASE_PATH,
        detect_types=sqlite3.PARSE_DECLTYPES | sqlite3.PARSE_COLNAMES,
        check_same_thread=False,  # Required for FastAPI
    )
    
    # Enable foreign keys (off by default in SQLite)
    conn.execute('PRAGMA foreign_keys = ON')
    
    # Use WAL mode for better concurrency
    conn.execute('PRAGMA journal_mode = WAL')
    
    # Return rows as dictionaries
    conn.row_factory = sqlite3.Row
    
    return conn


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    """Context manager for database connections."""
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
```

### Async Connection (with aiosqlite)

```python
# database/connection.py
import aiosqlite
from pathlib import Path
from contextlib import asynccontextmanager
from typing import AsyncGenerator

DATABASE_PATH = Path('data/app.db')


async def get_async_connection() -> aiosqlite.Connection:
    """Create an async database connection."""
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    
    conn = await aiosqlite.connect(
        DATABASE_PATH,
        detect_types=aiosqlite.PARSE_DECLTYPES | aiosqlite.PARSE_COLNAMES,
    )
    
    conn.row_factory = aiosqlite.Row
    await conn.execute('PRAGMA foreign_keys = ON')
    await conn.execute('PRAGMA journal_mode = WAL')
    
    return conn


@asynccontextmanager
async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    """Async context manager for database connections."""
    conn = await get_async_connection()
    try:
        yield conn
        await conn.commit()
    except Exception:
        await conn.rollback()
        raise
    finally:
        await conn.close()
```

### FastAPI Dependency

```python
# database/connection.py
from fastapi import Depends
from typing import Annotated

# Sync version
def get_db_session():
    with get_db() as conn:
        yield conn

DatabaseDep = Annotated[sqlite3.Connection, Depends(get_db_session)]


# Async version
async def get_async_db_session():
    async with get_db() as conn:
        yield conn

AsyncDatabaseDep = Annotated[aiosqlite.Connection, Depends(get_async_db_session)]
```

---

## Schema Design

### Recommended PRAGMAs

```sql
-- Run these on every connection or at database creation

-- Enable foreign key enforcement (OFF by default!)
PRAGMA foreign_keys = ON;

-- WAL mode for better read concurrency
PRAGMA journal_mode = WAL;

-- Faster writes, acceptable durability for most apps
PRAGMA synchronous = NORMAL;

-- Use memory for temp tables (faster)
PRAGMA temp_store = MEMORY;

-- Increase cache size (default is very small)
PRAGMA cache_size = -64000;  -- 64MB (negative = KB)

-- Enable memory-mapped I/O (faster reads)
PRAGMA mmap_size = 268435456;  -- 256MB
```

### Table Design Patterns

```sql
-- database/migrations/001_initial.sql

-- Always use INTEGER PRIMARY KEY for rowid alias (fastest)
-- Use TEXT for UUIDs, not BLOB
-- Use INTEGER for booleans (0/1)
-- Use TEXT for ISO8601 datetimes

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,           -- Auto-increment rowid
    uuid TEXT NOT NULL UNIQUE,        -- External identifier
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS builds (
    id INTEGER PRIMARY KEY,
    uuid TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'failed')),
    started_at TEXT,
    finished_at TEXT,
    duration_seconds INTEGER,
    metadata TEXT,  -- JSON blob for flexible data
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_builds_user_id ON builds(user_id);
CREATE INDEX IF NOT EXISTS idx_builds_status ON builds(status);
CREATE INDEX IF NOT EXISTS idx_builds_created_at ON builds(created_at DESC);

-- Composite index for filtered + sorted queries
CREATE INDEX IF NOT EXISTS idx_builds_user_status_created 
    ON builds(user_id, status, created_at DESC);
```

### Schema Migrations

```python
# database/schema.py
import sqlite3
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).parent / 'migrations'


def get_schema_version(conn: sqlite3.Connection) -> int:
    """Get current schema version."""
    conn.execute('''
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')
    result = conn.execute('SELECT MAX(version) FROM schema_version').fetchone()
    return result[0] or 0


def apply_migrations(conn: sqlite3.Connection) -> None:
    """Apply all pending migrations."""
    current_version = get_schema_version(conn)
    
    migration_files = sorted(MIGRATIONS_DIR.glob('*.sql'))
    
    for migration_file in migration_files:
        # Extract version from filename: 001_initial.sql -> 1
        version = int(migration_file.stem.split('_')[0])
        
        if version > current_version:
            print(f'Applying migration {migration_file.name}')
            conn.executescript(migration_file.read_text())
            conn.execute(
                'INSERT INTO schema_version (version) VALUES (?)',
                (version,)
            )
            conn.commit()


def init_database() -> None:
    """Initialize database with all migrations."""
    with get_db() as conn:
        apply_migrations(conn)
```

---

## Query Patterns

### Parameterized Queries (ALWAYS)

```python
# NEVER do string formatting - SQL injection risk
# BAD: f"SELECT * FROM users WHERE id = {user_id}"

# GOOD: Use ? placeholders for positional params
cursor.execute(
    'SELECT * FROM users WHERE id = ?',
    (user_id,)
)

# GOOD: Use :name for named params
cursor.execute(
    'SELECT * FROM users WHERE email = :email AND is_active = :active',
    {'email': email, 'active': 1}
)
```

### Common Query Patterns

```python
# database/queries.py
from dataclasses import dataclass
from datetime import datetime
from typing import Any
import sqlite3


@dataclass
class User:
    id: int
    uuid: str
    email: str
    name: str
    is_active: bool
    created_at: datetime


def row_to_user(row: sqlite3.Row) -> User:
    """Convert database row to domain model."""
    return User(
        id=row['id'],
        uuid=row['uuid'],
        email=row['email'],
        name=row['name'],
        is_active=bool(row['is_active']),
        created_at=datetime.fromisoformat(row['created_at']),
    )


# SELECT single row
def get_user_by_id(conn: sqlite3.Connection, user_id: int) -> User | None:
    cursor = conn.execute(
        'SELECT * FROM users WHERE id = ?',
        (user_id,)
    )
    row = cursor.fetchone()
    return row_to_user(row) if row else None


# SELECT multiple rows
def get_active_users(conn: sqlite3.Connection) -> list[User]:
    cursor = conn.execute(
        'SELECT * FROM users WHERE is_active = 1 ORDER BY name'
    )
    return [row_to_user(row) for row in cursor.fetchall()]


# SELECT with pagination
def get_users_paginated(
    conn: sqlite3.Connection,
    limit: int = 20,
    offset: int = 0,
) -> list[User]:
    cursor = conn.execute(
        'SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?',
        (limit, offset)
    )
    return [row_to_user(row) for row in cursor.fetchall()]


# INSERT and return ID
def create_user(
    conn: sqlite3.Connection,
    uuid: str,
    email: str,
    name: str,
) -> int:
    cursor = conn.execute(
        '''
        INSERT INTO users (uuid, email, name)
        VALUES (?, ?, ?)
        ''',
        (uuid, email, name)
    )
    return cursor.lastrowid


# UPDATE
def update_user_name(
    conn: sqlite3.Connection,
    user_id: int,
    name: str,
) -> bool:
    cursor = conn.execute(
        '''
        UPDATE users 
        SET name = ?, updated_at = datetime('now')
        WHERE id = ?
        ''',
        (name, user_id)
    )
    return cursor.rowcount > 0


# DELETE
def delete_user(conn: sqlite3.Connection, user_id: int) -> bool:
    cursor = conn.execute(
        'DELETE FROM users WHERE id = ?',
        (user_id,)
    )
    return cursor.rowcount > 0


# UPSERT (INSERT or UPDATE)
def upsert_user(
    conn: sqlite3.Connection,
    uuid: str,
    email: str,
    name: str,
) -> int:
    cursor = conn.execute(
        '''
        INSERT INTO users (uuid, email, name)
        VALUES (?, ?, ?)
        ON CONFLICT(uuid) DO UPDATE SET
            email = excluded.email,
            name = excluded.name,
            updated_at = datetime('now')
        RETURNING id
        ''',
        (uuid, email, name)
    )
    return cursor.fetchone()[0]
```

### Batch Operations

```python
# Efficient batch insert
def insert_many_users(
    conn: sqlite3.Connection,
    users: list[dict[str, Any]],
) -> None:
    conn.executemany(
        '''
        INSERT INTO users (uuid, email, name)
        VALUES (:uuid, :email, :name)
        ''',
        users
    )


# Batch with transaction
def bulk_update_status(
    conn: sqlite3.Connection,
    user_ids: list[int],
    is_active: bool,
) -> int:
    placeholders = ','.join('?' * len(user_ids))
    cursor = conn.execute(
        f'''
        UPDATE users 
        SET is_active = ?, updated_at = datetime('now')
        WHERE id IN ({placeholders})
        ''',
        [int(is_active)] + user_ids
    )
    return cursor.rowcount
```

---

## JSON Data

SQLite has built-in JSON functions for flexible schema portions:

```sql
-- Store JSON in TEXT column
CREATE TABLE builds (
    id INTEGER PRIMARY KEY,
    metadata TEXT  -- JSON blob
);

-- Query JSON fields
SELECT 
    id,
    json_extract(metadata, '$.commit_sha') AS commit_sha,
    json_extract(metadata, '$.branch') AS branch
FROM builds
WHERE json_extract(metadata, '$.branch') = 'main';

-- Update JSON field
UPDATE builds
SET metadata = json_set(metadata, '$.status', 'completed')
WHERE id = 1;
```

```python
import json

# Insert with JSON
def create_build_with_metadata(
    conn: sqlite3.Connection,
    metadata: dict,
) -> int:
    cursor = conn.execute(
        'INSERT INTO builds (metadata) VALUES (?)',
        (json.dumps(metadata),)
    )
    return cursor.lastrowid


# Read JSON back
def get_build_metadata(
    conn: sqlite3.Connection,
    build_id: int,
) -> dict | None:
    cursor = conn.execute(
        'SELECT metadata FROM builds WHERE id = ?',
        (build_id,)
    )
    row = cursor.fetchone()
    if row and row['metadata']:
        return json.loads(row['metadata'])
    return None
```

---

## Performance Tips

### Index Strategy

```sql
-- Index columns used in WHERE, JOIN, ORDER BY
-- Don't over-index (slows writes)

-- Single column for equality checks
CREATE INDEX idx_users_email ON users(email);

-- Composite for multi-column filters (order matters!)
CREATE INDEX idx_builds_user_status ON builds(user_id, status);

-- Covering index (includes all columns needed)
CREATE INDEX idx_builds_list ON builds(user_id, status, created_at DESC)
    INCLUDE (uuid, started_at, finished_at);

-- Partial index for common filtered queries
CREATE INDEX idx_builds_pending ON builds(created_at)
    WHERE status = 'pending';
```

### Query Analysis

```python
# Check query plan
def explain_query(conn: sqlite3.Connection, query: str, params=()) -> None:
    cursor = conn.execute(f'EXPLAIN QUERY PLAN {query}', params)
    for row in cursor:
        print(row)
```

### Connection Pooling (for FastAPI)

```python
# For high-concurrency apps, use connection pool
from queue import Queue
from contextlib import contextmanager

class ConnectionPool:
    def __init__(self, database_path: str, pool_size: int = 5):
        self.database_path = database_path
        self.pool: Queue[sqlite3.Connection] = Queue(maxsize=pool_size)
        
        for _ in range(pool_size):
            self.pool.put(self._create_connection())
    
    def _create_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(
            self.database_path,
            check_same_thread=False,
        )
        conn.execute('PRAGMA foreign_keys = ON')
        conn.execute('PRAGMA journal_mode = WAL')
        conn.row_factory = sqlite3.Row
        return conn
    
    @contextmanager
    def get_connection(self):
        conn = self.pool.get()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            self.pool.put(conn)


# Usage in FastAPI
pool = ConnectionPool('data/app.db', pool_size=10)

def get_db():
    with pool.get_connection() as conn:
        yield conn
```

---

## Testing

```python
# tests/conftest.py
import pytest
import sqlite3
from pathlib import Path

@pytest.fixture
def db_connection(tmp_path: Path):
    """Create an in-memory or temp file database for testing."""
    db_path = tmp_path / 'test.db'
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    
    # Apply schema
    schema_sql = Path('src/app_name/database/migrations/001_initial.sql').read_text()
    conn.executescript(schema_sql)
    
    yield conn
    conn.close()


@pytest.fixture
def db_with_data(db_connection):
    """Database with test data pre-populated."""
    db_connection.execute(
        "INSERT INTO users (uuid, email, name) VALUES (?, ?, ?)",
        ('test-uuid', 'test@example.com', 'Test User')
    )
    db_connection.commit()
    return db_connection
```

---

## Common Anti-Patterns

| Anti-Pattern | Issue | Correct Approach |
|--------------|-------|------------------|
| String formatting in queries | SQL injection | Use parameterized queries |
| Forgetting `PRAGMA foreign_keys = ON` | No referential integrity | Set on every connection |
| Using BLOB for UUIDs | Hard to debug | Use TEXT for UUIDs |
| No indexes on foreign keys | Slow JOINs and cascades | Index all FK columns |
| Storing datetimes as integers | Confusing, timezone issues | Use TEXT with ISO8601 |
| One connection per request | Resource exhaustion | Use connection pool |
| Ignoring WAL mode | Poor read concurrency | Enable WAL journal mode |
| Giant transactions | Lock contention | Keep transactions small |
| SELECT * in production | Wastes bandwidth | Select specific columns |
| No schema migrations | Manual DB changes | Track migrations in SQL files |
