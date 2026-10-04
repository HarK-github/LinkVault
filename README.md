# LinkVault 🔐

LinkVault is an ephemeral, privacy-first file sharing web service built with Node.js, Express, and SQLite.  
It generates self-destructing download links with configurable time expiration, atomic download limits, and optional password protection without requiring user accounts.

🌐 **Live Production Deployment:** [https://linkvault-chve.onrender.com](https://linkvault-chve.onrender.com)

---

## 🚀 Quickstart (Run Locally)

### Prerequisites
- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **npm**: v9.0.0 or higher
- C/C++ compiler and Python 3 for compiling native SQLite bindings (`better-sqlite3`)

### Installation & Run

1. **Clone the repository:**
   ```bash
   git clone https://github.com/HarK-github/LinkVault.git
   cd LinkVault
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm start
   # or with live reloading:
   npm run dev
   ```

4. **Open your browser:**
   Navigate to [http://localhost:3000](http://localhost:3000) to access the web application.

5. **Run the test suite:**
   ```bash
   npm test
   ```

---

## 📡 API Specification

| Method | Endpoint | Description | Headers / Auth | Request Body | Status Codes |
|---|---|---|---|---|---|
| `GET` | `/health` | Service health status | None | None | `200` |
| `POST` | `/upload` | Upload a file (up to 50 MB) | `multipart/form-data` | `file`: file blob<br>`expiry`: `10m`, `1h`, `24h`, `7d`, `30d`<br>`max_downloads`: integer (optional)<br>`password`: string (optional) | `201`: Upload succeeded<br>`400`: Missing file or bad input<br>`413`: Exceeds 50 MB<br>`429`: Rate limit hit |
| `GET` | `/f/:id` | Download page / metadata | `Accept: application/json` or browser navigation | None | `200`: File metadata<br>`404`: Missing, expired, or used up |
| `POST` | `/f/:id/download` | Download binary payload | `Content-Type: application/json` | `password`: string (if protected) | `200`: Binary file stream<br>`403`: Incorrect password<br>`404`: Missing, expired, or used up<br>`429`: Rate limit hit |
| `DELETE` | `/f/:id` | Delete file immediately | `x-delete-token: <token>` | None | `200`: Successfully deleted<br>`403`: Invalid or missing token<br>`404`: File not found |

---

## ⚡ Concurrency & The Atomic Download Counter

When a file link has a restricted download count (such as a 1-time self-destructing link), concurrent requests could trigger a classic **check-then-act** race condition:
If two recipients request the file simultaneously, both could read `downloads = 0`, both approve the request, and both receive the file—violating the download constraint.

LinkVault solves this at the database engine level using an atomic SQLite `UPDATE` statement:

```sql
UPDATE files 
SET downloads = downloads + 1
WHERE id = ? 
  AND (max_downloads IS NULL OR downloads < max_downloads);
```

### Why This Is Bulletproof:
1. **Single Atomic Statement:** SQLite evaluates the `WHERE` condition and updates the row in a single atomic transaction step under WAL mode (`journal_mode = WAL`).
2. **Zero Row Mutation Guard:** If another request increments the counter first, the condition `downloads < max_downloads` evaluates to `false`. The update modifies `0` rows (`info.changes === 0`).
3. **Immediate Rejection:** If `info.changes === 0`, LinkVault aborts file streaming immediately and returns `404 File not found or link has expired`.
4. **Clean Disk Streaming:** The file remains safely on disk while active streams are in flight, and subsequent or cleanup cycles remove exhausted files without interrupting active reads.

---

## 🧪 Measured Test Results & Benchmarks

LinkVault includes an automated test suite verifying functional requirements, security boundaries, and high-concurrency race conditions:

```
PASS tests/fileshare.test.js
  LinkVault File Sharing Test Suite
    ✓ GET /health returns 200 OK (58 ms)
    ✓ Upload then download returns identical file payload and filename (95 ms)
    ✓ Expired link returns 404 on both info and download (44 ms)
    ✓ Password-protected link rejects wrong password (403) and allows correct password (200) (406 ms)
    ✓ Link with 1 max download works once, then returns 404 on subsequent attempt (62 ms)
    ✓ Concurrency test: 20 parallel downloads to a 1-download link results in exactly 1 success (200) and 19 rejections (404) (175 ms)
    ✓ File over 50 MB size limit returns 413 and does not save to disk (1468 ms)
    ✓ Delete with wrong token returns 403, right token returns 200 and purges record (41 ms)
    ✓ Cleanup job removes expired and used-up files from disk and DB (34 ms)

Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
Time:        3.517 s
```

### Concurrency Stress Benchmark
- **Test:** Fired **20 concurrent asynchronous requests** simultaneously (`Promise.all`) at a link configured for `max_downloads: 1`.
- **Result:** **Exactly 1 request** received status `200` with the file payload; **19 requests** received status `404`. No duplicate streams occurred.

---

## ☁️ Deployment Guide (Render)

LinkVault is production-ready for deployment on **[Render](https://render.com)**.

### Method 1: Render Blueprint (Infrastructure-as-Code) — Recommended

The repository includes a ready-to-use [`render.yaml`](./render.yaml) blueprint:

1. Push this repository to your GitHub or GitLab account.
2. In the [Render Dashboard](https://dashboard.render.com), click **New +** and select **Blueprint**.
3. Connect your repository. Render automatically reads `render.yaml` and provisions:
   - **Service Type**: Web Service
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
4. Click **Apply**. Render will build and deploy the application with a public HTTPS URL (e.g., `https://linkvault.onrender.com`).

### Method 2: Manual Web Service Setup on Render

1. Click **New +** > **Web Service**.
2. Connect your Git repository.
3. Configure the following settings:
   - **Name**: `linkvault`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
4. Add Environment Variables:
   - `NODE_ENV`: `production`
   - `PORT`: `10000` (or leave default for Render to inject)

### Method 3: Docker Deployment on Render

Render also supports direct container deployment using the included [`Dockerfile`](./Dockerfile):
- Set **Runtime** to `Docker`
- Render will build the multi-stage image, compile SQLite, and expose port 3000.

### 📌 Render Deployment Notes & Gotchas:
- **Proxy Trust:** `server.js` includes `app.set('trust proxy', 1)` so that client IP detection, rate limiting (`express-rate-limit`), and full URL reconstruction work seamlessly behind Render's reverse proxy.
- **Ephemeral Storage on Free Tier:** On Render's free tier, local disk storage is ephemeral and is cleared on every redeployment or instance spin-down. If you want permanent persistence across redeploys, attach a Render Persistent Disk mounted at `/var/data` (configured in `render.yaml`).
- **Instance Sleep:** On free tier instances, the service sleeps after 15 minutes of inactivity. The background cleanup job (`setInterval`) runs whenever the instance is awake, and expired links are also lazily cleaned up on access.

---

## 🛡️ Security & Privacy Architecture

- **Random Link Identifiers:** URLs use cryptographically strong IDs generated via `crypto.randomBytes(12)` (24 hexadecimal characters), preventing link enumeration or guessing.
- **Random Disk Filenames:** Uploaded files are saved on disk with random UUIDs (`crypto.randomUUID()`) to prevent filesystem collisions and path traversal attacks.
- **Bcrypt Password Hashing:** User passwords are never saved in plaintext; they are hashed with `bcryptjs` using 10 salt rounds and verified using constant-time comparison.
- **No Password in URLs:** Passwords must be submitted via `POST /f/:id/download`, never as URL query parameters (which could be leaked in browser history or access logs).
- **Uniform 404 Response:** Missing files, expired links, and exhausted download links all return the identical `404 File not found or link has expired` error, preventing attackers from discovering whether a link ever existed.
- **Rate Limiting:** Protects `/upload` (20/hr per IP) and `/f/:id` downloads (100/15min per IP) against brute-force attacks and abuse.
- **Zero Account Footprint:** No tracking cookies, no personal identity records, and no user registration required.

---

## ⚠️ Known Limitations (v1)

- **Local Storage:** Files are stored on the server's local disk; not yet backed by cloud object storage (S3/Cloudflare R2).
- **No User Accounts:** Designed purely for anonymous, ephemeral transfers; does not provide a user dashboard.
- **Antivirus Scanning:** Files are not scanned for malware prior to storage; users should only download files from trusted senders.

---

## 📝 Resume Bullet

- *Built a file-sharing service (Express, SQLite) with expiring, password-protected, download-limited links; used atomic SQL updates to enforce download limits under concurrency (verified with parallel-request tests) and added a scheduled job to delete expired files.*

---

## 📄 License
ISC License.
