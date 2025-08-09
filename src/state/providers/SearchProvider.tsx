import React, { createContext, createRef, RefObject, useState} from "react";
import { GURBANI_SEARCH, SEARCH_SHABAD_PANKTI } from "../ActionTypes";
import { Pankti } from "../../models/Pankti";

type initSearchStateType = {
    searchTerm: string;
    searchShabadPankti: Pankti|null;
};

const initSearchState = {
    searchTerm: "",
    searchShabadPankti: null,
};

const searchReducer = (state: initSearchStateType, action: any) => {
    switch (action.type) {
        case GURBANI_SEARCH:
            return {
                ...state,
                searchTerm: action.payload.searchTerm
            };

        case SEARCH_SHABAD_PANKTI:
            return {
                ...state,
                searchShabadPankti: action.payload.pankti
            };

        default:
            return state;
    }
}

const SearchContext = createContext<{
    state: initSearchStateType,
    dispatch: React.Dispatch<any>,
    searchInputRef: RefObject<HTMLInputElement>,
    searchTerm: string,
    setSearchTerm: React.Dispatch<any>,
    panktis: Array<Pankti>,
    setPanktis: React.Dispatch<any>,
}>({
    state: initSearchState,
    dispatch: () => {},
    searchInputRef: createRef<HTMLInputElement>(),
    searchTerm: "",
    setSearchTerm: () => {},
    panktis: [],
    setPanktis: () => {},
});

const SearchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [state, dispatch] = React.useReducer(searchReducer, initSearchState);
    const searchInputRef = createRef<HTMLInputElement>();
    const [searchTerm, setSearchTerm] = useState("");
    const [panktis, setPanktis] = useState<Pankti[]>([]);

    return (
        <SearchContext.Provider value={{state, dispatch, searchInputRef, searchTerm, setSearchTerm, panktis, setPanktis}}>
            {children}
        </SearchContext.Provider>
    );
}

export {SearchProvider, SearchContext};
