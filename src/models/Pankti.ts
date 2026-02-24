export type Pankti = {
    first_letter: string;
    gurmukhi: string;
    gurmukhi_unicode: string;
    id: string;
    order_id: number;
    pronuciation: string;
    shabad_id: string;
    source_line: number;
    source_page: number;
    type_id: number;
    vishraam_first_letters: string;
    visited?: boolean;
    punjabi_translation: string;
    english_translation: string;
    bani_id?: number;
    gurmukhi_speech: string,
    vishraam_idx: number | null,
    vishraam_ridx: number | null,
    gurmukhi_words: string[],
    gurmukhi_rwords: string[],
    group: number;
};
