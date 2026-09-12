# File Sharing App: Simple Project Plan

## 1. Goal
Upload a file, get a random link, share it. The link stops working after an expiry time or a download limit. An optional password protects it. No accounts.

## 2. Scope

**In (v1)**
- Upload a file (up to 50 MB)
- Share link with expiry, optional max downloads, optional password
- Download page
- Delete with a delete token
- Automatic cleanup of expired files
- Rate limiting

**Out (not now)**
- User accounts and login
- Cloud storage (S3/R2)
- Chunked uploads
- Virus scanning
- Analytics

## 3. Tech stack
| Part | Choice |
|---|---|
| Server | Node.js + Express |
| Upload handling | multer (disk storage) |
| Database | SQLite via better-sqlite3 |
| Password hashing | bcryptjs |
| Rate limiting | express-rate-limit |
| Tests | jest or vitest + supertest |

## 4. Design

**Flow**
1. Sender uploads a file with expiry, max downloads, and password options.
2. Server saves the file under a random name, inserts a row, and returns a link and a delete token.
3. Sender sends the link to the recipient.
4. Recipient opens the link, enters the password if needed, and downloads.
5. A cleanup job removes expired and used-up files.

**Database: one table, `files`**
| Column | Purpose |
|---|---|
| id | random link ID |
| original_name | name shown to the downloader |
| stored_name | random name on disk |
| size | bytes |
| password_hash | null if no password |
| expires_at | required |
| max_downloads | null means unlimited |
| downloads | count so far, starts at 0 |
| delete_token | lets the uploader delete the file |
| created_at | timestamp |

**Endpoints**
| Method | Path | Purpose |
|---|---|---|
| POST | `/upload` | save file, return link and delete token |
| GET | `/f/:id` | download page with file info |
| POST | `/f/:id/download` | check password, count download, send file |
| DELETE | `/f/:id` | delete using the `x-delete-token` header |

**Status codes**
| Code | When |
|---|---|
| 201 | upload succeeded |
| 400 | no file or bad input |
| 403 | wrong password |
| 404 | link missing, expired, or used up |
| 413 | file too large |
| 429 | rate limit hit |

**The one tricky part: download counting**
Do it in a single SQL statement so two people can't both take the last download:
```sql
UPDATE files SET downloads = downloads + 1
WHERE id = ? AND (max_downloads IS NULL OR downloads < max_downloads)
```
If it changes 0 rows, don't send the file.

**Safety rules**
- Random link ID from `crypto.randomBytes(12)`.
- Random filename on disk, never the user's filename.
- Password sent by POST, never in the URL.
- Same 404 for missing, expired, and used-up links.
- Size limit on uploads.

## 5. Folder structure
```
file-share/
  server.js
  public/index.html
  uploads/          (auto-created, add to .gitignore)
  tests/
  package.json
  README.md
```

## 6. Build plan

| Step | Work | Done when | Time |
|---|---|---|---|
| 1. Setup | `npm init`, install packages, basic Express server, SQLite table | Server starts, table exists | 1 hr |
| 2. Upload | multer with random filenames and size limit, insert row, return link and delete token | Upload returns a link, file is on disk | 2 hr |
| 3. Download | `/f/:id` page and download route that sends the file with its original name | Link downloads the correct file | 2 hr |
| 4. Expiry | Check `expires_at` on every request, return 404 and delete if expired | Expired link returns 404 | 1 hr |
| 5. Download limit | Atomic SQL update from section 4 | A 1-download link works once, then 404 | 1 hr |
| 6. Password | bcrypt hash on upload, compare on download | Wrong password gives 403 | 1 hr |
| 7. Delete | DELETE route with the token check | File and row are gone | 1 hr |
| 8. Cleanup job | `setInterval` every 10 min removes expired and used-up files from disk and DB | Old files disappear, count is logged | 1 hr |
| 9. Rate limit | Limit uploads (for example 20 per hour per IP) and downloads | 429 after the limit | 30 min |
| 10. Frontend | One HTML page with an upload form and a result box showing the link | Full flow works in the browser | 2 hr |
| 11. Tests | See section 7 | All tests pass | 2 to 3 hr |
| 12. Deploy and README | Deploy, write README | Public URL, README done | 2 hr |

Total: about 2 to 3 days.

## 7. Test plan
- Upload then download returns the same file.
- Expired link returns 404.
- Wrong password returns 403, correct password works.
- Link with 1 max download works once, then returns 404.
- **Concurrency test:** send 20 parallel downloads to a 1-download link, then check that exactly 1 returns 200.
- File over the size limit returns 413 and leaves nothing on disk.
- Delete with the wrong token fails, delete with the right token works.
- Cleanup job removes an expired file from disk and DB.

## 8. Deployment notes
- Render's disk is wiped on every redeploy, so uploaded files and the SQLite DB disappear. Either add a persistent disk, or accept this and say so in the README.
- Set `app.set('trust proxy', 1)` so rate limiting and links work behind Render's proxy.
- Free instances sleep, so the cleanup job only runs while the app is awake.

## 9. README checklist
- What it does, in two lines.
- How to run it locally.
- The endpoint table.
- The design decision about atomic download counting.
- Known limits: no login, local disk, no virus scanning.
- Test results and any load numbers you measured.

## 10. Optional upgrades (after v1 works)
Pick one at a time:
1. User accounts and a "my files" page.
2. Move file storage to Cloudflare R2.
3. Per-link download history.

## 11. Resume bullet (once built and tested)
- Built a file-sharing service (Express, SQLite) with expiring, password-protected, download-limited links; used atomic SQL updates to enforce download limits under concurrency (verified with parallel-request tests) and added a scheduled job to delete expired files.

Add real numbers only if you measured them.