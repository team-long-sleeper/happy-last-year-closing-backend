// 한글 초성 추출 및 가나다(초성) 섹션 그룹핑 유틸

// 완성형 한글 음절(가~힣)의 19개 초성
const CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

// 쌍자음은 평음 섹션으로 합친다 (ㄲ→ㄱ 등). 14개 섹션 + 기타(#)
const SECTION_MAP: Record<string, string> = {
  ㄲ: 'ㄱ',
  ㄸ: 'ㄷ',
  ㅃ: 'ㅂ',
  ㅆ: 'ㅅ',
  ㅉ: 'ㅈ',
};

// 섹션 정렬 순서 (한글 14개 → 그 외는 맨 뒤)
export const SECTION_ORDER = [
  'ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ',
  'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ', '#',
];

const HANGUL_BASE = 0xac00; // '가'
const HANGUL_END = 0xd7a3; // '힣'

/** 이름의 첫 글자로 섹션 키(ㄱ~ㅎ, 그 외는 '#')를 반환 */
export function getSection(name: string): string {
  const ch = name?.trim().charAt(0);
  if (!ch) return '#';

  const code = ch.charCodeAt(0);
  if (code < HANGUL_BASE || code > HANGUL_END) return '#'; // 영문/숫자/특수문자

  const choIndex = Math.floor((code - HANGUL_BASE) / 588);
  const cho = CHOSEONG[choIndex];
  if (!cho) return '#';
  return SECTION_MAP[cho] ?? cho;
}

const collator = new Intl.Collator('ko');

/** name 기준 가나다 정렬 후 초성 섹션으로 그룹핑 */
export function groupBySection<T extends { name: string }>(
  items: T[],
): { key: string; items: T[] }[] {
  const sorted = [...items].sort((a, b) => collator.compare(a.name, b.name));

  const buckets = new Map<string, T[]>();
  for (const item of sorted) {
    const key = getSection(item.name);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  return SECTION_ORDER.filter((key) => buckets.has(key)).map((key) => ({
    key,
    items: buckets.get(key)!,
  }));
}
