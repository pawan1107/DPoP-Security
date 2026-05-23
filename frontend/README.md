# Next.js Secure Frontend with DPoP & Anti-Bot

This Next.js application serves as the ultra-secure frontend for the `.NET` backend. It implements multiple layers of defense-in-depth to protect against automated bot attacks, session theft, and replay attacks.

## Core Security Features

### 1. DPoP (Demonstrating Proof-of-Possession)
- Uses `IndexedDB` to securely store a non-extractable ECDSA Private Key.
- Signs every request (using `jose`) with a short-lived JWT.
- Protects against Token/Cookie theft because the private key cannot physically leave the user's browser.

### 2. Client-Side Anti-Bot Heuristics
- `anti-bot.ts` runs passive behavioral checks (mouse teleportation, CDP leaks, coalesced events).
- The detection score is **covertly embedded** into the DPoP JWT payload (as `_v` and `_c` claims).
- The bot is forced to cryptographically sign and send its own detection flags to the server without realizing it.

### 3. Proof of Work (PoW)
- Before registering a device, the browser must solve a SHA-256 Hashcash puzzle (mining a nonce that produces a hash starting with "000").
- This requires negligible CPU time for a real user, but economically bankrupts a botnet trying to generate 10,000 fake devices per second.

### 4. Edge Middleware Rate Limiting
- `middleware.ts` runs at the Next.js Edge (Vercel/Cloudflare).
- Blocks IP addresses that make too many requests instantly, protecting the Node and .NET servers from DDoS or scraping.

### 5. Backend-For-Frontend (BFF) Pattern
- React components NEVER call the `.NET` API directly.
- All requests go through Next.js **Server Actions** (`actions.ts`), which proxy the request to `.NET`.
- Injects a secret `X-BFF-Secret` header so `.NET` can perfectly distinguish traffic coming through the secure proxy vs direct script attacks.

### 6. Production Obfuscation & CSP
- `webpack-obfuscator` automatically mangles `anti-bot.ts` and `client-crypto.ts` during `npm run build`, making it extremely difficult for attackers to reverse-engineer the bot detection.
- Strict Content-Security-Policy (CSP) headers prevent malicious script injections.

## Getting Started

```bash
npm install
npm run dev
```
