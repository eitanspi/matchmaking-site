# -*- coding: utf-8 -*-
"""Encrypt / decrypt the matchmaking data file for the static site.

The encryption scheme is byte-for-byte compatible with the browser (WebCrypto):
  key = PBKDF2-HMAC-SHA256(password, salt, 200000 iters, 32 bytes)
  ciphertext = AES-256-GCM(iv, plaintext)          # 128-bit tag appended
Output JSON: { v, kdf, iterations, salt(b64), iv(b64), ct(b64) }

Usage:
  python tools/matchdata.py sample  <password>                 # write docs/data.enc with demo data
  python tools/matchdata.py encrypt <password> data.json       # data.json  -> docs/data.enc
  python tools/matchdata.py decrypt <password> [docs/data.enc] # docs/data.enc -> stdout (plaintext JSON)
"""
import base64
import json
import os
import sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ITERATIONS = 200_000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENC_PATH = os.path.join(ROOT, 'docs', 'data.enc')

# Deterministic salt/iv only when explicitly provided; otherwise random.
try:
    from os import urandom
except ImportError:  # pragma: no cover
    urandom = None


def _b64(b):
    return base64.b64encode(b).decode()


def _unb64(s):
    return base64.b64decode(s)


def _derive(password, salt):
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS)
    return kdf.derive(password.encode('utf-8'))


def encrypt(plaintext, password):
    salt = urandom(16)
    iv = urandom(12)
    key = _derive(password, salt)
    ct = AESGCM(key).encrypt(iv, plaintext.encode('utf-8'), None)
    return {
        'v': 1, 'kdf': 'PBKDF2-SHA256', 'iterations': ITERATIONS,
        'salt': _b64(salt), 'iv': _b64(iv), 'ct': _b64(ct),
    }


def decrypt(obj, password):
    key = _derive(password, _unb64(obj['salt']))
    pt = AESGCM(key).decrypt(_unb64(obj['iv']), _unb64(obj['ct']), None)
    return pt.decode('utf-8')


SAMPLE = {
    'candidates': [
        dict(id=1, name='דוד לוי', age=29, gender='male', height=178, religious_level='דתי לאומי',
             location='ירושלים', phone='', occupation='מהנדס תוכנה', ethnicity='ספרדי',
             marital_status='רווק', description='בחור שמח ורציני, אוהב טיולים ולימוד.',
             looking_for='בחורה חמה ומשפחתית', references='', vip=True, takiru=False, photos=[]),
        dict(id=2, name='נועה כהן', age=27, gender='female', height=165, religious_level='דתי לאומי',
             location='מודיעין', phone='', occupation='מורה', ethnicity='אשכנזי',
             marital_status='רווקה', description='רגישה, אכפתית ואוהבת אנשים.',
             looking_for='בחור עם ערכים ולב טוב', references='', vip=False, takiru=False, photos=[]),
        dict(id=3, name='אבי מזרחי', age=33, gender='male', height=182, religious_level='דתי תורני',
             location='פתח תקווה', phone='', occupation='רואה חשבון', ethnicity='תימני',
             marital_status='רווק', description='יסודי, נאמן ובעל שאיפות.',
             looking_for='בחורה תורנית ושמחה', references='', vip=False, takiru=True, photos=[]),
        dict(id=4, name='שירה פרץ', age=31, gender='female', height=170, religious_level='דתי תורני',
             location='רמת גן', phone='', occupation='עורכת דין', ethnicity='מרוקאי',
             marital_status='רווקה', description='חכמה, עצמאית ובעלת חוש הומור.',
             looking_for='בחור יציב ורגוע', references='', vip=False, takiru=False, photos=[]),
    ],
    'matches': [
        {'a': 1, 'b': 2, 'status': 'proposed', 'notes': 'דוגמה'},
    ],
    'ai': {
        '1': [{'id': 2, 'score': 9, 'reason': 'התאמת ערכים, גיל ומיקום מצוינת.'},
              {'id': 4, 'score': 7.5, 'reason': 'רמה דתית קרובה ואופי משלים.'}],
        '3': [{'id': 4, 'score': 8.5, 'reason': 'שניהם תורניים עם שאיפה לבית של תורה.'},
              {'id': 2, 'score': 7, 'reason': 'אופי חם ומתאים, פער מיקום קטן.'}],
    },
}


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    cmd, password = sys.argv[1], sys.argv[2]
    if cmd == 'sample':
        obj = encrypt(json.dumps(SAMPLE, ensure_ascii=False, indent=2), password)
        with open(ENC_PATH, 'w', encoding='utf-8') as f:
            json.dump(obj, f)
        print(f'wrote {ENC_PATH} (demo data, password: {password})')
    elif cmd == 'encrypt':
        with open(sys.argv[3], encoding='utf-8') as f:
            plaintext = f.read()
        json.loads(plaintext)  # validate JSON
        obj = encrypt(plaintext, password)
        with open(ENC_PATH, 'w', encoding='utf-8') as f:
            json.dump(obj, f)
        print(f'wrote {ENC_PATH}')
    elif cmd == 'decrypt':
        path = sys.argv[3] if len(sys.argv) > 3 else ENC_PATH
        with open(path, encoding='utf-8') as f:
            obj = json.load(f)
        print(decrypt(obj, password))
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == '__main__':
    main()
