# Metflux

Multi-tenant admin panel + portfolio site for an electrical-industry business.
**Hostinger Node.js + MySQL** in production.

- `metflux.com` → portfolio (plain HTML/CSS/JS — `portfolio/`)
- `admin.metflux.com` → admin panel (React SPA — `client/`)
- Both are served by one Node.js process — see `server/`

## Folder map

```
metflux/
├── server/                  Node.js + Express + Prisma backend
│   ├── server.js            ← entry point — run with `node server.js`
│   ├── routes/              one file per resource (route + logic + DB calls)
│   │   ├── index.js         mounts everything under /api
│   │   ├── auth.js          /api/auth/* — login, refresh, switch-company, logout, me
│   │   ├── customers.js     /api/customers/* — CRUD, scoped to active company
│   │   ├── push.js          /api/push/* — Web Push subscribe + broadcast
│   │   └── whatsapp.js      /api/whatsapp/* — wa.me share-URL builder
│   ├── lib/                 shared utilities only
│   │   ├── env.js           env vars (zod-validated, fails fast)
│   │   ├── db.js            Prisma client singleton
│   │   ├── auth.js          password hashing, JWT, requireAuth, requireRole
│   │   ├── tenant.js        resolveTenant + tenantWhere(req, …) helpers
│   │   ├── push.js          web-push send helpers
│   │   ├── whatsapp.js      wa.me URL builder
│   │   ├── hostRouter.js    serves admin SPA vs portfolio by Host header
│   │   ├── rateLimit.js     auth + api rate limits
│   │   ├── errors.js        AppError, asyncHandler, error middleware
│   │   └── constants.js     ROLES, ROLE_RANK, COOKIE_NAMES
│   ├── prisma/
│   │   ├── schema.prisma    Company, User, Membership, RefreshToken, Customer, PushSubscription
│   │   └── seed.js          creates the platform-admin user
│   ├── public/              served as static
│   │   ├── admin/           built React SPA lands here at build time
│   │   ├── portfolio/       built portfolio lands here at build time
│   │   └── uploads/         user-uploaded files (logos, avatars)
│   ├── private/             server-only — never served (generated PDFs etc.)
│   ├── scripts/             build helpers
│   ├── .env.example
│   └── package.json
│
├── client/                  React admin SPA (Vite + Tailwind + PWA)
│   ├── src/
│   │   ├── pages/           AuthPage, DashboardPage, CustomersPage
│   │   ├── components/      AppLayout, CompanySwitcher, RequireAuth
│   │   └── lib/             api.ts (fetch wrapper), auth.ts (store), push.ts, cn.ts
│   ├── public/              static assets — logo.png, icons, favicon
│   ├── index.html
│   ├── tailwind.config.js   green/charcoal palette + animations
│   ├── vite.config.ts
│   └── package.json
│
├── portfolio/               metflux.com — plain HTML/CSS/JS
│   ├── index.html
│   ├── styles.css
│   └── script.js
│
├── README.md                this file
├── DATABASE.md              MySQL setup steps
└── package.json             root — convenience scripts only
```

**Two folders, one job each:**
- `server/routes/` — what each URL does (validation + DB + response, all in one file)
- `server/lib/` — shared helpers everything else imports

If you want to add a new feature like Invoices, you only touch:
1. `server/prisma/schema.prisma` — add the model
2. `server/routes/invoices.js` — copy `customers.js` and adapt
3. `server/routes/index.js` — register the new router
4. `client/src/pages/InvoicesPage.tsx` — add the UI

That's it. No controllers, no services, no separate validators.

## Tech stack

| Layer    | Choice |
|----------|--------|
| Backend  | Node.js 18+, Express, Prisma (MySQL), JWT |
| Admin UI | React 18, Vite, TypeScript, Tailwind CSS, TanStack Query, Zustand |
| PWA      | `vite-plugin-pwa` (Workbox) — installable on desktop + mobile |
| Push     | Web Push API with VAPID keys (free, no Firebase) |
| WhatsApp | `wa.me` click-to-chat URLs (free, no API approval) |
| Portfolio | Plain HTML / CSS / JS (no build step) |

## Local setup (first time)

```powershell
# 1. Install dependencies for both sides
npm install

# 2. Set up environment
Copy-Item server\.env.example server\.env

# 3. Generate two JWT secrets (run twice, paste each into server\.env)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 4. Generate VAPID keys for push notifications (paste into server\.env)
npx web-push generate-vapid-keys

# 5. Create the database — manual, via phpMyAdmin (or any MySQL client)
#    a) Create an empty database in phpMyAdmin.
#    b) Open the "Import" tab → upload database.sql (at repo root) → Go.
#    c) Set DATABASE_URL in server\.env to point at that database.
#    d) Create the first admin user (one-time):
npm --workspace server run seed
```

The seed creates: `admin@metflux.com` / `admin` / password `ChangeMe!123` as a platform admin.

> **Schema changes after first install** are also manual now:
> 1. Run your `ALTER TABLE …` in phpMyAdmin.
> 2. Use the new column in your route SQL via the helpers in
>    `server/lib/db.js` (`q`, `qOne`, `insert`, `update`, `del`, `txn`).
>
> No ORM, no client regeneration, no schema file to keep in sync.
> The SQL is the source of truth. Prisma was removed because its Rust
> query engine panics on Hostinger's LiteSpeed wrapper.

## Run locally

Two terminals:

```powershell
# Terminal 1 — backend
npm run dev:server     # http://localhost:3000

# Terminal 2 — admin UI
npm run dev:client     # http://localhost:5173
```

Open <http://localhost:5173/login>.

## Build for production

```powershell
npm run build         # builds React → copies to server/public/admin
npm start             # runs node server/server.js
```

## Deploy to Hostinger

In hPanel → Node.js:
- **Application startup file:** `server/server.js`
- **Application root:** wherever you upload the repo
- **Environment variables:** copy from `server/.env.example`, fill all values

Then in the Hostinger terminal:
```bash
npm install
# Tables are already created via phpMyAdmin (import database.sql once).
# Seed only needs to run once, the very first time:
npm --workspace server run seed
npm run build
# click Restart in hPanel
```

See [DATABASE.md](DATABASE.md) for full DB setup (local + Hostinger).

## Cheat sheet — "where do I edit X?"

| I want to change… | File |
|---|---|
| Login page UI | `client/src/pages/AuthPage.tsx` |
| Brand colours / animations | `client/tailwind.config.js` |
| Sidebar / nav links | `client/src/components/AppLayout.tsx` |
| What the API does for /login | `server/routes/auth.js` |
| Add a new API resource | New file in `server/routes/`, then add to `routes/index.js` |
| Database tables | `server/prisma/schema.prisma` (then `prisma:migrate`) |
| JWT lifetime / cookie | `server/.env` (`JWT_REFRESH_TTL`) and `server/routes/auth.js` (`REFRESH_TTL_MS`) |
| Push notification logic | `server/lib/push.js` |
| WhatsApp share format | `server/lib/whatsapp.js` |
| Portfolio site | `portfolio/index.html`, `styles.css`, `script.js` |
