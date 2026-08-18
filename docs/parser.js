/* WhatsApp chat -> candidate profiles, ported from the Python parser.py.
   Robust to many free-text / structured Hebrew profile formats.
   Exposes window.parseWhatsappChat(chatText) -> [{name, age, gender, height,
   religious_level, location, phone, occupation, description, looking_for,
   references, ethnicity, marital_status, photos:[filename...]}]. */
(function () {
  'use strict';

  const H = "א-ת׳״'";          // Hebrew letters + geresh/gershayim + apostrophe
  const HC = "[" + H + "]";               // one name char
  const HR = "[" + H + "\\s\\-]";         // name char / space / dash
  const NAME = HC + HR + "*" + HC;        // a name (>=2 chars)
  const re = (p, f) => new RegExp(p, f);

  const EMOJI_RE = /[\u{1F300}-\u{1F9FF}\u{2702}-\u{27B0}\u{FE00}-\u{FE0F}‍\u{2640}-\u{2642}\u{2600}-\u{26FF}‎‏]+/gu;
  const stripEmojis = t => (t || '').replace(EMOJI_RE, '');
  const stripNikud = t => (t || '').replace(/[֐-׏װ-ײ]/g, '');
  const bad = (name, kws) => kws.some(k => name.includes(k));

  // ---------- profile detector ----------
  const INDICATORS = [
    'בן\\s+\\d{2}', 'בת\\s+\\d{2}', 'גיל[:\\s]+\\d{2}', 'גיל\\s*(?:וגובה\\s*)?[:\\s]+\\d{2}',
    'רווק', 'גרוש', 'גר[ה]?\\s+ב', 'מגורים', 'דתי', 'דתיה', 'תורני', 'חרדי',
    'כרטיס\\s*שידוך', 'נעים\\s*מאוד', 'היי,?\\s*אני', 'מחפש[ת]?(?![א-ת])', 'אוהב\\s', 'אוהבת\\s',
    'שירת|שירות\\s*צבאי', 'גובה[:\\s]', 'מטר\\s', 'עיסוק', 'השכלה', 'תכונות\\s*אופי',
    'סטטוס', 'שם\\s*פרטי', 'שם\\s*משפחה', 'שירות\\s*לאומי', 'תואר', 'קצת\\s*על',
    'מצב\\s*משפחתי', 'עדה', 'מגזר', 'התגייס', 'מכינה', 'ישיבה', 'טייל', 'חברותי',
    'לומד(?![א-ת])', 'עיסוק\\s*(?:עכשווי|נוכחי|היום)',
  ].map(p => re(p));
  function looksLikeProfile(text) {
    return INDICATORS.reduce((n, p) => n + (p.test(text) ? 1 : 0), 0) >= 2;
  }

  // ---------- field extractors ----------
  function extractAge(text) {
    const first = text.trim().split('\n')[0];
    const tries = [
      [re('(?:^|[^א-ת])גיל\\s*(?:וגובה\\s*)?[\\s:*]+(\\d{2})'), text],
      [re('(?:בן|בת)\\s+(\\d{2})'), text],
      [re('\\((\\d{2})\\)'), text.slice(0, 200)],
      [re('\\|\\s*(\\d{2})\\s*(?:\\||,|\\n|$)'), text.slice(0, 200)],
      [re(',\\s*(\\d{2})\\s*[,|.\\n\\s]'), text],
      [re('[א-ת]\\s+(\\d{2})\\s*[.\\n]'), first],
      [re('[א-ת]\\s+(\\d{2})\\s+[א-ת]'), first],
      [re('רווק[ה]?\\s*,\\s*(\\d{2})'), text],
    ];
    for (const [rx, src] of tries) {
      const mm = src.match(rx);
      if (mm) { const a = +mm[1]; if (a >= 18 && a <= 70) return a; }
    }
    for (const line of text.trim().split('\n').slice(0, 5)) {
      const mm = line.trim().match(re('(?:^|[.\\s])\\s*(\\d{2})\\s*\\.?\\s*$'));
      if (mm) { const a = +mm[1]; if (a >= 18 && a <= 70) return a; }
    }
    const mm = first.match(re('[א-ת)]\\s+(\\d{2})\\s*$'));
    if (mm) { const a = +mm[1]; if (a >= 18 && a <= 70) return a; }
    return null;
  }

  function extractGender(text) {
    const B = '(?![א-ת])';   // Hebrew-aware word-end (JS \b is ASCII-only)
    const LB = '(?<![א-ת])'; // Hebrew-aware word-start
    const hasBen = re(LB + 'בן\\s+\\d').test(text), hasBat = re(LB + 'בת\\s+\\d').test(text);
    if (hasBen && !hasBat) return 'male';
    if (hasBat && !hasBen) return 'female';
    let mm = text.match(/מין\s*[:*]\s*\*?\s*(זכר|נקבה)/);
    if (mm) return mm[1] === 'זכר' ? 'male' : 'female';
    let about = text;
    const look = text.match(re('מחפש[ת]?' + B));
    if (look) about = text.slice(0, look.index);
    about = about.replace(/רמה\s*דתית/g, '');
    const fem = (about.match(re('רווקה|גרה' + B + '|עובדת' + B + '|דתיה|דתית' + B + '|אוהבת' + B + '|מחפשת' + B + '|לומדת' + B + '|ירושלמית' + B + '|מחנכת' + B + '|דתייה|בוגרת' + B + '|מורה' + B + '|מטפלת' + B + '|סטודנטית' + B + '|מרצה' + B + '|אחות' + B + '|מעצבת' + B + '|רכזת' + B + '|מנהלת' + B, 'g')) || []).length;
    const masc = (about.match(re('רווק' + B + '|גר' + B + '|עובד' + B + '|דתי' + B + '|אוהב' + B + '|מחפש' + B + '|לומד' + B + '|שירת' + B + '|גרוש' + B + '|לוחם' + B + '|קצין' + B + '|משרת' + B, 'g')) || []).length;
    if (fem > masc) return 'female';
    if (masc > 0) return 'male';
    return null;
  }

  const HEIGHT_WORDS = { ארבעים: 140, חמישים: 150, שישים: 160, שבעים: 170, שמונים: 180, תשעים: 190 };
  function extractHeight(text) {
    let mm = text.match(/גובה\s*[\s:;*]*(\d{3})/);
    if (mm) return +mm[1];
    mm = text.match(/גובה\s*[\s:;*]*1[.,](\d{2})/);
    if (mm) return 100 + +mm[1];
    mm = text.match(/מטר\s+(שבעים|שישים|חמישים|ארבעים|שמונים|תשעים)/);
    if (mm) return HEIGHT_WORDS[mm[1]] || null;
    mm = text.slice(0, 300).match(/(?:רווק[ה]?\s*,\s*\d{2}\s*,\s*|,\s*)1[.,](\d{2})/);
    if (mm) return 100 + +mm[1];
    mm = text.slice(0, 300).match(/(?:^|\n|[|])\s*1[.,](\d{2})\s*(?:\n|$|[|])/);
    if (mm) return 100 + +mm[1];
    mm = text.slice(0, 300).match(/בן\s+\d{2}[^0-9]*?(\d{3})\b/);
    if (mm) { const h = +mm[1]; if (h >= 140 && h <= 210) return h; }
    return null;
  }

  const RELIG = [
    ['דתי\\s*(?:ו?תורני)\\s*סגנון\\s*גבעות', 'דתי תורני סגנון גבעות'],
    ['דתי\\s*לאומי\\s*תורני', 'דתי לאומי תורני'],
    ['דתי\\s*(?:ו?תורני)', 'דתי תורני'],
    ['דתייה\\s*לייט', 'דתייה לייט'],
    ['דתיה\\s*לאומית', 'דתיה לאומית'],
    ['דתייה\\s*לאומית', 'דתייה לאומית'],
    ['דתי\\s*לאומי', 'דתי לאומי'],
    ['דתי\\s*חסידי', 'דתי חסידי'],
    ['תורני[ת]?\\s*חרדי[ת]?', 'תורני חרדי'],
    ['תורני[ת]?', 'תורני'],
    ['חרדי[ת]?\\s*מודרני[ת]?', 'חרדי מודרני'],
    ['חרד[יה]', 'חרדי/ת'],
    ['דתי[ה]?(?![א-ת])', 'דתי'],
    ['מסורתי[ת]?', 'מסורתי/ת'],
    ['חילוני[ת]?', 'חילוני/ת'],
    ['חוזר.?\\s*בתשובה', 'חוזר בתשובה'],
  ];
  function extractReligiousLevel(text) {
    const fm = text.match(/(?:רמה\s*דתית|מגזר\s*[+ו]?\s*רמה\s*דתית|מגזר)[:\s*]*\*?\s*\n?\s*([^\n]+)/);
    if (fm) for (const [p, label] of RELIG) if (re(p).test(fm[1])) return label;
    for (const [p, label] of RELIG) if (re(p).test(text)) return label;
    return null;
  }

  const CITIES = [
    ['ירושלמי', 'ירושלים'], ['תל אביבי', 'תל אביב'], ['מעלה אדומים', 'מעלה אדומים'],
    ['גוש עציון', 'גוש עציון'], ['כוכב השחר', 'כוכב השחר'], ['מצפה יאיר', 'מצפה יאיר'],
    ['נוף איילון', 'נוף איילון'], ['בית שמש', 'בית שמש'], ['גבעת שמואל', 'גבעת שמואל'],
    ['פתח תקווה', 'פתח תקווה'], ['רמת גן', 'רמת גן'], ['בני ברק', 'בני ברק'],
    ['רמת מגשימים', 'רמת מגשימים'], ['אבני איתן', 'אבני איתן'], ['בת עין', 'בת עין'],
    ['מרכז שפירא', 'מרכז שפירא'], ['ירושלים', 'ירושלים'], ['תל אביב', 'תל אביב'],
    ['חיפה', 'חיפה'], ['באר שבע', 'באר שבע'], ['חברון', 'חברון'], ['אשדוד', 'אשדוד'],
    ['אשקלון', 'אשקלון'], ['קרית שמואל', 'קרית שמואל'], ['קרית שמונה', 'קרית שמונה'],
    ['אור יהודה', 'אור יהודה'], ['כפר מימון', 'כפר מימון'], ['תל מונד', 'תל מונד'],
    ['רעננה', 'רעננה'], ['רחובות', 'רחובות'], ['יבנה', 'יבנה'], ['שוהם', 'שוהם'],
    ['עפרה', 'עפרה'], ['אלקנה', 'אלקנה'], ['תקוע', 'תקוע'], ['אלעזר', 'אלעזר'],
    ['לוד', 'לוד'], ['אדם', 'אדם'], ['חשמונאים', 'חשמונאים'], ['מושב בקוע', 'מושב בקוע'],
    ['הר חברון', 'הר חברון'],
  ];
  function extractLocation(text) {
    const pats = [
      'מגורים\\s*[:*]\\s*\\*?\\s*\\n?\\s*([א-ת\\s\\-]+?)(?:\\.|,|\\n|$)',
      'אזור\\s*מגורים\\s*[:\\s]*\\*?\\s*([א-ת\\s\\-]+?)(?:\\.|,|\\n|$)',
      'עיר\\s*מגורים\\s*[:*]\\s*\\*?\\s*([א-ת\\s\\-]+?)(?:\\.|,|\\n|$)',
      'מקום\\s*מגורים\\s*[:*]\\s*\\*?\\s*([א-ת\\s\\-]+?)(?:\\.|,|\\n|$)',
      'גר[ה]?\\s+(?:בדירת\\s+שותפות\\s+)?ב([א-ת\\s\\-]+?)(?:\\.|,|\\n|$|\\s+ו)',
    ];
    for (const p of pats) { const mm = text.match(re(p)); if (mm && mm[1].trim().length > 1) return mm[1].trim(); }
    const mm = text.slice(0, 200).match(re('(?:בת|בן)\\s+\\d{2}[,.]?\\s*מ([א-ת][א-ת\\s\\-]*?)(?:\\.|,|\\n|\\s*$)'));
    if (mm && mm[1].trim().length > 1) return mm[1].trim();
    for (const [p, city] of CITIES) if (text.includes(p)) return city;
    return null;
  }

  function extractPhone(text) {
    let phones = [...text.matchAll(/(0\d{1,2}[\-\s]?\d{3}[\-\s]?\d{4})/g)].map(x => x[1]);
    if (!phones.length) phones = [...text.matchAll(/(0\d{8,9})/g)].map(x => x[1]);
    if (!phones.length) return null;
    const mm = text.match(/(?:קשר\s*(?:ישירות\s*)?אלי|יצירת\s*קשר)[^\n]*(0\d{1,2}[\-\s]?\d{3}[\-\s]?\d{4})/);
    if (mm) return mm[1];
    const refs = [...text.matchAll(/(?:שליט"א|חבר\s*קרוב|לבירורים|בירורים)[^0]*(0\d{1,2}[\-\s]?\d{3}[\-\s]?\d{4})/g)].map(x => x[1]);
    if (refs.length) {
      const nonRef = phones.filter(p => !refs.includes(p));
      return nonRef.length ? nonRef[nonRef.length - 1] : refs[0];
    }
    return phones.length === 1 ? phones[0] : phones[phones.length - 1];
  }

  function extractOccupation(text) {
    const single = [
      'עיסוק\\s*(?:היום|נוכחי)?\\s*[:*]\\s*\\*?\\s*\\n?\\s*([^\\n]+)',
      'עיסוק\\s*עכשווי\\s*\\*?\\s*[:*]\\s*\\*?\\s*([^\\n]*)',
      'עיסוק\\s*עכשווי\\s*\\*?\\s*[:*]\\s*\\*?\\s*\\n\\s*([^\\n]+)',
      '(?:השכלה\\s*(?:ו|/)?\\s*(?:תעסוקה|עיסוק))\\s*[:*]\\s*\\*?\\s*\\n?\\s*([^\\n]+)',
    ];
    for (const p of single) { const mm = text.match(re(p)); if (mm) { const o = stripEmojis(mm[1]).trim(); if (o.length > 2) return o; } }
    let mm = text.match(/מה\s+(?:עוש[הה]|את|אתה)\s+כרגע\s+בחיים\s*\??\s*\*?\s*(.+)/);
    if (mm) { let o = stripEmojis(mm[1]).trim().replace(/^[•\-*\t\s]+/, ''); if (o.length > 2) return o; }
    mm = text.match(/מה\s+(?:עוש[הה]|את|אתה)\s+כרגע\s+בחיים\s*\??\s*\*?\s*\n\s*([^\n]+)/);
    if (mm) { let o = stripEmojis(mm[1]).trim().replace(/^[•\-*\t\s]+/, ''); if (o.length > 2) return o; }
    mm = text.match(/מה\s+אני\s+עוש[הה]\s+בחיים\s*\??\s*\*?\s*\n\s*([^\n]+)/);
    if (mm) { let o = stripEmojis(mm[1]).trim().replace(/^[•\-*\t\s]+/, ''); if (o.length > 2) return o; }
    mm = text.match(/עושה\s*כרגע\s*[:\s]*([^\n]+)/);
    if (mm) return stripEmojis(mm[1]).trim();
    mm = text.match(/למד[ה]?\s+(הנדסת\s+[^\n,]{2,20})[^\n]*ועובד[ת]?\s+בתחום/);
    if (mm) return mm[1].trim();
    const occs = [];
    mm = text.match(/עובד[ת]?\s+(?:ב|כ)([^\n.]{3,50})/);
    if (mm) { const o = mm[1].trim(); if (o !== 'תחום' && o !== 'תחום.') occs.push(o); }
    mm = text.match(/לומד[ת]?\s+ב([^\n.]{3,50})/);
    if (mm) occs.push('לומד/ת ב' + mm[1].trim());
    if (occs.length) return occs.join(', ');
    mm = text.match(/נהג\s+(?:של\s+)?([^\n.]{3,50})/);
    if (mm) return 'נהג ' + mm[1].trim();
    mm = text.match(/מדריכ[ת]?\s+טיולים/);
    if (mm) return mm[0].trim();
    const titles = ['עורכת?\\s*דין[^\\n]*', 'מהנדס(?:ת)?\\s+[^\\n]*', 'מתכנת[^\\n]*',
      'רואה\\s*חשבון[^\\n]*', 'רופא[^\\n]*', 'אחות\\s+ב[^\\n]*', 'קלינאית\\s+תקשורת', 'מרפאה\\s+בעיסוק'];
    for (const p of titles) { const t = text.match(re(p)); if (t) return t[0].trim(); }
    mm = text.match(/(?<!אלון\s)מורה\s+ל[^\n]*/);
    if (mm) return mm[0].trim();
    return null;
  }

  function extractLookingFor(text) {
    let mm = text.match(/(?:מה\s+אני\s+מחפש[ת]?|מחפש[ת]?|מה\s+(?:הוא|היא|אני)\s+מחפש[ת]?)\s*[:*]\s*\*?\s*\n?\s*([\s\S]+?)(?:\n\n|טווח|טלפון|לבירורים|מעשן|$)/);
    if (mm && mm[1].trim().length > 5) return stripEmojis(mm[1]).trim();
    mm = text.match(/על\s+הבחורה\s*[:\s]*\n?\s*([\s\S]+?)(?:\n\n|$)/);
    if (mm && mm[1].trim().length > 5) return stripEmojis(mm[1]).trim();
    return null;
  }

  function extractReferences(text) {
    const refs = [...text.matchAll(/([א-ת\s\-"]+?)\s*:?\s*(?:📞\s*)?(0\d{1,2}[\-\s]?\d{3}[\-\s]?\d{4})/g)];
    if (refs.length >= 2) {
      const lines = [];
      for (const r of refs) {
        let name = r[1].trim().replace(/^📞/, '').trim();
        if (name.includes('קשר') || name.includes('אלי')) continue;
        if (name && name.length > 2) lines.push(name + ': ' + r[2]);
      }
      return lines.length ? lines.join('\n') : null;
    }
    return null;
  }

  function extractEthnicity(text) {
    let mm = text.match(/עדה\s*[:*]\s*\*?\s*([^\n]+)/);
    if (mm) return stripEmojis(mm[1]).trim().replace(/^[\-:\s]+/, '');
    mm = text.match(/(חצי\s+[א-ת]+\s+חצי\s+[א-ת]+)/);
    if (mm) return mm[1].trim();
    return null;
  }

  function normStatus(v) {
    v = v.trim();
    if (v.includes('גרוש')) return 'גרוש/ה';
    if (v.includes('אלמן')) return 'אלמן/ה';
    if (v.includes('רווק')) return 'רווק/ה';
    return v;
  }
  function extractMaritalStatus(text) {
    const mm = text.match(/(?:סטטוס|מצב\s*משפחתי|רווק\/גרוש\/אלמן)\s*[:*]\s*\*?\s*([^\n]+)/);
    if (mm) return normStatus(stripEmojis(mm[1]).trim());
    if (/גרוש[ה]?\+?/.test(text)) return 'גרוש/ה';
    if (/אלמן[ה]?/.test(text)) return 'אלמן/ה';
    if (/רווק[ה]?/.test(text)) return 'רווק/ה';
    return null;
  }

  // ---------- name extraction (mirrors parser.py order) ----------
  const NAME_BAD = ['מחפש', 'אופי', 'תכונות', 'משתדלת', 'רגישות', 'גברי'];
  function extractName(text) {
    const lines = text.trim().split('\n');
    let first = lines[0].trim();
    let firstClean = stripEmojis(first).trim()
      .replace(/\s*[:;][)(DP]+\s*/g, '').trim()
      .replace(/^[•〰️📌\s]+/, '').trim();
    const firstNoNikud = stripNikud(firstClean).trim();

    // בס"ד header -> name on next non-empty line
    if (re("^בס['\"׳״]{0,3}ד\\s*$").test(firstNoNikud)) {
      for (const line of lines.slice(1)) {
        const lc = stripNikud(stripEmojis(line).trim()).trim();
        if (!lc) continue;
        if (re('^' + HR + '+$').test(lc) && lc.length > 1 && lc.length < 30) return lc;
        break;
      }
    }

    const firstUnbold = firstClean.replace(/\*/g, '').trim();
    const firstUnboldNk = stripNikud(firstUnbold).trim();

    // pure Hebrew name, 2nd line not a שם label
    if (firstNoNikud && re('^' + HR + '+$').test(firstNoNikud)) {
      const name = firstNoNikud.trim();
      if (name.length > 1 && name.length < 30 && lines.length >= 2) {
        const second = stripEmojis(lines[1]).trim();
        if (!/^\*?שם/.test(second)) return name;
      }
    }

    const branches = [
      ['^(' + NAME + ')\\s*\\|\\s*(?:בן|בת\\s+)?\\d{2}', firstNoNikud, 2, 30],
      ['^(' + NAME + ')\\s*,\\s*\\d{2}\\s*,', firstNoNikud, 2, 30],
    ];
    for (const [p, src, lo, hi] of branches) {
      const mm = src.match(re(p));
      if (mm) { const n = mm[1].trim(); if (n.length > lo && n.length < hi) return n; }
    }

    // *Name* בן/בת XX  and bullet variants, *Name* (XX)
    for (const p of [
      '^\\*(' + NAME + ')\\*\\s*(?:•\\s*)?(?:בן|בת)\\s+\\d{2}',
      '^\\*(' + NAME + ')\\s*•\\s*(?:בן|בת)\\s+\\d{2}',
      '^\\*(' + NAME + ')\\*\\s*\\(\\d{2}\\)',
    ]) { const mm = firstClean.match(re(p)); if (mm) { const n = mm[1].trim(); if (n.length > 2 && n.length < 40) return n; } }

    let mm = text.match(re('קוראים\\s+ל[הו]\\s+(' + HC + HR + '*' + HC + ')'));
    if (mm) { let n = mm[1].trim().split(/\s*,\s*/)[0].trim(); if (n.length > 2 && n.length < 30) return n; }

    const mFirst = text.match(re('שם\\s*פרטי\\s*[:*]\\s*\\*?\\s*([' + H + '\\s\\-]+)'));
    const mLast = text.match(re('שם\\s*משפחה\\s*[:*]\\s*\\*?\\s*([' + H + '\\s\\-]+)'));
    if (mFirst && mLast) {
      const full = mFirst[1].trim().split('\n')[0].trim() + ' ' + mLast[1].trim().split('\n')[0].trim();
      if (full.length > 2 && full.length < 40) return full;
    }

    const textLtr = text.replace(/[‎‏]/g, '');
    mm = textLtr.match(re('\\*?שם\\s*(?:מלא|פרטי)?\\s*\\*?\\s*[:*]\\s*\\*?\\s*([' + H + '\\s\\-]+)'));
    if (mm) { let n = mm[1].trim().split(/\s*,\s*בן\s|\s*,\s*בת\s|\s*\n/)[0].trim(); if (n.length > 2 && n.length < 40) return n; }

    mm = textLtr.match(re('\\*?שמי\\*?(?![א-ת])\\s*[:*]?\\s*\\*?\\s*(' + HC + HR + '*' + HC + ')'));
    if (mm) { let n = mm[1].trim().split(/\s*,\s*|\s*\n/)[0].trim(); if (n.length > 2 && n.length < 40) return n; }

    if (first.includes('כרטיס שידוך') || first.includes('כרטיס שידוכים')) {
      let m2 = text.match(re('שם\\s*[;:*]\\s*\\*?\\s*([' + H + '\\s\\-]+)'));
      if (m2) { const n = m2[1].trim().split(/\s*\n/)[0].trim(); if (n.length > 2 && n.length < 40) return n; }
      for (const line of lines.slice(1)) {
        const lc = stripEmojis(line).trim();
        const mm2 = lc.match(re('^נעים מאוד,?\\s*אני\\s+([' + H + '\\s\\-]+?)(?:,|\\s*$)'));
        if (mm2) return mm2[1].trim();
      }
    }

    mm = text.match(re('נעים מאוד[!,]?\\s*(?:אני\\s+)?([' + H + '\\s\\-]+?)(?:,|\\s+בן\\s|\\s+בת\\s)'));
    if (mm) return mm[1].trim();

    mm = text.match(re('(?:^|\\n)\\s*אני\\s+(' + NAME + ')\\s*[.,]\\s*(?:בן|בת)\\s+\\d{2}'));
    if (mm) { const n = mm[1].trim(); if (n.length > 2 && n.length < 30) return n; }

    mm = text.slice(0, 500).match(re('(' + NAME + ')\\s*,\\s*(?:בן|בת)\\s+\\d{2}'));
    if (mm) { const n = mm[1].trim(); if (n.length > 2 && n.length < 30 && n.split(/\s+/).length <= 4 && !bad(n, ['מחפש', 'אופי', 'תכונות', 'משתדלת', 'רגישות', 'גברי'])) return n; }

    const textNoEmoji = stripEmojis(text.slice(0, 500));
    if (/(?:בן|בת)\s+\d{2}/.test(textNoEmoji)) {
      mm = textNoEmoji.match(re('^(' + NAME + ')\\s*\\.'));
      if (mm) { const n = mm[1].trim(); if (n.length > 2 && n.length < 30 && n.split(/\s+/).length <= 4 && !bad(n, NAME_BAD)) return n; }
    }
    mm = textNoEmoji.match(re('(' + NAME + ')\\s*\\.\\s*(?:בן|בת)\\s+\\d{2}'));
    if (mm) { const n = mm[1].trim(); if (n.length > 2 && n.length < 30 && n.split(/\s+/).length <= 4 && !bad(n, NAME_BAD)) return n; }
    mm = textNoEmoji.match(re('^(' + NAME + ')\\s*\\.\\s*(\\d{2})\\s*\\.'));
    if (mm) { const n = mm[1].trim(), a = +mm[2]; if (n.length > 2 && n.length < 30 && n.split(/\s+/).length <= 4 && a >= 18 && a <= 70) return n; }
    mm = textNoEmoji.slice(0, 500).match(re('(' + NAME + ')\\s*,\\s*\\d{2}\\s*,\\s*גובה'));
    if (mm) { const n = mm[1].trim(); if (n.length > 1 && n.length < 30 && n.split(/\s+/).length <= 4) return n; }

    mm = text.match(re('היי[,.]?\\s*(?:מה\\s+קורה\\??\\s*)?(?:אז\\s+)?אני\\s+(' + HC + HR + '*' + HC + ')'));
    if (mm) { let n = mm[1].trim().split(/\s*:\s*|\s*\n/)[0].trim().split(/\s*,\s*(?:בן|בת)\s/)[0].trim(); if (n.length > 2) return n; }

    if (firstClean.startsWith('היי')) {
      for (const line of lines.slice(1, 4)) {
        const lc = stripEmojis(line).trim();
        let m2 = lc.match(re('^אני\\s+(' + NAME + ')\\s*[.,]\\s*(?:בן|בת)\\s+\\d'));
        if (m2) { const n = m2[1].trim(); if (n.length > 2 && n.length < 30) return n; }
        m2 = lc.match(re('^(' + HC + HR + '*' + HC + ')\\s+(?:בן|בת)\\s+\\d'));
        if (m2) { const n = m2[1].trim(); if (n.length > 2 && n.length < 30) return n; }
      }
    }

    mm = firstUnboldNk.match(re('^([' + H + '\\s\\-]+)\\s+(?:בן|בת)\\s+\\d{2}'));
    if (mm) { const n = mm[1].trim(); if (n.length > 2 && n.length < 30) return n; }
    mm = firstClean.match(re('^([' + H + '\\s\\-]+?)\\s+\\d{2}\\s*\\.'));
    if (mm) { let n = mm[1].trim().replace(/\s+(?:בן|בת)$/, ''); if (n.length > 2 && n.length < 30) return n; }

    for (const line of lines.slice(0, 5)) {
      const lc = stripEmojis(line).trim();
      const m2 = lc.match(re('^([' + H + ']+)\\s*\\(([' + H + ']+)\\)\\s*([' + H + '\\s\\-]+)'));
      if (m2) { const n = m2[1] + ' ' + m2[3].trim(); if (n.length > 2 && n.length < 40) return n; }
    }

    for (let idx = 1; idx < Math.min(lines.length, 6); idx++) {
      const lc = stripEmojis(lines[idx]).trim();
      const lcnk = stripNikud(lc).trim();
      if (!lcnk) continue;
      if (/^[*]?(שם|גיל|גובה|סטטוס|מגורים|עיסוק|עדה|מגזר|דתי|תורני|חרדי|חילוני|מסורתי|רווק|גרוש|גרה|גר\b)/.test(lcnk)) continue;
      if (re('^' + HR + '+$').test(lcnk)) {
        const n = lcnk.trim();
        if (n.length < 30) {
          if (n.length <= 2) { if (idx + 1 < lines.length && /^\s*(?:בן|בת)\s+\d/.test(lines[idx + 1].trim())) return n; }
          else return n;
        }
      }
      let m2 = lcnk.match(re('^(' + NAME + ')\\s+(?:בן|בת)\\s+\\d'));
      if (m2) { const n = m2[1].trim(); if (n.length > 2 && n.length < 30) return n; }
      m2 = lcnk.match(re('^(' + NAME + ')\\s*,\\s*(?:בן|בת)\\s+\\d'));
      if (m2) { const n = m2[1].trim(); if (n.length > 2 && n.length < 30) return n; }
      break;
    }

    const fcBranches = [
      '^[*\\s]*-\\s*(' + NAME + ')',
      '^([' + H + '\\s\\-]+?)\\s*-\\s*(?:בן|בת)\\s+\\d',
      '^([' + H + '\\s\\-]+?)\\s*,\\s*(?:בן|בת)\\s+\\d',
      '^([' + H + '\\s\\-]+?)\\s+(?:בן|בת)\\s+\\d',
      '^([' + H + '\\s\\-]+?)\\s*\\.\\s*(?:בן|בת)\\s+\\d',
    ];
    for (const p of fcBranches) { const mm2 = firstClean.match(re(p)); if (mm2) { const n = mm2[1].trim(); if (n.length > 2 && n.length < 30) return n; } }

    mm = text.slice(0, 500).match(re('(?:^|\\n)\\s*(' + NAME + ')\\s+(?:בן|בת)\\s+\\d{2}'));
    if (mm) { const n = mm[1].trim(); if (n.length > 2 && n.length < 30 && n.split(/\s+/).length <= 4) return n; }

    for (const p of [
      '^([' + H + '\\s\\-]+?)\\s+\\d{2}\\s+[' + H + ']',
      '^(' + NAME + ')\\s+מ[' + H + ']',
      '^([' + H + '\\s\\-]+?)\\s*\\.\\s*$',
      '^\\*?([' + H + '\\s\\-]+?)\\*?\\s*(?:\\(נכתב|\\(|,|$)',
    ]) { const mm2 = firstClean.match(re(p)); if (mm2) { const n = mm2[1].trim(); if (n.length > 2 && n.length < 30) return n; } }

    mm = text.match(re('^([' + H + '\\s\\-]+?)\\s*,\\s*\\d{2}\\s*[|\\n]', 'm'));
    if (mm) { const n = mm[1].trim(); if (n.length > 2 && n.length < 30) return n; }

    mm = firstClean.match(re('^([' + H + '\\s\\-]+?)\\s*,?\\s*(?:רווק|גרוש)'));
    if (mm) { const n = mm[1].trim(); if (n.length > 2 && n.length < 30) return n; }

    return null;
  }

  function extractCandidate(text) {
    if (!text || text.length < 20) return null;
    let name = extractName(text);
    const age = extractAge(text);
    const gender = extractGender(text);
    if (!name) return null;
    name = name.replace(/\s+(?:בן|בת)$/, '').replace(/[\s\-]+$/, '').replace(/^[\-•\s]+/, '');
    const badNames = ['תכונות', 'מחפש', 'אופי', 'דתי לאומי', 'תורני', 'דתי', 'חרדי'];
    if (badNames.includes(name) || /(?:תכונות|מחפש|אופי|מתפללת|שומרת|מורה ל|עובד(?:ת|ים)?(?:\s|$)|לומד(?:ת|ים)?(?:\s|$))/.test(name)) return null;
    if (!age && !looksLikeProfile(text)) return null;
    return {
      name, age, gender,
      height: extractHeight(text),
      religious_level: extractReligiousLevel(text),
      location: extractLocation(text),
      phone: extractPhone(text),
      occupation: extractOccupation(text),
      description: stripEmojis(text).trim(),
      looking_for: extractLookingFor(text),
      references: extractReferences(text),
      ethnicity: extractEthnicity(text),
      marital_status: extractMaritalStatus(text),
    };
  }

  const NAME_FIXES = {
    'איתי': 'איתי מעטוף', 'גר בחברון': 'ניצן מאיר', 'גר בירושלים': 'נדב אריכא',
    'כרטיס שידוכים': 'בנימין כהן', 'לדבר איתה': 'יערה באגד', 'חברה ממש טובה שלי': 'לימור אלמוג',
    'ירושלמית': 'אסתר נדב', 'גרה בירושלים': 'עדיה ביטקובר', 'גר בתקוע': 'בצלאל טולידאנו',
    'אהלן אהלן': 'יוסף חדד', 'הנה': 'עינת', 'ניצוצות': 'יקיר חביב אלימלך',
  };

  function parseWhatsappChat(text) {
    const parts = text.split(/\[(\d{2}\/\d{2}\/\d{4}),\s*(\d{1,2}:\d{2}:\d{2})\]\s*([^:]+):\s*/);
    const messages = [];
    for (let i = 1; i + 3 < parts.length; i += 4) {
      messages.push({ sender: (parts[i + 2] || '').trim(), body: (parts[i + 3] || '').trim() });
    }
    const profiles = [];
    let current = null;
    for (const msg of messages) {
      const body = msg.body;
      const photoFiles = [...body.matchAll(/<attached:\s*(.+?)>/g)].map(x => x[1].trim());
      const bodyClean = body.replace(/[‎‏]?\s*<attached:\s*.+?>/g, '').trim();
      if (bodyClean.length > 20 && looksLikeProfile(bodyClean)) {
        if (current) profiles.push(current);
        current = { text: bodyClean, photos: photoFiles.slice() };
      } else if (photoFiles.length && current) {
        current.photos.push(...photoFiles);
      }
    }
    if (current) profiles.push(current);

    const candidates = [];
    const seen = new Set();
    for (const p of profiles) {
      const c = extractCandidate(p.text);
      if (!c) continue;
      c.photos = p.photos;
      c.source = 'whatsapp';
      if (NAME_FIXES[c.name]) c.name = NAME_FIXES[c.name];
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      candidates.push(c);
    }
    return candidates;
  }

  if (typeof window !== 'undefined') window.parseWhatsappChat = parseWhatsappChat;
  if (typeof module !== 'undefined' && module.exports) module.exports = { parseWhatsappChat };
})();
