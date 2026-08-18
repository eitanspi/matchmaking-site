# שידוכים — Matchmaking App

A matchmaking database for candidates, matches, and AI-generated match
suggestions. Hebrew, right-to-left UI. Comes in **two flavours**:

1. **Local app (`docs/`)** — a client-side app that runs in your browser with **no
   server**. Your data is a plain JSON file on your own Mac; put it in a shared
   iCloud/Dropbox folder to use it from two computers. This is the recommended,
   private, free option. **Details below.**
2. **Flask server (root)** — the full dynamic app (SQLite backend), if you ever
   want a real hosted server. See "Flask version" below.

## Local app (`docs/`)

Open `docs/index.html` (via the GitHub Pages URL, or served locally). Nothing is
uploaded anywhere — all data stays in a file you control.

- **Open / create a database:** on the start screen, create a new JSON data file or
  open an existing one. In **Chrome/Edge** the app saves changes back to that file
  automatically (File System Access API); in Safari you load a copy and save with
  the **💾 שמור קובץ** button.
- **Share between two Macs:** keep the JSON file in a shared **iCloud Drive** folder
  and open it on both computers — one edits, the other sees the updates when iCloud
  syncs. (Best with a single editor to avoid overwrite conflicts.)
- **Admin mode** (🔧 ניהול): shows editing tools. Leave it off for view-only.
- **Photos:** add per candidate; images are downscaled in the browser (~1000px JPEG)
  and stored inside the JSON.
- **WhatsApp ZIP import** (📦): drop a WhatsApp chat export (`.zip` with `_chat.txt`
  + photos). It is unzipped and parsed **entirely in the browser** into candidates
  with photos, using a robust parser (`parser.js`, ported from the Python
  `parser.py`) that handles many free-text and structured Hebrew profile formats.
  A preview lets you deselect before adding; name-duplicates are skipped.
- **Excel** (matches the existing שידוכים spreadsheets exactly):
  - **⬇ ייצוא אקסל** — download a candidates sheet (`ID, שם, גיל, מין, …`).
  - **⬆ ייבוא אקסל מועמדים** — load/merge a candidates sheet (upsert by `ID`).
  - **⬆ ייבוא אקסל הצעות** — load a match-suggestions sheet
    (`שם המועמד | הצעה 1 | ציון 1 | …`) into the app's suggestions.

No accounts, no hosting fees, works offline.

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
