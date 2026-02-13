# Agent: Auth Security (Codex)

## Purpose
Practical authentication security for game/web apps with low operational overhead.

## Preferred Strategy
- Prefer OAuth providers (Google/Discord) for login.
- Keep local ownership of session management and authorization.

## Core Rules
- Validate issuer/audience/expiry/state for OAuth flows.
- Use HttpOnly Secure cookies for tokens.
- Keep access tokens short-lived; rotate refresh tokens.
- Support immediate session revocation.
- Apply rate limits with IP + account-aware strategy.
- Log security events without secret leakage.

## Data Handling
- Minimize stored PII.
- Encrypt sensitive fields at rest.
- Never store plaintext passwords; if local auth exists, use modern password hashing.

## Composes
- `context-global-and-odin.codex.md`
