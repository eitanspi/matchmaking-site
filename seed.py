"""Insert a few fictional sample candidates so the UI isn't empty on first run.

    python seed.py

Safe to run once on a fresh database. All data here is invented — no real people.
"""
from models import init_db, create_candidate, create_match, get_all_candidates

SAMPLES = [
    dict(name='דוד לוי', age=29, gender='male', height=178, religious_level='דתי לאומי',
         location='ירושלים', marital_status='רווק', ethnicity='ספרדי', occupation='מהנדס תוכנה',
         description='בחור שמח ורציני, אוהב טיולים ולימוד.', looking_for='בחורה חמה ומשפחתית'),
    dict(name='נועה כהן', age=27, gender='female', height=165, religious_level='דתי לאומי',
         location='מודיעין', marital_status='רווקה', ethnicity='אשכנזי', occupation='מורה',
         description='רגישה, אכפתית ואוהבת אנשים.', looking_for='בחור עם ערכים ולב טוב'),
    dict(name='אבי מזרחי', age=33, gender='male', height=182, religious_level='דתי תורני',
         location='פתח תקווה', marital_status='רווק', ethnicity='תימני', occupation='רואה חשבון',
         description='יסודי, נאמן ובעל שאיפות.', looking_for='בחורה תורנית ושמחה'),
    dict(name='שירה פרץ', age=31, gender='female', height=170, religious_level='דתי תורני',
         location='רמת גן', marital_status='רווקה', ethnicity='מרוקאי', occupation='עורכת דין',
         description='חכמה, עצמאית ובעלת חוש הומור.', looking_for='בחור יציב ורגוע'),
]


def main():
    init_db()
    if get_all_candidates():
        print('Database already has candidates — skipping seed.')
        return
    ids = []
    for c in SAMPLES:
        c['source'] = 'seed'
        ids.append(create_candidate(c))
    create_match(ids[0], ids[1], notes='דוגמה')
    print(f'Inserted {len(ids)} sample candidates and 1 sample match.')


if __name__ == '__main__':
    main()
