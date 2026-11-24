'use strict';

/**
 * Question banks.
 *
 *  - `practice`    : 20 training questions (scores do not count, explanations are shown).
 *  - `competition` : 50 questions for the real event.
 *
 * Each question: { category, text, options: [A, B, C, D], correct: 0-3, explain? }
 *
 * IMPORTANT: have a knowledgeable person (teacher / scholar) review every question
 * and answer before the event. Edit this file only - the server validates it on start.
 */

const PRACTICE_SECONDS = Number(process.env.PRACTICE_SECONDS) || 15;
const COMPETITION_SECONDS = Number(process.env.COMPETITION_SECONDS) || 15;
// How long the answer stays on screen before the next question starts (when Auto-advance is on).
const PRACTICE_REVEAL_SECONDS = Number(process.env.PRACTICE_REVEAL_SECONDS) || 6; // time to read the explanation
const COMPETITION_REVEAL_SECONDS = Number(process.env.COMPETITION_REVEAL_SECONDS) || 4;

const practice = [
  { category: 'Basics', text: 'Which Surah is the first in the Mushaf?', options: ['Al-Baqarah', 'Al-Fatiha', 'Al-Ikhlas', 'An-Nas'], correct: 1,
    explain: "Al-Fatiha ('The Opening') begins the Quran and is recited in every rak'ah of the prayer." },
  { category: 'Basics', text: 'How many obligatory prayers do Muslims offer each day?', options: ['3', '4', '5', '6'], correct: 2,
    explain: 'Fajr, Dhuhr, Asr, Maghrib and Isha.' },
  { category: 'Prophets', text: 'Which prophet was commanded to build the Ark?', options: ['Ibrahim', 'Nuh', 'Musa', 'Yunus'], correct: 1,
    explain: 'Nuh (AS) built the Ark before the flood - see Surah Hud and Surah Nuh.' },
  { category: 'Prophets', text: "Which prophet is called 'Khalilullah' (the close friend of Allah)?", options: ['Ibrahim', 'Musa', 'Isa', 'Dawud'], correct: 0,
    explain: 'Quran 4:125 - "Allah took Ibrahim as a close friend".' },
  { category: 'Prophets', text: 'Who was the first human being and the first prophet?', options: ['Idris', 'Nuh', 'Adam', 'Ibrahim'], correct: 2,
    explain: 'Adam (AS) was created by Allah and was the first prophet.' },
  { category: 'Surahs', text: 'What is the main theme of Surah Al-Ikhlas?', options: ['Fasting', 'The Oneness of Allah (Tawhid)', 'Charity', 'The Pilgrimage'], correct: 1,
    explain: "Al-Ikhlas declares that Allah is One, Self-Sufficient, and has no equal. The Prophet ﷺ said it equals a third of the Quran in reward." },
  { category: 'Surahs', text: "What does the name 'Al-Baqarah' mean?", options: ['The Family of Imran', 'The Cow', 'The Women', 'The Table Spread'], correct: 1,
    explain: 'Al-Baqarah means "The Cow" and is the longest Surah.' },
  { category: 'Seerah', text: 'In which city was Prophet Muhammad ﷺ born?', options: ['Madinah', 'Taif', 'Makkah', 'Jerusalem'], correct: 2,
    explain: 'He ﷺ was born in Makkah in the Year of the Elephant.' },
  { category: 'Seerah', text: 'To which city did the Prophet ﷺ migrate (the Hijrah)?', options: ['Madinah', 'Makkah', 'Taif', 'Damascus'], correct: 0,
    explain: 'The Hijrah to Madinah marks the start of the Islamic calendar.' },
  { category: 'Quran Sciences', text: 'What is the science of the rules of correct Quran recitation called?', options: ['Tafsir', 'Fiqh', 'Tajweed', 'Hadith'], correct: 2,
    explain: 'Tajweed means to pronounce every letter correctly with its rights.' },
  { category: 'Quran Sciences', text: 'What is a single verse of the Quran called in Arabic?', options: ['Surah', 'Ayah', 'Juz', 'Ruku'], correct: 1,
    explain: 'An Ayah means "sign"; the plural is Ayat.' },
  { category: 'Prophets', text: 'Which prophet could understand the speech of birds and ants and ruled over the jinn?', options: ['Dawud', 'Sulaiman', 'Yusuf', 'Zakariya'], correct: 1,
    explain: 'See Surah An-Naml (27:16-19).' },
  { category: 'Surahs', text: 'Which Surah tells the story of the People of the Cave?', options: ['Al-Kahf', 'Yusuf', 'Maryam', 'Al-Anbiya'], correct: 0,
    explain: 'Surah Al-Kahf (18) - recommended to be read on Fridays.' },
  { category: 'Prophets', text: 'Which prophet was ordered to strike the sea with his staff so that it parted?', options: ['Isa', 'Nuh', 'Harun', 'Musa'], correct: 3,
    explain: 'See Surah Ash-Shu\'ara (26:63).' },
  { category: 'Quran Sciences', text: "What does the word 'Quran' literally mean?", options: ['The Light', 'The Recitation', 'The Path', 'The Mercy'], correct: 1,
    explain: "It comes from the Arabic root q-r-' meaning to read or recite." },
  { category: 'Prophets', text: 'Which prophet was born without a father?', options: ['Yahya', 'Yusuf', 'Isa', 'Ismail'], correct: 2,
    explain: 'Isa (AS) was born miraculously to Maryam - see Surah Maryam and Al-Imran 3:59.' },
  { category: 'Surahs', text: 'Which Surah mentions the winter and summer journeys?', options: ['Quraysh', 'Al-Fil', 'Al-Ma\'un', 'Al-Humazah'], correct: 0,
    explain: 'Surah Quraysh (106) reminds the Quraysh of their trade journeys and Allah\'s favour.' },
  { category: 'Basics', text: 'What is the pilgrimage to Makkah called?', options: ['Umrah only', 'Zakah', 'Hajj', 'Ziyarah'], correct: 2,
    explain: 'Hajj is the fifth pillar of Islam, for those who are able.' },
  { category: 'Surahs', text: "Which Surah's name means 'The Believers'?", options: ['Al-Munafiqun', "Al-Mu'minun", 'Al-Kafirun', 'An-Nur'], correct: 1,
    explain: "Surah Al-Mu'minun is the 23rd Surah." },
  { category: 'Surahs', text: "Which Surah's name means 'The Table Spread'?", options: ["Al-Ma'idah", 'Al-Anam', 'Al-Araf', 'At-Tawbah'], correct: 0,
    explain: "Al-Ma'idah (5) takes its name from the table that the disciples of Isa asked for." },
];

const competition = [
  { category: 'Basics', text: 'How many Surahs are there in the Quran?', options: ['110', '112', '114', '116'], correct: 2 },
  { category: 'Basics', text: 'How many Juz (parts) is the Quran divided into?', options: ['20', '30', '40', '60'], correct: 1 },
  { category: 'Surahs', text: "Which Surah is known as the 'Heart of the Quran'?", options: ['Al-Fatiha', 'Al-Baqarah', 'Yasin', 'Al-Ikhlas'], correct: 2 },
  { category: 'Surahs', text: "Which Surah is known as 'The Opening'?", options: ['Al-Baqarah', 'Al-Fatiha', 'Al-Ikhlas', 'An-Nas'], correct: 1 },
  { category: 'Surahs', text: 'How many verses are in Surah Al-Fatiha?', options: ['5', '6', '7', '8'], correct: 2 },
  { category: 'Prophets', text: 'Which prophet is mentioned most often by name in the Quran?', options: ['Ibrahim', 'Musa', 'Isa', 'Nuh'], correct: 1 },
  { category: 'Revelation', text: 'Which angel conveyed the revelation to Prophet Muhammad ﷺ?', options: ['Mikail', 'Israfil', 'Jibril', 'Izrail'], correct: 2 },
  { category: 'Revelation', text: 'In which month was the Quran first revealed?', options: ['Muharram', 'Rajab', 'Ramadan', 'Shawwal'], correct: 2 },
  { category: 'Surahs', text: 'Which is the longest Surah in the Quran?', options: ['Al-Imran', 'An-Nisa', 'Al-Baqarah', "Al-Ma'idah"], correct: 2 },
  { category: 'Revelation', text: 'What is the first word revealed of the Quran?', options: ['Qalam', 'Iqra', 'Bismillah', 'Allah'], correct: 1 },
  { category: 'Prophets', text: 'How many prophets are mentioned by name in the Quran?', options: ['20', '25', '30', '35'], correct: 1 },
  { category: 'Basics', text: 'In which language was the Quran revealed?', options: ['Hebrew', 'Aramaic', 'Arabic', 'Persian'], correct: 2 },
  { category: 'Surahs', text: "Which Surah is recited in every rak'ah of the prayer?", options: ['Al-Ikhlas', 'Yasin', 'Al-Mulk', 'Al-Fatiha'], correct: 3 },
  { category: 'Basics', text: "How many times is the name 'Muhammad' mentioned in the Quran?", options: ['2', '4', '6', '8'], correct: 1 },
  { category: 'Surahs', text: 'Which Surah does not begin with Bismillah?', options: ['At-Tawbah', 'Al-Anfal', "Al-Ma'un", 'Al-Kawthar'], correct: 0 },
  { category: 'Prophets', text: 'Which two prophets raised the foundations of the Kaaba?', options: ['Adam and Nuh', 'Ibrahim and Ismail', 'Musa and Harun', 'Dawud and Sulaiman'], correct: 1 },
  { category: 'Surahs', text: "Which Surah is called 'Umm al-Kitab' (Mother of the Book)?", options: ['Al-Baqarah', 'Al-Fatiha', 'Al-Imran', 'An-Nisa'], correct: 1 },
  { category: 'Surahs', text: 'Which Surah is named after a woman?', options: ['Maryam', 'An-Nur', 'Fatir', 'Ar-Rahman'], correct: 0 },
  { category: 'Basics', text: "How many times is the word 'Ramadan' mentioned in the Quran?", options: ['1', '2', '3', '4'], correct: 0 },
  { category: 'Revelation', text: 'Over how many years was the Quran revealed?', options: ['15', '20', '23', '30'], correct: 2 },
  { category: 'Surahs', text: "Which Surah's name means 'The Iron'?", options: ['Al-Qalam', 'Al-Hadid', 'Al-Muzzammil', 'Al-Mudaththir'], correct: 1 },
  { category: 'Surahs', text: "Which Surah's name means 'The Sun'?", options: ['Ad-Duha', 'Al-Lail', 'Ash-Shams', 'Al-Fajr'], correct: 2 },
  { category: 'Surahs', text: "Which Surah's name means 'The Dawn'?", options: ['Ad-Duha', 'Al-Fajr', 'Al-Lail', 'Ash-Sharh'], correct: 1 },
  { category: 'Surahs', text: "Which Surah's name means 'The Star'?", options: ['An-Najm', 'Ash-Shams', 'Al-Qamar', 'Al-Lail'], correct: 0 },
  { category: 'Surahs', text: 'Which Surah is named after the Ant?', options: ['An-Nahl', 'An-Naml', 'Al-Ankabut', 'Al-Fil'], correct: 1 },
  { category: 'Surahs', text: 'Which is the shortest Surah in the Quran?', options: ['Al-Ikhlas', 'Al-Falaq', 'Al-Kawthar', 'An-Nas'], correct: 2 },
  { category: 'Surahs', text: 'Which is the last Surah in the Mushaf?', options: ['Al-Falaq', 'Al-Ikhlas', 'An-Nasr', 'An-Nas'], correct: 3 },
  { category: 'Surahs', text: 'In which Surah is Ayat al-Kursi found?', options: ['Al-Imran', 'Al-Baqarah', 'An-Nisa', "Al-Ma'idah"], correct: 1 },
  { category: 'Surahs', text: 'How many verses are in Surah Al-Ikhlas?', options: ['3', '4', '5', '6'], correct: 1 },
  { category: 'Surahs', text: 'Which Surah is most famously recommended for recitation on Fridays?', options: ['Yasin', 'Al-Kahf', 'Ar-Rahman', "Al-Waqi'ah"], correct: 1 },
  { category: 'Revelation', text: "Which night does the Quran describe as 'better than a thousand months'?", options: ['Night of Arafah', 'Night of Isra', 'Laylat al-Qadr', 'Night of Eid'], correct: 2 },
  { category: 'Prophets', text: 'Which prophet was swallowed by a great fish?', options: ['Ayyub', 'Yunus', 'Idris', 'Ilyas'], correct: 1 },
  { category: 'Prophets', text: 'Which prophet was thrown into a fire that Allah made cool and safe?', options: ['Nuh', 'Musa', 'Ibrahim', 'Lut'], correct: 2 },
  { category: 'Prophets', text: 'To which prophet was the Zabur (Psalms) given?', options: ['Sulaiman', 'Yahya', 'Zakariya', 'Dawud'], correct: 3 },
  { category: 'Prophets', text: 'To which prophet was the Tawrat (Torah) given?', options: ['Isa', 'Musa', 'Dawud', 'Ibrahim'], correct: 1 },
  { category: 'Prophets', text: 'To which prophet was the Injil (Gospel) given?', options: ['Isa', 'Yusuf', 'Harun', 'Yahya'], correct: 0 },
  { category: 'Surahs', text: "Which Surah narrates a prophet's life as 'the best of stories'?", options: ['Hud', 'Maryam', 'Yusuf', 'Al-Anbiya'], correct: 2 },
  { category: 'Prophets', text: 'Which prophet was sent to the people of Thamud with a she-camel as a sign?', options: ['Hud', 'Salih', "Shu'ayb", 'Lut'], correct: 1 },
  { category: 'Prophets', text: 'Which prophet is known for his great patience during illness and loss?', options: ['Ayyub', 'Yunus', 'Zakariya', 'Ilyas'], correct: 0 },
  { category: 'Surahs', text: 'Surah Al-Fil tells of an army that came to destroy the Kaaba with which animal?', options: ['Horses', 'Camels', 'Elephants', 'Lions'], correct: 2 },
  { category: 'Seerah', text: 'Which battle is the main subject of Surah Al-Anfal?', options: ['Uhud', 'Badr', 'Khandaq', 'Hunayn'], correct: 1 },
  { category: 'Surahs', text: "Which Surah repeats 'Which of your Lord's favours will you deny?'", options: ['Al-Mulk', 'Ar-Rahman', "Al-Waqi'ah", 'Al-Haqqah'], correct: 1 },
  { category: 'Seerah', text: 'In which cave did Prophet Muhammad ﷺ receive the first revelation?', options: ['Cave Thawr', 'Cave Hira', 'Cave Uhud', 'Cave Mina'], correct: 1 },
  { category: 'Seerah', text: 'Who was the first wife of Prophet Muhammad ﷺ?', options: ['Aisha', 'Hafsa', 'Khadijah', 'Zaynab'], correct: 2 },
  { category: 'Quran Sciences', text: 'Which Caliph first ordered the Quran to be compiled into a single volume?', options: ['Umar', 'Abu Bakr', 'Uthman', 'Ali'], correct: 1 },
  { category: 'Surahs', text: 'How many verses are in Surah Al-Baqarah?', options: ['186', '255', '286', '300'], correct: 2 },
  { category: 'Surahs', text: "Which two Surahs are known as 'Al-Mu'awwidhatayn'?", options: ['Al-Ikhlas and Al-Falaq', 'Al-Falaq and An-Nas', 'An-Nas and Al-Kawthar', 'Al-Fatiha and Al-Ikhlas'], correct: 1 },
  { category: 'Basics', text: 'Who is the only woman mentioned by name in the Quran?', options: ['Asiya', 'Hajar', 'Maryam', 'Khadijah'], correct: 2 },
  { category: 'Seerah', text: 'The prayer direction was changed from Bayt al-Maqdis (Jerusalem) to which place?', options: ['Madinah', 'The Kaaba in Makkah', 'Mount Sinai', 'Quba'], correct: 1 },
  { category: 'Surahs', text: "Which Surah begins 'By time, indeed mankind is in loss'?", options: ['Al-Humazah', 'At-Takathur', "Al-Qari'ah", 'Al-Asr'], correct: 3 },
];

const SETS = {
  practice: {
    key: 'practice',
    label: 'Practice Round',
    timeLimit: PRACTICE_SECONDS,
    revealSeconds: PRACTICE_REVEAL_SECONDS,
    questions: practice,
  },
  competition: {
    key: 'competition',
    label: 'Competition',
    timeLimit: COMPETITION_SECONDS,
    revealSeconds: COMPETITION_REVEAL_SECONDS,
    questions: competition,
  },
};

// Fail fast on a malformed question bank (better at boot than in front of an audience).
for (const set of Object.values(SETS)) {
  set.questions.forEach((q, i) => {
    const where = `${set.key} question ${i + 1}`;
    if (typeof q.text !== 'string' || !q.text) throw new Error(`${where}: missing text`);
    if (!Array.isArray(q.options) || q.options.length !== 4) throw new Error(`${where}: needs exactly 4 options`);
    if (new Set(q.options).size !== 4) throw new Error(`${where}: duplicate options`);
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) throw new Error(`${where}: bad 'correct' index`);
  });
}

module.exports = { SETS };
