"""SQLite data layer for the matchmaking site.

A thin, dependency-free wrapper over sqlite3. The schema is intentionally kept
compatible with the Excel import/export format (Hebrew headers) so candidate
lists and AI-match sheets can round-trip through the app.
"""
import os
import sqlite3
from datetime import datetime

DB_PATH = os.environ.get(
    'MATCHMAKING_DB',
    os.path.join(os.path.abspath(os.path.dirname(__file__)), 'matchmaking.db'),
)


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def init_db():
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            age INTEGER,
            gender TEXT,                     -- 'male' | 'female'
            height INTEGER,
            religious_level TEXT,
            location TEXT,
            phone TEXT,
            occupation TEXT,
            description TEXT,
            looking_for TEXT,
            "references" TEXT,
            ethnicity TEXT,
            marital_status TEXT,
            source TEXT,
            vip INTEGER DEFAULT 0,
            takiru INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
            filename TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_a_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
            candidate_b_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
            status TEXT DEFAULT 'proposed',  -- proposed | in_progress | accepted | rejected
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS ai_suggestions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
            suggested_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
            rank INTEGER,
            score REAL,
            explanation TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
    ''')
    conn.commit()
    conn.close()


# --------------------------------------------------------------------------
# Lightweight row wrappers (attribute access + related-object lookups)
# --------------------------------------------------------------------------
class _Row:
    def __init__(self, row):
        self._row = dict(row) if row else {}

    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(name)
        return self._row.get(name)


class Candidate(_Row):
    @property
    def photos(self):
        conn = get_db()
        rows = conn.execute('SELECT * FROM photos WHERE candidate_id = ?', (self.id,)).fetchall()
        conn.close()
        return [Photo(r) for r in rows]

    @property
    def matches(self):
        """All matches this candidate is part of (either side)."""
        conn = get_db()
        rows = conn.execute(
            'SELECT * FROM matches WHERE candidate_a_id = ? OR candidate_b_id = ? ORDER BY created_at DESC',
            (self.id, self.id),
        ).fetchall()
        conn.close()
        return [MatchObj(r) for r in rows]

    @property
    def match_partner_ids(self):
        ids = set()
        for m in self.matches:
            ids.add(m.candidate_b_id if m.candidate_a_id == self.id else m.candidate_a_id)
        return ids


class Photo(_Row):
    pass


class MatchObj(_Row):
    @property
    def candidate_a(self):
        return get_candidate(self.candidate_a_id)

    @property
    def candidate_b(self):
        return get_candidate(self.candidate_b_id)

    @property
    def created_at_dt(self):
        try:
            return datetime.fromisoformat(self.created_at)
        except (TypeError, ValueError):
            return None


# --------------------------------------------------------------------------
# Candidate queries
# --------------------------------------------------------------------------
_CANDIDATE_FIELDS = (
    'name', 'age', 'gender', 'height', 'religious_level', 'location', 'phone',
    'occupation', 'description', 'looking_for', 'references', 'ethnicity',
    'marital_status', 'source',
)


def get_all_candidates(filters=None):
    query = 'SELECT * FROM candidates WHERE 1=1'
    params = []
    f = filters or {}
    if f.get('name'):
        query += ' AND name LIKE ?'; params.append(f'%{f["name"]}%')
    if f.get('gender'):
        query += ' AND gender = ?'; params.append(f['gender'])
    if f.get('religious'):
        query += ' AND religious_level LIKE ?'; params.append(f'%{f["religious"]}%')
    if f.get('location'):
        query += ' AND location LIKE ?'; params.append(f'%{f["location"]}%')
    if f.get('ethnicity'):
        query += ' AND ethnicity LIKE ?'; params.append(f'%{f["ethnicity"]}%')
    if f.get('age_min'):
        query += ' AND age >= ?'; params.append(f['age_min'])
    if f.get('age_max'):
        query += ' AND age <= ?'; params.append(f['age_max'])
    if f.get('height_min'):
        query += ' AND height >= ?'; params.append(f['height_min'])
    if f.get('height_max'):
        query += ' AND height <= ?'; params.append(f['height_max'])
    if f.get('marital_status'):
        statuses = f['marital_status']
        if isinstance(statuses, list):
            query += f' AND marital_status IN ({",".join("?" * len(statuses))})'
            params.extend(statuses)
        else:
            query += ' AND marital_status = ?'; params.append(statuses)
    if f.get('vip'):
        query += ' AND vip = 1'
    if f.get('takiru'):
        query += ' AND takiru = 1'
    query += ' ORDER BY created_at DESC'
    conn = get_db()
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [Candidate(r) for r in rows]


def get_candidate(id):
    if id is None:
        return None
    conn = get_db()
    row = conn.execute('SELECT * FROM candidates WHERE id = ?', (id,)).fetchone()
    conn.close()
    return Candidate(row) if row else None


def get_candidates_by_gender(gender):
    conn = get_db()
    rows = conn.execute('SELECT * FROM candidates WHERE gender = ?', (gender,)).fetchall()
    conn.close()
    return [Candidate(r) for r in rows]


def create_candidate(data):
    conn = get_db()
    cur = conn.execute(
        '''INSERT INTO candidates
           (name, age, gender, height, religious_level, location, phone, occupation,
            description, looking_for, "references", ethnicity, marital_status, source)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
        tuple(data.get(f) for f in _CANDIDATE_FIELDS),
    )
    cid = cur.lastrowid
    conn.commit()
    conn.close()
    return cid


def update_candidate(id, data):
    conn = get_db()
    conn.execute(
        '''UPDATE candidates SET
           name=?, age=?, gender=?, height=?, religious_level=?, location=?, phone=?,
           occupation=?, description=?, looking_for=?, "references"=?, ethnicity=?, marital_status=?
           WHERE id=?''',
        (data.get('name'), data.get('age'), data.get('gender'), data.get('height'),
         data.get('religious_level'), data.get('location'), data.get('phone'),
         data.get('occupation'), data.get('description'), data.get('looking_for'),
         data.get('references'), data.get('ethnicity'), data.get('marital_status'), id),
    )
    conn.commit()
    conn.close()


def delete_candidate(id):
    conn = get_db()
    conn.execute('DELETE FROM candidates WHERE id = ?', (id,))
    conn.commit()
    conn.close()


def candidate_exists(name=None, phone=None):
    conn = get_db()
    found = False
    if phone:
        found = conn.execute('SELECT 1 FROM candidates WHERE phone = ?', (phone,)).fetchone() is not None
    if not found and name:
        found = conn.execute('SELECT 1 FROM candidates WHERE name = ?', (name,)).fetchone() is not None
    conn.close()
    return found


def find_candidate_by_name(name):
    """Resolve a candidate by exact name, then by prefix (handles trailing text)."""
    conn = get_db()
    row = conn.execute('SELECT * FROM candidates WHERE name = ?', (name,)).fetchone()
    if not row:
        row = conn.execute('SELECT * FROM candidates WHERE name LIKE ?', (name + '%',)).fetchone()
    conn.close()
    return Candidate(row) if row else None


def set_flag(id, field, value):
    assert field in ('vip', 'takiru')
    conn = get_db()
    conn.execute(f'UPDATE candidates SET {field} = ? WHERE id = ?', (1 if value else 0, id))
    conn.commit()
    conn.close()


# --------------------------------------------------------------------------
# Photos
# --------------------------------------------------------------------------
def add_photo(candidate_id, filename):
    conn = get_db()
    conn.execute('INSERT INTO photos (candidate_id, filename) VALUES (?, ?)', (candidate_id, filename))
    conn.commit()
    conn.close()


def delete_photo(photo_id, photos_dir=None):
    conn = get_db()
    row = conn.execute('SELECT filename FROM photos WHERE id = ?', (photo_id,)).fetchone()
    if row and photos_dir:
        path = os.path.join(photos_dir, row['filename'])
        if os.path.exists(path):
            os.remove(path)
    conn.execute('DELETE FROM photos WHERE id = ?', (photo_id,))
    conn.commit()
    conn.close()


# --------------------------------------------------------------------------
# Matches
# --------------------------------------------------------------------------
def create_match(a_id, b_id, notes=''):
    conn = get_db()
    dup = conn.execute(
        '''SELECT 1 FROM matches
           WHERE (candidate_a_id=? AND candidate_b_id=?) OR (candidate_a_id=? AND candidate_b_id=?)''',
        (a_id, b_id, b_id, a_id),
    ).fetchone()
    if dup:
        conn.close()
        return None
    cur = conn.execute('INSERT INTO matches (candidate_a_id, candidate_b_id, notes) VALUES (?, ?, ?)',
                       (a_id, b_id, notes))
    mid = cur.lastrowid
    conn.commit()
    conn.close()
    return mid


def update_match(id, status=None, notes=None):
    conn = get_db()
    if status:
        conn.execute("UPDATE matches SET status=?, updated_at=datetime('now') WHERE id=?", (status, id))
    if notes is not None:
        conn.execute("UPDATE matches SET notes=?, updated_at=datetime('now') WHERE id=?", (notes, id))
    conn.commit()
    conn.close()


def delete_match(id):
    conn = get_db()
    conn.execute('DELETE FROM matches WHERE id = ?', (id,))
    conn.commit()
    conn.close()


def get_match(id):
    conn = get_db()
    row = conn.execute('SELECT * FROM matches WHERE id = ?', (id,)).fetchone()
    conn.close()
    return MatchObj(row) if row else None


def get_all_matches(status=None):
    conn = get_db()
    if status:
        rows = conn.execute('SELECT * FROM matches WHERE status = ? ORDER BY created_at DESC', (status,)).fetchall()
    else:
        rows = conn.execute('SELECT * FROM matches ORDER BY created_at DESC').fetchall()
    conn.close()
    return [MatchObj(r) for r in rows]


# --------------------------------------------------------------------------
# AI suggestions (populated from an uploaded matches spreadsheet)
# --------------------------------------------------------------------------
def add_ai_suggestion(candidate_id, suggested_id, rank, score, explanation=None):
    conn = get_db()
    exists = conn.execute(
        'SELECT id FROM ai_suggestions WHERE candidate_id = ? AND suggested_id = ?',
        (candidate_id, suggested_id),
    ).fetchone()
    if exists:
        conn.execute('UPDATE ai_suggestions SET rank=?, score=?, explanation=? WHERE id=?',
                     (rank, score, explanation, exists['id']))
    else:
        conn.execute(
            'INSERT INTO ai_suggestions (candidate_id, suggested_id, rank, score, explanation) VALUES (?,?,?,?,?)',
            (candidate_id, suggested_id, rank, score, explanation),
        )
    conn.commit()
    conn.close()


def get_ai_suggestions_for(candidate_id):
    conn = get_db()
    rows = conn.execute('''
        SELECT s.*, c.name AS suggested_name, c.age AS suggested_age, c.gender AS suggested_gender,
               c.religious_level AS suggested_religious, c.location AS suggested_location
        FROM ai_suggestions s JOIN candidates c ON s.suggested_id = c.id
        WHERE s.candidate_id = ? ORDER BY s.score DESC
    ''', (candidate_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_all_ai_suggestions():
    conn = get_db()
    rows = conn.execute('''
        SELECT s.*,
               c1.name AS candidate_name, c1.age AS candidate_age, c1.gender AS candidate_gender,
               c2.name AS suggested_name, c2.age AS suggested_age, c2.gender AS suggested_gender
        FROM ai_suggestions s
        JOIN candidates c1 ON s.candidate_id = c1.id
        JOIN candidates c2 ON s.suggested_id = c2.id
        ORDER BY s.candidate_id, s.score DESC
    ''').fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_ai_suggestion(id):
    conn = get_db()
    conn.execute('DELETE FROM ai_suggestions WHERE id = ?', (id,))
    conn.commit()
    conn.close()


def delete_all_ai_suggestions():
    conn = get_db()
    cur = conn.execute('DELETE FROM ai_suggestions')
    count = cur.rowcount
    conn.commit()
    conn.close()
    return count
