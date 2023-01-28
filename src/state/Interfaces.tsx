import { GURBANI_SEARCH } from "./ActionTypes";

export interface IGurbaniSearch {
    type: typeof GURBANI_SEARCH;
    payload: {
        searchTerm: string
    }
}

export type SearchActions = IGurbaniSearch;
