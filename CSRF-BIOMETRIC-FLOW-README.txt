CSRF + Biometric Login (Capacitor + Axios)

This app uses a double-submit CSRF pattern and supports Face ID / Touch ID login on iOS/Android (Capacitor). This doc explains the flow, the few files that matter, and how to sanity-check + troubleshoot.

TL;DR

Frontend mints a CSRF cookie by calling GET /api/auth/csrf.
Server sets Set-Cookie: __Host-csrf=… and returns { token } (different value than the cookie).

For every unsafe API call (POST/PUT/PATCH/DELETE under /api/…), we attach the returned token as X-CSRF-Token.

If server says 403 csrf_failed, we re-mint and retry once.

Biometric login just reads stored creds and calls the same /api/auth/login after step (1).

Files that matter

src/api/http.ts – Axios instance + CSRF request/response interceptors.

src/api/csrf.ts – Mints __Host-csrf, caches the returned token, exposes ensureCsrf().

src/utils/biometric.ts – Save/read/delete creds via Keychain/Keystore.

src/pages/Login.tsx – Username/password login (calls ensureCsrf() then POSTs).

src/pages/Home.tsx – Face ID login button (same flow as above once creds are read).

Sanity checks (curl)
# 1) Mint
curl -i -c cookies.txt https://app.ourglp1.com/api/auth/csrf
# Expect: 200 + Set-Cookie: __Host-csrf=…; SameSite=None

# 2) Extract token
TOKEN=$(curl -s -b cookies.txt https://app.ourglp1.com/api/auth/csrf | jq -r .token)

# 3) Login (cookie + header)
curl -i -X POST https://app.ourglp1.com/api/auth/login \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $TOKEN" \
  -b cookies.txt \
  -d '{"email":"you@example.com","password":"secret"}'
# Expect: 200 and Set-Cookie: __Host-glp1.sid=…

Quick FAQ

Is the CSRF token tied to a user?
No. It’s tied to the CSRF cookie/secret and validated per request.

Why not use Axios XSRF automagic?
Because csurf gives you a separate request token (via req.csrfToken()), not the cookie value. We must send that token in X-CSRF-Token.

Do we cache the token?
Yes, per page load. If it’s rejected, we clear → re-mint → retry once.

Should we store passwords in biometrics?
Product decision. If you do, it stays on device Keychain/Keystore. Provide a “Reset Face ID Credentials” option (we do).

Dev tips

Add a small hidden route with a Biometric Test Button in dev builds only.

Keep /api/auth/csrf and /api/auth/login same origin to avoid cross-site cookie surprises.

When changing cookie attributes, always match on clear (Path/SameSite/Secure).

That’s it. If anyone tweaks auth again, follow this doc and you’ll avoid the dreaded csrf_failed. ✅