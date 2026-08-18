# שידוכים — Matchmaking Site

A matchmaking database for candidates, matches, and AI-generated match
suggestions. Hebrew, right-to-left UI. Comes in **two flavours**:

1. **Static site (`docs/`)** — a client-side app hosted free on GitHub Pages.
   All data lives in one **encrypted** file (`docs/data.enc`); the site asks for
   a password and decrypts it in the browser. Nothing readable is ever public.
   This is the "just open the link and it works" version.
2. **Flask server (root)** — the full dynamic app (SQLite backend). Use it if you
   want server-side storage and multi-user editing. See "Flask version" below.

## Live static site (GitHub Pages)

Once Pages is enabled for this repo, the site is at
`https://<user>.github.io/matchmaking-site/`. Open it, type the password, and the
candidate gallery, filters, matches and AI suggestions load in your browser.

- **Demo password:** `demo1234` (protects only fictional sample data).
- **Admin mode** (🔧 ניהול): add/edit/delete candidates and matches in the
  browser, then **⬇ שמור (ייצוא מוצפן)** downloads an updated `data.enc`.
- **Saving changes:** replace `docs/data.enc` in the repo with the downloaded
  file (drag it into GitHub's web UI, or commit it). Pages redeploys in ~1 min.
- **Change the password:** in admin mode, export and type a new password when
  prompted — the new `data.enc` is encrypted with it. Don't commit the password
  anywhere.

### Updating data from a spreadsheet (maintainer)

`tools/matchdata.py` reads/writes the same encrypted format from Python:

```bash
python tools/matchdata.py decrypt <password>            # docs/data.enc -> plaintext JSON (stdout)
python tools/matchdata.py encrypt <password> data.json  # data.json -> docs/data.enc
python tools/matchdata.py sample  <password>            # regenerate demo data
```

Encryption: AES-256-GCM with a PBKDF2-SHA256 (200k iterations) key — identical to
the browser's WebCrypto, so files round-trip between Python and the site.

---

## Flask version (optional full server)

A small, self-hosted web app for the same data, built with Flask + SQLite.

## Features

- **Candidates** — list with live filters (name, gender, religious level, location,
  ethnicity, age range), detail pages, add / edit / delete, multiple photos,
  and `VIP` / `תכירו` flags.
- **Matches** — create a match between two candidates, track its status
  (הוצע / בתהליך / יצא לפועל / נדחה), and browse all matches.
- **AI matches** — upload a suggestions spreadsheet and browse the results grouped
  per candidate, with one-click "create match" and side-by-side compare.
- **Excel** — export the full candidate list, or import a sheet to create/update
  candidates in bulk (matched by the `ID` column).
- **Compare** — view two candidates side by side.

## Quick start

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

python seed.py                     # optional: a few fictional sample candidates
python app.py                      # http://localhost:5555
```

The SQLite database (`matchmaking.db`) and uploaded photos are created on first
run and are **git-ignored** — real candidate data never lands in the repo.

## AI-matches spreadsheet format

One header row, then one row per candidate. Column A is the candidate's name;
the remaining columns are `(suggestion name, score)` pairs. A trailing age in
parentheses is ignored when matching names.

| שם המועמד | הצעה 1 | ציון 1 | הצעה 2 | ציון 2 | … |
|-----------|--------|--------|--------|--------|---|
| רון כהן (30) | מיכל לוי (28) | 9 | שירה דן (27) | 8.5 | … |

Names must already exist as candidates in the system before uploading.

## Configuration

| Env var         | Purpose                                   | Default                    |
|-----------------|-------------------------------------------|----------------------------|
| `SECRET_KEY`    | Flask session/flash secret                | dev fallback (change it!)  |
| `MATCHMAKING_DB`| Path to the SQLite database file          | `./matchmaking.db`         |

## Deploying

This is a dynamic Flask app, so it needs a Python host (GitHub Pages, which only
serves static files, will **not** run it). Any of these work:

- **PythonAnywhere** — point a WSGI file at `from app import app as application`.
- **Render / Railway / Fly.io** — run with a WSGI server:
  ```bash
  pip install gunicorn
  gunicorn app:app
  ```
- Set a strong `SECRET_KEY` and put the database on persistent storage.

## Project layout

```
app.py            Flask routes
models.py         SQLite schema + query helpers
seed.py           optional fictional sample data
templates/        Jinja2 HTML (RTL Hebrew)
static/style.css  styling
static/photos/    uploaded candidate photos (git-ignored)
```

## Notes

- Candidate data is personal and sensitive — keep the repo private and the
  database off version control (already handled by `.gitignore`).
- The schema is intentionally compatible with the Excel import/export headers so
  candidate lists and match sheets round-trip cleanly.
