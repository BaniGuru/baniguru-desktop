import { Pankti } from "../models/Pankti";

export const cleanGurmukhiUnicode = (gurmukhi: string, vishraamReplace = true) => {
    gurmukhi = gurmukhi.normalize("NFC");
    gurmukhi = gurmukhi.replaceAll('ੴ', 'ਇਕਓਨਕਾਰ');
    gurmukhi = gurmukhi.replaceAll('ਰਹਾੳੁ', '');
    gurmukhi = gurmukhi.replaceAll('ਅਾ', 'ਆ')
        .replaceAll('ਅੌ', 'ਔ')
        .replaceAll('ਅੈ', 'ਐ')
        .replaceAll('ੲੇ', 'ਏ')
        .replaceAll('ੳੂ', 'ਊ')
        .replaceAll('ੳੁ', 'ਉ')
        .replaceAll('ੲੀ', 'ਈ')
        .replaceAll('ਿੲ', 'ਇ')
        .replaceAll('ਕਿ੍ਰ', 'ਕ੍ਰਿ')
        .replaceAll('ਖਿ੍ਰ', 'ਖ੍ਰਿ')  // Correct 'ਖਿ੍ਰ' to 'ਖ੍ਰਿ'
        .replaceAll('ਗਿ੍ਰ', 'ਗ੍ਰਿ')  // Correct 'ਗਿ੍ਰ' to 'ਗ੍ਰਿ'
        .replaceAll('ਘਿ੍ਰ', 'ਘ੍ਰਿ')  // Correct 'ਘਿ੍ਰ' to 'ਘ੍ਰਿ'
        .replaceAll('ਚਿ੍ਰ', 'ਚ੍ਰਿ')  // Correct 'ਚਿ੍ਰ' to 'ਚ੍ਰਿ'
        .replaceAll('ਛਿ੍ਰ', 'ਛ੍ਰਿ')  // Correct 'ਛਿ੍ਰ' to 'ਛ੍ਰਿ'
        .replaceAll('ਜਿ੍ਰ', 'ਜ੍ਰਿ')  // Correct 'ਜਿ੍ਰ' to 'ਜ੍ਰਿ'
        .replaceAll('ਝਿ੍ਰ', 'ਝ੍ਰਿ')  // Correct 'ਝਿ੍ਰ' to 'ਝ੍ਰਿ'
        .replaceAll('ਟਿ੍ਰ', 'ਟ੍ਰਿ')  // Correct 'ਟਿ੍ਰ' to 'ਟ੍ਰਿ'
        .replaceAll('ਠਿ੍ਰ', 'ਠ੍ਰਿ')  // Correct 'ਠਿ੍ਰ' to 'ਠ੍ਰਿ'
        .replaceAll('ਡਿ੍ਰ', 'ਡ੍ਰਿ')  // Correct 'ਡਿ੍ਰ' to 'ਡ੍ਰਿ'
        .replaceAll('ਢਿ੍ਰ', 'ਢ੍ਰਿ')  // Correct 'ਢਿ੍ਰ' to 'ਢ੍ਰਿ'
        .replaceAll('ਤਿ੍ਰ', 'ਤ੍ਰਿ')  // Correct 'ਤਿ੍ਰ' to 'ਤ੍ਰਿ'
        .replaceAll('ਥਿ੍ਰ', 'ਥ੍ਰਿ')  // Correct 'ਥਿ੍ਰ' to 'ਥ੍ਰਿ'
        .replaceAll('ਦਿ੍ਰ', 'ਦ੍ਰਿ')  // Correct 'ਦਿ੍ਰ' to 'ਦ੍ਰਿ'
        .replaceAll('ਧਿ੍ਰ', 'ਧ੍ਰਿ')  // Correct 'ਧਿ੍ਰ' to 'ਧ੍ਰਿ'
        .replaceAll('ਪਿ੍ਰ', 'ਪ੍ਰਿ')  // Correct 'ਪਿ੍ਰ' to 'ਪ੍ਰਿ'
        .replaceAll('ਫਿ੍ਰ', 'ਫ੍ਰਿ')  // Correct 'ਫਿ੍ਰ' to 'ਫ੍ਰਿ'
        .replaceAll('ਬਿ੍ਰ', 'ਬ੍ਰਿ')  // Correct 'ਬਿ੍ਰ' to 'ਬ੍ਰਿ'
        .replaceAll('ਭਿ੍ਰ', 'ਭ੍ਰਿ')  // Correct 'ਭਿ੍ਰ' to 'ਭ੍ਰਿ'
        .replaceAll('ਮਿ੍ਰ', 'ਮ੍ਰਿ')  // Correct 'ਮਿ੍ਰ' to 'ਮ੍ਰਿ'
        .replaceAll('ਯਿ੍ਰ', 'ਯ੍ਰਿ')  // Correct 'ਯਿ੍ਰ' to 'ਯ੍ਰਿ'
        .replaceAll('ਰਿ੍ਰ', 'ਰ੍ਰਿ')  // Correct 'ਰਿ੍ਰ' to 'ਰ੍ਰਿ'
        .replaceAll('ਲਿ੍ਰ', 'ਲ੍ਰਿ')  // Correct 'ਲਿ੍ਰ' to 'ਲ੍ਰਿ'
        .replaceAll('ਵਿ੍ਰ', 'ਵ੍ਰਿ')  // Correct 'ਵਿ੍ਰ' to 'ਵ੍ਰਿ'
        .replaceAll('ਸਿ੍ਰ', 'ਸ੍ਰਿ')  // Correct 'ਸਿ੍ਰ' to 'ਸ੍ਰਿ'
        .replaceAll('ਹਿ੍ਰ', 'ਹ੍ਰਿ')  // Correct 'ਹਿ੍ਰ' to 'ਹ੍ਰਿ'
        .replaceAll('`', 'ੱ')
        .replaceAll('ˆØ', 'ੀ')
        .replaceAll('@', '')
        ;
    gurmukhi = convertMahala(gurmukhi);
    gurmukhi = gurmukhi.replaceAll("॥", '');

    if (vishraamReplace) {
        gurmukhi = gurmukhi.replaceAll(',', '')
    }
    
    gurmukhi = gurmukhi.trim();

    // console.log(gurmukhi);

    return gurmukhi;
};

const gurmukhiOrdinal: Record<string, string> = {
  '੧': 'ਪਹਿਲਾ',
  '੨': 'ਦੂਜਾ',
  '੩': 'ਤੀਜਾ',
  '੪': 'ਚੌਥਾ',
  '੫': 'ਪੰਜਵਾ',
  '੬': 'ਛੇਵਾ',
  '੭': 'ਸੱਤਵਾ',
  '੮': 'ਅੱਠਵਾ',
  '੯': 'ਨੌਵਾ',
  '੧੦': 'ਦਸਵੀ'
};

function convertMahala(text: string) {
    return text.replace(/੧੦|[੧੨੩੪੫੬੭੮੯]/g, (digit) => {
        return gurmukhiOrdinal[digit] || digit;
    }).replaceAll('ਮਃ', 'ਮਹਲਾ');
//   return text.replace(/ਮਹਲਾ\s([੧੨੩੪੫੬੭੮੯੧੦])/g, (match, digit) => {
//     const ordinal = gurmukhiOrdinal[digit];
//     return ordinal ? `ਮਹਲਾ ${ordinal}` : match;
//   });
}

export const getGurmukhiWords = (gurmukhi_unicode: string) => {
    let gurmukhi_words = cleanGurmukhiUnicode(gurmukhi_unicode, false).split(" ");

    let vishraam_idx = -1;
    gurmukhi_words = gurmukhi_words.map((word, index) => {
        word = word.trim();
        const searchIndex = word.indexOf(',');
        if (searchIndex == (word.length - 1)) {
            vishraam_idx = index + 1;
        } else if (searchIndex !== -1) {
            vishraam_idx = index;
        }

        return word.replaceAll(',', '').trim();
    });

    const reverse_gurmukhi_words = [...gurmukhi_words].reverse();
    const reverse_vishraam_idx = gurmukhi_words.length - 1 - vishraam_idx;

    return {gurmukhi_words, vishraam_idx: vishraam_idx, reverse_gurmukhi_words, reverse_vishraam_idx};
}

export const formatPanktis = (panktis: any) => {
    let group = 1;
    const result = [];
    for (let i = 0; i < panktis.length; i++) {
        const pankti = panktis[i];

        result.push({
            ...pankti,
            group: group,
            gurmukhi_words: JSON.parse(pankti.gurmukhi_words),
            gurmukhi_rwords: JSON.parse(pankti.gurmukhi_rwords),
        });

        if (pankti.type_id > 2 && (pankti.gurmukhi.match(/\]/g) || []).length > 1) {
            group++;
        }
    }

    return result;
};

export const getShabadIds = (panktis: Pankti[]): string[] => {
    return panktis.map(p => p.shabad_id)
}
