import { test, expect } from '@playwright/test';

import {
  romanizeBengali,
  romanizeHindi,
} from '../src/plugins/synced-lyrics/renderer/indic-romanization';

const hindi: [string, string][] = [
  ['तुम ही हो, अब तुम ही हो।', 'tum hi ho, ab tum hi ho'],
  ['हम तेरे बिन अब रह नहीं सकते', 'ham tere bin ab rah nahin sakte'],
  ['तेरे बिना क्या वजूद मेरा', 'tere bina kya vajud mera'],
  ['ज़िंदगी अब तुम ही हो', 'zindagi ab tum hi ho'],
  ['चैन भी, मेरा दर्द भी', 'chain bhi, mera dard bhi'],
  ['मेरी आशिक़ी अब तुम ही हो', 'meri aashiqi ab tum hi ho'],
  ['दिल में मोहब्बत है १० बार', 'dil mein mohabbat hai 10 baar'],
  ['आँखों में Baby तू मेरा प्यार', 'aankhon mein Baby tu mera pyaar'],
  ['कहना क्या, समझना, करना', 'kahna kya, samajhna, karna'],
  ['सड़क पर लड़की', 'sadak par ladki'],
  ['रहते हैं, कहते हैं', 'rahte hain, kahte hain'],
  ['सत्य', 'satya'],
  ['हंसना', 'hansna'],
  ['हँसना', 'hansna'],
  ['ढूँढ़ता', 'dhundhta'],
  ['ॐ नमः', 'om namah'],
  ['ज्ञान', 'gyaan'],
  ['न', 'na'],
  ['Love you', 'Love you'],
  // The same letter typed as one character or as a letter and a nukta
  ['ज़रा', 'zara'],
  ['ज़रा', 'zara'],
];

const bengali: [string, string][] = [
  [
    'আমার সোনার বাংলা, আমি তোমায় ভালোবাসি।',
    'amar shonar bangla, ami tomay bhalobashi',
  ],
  ['চাঁদ', 'chand'],
  ['রং', 'rong'],
  ['মন', 'mon'],
  ['করবো', 'korbo'],
  ['তুমি আমার ১০ বার', 'tumi amar 10 bar'],
  ['হঠাৎ', 'hothat'],
  ['র\u200d্যাপ', 'ryap'],
  ['কেমন আছো?', 'kemon achho?'],
  ['Love you', 'Love you'],
];

for (const [line, expected] of hindi) {
  test(`romanizeHindi: ${line}`, () => {
    expect(romanizeHindi(line)).toBe(expected);
  });
}

for (const [line, expected] of bengali) {
  test(`romanizeBengali: ${line}`, () => {
    expect(romanizeBengali(line)).toBe(expected);
  });
}
