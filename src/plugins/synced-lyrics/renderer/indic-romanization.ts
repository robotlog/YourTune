// Romanizes Hindi and Bengali the way lyrics are usually written in Latin
// letters: "तुम ही हो" is "tum hi ho", not the letter-by-letter "tuma hi ho".

type Script = {
  consonants: Record<string, string>;
  /** Consonants written with a nukta, keyed by the base consonant */
  nuktas: Record<string, string>;
  /** Consonants that never carry the inherent vowel, like Bengali ৎ */
  bare?: Record<string, string>;
  vowels: Record<string, string>;
  matras: Record<string, string>;
  /** Clusters with their own sound, keyed by the two consonants */
  clusters?: Record<string, string>;
  /** Consonant sounds after a virama when they differ from `consonants` */
  afterVirama?: Record<string, string>;
  virama: string;
  anusvara: string;
  chandrabindu: string;
  visarga: string;
  nukta: string;
  digitZero: number;
  /** Characters with no sound of their own */
  silent: string;
  inherent: string;
  /** Sound of the anusvara, `null` to pick "m" or "n" from the next letter */
  anusvaraSound: string | null;
  /** Spell a long "a" inside a word as "aa", since "a" is the short vowel */
  doubleLongA: boolean;
  /** Spell a final "en" as "ein", "में" is "mein" */
  finalEin: boolean;
};

const devanagari: Script = {
  consonants: {
    क: 'k',
    ख: 'kh',
    ग: 'g',
    घ: 'gh',
    ङ: 'n',
    च: 'ch',
    छ: 'chh',
    ज: 'j',
    झ: 'jh',
    ञ: 'n',
    ट: 't',
    ठ: 'th',
    ड: 'd',
    ढ: 'dh',
    ण: 'n',
    त: 't',
    थ: 'th',
    द: 'd',
    ध: 'dh',
    न: 'n',
    प: 'p',
    फ: 'ph',
    ब: 'b',
    भ: 'bh',
    म: 'm',
    य: 'y',
    र: 'r',
    ल: 'l',
    व: 'v',
    श: 'sh',
    ष: 'sh',
    स: 's',
    ह: 'h',
  },
  nuktas: {
    क: 'q',
    ख: 'kh',
    ग: 'gh',
    ज: 'z',
    झ: 'zh',
    ड: 'd',
    ढ: 'dh',
    फ: 'f',
  },
  vowels: {
    अ: 'a',
    आ: 'ā',
    इ: 'i',
    ई: 'i',
    उ: 'u',
    ऊ: 'u',
    ऋ: 'ri',
    ए: 'e',
    ऐ: 'ai',
    ओ: 'o',
    औ: 'au',
    ऑ: 'o',
    ऍ: 'e',
  },
  matras: {
    'ा': 'ā',
    'ि': 'i',
    'ी': 'i',
    'ु': 'u',
    'ू': 'u',
    'ृ': 'ri',
    'े': 'e',
    'ै': 'ai',
    'ो': 'o',
    'ौ': 'au',
    'ॉ': 'o',
    'ॅ': 'e',
  },
  clusters: { जञ: 'gy' },
  virama: '्',
  anusvara: 'ं',
  chandrabindu: 'ँ',
  visarga: 'ः',
  nukta: '़',
  digitZero: 0x966,
  silent: '।॥ऽ‌‍',
  inherent: 'a',
  anusvaraSound: null,
  doubleLongA: true,
  finalEin: true,
};

const bengali: Script = {
  consonants: {
    ক: 'k',
    খ: 'kh',
    গ: 'g',
    ঘ: 'gh',
    ঙ: 'ng',
    চ: 'ch',
    ছ: 'chh',
    জ: 'j',
    ঝ: 'jh',
    ঞ: 'n',
    ট: 't',
    ঠ: 'th',
    ড: 'd',
    ঢ: 'dh',
    ণ: 'n',
    ত: 't',
    থ: 'th',
    দ: 'd',
    ধ: 'dh',
    ন: 'n',
    প: 'p',
    ফ: 'ph',
    ব: 'b',
    ভ: 'bh',
    ম: 'm',
    য: 'j',
    র: 'r',
    ল: 'l',
    শ: 'sh',
    ষ: 'sh',
    স: 'sh',
    হ: 'h',
    ৰ: 'r',
    ৱ: 'w',
  },
  nuktas: { ড: 'r', ঢ: 'rh', য: 'y' },
  bare: { ৎ: 't' },
  vowels: {
    অ: 'o',
    আ: 'a',
    ই: 'i',
    ঈ: 'i',
    উ: 'u',
    ঊ: 'u',
    ঋ: 'ri',
    এ: 'e',
    ঐ: 'oi',
    ও: 'o',
    ঔ: 'ou',
  },
  matras: {
    'া': 'a',
    'ি': 'i',
    'ী': 'i',
    'ু': 'u',
    'ূ': 'u',
    'ৃ': 'ri',
    'ে': 'e',
    'ৈ': 'oi',
    'ো': 'o',
    'ৌ': 'ou',
  },
  afterVirama: { য: 'y' },
  virama: '্',
  anusvara: 'ং',
  chandrabindu: 'ঁ',
  visarga: 'ঃ',
  nukta: '়',
  digitZero: 0x9e6,
  silent: '।॥‌‍',
  inherent: 'o',
  anusvaraSound: 'ng',
  doubleLongA: false,
  finalEin: false,
};

type Sound =
  | { kind: 'consonant'; text: string }
  | { kind: 'vowel'; text: string; inherent?: boolean }
  | { kind: 'nasal' | 'anusvara'; text: string };

const isVowel = (sound?: Sound) => sound?.kind === 'vowel';
const isConsonant = (sound?: Sound) => sound?.kind === 'consonant';
const isInherent = (sound?: Sound) =>
  sound?.kind === 'vowel' && sound.inherent === true;

// A final inherent vowel stays after these clusters: "सत्य" is "satya"
const keepsFinalVowel = new Set(['y', 'r', 'l', 'v']);

const dropSilentVowels = (word: Sound[]) => {
  const last = word.length - 1;
  if (isInherent(word[last]) && word.slice(0, last).some(isVowel)) {
    const clustered = isConsonant(word[last - 2]);
    if (!clustered || !keepsFinalVowel.has(word[last - 1].text)) {
      word.pop();
    }
  }

  // Vowel, consonant, inherent vowel, consonant, vowel loses the inherent
  // vowel. Going from the end matters: "समझना" is "samajhna", not "samjhana"
  for (let i = word.length - 3; i >= 2; i--) {
    if (
      isInherent(word[i]) &&
      isConsonant(word[i - 1]) &&
      isVowel(word[i - 2]) &&
      isConsonant(word[i + 1]) &&
      isVowel(word[i + 2])
    ) {
      word.splice(i, 1);
    }
  }
};

const labials = new Set(['p', 'ph', 'f', 'b', 'bh', 'm']);

const spell = (word: Sound[], script: Script) => {
  dropSilentVowels(word);

  const vowelCount = word.filter(isVowel).length;
  let out = '';
  word.forEach((sound, index) => {
    if (sound.kind === 'anusvara') {
      out +=
        script.anusvaraSound ??
        (labials.has(word[index + 1]?.text ?? '') ? 'm' : 'n');
    } else if (sound.text === 'ā') {
      // "मेरा" ends in a plain "mera", while a lone "आ" has to stay "aa"
      const isFinal = index === word.length - 1;
      const isLoneVowel = vowelCount === 1 && !isConsonant(word[index - 1]);
      out += script.doubleLongA && (!isFinal || isLoneVowel) ? 'aa' : 'a';
    } else {
      out += sound.text;
    }
  });

  return script.finalEin ? out.replace(/en$/, 'ein') : out;
};

const romanize = (line: string, script: Script) => {
  // NFC splits the single-character nukta letters, like ज़ into ज and the nukta
  const chars = Array.from(line.normalize('NFC'));
  let out = '';
  let word: Sound[] = [];

  const flush = () => {
    if (word.length > 0) out += spell(word, script);
    word = [];
  };

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];

    if (script.silent.includes(char)) {
      // A joiner sits inside a word, a danda ends it
      if (char !== '‌' && char !== '‍') flush();
      continue;
    }

    if (script.bare?.[char]) {
      word.push({ kind: 'consonant', text: script.bare[char] });
    } else if (script.consonants[char]) {
      const hasNukta = chars[i + 1] === script.nukta;
      if (hasNukta) i++;

      const previousIsVirama =
        chars[i - 1 - (hasNukta ? 1 : 0)] === script.virama;
      const cluster = previousIsVirama
        ? script.clusters?.[chars[i - 2] + char]
        : undefined;
      if (cluster) {
        word.pop();
        word.push({ kind: 'consonant', text: cluster });
      } else {
        const text =
          (hasNukta ? script.nuktas[char] : undefined) ??
          (previousIsVirama ? script.afterVirama?.[char] : undefined) ??
          script.consonants[char];
        word.push({ kind: 'consonant', text });
      }

      const next = chars[i + 1];
      if (script.matras[next]) {
        word.push({ kind: 'vowel', text: script.matras[next] });
        i++;
      } else if (next === script.virama) {
        i++;
      } else {
        word.push({ kind: 'vowel', text: script.inherent, inherent: true });
      }
    } else if (script.vowels[char]) {
      word.push({ kind: 'vowel', text: script.vowels[char] });
    } else if (char === script.anusvara) {
      word.push({ kind: 'anusvara', text: '' });
    } else if (char === script.chandrabindu) {
      word.push({ kind: 'nasal', text: 'n' });
    } else if (char === script.visarga) {
      word.push({ kind: 'consonant', text: 'h' });
    } else {
      flush();
      const digit = char.charCodeAt(0) - script.digitZero;
      out += digit >= 0 && digit <= 9 ? String(digit) : char;
    }
  }
  flush();

  return out.replace(/\s+/g, ' ').trim() || line;
};

export const romanizeHindi = (line: string) => romanize(line, devanagari);
export const romanizeBengali = (line: string) => romanize(line, bengali);
