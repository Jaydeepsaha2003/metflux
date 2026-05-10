# MySQL setup guide

You need MySQL in two places:

1. **Locally** — for development on your Windows machine.
2. **On Hostinger** — for the live site.

The schema in [server/prisma/schema.prisma](server/prisma/schema.prisma) is the source of truth — Prisma creates and migrates the tables for you in both environments.

---

## A) Local MySQL on Windows

Pick **one** option below. They're equivalent — just different installers.

### Option 1 (recommended): MySQL Community Server

1. Download from <https://dev.mysql.com/downloads/installer/> → **MySQL Installer for Windows**.
2. Choose **Developer Default** → Next → Execute.
3. Set the **root password** when prompted (write it down).
4. Leave port as `3306`. Finish.

Verify it's running:
```powershell
Get-Service MySQL*
```

### Option 2: XAMPP (easier, also gives you phpMyAdmin)

1. Install <https://www.apachefriends.org/>.
2. Open the XAMPP Control Panel → Start **MySQL**.
3. Click **Admin** next to MySQL → opens phpMyAdmin in your browser.

Default user: `root` with **empty password** (XAMPP). You can change it under phpMyAdmin → User accounts.

### Create the database

Pick one method.

**phpMyAdmin** (XAMPP users):
- Open phpMyAdmin → click **New** in the left sidebar
- Database name: `metflux`
- Collation: `utf8mb4_unicode_ci`
- Click **Create**

**MySQL Workbench** or any MySQL client:
```sql
CREATE DATABASE metflux CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

**Command line** (if `mysql` is on your PATH):
```powershell
mysql -u root -p -e "CREATE DATABASE metflux CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### Wire it up to the app

Edit `server\.env` (created by copying `server\.env.example`):

```env
# XAMPP default (empty password):
DATABASE_URL="mysql://root:@localhost:3306/metflux"

# MySQL Community Server (with password "mypass"):
DATABASE_URL="mysql://root:mypass@localhost:3306/metflux"
```

> If your password contains `@`, `:`, `/`, or `#`, URL-encode it (e.g. `@` → `%40`).

### Create the tables

Prisma will generate the schema for you:

```powershell
npm --workspace server run prisma:migrate -- --name init
npm --workspace server run seed
```

You should see something like:
```
[seed] created super-admin email=admin@metflux.com userId=admin on "Metflux Demo Co"
```

You can now sign in at <http://localhost:5173/login>:
- **User ID** `admin` (or **Email** `admin@metflux.com`)
- **Password** from `SEED_SUPERADMIN_PASSWORD` (default `ChangeMe!123`)

### Inspecting the data

```powershell
npm --workspace server run prisma:studio
```

This opens a UI at <http://localhost:5555> where you can browse and edit rows directly. Useful while developing.

---

## B) MySQL on Hostinger

1. **hPanel → Databases → MySQL Databases**.
2. Click **Create database**:
   - Database name: e.g. `u123456789_metflux` (Hostinger prefixes everything with your account ID — that's fine)
   - Database username: e.g. `u123456789_mflx`
   - Password: generate a strong one and save it
3. Note the **MySQL hostname** shown on the same screen — usually `localhost` if your Node app and DB are on the same Hostinger plan, or something like `srv1234.hstgr.io` for remote access.

### Set the environment variables

In hPanel → **Node.js → Environment Variables**, add:

```
DATABASE_URL=mysql://u123456789_mflx:YOUR_PASSWORD@localhost:3306/u123456789_metflux
NODE_ENV=production
PORT=3000
PUBLIC_BASE_URL=https://admin.metflux.com
CORS_ORIGINS=https://admin.metflux.com,https://metflux.com
JWT_ACCESS_SECRET=<paste 64-byte hex>
JWT_REFRESH_SECRET=<paste another 64-byte hex>
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=15d
ALLOW_PUBLIC_SIGNUP=true
VAPID_PUBLIC_KEY=<from npx web-push generate-vapid-keys>
VAPID_PRIVATE_KEY=<from npx web-push generate-vapid-keys>
VAPID_SUBJECT=mailto:you@metflux.com
SEED_SUPERADMIN_EMAIL=admin@metflux.com
SEED_SUPERADMIN_USERNAME=admin
SEED_SUPERADMIN_PASSWORD=<a strong password — change after first login>
SEED_DEFAULT_COMPANY_NAME=Metflux
```

Generate the JWT secrets locally with:

```powershell
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Run it twice — once for `JWT_ACCESS_SECRET`, once for `JWT_REFRESH_SECRET`.

### Run migrations on Hostinger

In hPanel → **Node.js → Open Terminal** (or via SSH):

```bash
cd ~/domains/metflux.com/public_html   # or wherever you uploaded the repo
npm install
npm --workspace server run prisma:deploy
npm --workspace server run seed
npm run build
```

Then click **Restart** in the Node.js panel.

### Inspecting Hostinger data

Use **phpMyAdmin** from hPanel → MySQL → "phpMyAdmin" button next to the database. Same UI as local, just remote.

---

## Common errors

| Error | Cause | Fix |
| --- | --- | --- |
| `P1001: Can't reach database server at localhost:3306` | MySQL not running | Start it (Services panel locally, or check Hostinger DB status) |
| `P1000: Authentication failed` | Wrong password in `DATABASE_URL` | Re-check; URL-encode special chars |
| `P3014: Prisma Migrate could not create the shadow database` | User lacks `CREATE` privilege | On Hostinger this is normal — use `prisma:deploy` (no shadow needed), not `prisma:migrate` |
| `Unknown collation: utf8mb4_0900_ai_ci` | Older MySQL (5.7) reading newer dump | Use `utf8mb4_unicode_ci` (already configured here) |

---

## What lives in the database

After `prisma:migrate` runs, you'll have these tables:

| Table | Purpose |
| --- | --- |
| `Company` | One row per tenant (your 2–3 companies) |
| `User` | All users — has `companyId` foreign key, plus unique `email` and `username` |
| `RefreshToken` | One row per active session — `revokedAt` for logout, `expiresAt` for the 15-day window |
| `Customer` | Sample tenant-scoped table; copy this pattern for invoices, products, etc. |
| `PushSubscription` | Web push endpoints per user, used to send notifications |

Every tenant-scoped row has a `companyId` — every query goes through `tenantWhere(req, …)` so users only ever see their own company's data.
