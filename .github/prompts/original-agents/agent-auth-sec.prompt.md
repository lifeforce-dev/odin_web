# Authentication Security Guide

## Philosophy

**The goal is not to be unhackable. The goal is to make hacking expensive enough that attackers choose easier targets, while not annoying legitimate users.**

Three principles guide every decision:
1. **Defense in Depth**: Multiple layers. If one fails, others catch it.
2. **Fail Secure**: When something breaks, deny access rather than grant it.
3. **Minimize Attack Surface**: Less code = fewer bugs = fewer vulnerabilities.

---

## Decision: Build vs Buy

### Recommendation for ZoneControl: OAuth Provider (Google/Discord)

**Why OAuth wins for a game like ours:**
- We don't store passwords, so we can't leak them
- Google/Discord handle brute force, credential stuffing, 2FA
- Users don't need another password to forget
- Discord is natural for gaming communities
- One less critical system to maintain and audit

**When to roll your own auth:**
- Regulatory requirements mandate it (not us)
- Users cannot have third-party accounts (not our case)
- Offline/airgapped environments (not us)
- You have dedicated security engineers to maintain it (we don't)

**Hybrid approach (recommended):**
- OAuth for login (Google/Discord)
- Our own session management post-login
- Our own authorization (what can user X do)

---

## If Using OAuth Providers

### Provider Selection
- **Google**: Widest reach, most trusted, good documentation
- **Discord**: Natural for gamers, easy to add later
- **Avoid**: Facebook (privacy concerns), Twitter/X (unstable API)

### Implementation Rules

1. **Use Official SDKs or Well-Maintained Libraries**
   - Python: `authlib` or `python-social-auth`
   - Never parse JWTs manually in production
   - Never implement OAuth flows from scratch

2. **Validate Everything from Provider**
   ```
   MUST verify:
   - Token signature (SDK does this)
   - Token expiration (SDK does this)
   - Issuer matches expected provider
   - Audience matches YOUR client ID
   - Email is verified (provider confirms ownership)
   ```

3. **State Parameter is Non-Negotiable**
   - Prevents CSRF attacks
   - Generate cryptographically random value
   - Store in session, verify on callback
   - Single-use, expire after 2-3 minutes (not longer - login flows complete in seconds)

4. **Store Minimal User Data**
   ```
   User Table (internal identity):
   - id: UUID (internal, never exposed)
   - display_name: string
   - email: encrypted (see Email Protection below)
   - email_hash: for lookup (blind index)
   - created_at: timestamp
   
   LinkedIdentity Table (provider mappings):
   - user_id: FK to User
   - provider: "google" | "discord"
   - provider_sub: provider's user ID
   - linked_at: timestamp
   
   Why separate tables:
   - User can link multiple providers
   - If user loses Google access, can recover via Discord
   - Pro player account isn't tied to one provider
   ```
   
   **If storing OAuth tokens (e.g., for Discord API calls):**
   - Encrypt at rest (AES-GCM)
   - Scope narrowly (separate from login tokens)
   - Never reuse login tokens for gameplay APIs

5. **Account Linking**
   - Use the LinkedIdentity table pattern (see above)
   - First login creates User + LinkedIdentity record
   - Linking flow: User logged in with Provider A, initiates OAuth with Provider B, both get linked to same User
   - Require explicit user action to link (never auto-merge by email alone)
   - Account recovery: If user loses access to one provider, support can verify via another linked provider

---

## Session Management (Post-Login)

This is YOUR code, regardless of how login works.

### Token Strategy: JWT in HttpOnly Cookie

**Why JWT:**
- Fast verification (signature check + one integer comparison)
- Contains user ID, expiration, token version
- Signed, so tamper-evident

**Why HttpOnly Cookie (not localStorage):**
- XSS cannot steal HttpOnly cookies
- Automatically sent with requests
- CSRF protection via SameSite attribute

### Cookie Settings (Non-Negotiable)
```
Access Token Cookie:
  HttpOnly: true
  Secure: true
  SameSite: Lax
  Path: /
  Max-Age: 900         # 15 minutes

Refresh Token Cookie:
  HttpOnly: true
  Secure: true
  SameSite: Strict     # More restrictive
  Path: /auth/refresh  # Only sent to refresh endpoint
  Max-Age: 604800      # 7 days
```

**Why separate paths:**
- Refresh token only sent to `/auth/refresh`
- Prevents accidental exposure to other endpoints
- Limits attack surface if any endpoint is compromised

### JWT Claims
```json
{
  "sub": "user-uuid",           // User identifier
  "iat": 1706500000,            // Issued at (Unix timestamp)
  "exp": 1706500900,            // Expires at (15 min later)
  "tv": 1                       // Token version (for instant revocation)
}
```

### Instant Revocation (Critical for Games)

**The Problem:** With purely stateless JWTs, a banned cheater can play for 15 more minutes until their token expires. In gaming, this is unacceptable.

**The Solution:** Token Versioning
```
User Table:
- id: UUID
- token_version: integer (starts at 1)

Validation (every request):
1. Verify JWT signature
2. Check expiration
3. Fetch user.token_version (cache in Redis for speed)
4. If jwt.tv < user.token_version: REJECT

To ban user or kill all sessions:
- UPDATE users SET token_version = token_version + 1 WHERE id = ?
- All outstanding tokens instantly invalid
- Single integer comparison per request (fast)
- No central session store needed
```
```

**Do NOT put in JWT:**
- Roles/permissions (unless you're prepared to revoke on every permission change - use token versioning or fetch from DB)
- Email or PII (visible if decoded, even if signed)
- Anything that changes frequently

### Token Lifecycle

1. **Access Token**: 15 minutes, used for API calls
2. **Refresh Token**: 7 days, used only to get new access token, restricted path
3. **Refresh Token Rotation**: Each refresh issues new refresh token, invalidates old one

**Why short access tokens + refresh:**
- If access token leaks, damage is time-limited
- Refresh token is sent less often (smaller attack window)
- Rotation means stolen refresh token gets invalidated on legitimate user's next refresh

### Session Termination
```
On logout:
1. Clear cookies (set Max-Age=0)
2. Add token JTI to revocation list (if implementing revocation)

On password change (if we ever have passwords):
1. Invalidate ALL sessions for that user
2. Force re-login everywhere
```

---

## If Rolling Our Own Auth (Passwords)

**Only do this if OAuth truly doesn't work. Here's how to not screw it up:**

### Password Storage

**Use Argon2id. No exceptions.**
```python
# Correct
from argon2 import PasswordHasher
ph = PasswordHasher(
    time_cost=3,        # Iterations
    memory_cost=65536,  # 64MB
    parallelism=4       # Threads
)
hash = ph.hash(password)
ph.verify(hash, password)  # Raises exception if wrong

# Also acceptable: bcrypt with cost 12+
# NEVER: MD5, SHA1, SHA256 (even with salt), plain scrypt
```

**Why Argon2id:**
- Memory-hard (expensive for GPU/ASIC attacks)
- Won Password Hashing Competition
- Resistant to side-channel attacks
- Built-in salt handling

### Password Requirements

**Do:**
- Minimum 8 characters (12+ encouraged)
- Check against breach database (HaveIBeenPwned API)
- Allow paste (password managers need it)
- Show strength meter
- Allow all Unicode characters

**Don't:**
- Maximum length under 128 characters (hashing doesn't care)
- Required special characters (users just add "!" at end)
- Periodic forced rotation (causes weaker passwords)
- Security questions (easily researched)
- Password hints (just tells attackers)

### Breach Checking (k-Anonymity)
```
1. Hash password with SHA1 (yes, SHA1 - it's for lookup, not storage)
2. Send first 5 characters to HaveIBeenPwned API
3. API returns all hashes starting with those 5 chars
4. Check locally if full hash is in response
5. If found, reject password

Result: HIBP never sees the actual password, only a prefix.
```

---

## Rate Limiting

### The NAT/Dorm Problem (Gaming-Specific)

University dorms, internet cafes, and gaming houses share IPs. Pure IP-based rate limiting will block legitimate players when one person enters wrong password.

**Solution: Layer the limits**

```
Layer 1 - Per Account (Primary):
- 5 failed attempts: 1 minute lockout
- 10 failed attempts: 5 minute lockout
- 20 failed attempts: Account locked, email required to unlock
- This catches targeted attacks without affecting others

Layer 2 - Per Device Fingerprint (If Available):
- Browser fingerprint + User-Agent
- 20 attempts per minute per fingerprint
- Catches credential stuffing from single machine

Layer 3 - Per IP (DoS Prevention Only):
- 100 attempts per minute (high threshold)
- 1000 attempts per hour
- Only triggers on volumetric attacks
- Does not block legitimate shared-IP users

Counting:
- Only count failures, not successes
- Reset on successful login
- Use sliding window, not fixed buckets
```

### Password Reset
```
- 3 requests per hour per email
- Token valid for 1 hour
- Single use (invalidate after use or new request)
- Don't reveal if email exists ("If this email is registered, you'll receive...")
```

### Account Creation
```
- 5 accounts per IP per hour
- Email verification required before account is active
- CAPTCHA after 2 attempts from same IP
```

---

## Account Recovery

### Email Verification Flow
```
1. User provides email
2. Generate cryptographically random token (32+ bytes, base64url encoded)
3. Store hash of token (not plaintext) with expiration
4. Email link with token
5. User clicks link
6. Hash provided token, compare to stored hash
7. If match and not expired, mark email verified
8. Invalidate token

NEVER:
- Send password in email
- Use sequential or guessable tokens
- Allow token reuse
- Keep tokens valid for more than 24 hours
```

### Password Reset Flow
```
1. User requests reset for email
2. Always respond "If this email is registered..." (don't leak existence)
3. If email exists, generate token (same rules as verification)
4. Email link (expires in 1 hour)
5. Link goes to reset form (not auto-login)
6. User enters new password
7. Hash and store new password
8. Invalidate ALL existing sessions
9. Log the password change event (without the password)
10. Optionally notify user via email that password was changed
```

---

## Protecting Against Common Attacks

### Credential Stuffing
```
Problem: Attackers use leaked username/password lists from other sites
Defense:
- Rate limiting per IP
- Rate limiting per account
- CAPTCHA after N failures
- Breach password checking
- Encourage OAuth (no password to stuff)
```

### Brute Force
```
Problem: Attackers try many passwords for one account
Defense:
- Rate limiting per account (progressive lockout)
- Account lockout notification to user
- Strong password requirements
- Argon2 makes each attempt expensive
```

### Session Hijacking
```
Problem: Attacker steals session token
Defense:
- HttpOnly cookies (XSS can't steal)
- Secure flag (no transmission over HTTP)
- Short token lifetime + token versioning for instant revocation
- Bind session to user-agent (optional, can break on updates)
- Bind session to IP range (optional, breaks on mobile)
- Session binding tradeoff: Only enable for high-risk admin actions, not general gameplay
```

### CSRF (Cross-Site Request Forgery)
```
Problem: Malicious site triggers action using user's session
Defense:
- SameSite=Lax cookies (blocks most CSRF)
- CSRF tokens for state-changing operations
- Verify Origin/Referer headers
- Don't use GET for state changes

For JSON APIs (FastAPI + SPA):
- SameSite=Lax handles most cases
- For extra safety: require custom header (e.g., X-Requested-With)
- Browsers don't allow cross-origin requests to set custom headers
- This protects against edge cases with POST navigations
```

### XSS (Cross-Site Scripting)
```
Problem: Attacker injects script that runs in user's browser
Defense (even though we use HttpOnly):
- Content Security Policy headers
- Escape all user-generated content
- Use framework's built-in escaping (Vue does this by default)
- Never use v-html with user content
- Input validation on server side
```

---

## Logging and Monitoring

### What to Log
```
DO log:
- Login attempts (success/failure, IP, user-agent, timestamp)
- Password changes
- Email changes
- Session terminations
- Rate limit triggers
- Account lockouts
- OAuth errors

DON'T log:
- Passwords (obviously)
- Full tokens
- Session contents
- Detailed error messages that leak implementation
```

### Log Format
```json
{
  "timestamp": "2026-01-29T10:30:00Z",
  "event": "login_failure",
  "user_id": "uuid-if-known",
  "email_hash": "sha256-prefix-only",
  "ip": "192.168.1.1",
  "user_agent": "Mozilla/5.0...",
  "reason": "invalid_password",
  "attempt_count": 3
}
```

### Alerting
```
Alert immediately:
- 10+ failed logins to single account in 5 minutes
- 50+ failed logins from single IP in 5 minutes
- Password reset for admin accounts
- Any authentication from unexpected geography (if tracking)

Alert daily digest:
- Accounts locked
- Unusual registration patterns
- Rate limit summary
```

---

## Data Minimization

### Collect Only What You Need
```
For a game like ZoneControl:
- User ID (generated UUID, never exposed externally)
- Display name
- Email (encrypted - see below)
- Token version (for instant revocation)
- Created timestamp
- Last login timestamp

Via LinkedIdentity table:
- Provider name + provider sub (links to User)

Don't collect:
- Real name
- Address
- Phone number
- Date of birth
- Any "nice to have" fields
```

### Email Protection (PII Handling)

**Problem:** Email addresses are PII. If database is dumped, we leak every player's email (inviting phishing/spam).

**Solution: Encryption + Blind Index**
```
User Table:
- email_encrypted: AES-256-GCM encrypted email
- email_hash: SHA256(lowercase(email) + pepper) for lookup

Pepper: Application secret, NOT stored in database

To find user by email (login):
1. Hash the input email with pepper
2. SELECT * FROM users WHERE email_hash = ?
3. Decrypt email_encrypted to verify match

To send email to user:
1. Decrypt email_encrypted
2. Send email

If database leaks:
- email_encrypted is gibberish without app secrets
- email_hash cannot be reversed to email (one-way + peppered)
- Attacker gets nothing useful
```

**Tradeoff:** More complexity than plaintext. Worth it for user protection.

### Data Retention
```
Active accounts: Keep as long as account exists
Deleted accounts: Remove PII within 30 days
Logs: Rotate after 90 days, anonymize older
Failed login records: Purge after 30 days
```

### GDPR/Privacy Considerations
```
- Users can request data export
- Users can request deletion
- Privacy policy explains what's collected and why
- No selling data to third parties
- If breached, notification within 72 hours
```

---

## Implementation Checklist

### Before Launch
- [ ] HTTPS everywhere (no HTTP, not even redirects)
- [ ] OAuth flow tested with real providers
- [ ] Cookie security attributes verified
- [ ] Rate limiting tested (actually hit the limits)
- [ ] Error messages don't leak information
- [ ] Logging captures security events
- [ ] CORS configured restrictively
- [ ] CSP headers configured
- [ ] Dependencies are up to date
- [ ] No secrets in code or logs

### Security Review Questions
1. "What happens if this token leaks?" (Answer: Limited damage due to expiration)
2. "What happens if the database leaks?" (Answer: No plaintext passwords/tokens)
3. "What happens if someone tries 1000 logins?" (Answer: Rate limited, locked)
4. "What happens if someone steals a session?" (Answer: Limited duration, can't refresh forever)
5. "What happens if our OAuth secret leaks?" (Answer: Rotate immediately, revoke old tokens)

---

## Recommended Stack for ZoneControl

```
Authentication: Google OAuth + Discord OAuth (optional)
Library: authlib (Python)
Sessions: JWT in HttpOnly cookie (access) + HttpOnly cookie at /auth/refresh (refresh)
Token signing: See algorithm choice below
Token version cache: Redis (for instant revocation checks)
Rate limiting: slowapi (FastAPI) or Redis-based
Password hashing (if ever needed): argon2-cffi
```

### JWT Algorithm Choice

**For a Monolith (ZoneControl today):**
- Use **HS256** (HMAC-SHA256)
- Symmetric: same secret signs and verifies
- Fast, simple, secure
- One less key to manage

**For Microservices (future scaling):**
- Use **EdDSA (Ed25519)** or RS256
- Asymmetric: Auth service signs, game servers verify with public key
- EdDSA is much faster than RS256
- Allows verification without exposing signing secret

**Recommendation:** Start with HS256. Switch to EdDSA if/when we add separate services that need to verify tokens without the signing secret.

---

## What NOT to Do (Learned from Real Breaches)

1. **LinkedIn 2012**: SHA1 without salt. 6.5M passwords cracked in days.
2. **Adobe 2013**: 3DES encryption (not hashing), same key for all passwords.
3. **Equifax 2017**: Unpatched Struts, but also poor session management.
4. **Facebook 2019**: Passwords stored in plaintext logs for years.
5. **T-Mobile 2021**: API allowed enumeration of all accounts.

**Common threads:**
- "We'll fix security later" (no one does)
- Rolling custom crypto/hashing
- Logging sensitive data
- No rate limiting
- Trusting client-side validation

---

## Final Wisdom

> "The best authentication system is one you don't have to maintain."

Use OAuth. Let Google/Discord handle:
- Password storage
- Brute force protection
- 2FA
- Account recovery
- Credential stuffing prevention

Focus your security effort on:
- Secure session management (your code)
- Authorization (who can do what - your code)
- Rate limiting (your code)
- Not leaking data in logs (your discipline)

The goal is a system where a breach of ZoneControl's database reveals:
- UUIDs
- Display names
- Email addresses (hashed or encrypted)
- Timestamps

And nothing else. No passwords, no tokens, nothing that enables further attacks.
