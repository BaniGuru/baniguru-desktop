import { Pankti } from "../models/Pankti";
import { cleanGurmukhiUnicode } from "./autoPilotHelpers";

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

export const formatPanktis = (panktis: Pankti[]) => {
    return panktis.map((pankti: Pankti) => { return {...pankti, ...getGurmukhiWords(pankti.gurmukhi_unicode)} });
};

export const getShabadIds = (panktis: Pankti[]) => {
    return new Set(panktis.map(p => p.shabad_id))
}
