// Генерує SVG-іконки паків у public/packs/<id>.svg:  node scripts/make-icons.js
// Кожна іконка — заокруглений квадрат кольору категорії + тематичний малюнок.

const fs = require('fs');
const path = require('path');
const plan = require('./pack-plan');

const OUT = path.join(__dirname, '..', 'public', 'packs');
fs.mkdirSync(OUT, { recursive: true });

const PALETTE = {
  topic: ['#FFB26B', '#F2702C', '#B94A12'],
  profession: ['#9A8CFF', '#6C5CE7', '#4432B8'],
  situation: ['#5EDBCB', '#1FAE9E', '#0E7468'],
  language: ['#FF94BE', '#EC5A92', '#A92A5C'],
  level: ['#7EDDA6', '#2FB36C', '#1B7445'],
  course: ['#8FC6FF', '#3A86E0', '#164C8C'],
  screen: ['#FF8A8A', '#E04848', '#9C1F2A'],
};
const W = '#FFFFFF';
const A = '#FFD24D'; // акцент
const FONT = "font-family=\"Arial Rounded MT Bold, Nunito, Arial, sans-serif\" font-weight=\"900\"";

// Малюнки на полотні 64×64; D — темний відтінок кольору категорії
const GLYPHS = {
  airport: (D) => `<path d="M32 10c2.3 0 4 2 4 4.6V26l15 8.6v5.2L36 35.5v8.8l4.5 3.3v4.2L32 49.6l-8.5 2.2v-4.2l4.5-3.3v-8.8L13 39.8v-5.2L28 26V14.6C28 12 29.7 10 32 10z" fill="${W}"/><circle cx="32" cy="20" r="2" fill="${D}"/>`,
  hotel: (D) => `<rect x="10" y="18" width="7" height="32" rx="3" fill="${W}"/><rect x="10" y="33" width="44" height="11" rx="4" fill="${W}"/><rect x="47" y="40" width="7" height="10" rx="3" fill="${W}"/><rect x="19" y="25" width="14" height="8" rx="4" fill="${A}"/><path d="M37 17h8l-8 8h8" stroke="${D}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  restaurant: (D) => `<circle cx="32" cy="34" r="15" fill="${W}"/><circle cx="32" cy="34" r="9" fill="none" stroke="${D}" stroke-width="2.5" opacity=".35"/><path d="M11 14v12a4 4 0 0 0 4 4v20M15 14v10M19 14v12a4 4 0 0 1-4 4" stroke="${A}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M50 14c-4 3-5 9-5 15h5v21" stroke="${A}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  cooking: (D) => `<path d="M24 16c-2 3 2 5 0 8M32 13c-2 3 2 5 0 8M40 16c-2 3 2 5 0 8" stroke="${W}" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".85"/><rect x="14" y="29" width="36" height="5" rx="2.5" fill="${A}"/><path d="M16 34h32v10a8 8 0 0 1-8 8H24a8 8 0 0 1-8-8z" fill="${W}"/><rect x="8" y="37" width="8" height="4" rx="2" fill="${W}"/><rect x="48" y="37" width="8" height="4" rx="2" fill="${W}"/><rect x="29" y="26" width="6" height="4" rx="2" fill="${A}"/>`,
  home: (D) => `<path d="M32 12 9 31h6v19h34V31h6z" fill="${W}" stroke="${W}" stroke-width="2" stroke-linejoin="round"/><rect x="27" y="36" width="10" height="14" rx="2" fill="${A}"/><rect x="18" y="34" width="6" height="6" rx="1.5" fill="${D}" opacity=".5"/><rect x="40" y="34" width="6" height="6" rx="1.5" fill="${D}" opacity=".5"/><rect x="41" y="14" width="5" height="10" rx="1.5" fill="${W}"/>`,
  health: (D) => `<path d="M32 51S11 39 11 24.5A10.5 10.5 0 0 1 32 19a10.5 10.5 0 0 1 21 5.5C53 39 32 51 32 51z" fill="${W}"/><path d="M15 33h9l3-7 5 13 4-9 2 3h11" stroke="${D}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  shopping: (D) => `<path d="M24 22v-3a8 8 0 0 1 16 0v3" stroke="${W}" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M14 22h36l-3 28H17z" fill="${W}" stroke="${W}" stroke-width="2" stroke-linejoin="round"/><path d="M36 30h10l3 3v8h-10l-3-3z" fill="${A}"/><circle cx="45" cy="35" r="1.6" fill="${D}"/>`,
  emotions: (D) => `<circle cx="29" cy="34" r="17" fill="${A}"/><circle cx="23" cy="31" r="2.4" fill="${D}"/><circle cx="35" cy="31" r="2.4" fill="${D}"/><path d="M21 38c4 5 12 5 16 0" stroke="${D}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M48 25s-8-4.6-8-10a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 5.4-8 10-8 10z" fill="${W}"/>`,
  nature: (D) => `<circle cx="24" cy="24" r="10" fill="${A}"/><path d="M24 8v4M24 36v4M8 24h4M36 24h0M12.7 12.7l2.8 2.8M12.7 35.3l2.8-2.8M35.3 12.7l-2.8 2.8" stroke="${A}" stroke-width="3" stroke-linecap="round"/><path d="M22 50h26a9 9 0 0 0 0-18 12 12 0 0 0-22.5 3A7.5 7.5 0 0 0 22 50z" fill="${W}"/>`,
  sport: (D) => `<rect x="18" y="29" width="28" height="6" rx="3" fill="${W}"/><rect x="10" y="19" width="9" height="26" rx="3" fill="${W}"/><rect x="45" y="19" width="9" height="26" rx="3" fill="${W}"/><rect x="5" y="24" width="6" height="16" rx="3" fill="${A}"/><rect x="53" y="24" width="6" height="16" rx="3" fill="${A}"/>`,
  family: (D) => `<circle cx="22" cy="22" r="7" fill="${W}"/><circle cx="42" cy="22" r="7" fill="${W}"/><path d="M9 50c0-9 6-15 13-15s13 6 13 15z" fill="${W}"/><path d="M29 50c0-9 6-15 13-15s13 6 13 15z" fill="${W}" opacity=".85"/><path d="M32 33s-5-2.8-5-6.2a2.6 2.6 0 0 1 5-.9 2.6 2.6 0 0 1 5 .9c0 3.4-5 6.2-5 6.2z" fill="${A}"/>`,
  gadgets: (D) => `<rect x="20" y="9" width="24" height="46" rx="6" fill="${W}"/><rect x="24" y="15" width="16" height="30" rx="2" fill="${D}"/><circle cx="32" cy="50" r="2" fill="${D}"/><path d="M28 26l4 4-4 4M34 34h4" stroke="${A}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  city: (D) => `<rect x="14" y="12" width="36" height="36" rx="7" fill="${W}"/><rect x="18" y="17" width="28" height="14" rx="3" fill="${D}"/><rect x="18" y="37" width="6" height="4" rx="2" fill="${A}"/><rect x="40" y="37" width="6" height="4" rx="2" fill="${A}"/><rect x="17" y="46" width="7" height="7" rx="2" fill="${W}"/><rect x="40" y="46" width="7" height="7" rx="2" fill="${W}"/><rect x="26" y="12" width="12" height="3" rx="1.5" fill="${D}" opacity=".4"/>`,
  money: (D) => `<rect x="8" y="18" width="40" height="24" rx="4" fill="${W}"/><circle cx="28" cy="30" r="6" fill="none" stroke="${D}" stroke-width="2.5" opacity=".5"/><ellipse cx="44" cy="46" rx="12" ry="4.5" fill="${A}"/><ellipse cx="44" cy="41" rx="12" ry="4.5" fill="${A}" stroke="${D}" stroke-width="1.5"/><ellipse cx="44" cy="36" rx="12" ry="4.5" fill="${A}" stroke="${D}" stroke-width="1.5"/>`,
  education: (D) => `<path d="M32 14 6 26l26 12 26-12z" fill="${W}"/><path d="M17 31v9c0 4 7 8 15 8s15-4 15-8v-9l-15 7z" fill="${W}" opacity=".85"/><path d="M52 28v12" stroke="${A}" stroke-width="3" stroke-linecap="round"/><circle cx="52" cy="43" r="3" fill="${A}"/>`,

  it: (D) => `<rect x="8" y="12" width="48" height="40" rx="6" fill="${W}"/><rect x="8" y="12" width="48" height="9" rx="6" fill="${D}" opacity=".25"/><circle cx="14" cy="16.5" r="1.8" fill="${D}"/><circle cx="20" cy="16.5" r="1.8" fill="${D}"/><path d="M24 29l-7 7 7 7M40 29l7 7-7 7" stroke="${D}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M35 27l-6 18" stroke="${A}" stroke-width="3.5" stroke-linecap="round"/>`,
  medicine: (D) => `<path d="M18 10v12a10 10 0 0 0 20 0V10" stroke="${W}" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M28 32v6a10 10 0 0 0 20 0v-4" stroke="${W}" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="48" cy="29" r="6" fill="${A}"/><circle cx="48" cy="29" r="2.5" fill="${D}"/><circle cx="18" cy="10" r="3" fill="${W}"/><circle cx="38" cy="10" r="3" fill="${W}"/>`,
  marketing: (D) => `<path d="M12 27h8l20-11v32L20 37h-8z" fill="${W}" stroke="${W}" stroke-width="2" stroke-linejoin="round"/><path d="M18 37l4 13h6l-3-13" fill="${W}"/><path d="M47 24c3 2 3 14 0 16M52 19c6 5 6 21 0 26" stroke="${A}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  finance: (D) => `<rect x="12" y="36" width="8" height="14" rx="2" fill="${W}"/><rect x="24" y="28" width="8" height="22" rx="2" fill="${W}"/><rect x="36" y="32" width="8" height="18" rx="2" fill="${W}"/><rect x="48" y="20" width="8" height="30" rx="2" fill="${W}"/><path d="M10 28 24 16l10 8 16-14" stroke="${A}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M42 9h9v9" stroke="${A}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  law: (D) => `<rect x="30" y="14" width="4" height="34" rx="2" fill="${W}"/><rect x="20" y="48" width="24" height="5" rx="2.5" fill="${W}"/><rect x="12" y="17" width="40" height="4" rx="2" fill="${W}"/><circle cx="32" cy="13" r="3.5" fill="${A}"/><path d="M16 21 9 36h14z" fill="none" stroke="${W}" stroke-width="1.8" stroke-linejoin="round"/><path d="M48 21l-7 15h14z" fill="none" stroke="${W}" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 36h16a8 8 0 0 1-16 0zM40 36h16a8 8 0 0 1-16 0z" fill="${A}"/>`,
  sales: (D) => `<path d="M10 30 30 10h22v22L32 52z" fill="${W}" stroke="${W}" stroke-width="2" stroke-linejoin="round"/><circle cx="43" cy="19" r="4" fill="${D}"/><text x="31" y="40" text-anchor="middle" font-size="18" ${FONT} fill="${D}" transform="rotate(-45 31 34)">%</text><path d="M43 19c4-6 10-6 12-3" stroke="${A}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
  hr: (D) => `<circle cx="24" cy="22" r="8" fill="${W}"/><path d="M9 50c0-10 7-16 15-16s15 6 15 16z" fill="${W}"/><circle cx="43" cy="36" r="9" fill="none" stroke="${A}" stroke-width="4"/><path d="M50 43l6 6" stroke="${A}" stroke-width="5" stroke-linecap="round"/>`,
  logistics: (D) => `<path d="M32 10 52 20v24L32 54 12 44V20z" fill="${W}"/><path d="M32 30v24L12 44V20z" fill="${D}" opacity=".18"/><path d="M12 20l20 10 20-10" stroke="${D}" stroke-width="2" fill="none" opacity=".35"/><path d="M22 15l20 10v9" stroke="${A}" stroke-width="5" fill="none" stroke-linejoin="round"/>`,
  construction: (D) => `<path d="M14 40a18 18 0 0 1 36 0z" fill="${A}"/><rect x="28" y="18" width="8" height="18" rx="3" fill="${D}" opacity=".3"/><rect x="8" y="39" width="48" height="8" rx="4" fill="${A}" stroke="${D}" stroke-width="1.5"/><path d="M20 30a13 13 0 0 1 6-8" stroke="${W}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".8"/>`,
  design: (D) => `<path d="M32 10C18 10 9 20 9 32s9 22 21 22c4 0 5-3 3-6s-1-6 3-6h6c8 0 13-5 13-11C55 19 45 10 32 10z" fill="${W}"/><circle cx="21" cy="28" r="4" fill="${A}"/><circle cx="30" cy="19" r="4" fill="#FF7AA8"/><circle cx="42" cy="21" r="4" fill="#3FD0C0"/><circle cx="46" cy="32" r="4" fill="${D}"/>`,
  hospitality: (D) => `<rect x="28" y="12" width="8" height="5" rx="2.5" fill="${A}"/><path d="M12 42a20 20 0 0 1 40 0z" fill="${W}"/><rect x="8" y="42" width="48" height="6" rx="3" fill="${W}"/><path d="M22 34a12 12 0 0 1 8-10" stroke="${D}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".3"/><rect x="31" y="16" width="2" height="6" fill="${A}"/>`,
  caregiving: (D) => `<path d="M32 36s-12-7-12-15a6 6 0 0 1 12-2 6 6 0 0 1 12 2c0 8-12 15-12 15z" fill="${A}"/><path d="M6 40c5 0 9 2 13 5h10a3 3 0 0 1 0 6H20m9 0h11l13-9a3.5 3.5 0 0 1 4 5.5L42 55H18l-12-4" stroke="${W}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  driving: (D) => `<circle cx="32" cy="32" r="20" fill="none" stroke="${W}" stroke-width="6"/><circle cx="32" cy="32" r="6" fill="${A}"/><path d="M13 30c6 0 12 1 13 2M51 30c-6 0-12 1-13 2M32 38v13" stroke="${W}" stroke-width="5" stroke-linecap="round"/>`,

  interview: (D) => `<path d="M8 14h30a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H20l-8 7v-7H8a5 5 0 0 1-5-5V19a5 5 0 0 1 5-5z" fill="${W}"/><circle cx="15" cy="26" r="2.2" fill="${D}"/><circle cx="23" cy="26" r="2.2" fill="${D}"/><circle cx="31" cy="26" r="2.2" fill="${D}"/><path d="M58 30H34a5 5 0 0 0-5 5v10a5 5 0 0 0 5 5h14l7 6v-6h3a5 5 0 0 0 0-10z" fill="${A}"/><path d="M38 41l4 4 8-8" stroke="${D}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  relocation: (D) => `<rect x="8" y="22" width="36" height="28" rx="5" fill="${W}"/><path d="M19 22v-5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v5" stroke="${W}" stroke-width="3.5" fill="none"/><rect x="16" y="22" width="4" height="28" fill="${D}" opacity=".25"/><rect x="32" y="22" width="4" height="28" fill="${D}" opacity=".25"/><path d="M48 44s-9-8.5-9-15a9 9 0 0 1 18 0c0 6.5-9 15-9 15z" fill="${A}"/><circle cx="48" cy="29" r="3.3" fill="${D}"/>`,
  smalltalk: (D) => `<path d="M10 28h28v12a10 10 0 0 1-10 10h-8a10 10 0 0 1-10-10z" fill="${W}"/><path d="M38 31h3a5 5 0 0 1 0 10h-3" stroke="${W}" stroke-width="3.5" fill="none"/><path d="M36 8h18a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-9l-6 5v-5h-3a4 4 0 0 1-4-4v-8a4 4 0 0 1 4-4z" fill="${A}"/><circle cx="39" cy="16" r="1.8" fill="${D}"/><circle cx="45" cy="16" r="1.8" fill="${D}"/><circle cx="51" cy="16" r="1.8" fill="${D}"/><path d="M19 17c-2 3 2 5 0 8M27 17c-2 3 2 5 0 8" stroke="${W}" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".8"/>`,
  'business-email': (D) => `<rect x="7" y="16" width="46" height="34" rx="5" fill="${W}"/><path d="M9 19l21 16 21-16" stroke="${D}" stroke-width="3" fill="none" stroke-linejoin="round" opacity=".45"/><circle cx="50" cy="17" r="9" fill="${A}"/><path d="M46 17l3 3 5-6" stroke="${D}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  phone: (D) => `<path d="M16 9h8l4 11-5 3a26 26 0 0 0 16 16l3-5 11 4v8a5 5 0 0 1-5 5C27 51 11 35 11 14a5 5 0 0 1 5-5z" fill="${W}"/><path d="M38 11a15 15 0 0 1 15 15M38 19a7 7 0 0 1 7 7" stroke="${A}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
  doctor: (D) => `<rect x="14" y="12" width="36" height="42" rx="5" fill="${W}"/><rect x="24" y="8" width="16" height="8" rx="3" fill="${A}"/><path d="M32 24v16M24 32h16" stroke="#FF6B6B" stroke-width="6" stroke-linecap="round"/><rect x="21" y="45" width="22" height="3" rx="1.5" fill="${D}" opacity=".3"/>`,
  meetings: (D) => `<rect x="10" y="9" width="44" height="28" rx="4" fill="${W}"/><path d="M16 30l8-9 7 5 9-11 8 6" stroke="${D}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M32 37v6" stroke="${W}" stroke-width="3"/><circle cx="16" cy="48" r="5" fill="${A}"/><circle cx="32" cy="50" r="5" fill="${A}"/><circle cx="48" cy="48" r="5" fill="${A}"/>`,

  'phrasal-verbs': (D) => `<rect x="6" y="14" width="30" height="18" rx="5" fill="${W}"/><text x="21" y="28" text-anchor="middle" font-size="13" ${FONT} fill="${D}">get</text><rect x="28" y="34" width="30" height="18" rx="5" fill="${A}"/><text x="43" y="48" text-anchor="middle" font-size="13" ${FONT} fill="${D}">up</text><path d="M20 36c0 8 2 9 6 9" stroke="${W}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  idioms: (D) => `<path d="M10 12h44a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H26l-10 9v-9h-6a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4z" fill="${W}"/><path d="M32 17a9 9 0 0 0-5 16.5V36h10v-2.5A9 9 0 0 0 32 17z" fill="${A}"/><rect x="27.5" y="37.5" width="9" height="3" rx="1.5" fill="${D}" opacity=".6"/><path d="M32 23v7" stroke="${D}" stroke-width="2" stroke-linecap="round" opacity=".5"/>`,
  slang: (D) => `<path d="M12 12h40a6 6 0 0 1 6 6v20a6 6 0 0 1-6 6H30l-12 10V44h-6a6 6 0 0 1-6-6V18a6 6 0 0 1 6-6z" fill="${W}"/><text x="32" y="35" text-anchor="middle" font-size="16" ${FONT} fill="${D}">lol</text><path d="M52 6l1.8 4.2L58 12l-4.2 1.8L52 18l-1.8-4.2L46 12l4.2-1.8z" fill="${A}"/>`,
  'false-friends': (D) => `<circle cx="20" cy="30" r="13" fill="${W}"/><circle cx="44" cy="30" r="13" fill="${A}"/><circle cx="16" cy="28" r="2" fill="${D}"/><circle cx="24" cy="28" r="2" fill="${D}"/><path d="M15 34c3 3 7 3 10 0" stroke="${D}" stroke-width="2.5" fill="none" stroke-linecap="round"/><circle cx="40" cy="28" r="2" fill="${D}"/><circle cx="48" cy="28" r="2" fill="${D}"/><path d="M39 36c3-3 7-3 10 0" stroke="${D}" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M26 50h12M26 55h12M36 46l-8 13" stroke="${W}" stroke-width="3" stroke-linecap="round"/>`,
  collocations: (D) => `<rect x="34" y="18" width="22" height="30" rx="4" fill="${A}"/><circle cx="45" cy="18" r="5" fill="${A}"/><rect x="8" y="18" width="24" height="30" rx="4" fill="${W}"/><circle cx="20" cy="48" r="5" fill="${W}"/><circle cx="33" cy="33" r="6" fill="${W}"/><path d="M14 27h10M14 33h7" stroke="${D}" stroke-width="2.5" stroke-linecap="round" opacity=".35"/><path d="M42 30h8M44 36h6" stroke="${D}" stroke-width="2.5" stroke-linecap="round" opacity=".35"/>`,
  'linking-words': (D) => `<rect x="7" y="22" width="30" height="20" rx="10" fill="none" stroke="${W}" stroke-width="6"/><rect x="27" y="22" width="30" height="20" rx="10" fill="none" stroke="${A}" stroke-width="6"/><path d="M30 22h4" stroke="${W}" stroke-width="6"/>`,
  'irregular-verbs': (D) => `<path d="M50 30A18 18 0 0 0 17 21" stroke="${W}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M12 13l5 9 9-3" stroke="${W}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 34a18 18 0 0 0 33 9" stroke="${A}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M52 51l-5-9-9 3" stroke="${A}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><text x="32" y="37" text-anchor="middle" font-size="11" ${FONT} fill="${W}">went</text>`,
  ielts: (D) => `<path d="M32 18c-6-5-14-6-24-5v34c10-1 18 0 24 5 6-5 14-6 24-5V13c-10-1-18 0-24 5z" fill="${W}"/><path d="M32 18v34" stroke="${D}" stroke-width="2" opacity=".35"/><path d="M40 12v16l4-3 4 3V12" fill="${A}"/><path d="M13 24h13M13 31h13M13 38h10M38 34h13M38 41h10" stroke="${D}" stroke-width="2.2" stroke-linecap="round" opacity=".3"/>`,
};

// Підручник: розгорнута книжка з номером розділу
const bookGlyph = (label) => (D) =>
  `<path d="M32 21c-6-5-14-7-24-6v31c10-1 18 1 24 6 6-5 14-7 24-6V15c-10-1-18 1-24 6z" fill="${W}"/>`
  + `<path d="M32 21v31" stroke="${D}" stroke-width="2.5" opacity=".35"/>`
  + `<path d="M12 26h13M12 33h13M39 26h13M39 33h13" stroke="${D}" stroke-width="2.2" stroke-linecap="round" opacity=".28"/>`
  + `<circle cx="46" cy="46" r="13" fill="${A}" stroke="${D}" stroke-width="2"/>`
  + `<text x="46" y="52" text-anchor="middle" font-size="15" ${FONT} fill="${D}">${label}</text>`;

// Телевізор із номером серії на екрані: «1·02», «S2» або 🎬 для фільму
const screenGlyph = (label) => (D) =>
  `<path d="M24 13l8 7 8-7" stroke="${W}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
  + `<rect x="8" y="20" width="48" height="32" rx="7" fill="${W}"/>`
  + `<rect x="13" y="25" width="38" height="22" rx="4" fill="${D}"/>`
  + `<text x="32" y="${label.length > 3 ? 41 : 42}" text-anchor="middle" font-size="${label.length > 3 ? 13 : 15}" ${FONT} fill="${A}">${label}</text>`;

const levelGlyph = (label) => (D) =>
  `<path d="M32 7l5.5 5 7.3-1 2.2 7 6.7 3.2-1.5 7.2 4.4 5.9-5 5.3.3 7.4-7.2 1.6-3.8 6.3L32 51.2 25.1 55l-3.8-6.3-7.2-1.6.3-7.4-5-5.3 4.4-5.9-1.5-7.2 6.7-3.2 2.2-7 7.3 1z" fill="${W}"/>`
  + `<text x="32" y="38" text-anchor="middle" font-size="19" ${FONT} fill="${D}">${label}</text>`;

let written = 0;
for (const pack of plan) {
  const [light, mid, dark] = PALETTE[pack.type];
  const glyph = GLYPHS[pack.id]
    || (pack.id.startsWith('core-') ? levelGlyph(pack.level) : null)
    || (pack.type === 'course' ? bookGlyph((pack.id.match(/(\d+)$/) || ['?'])[1]) : null)
    || (pack.type === 'screen' ? screenGlyph(pack.label === '🎬' ? '▶' : pack.label) : null);
  if (!glyph) { console.warn(`Немає малюнка для ${pack.id}`); continue; }
  const svgText = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${mid}"/></linearGradient></defs>
<rect width="64" height="64" rx="16" fill="url(#g)"/>
<circle cx="10" cy="8" r="22" fill="#fff" opacity=".12"/>
<g>${glyph(dark)}</g>
</svg>
`;
  fs.writeFileSync(path.join(OUT, `${pack.id}.svg`), svgText);
  written++;
}
console.log(`Іконок: ${written}`);
