import React, { createContext, createRef, RefObject, useState} from "react";
import { CLEAR_RECENT_PANKTIS, GURBANI_SEARCH, REMOVE_RECENT_PANKTI, SEARCH_SHABAD_PANKTI } from "../ActionTypes";
import { Pankti } from "../../models/Pankti";

type initSearchStateType = {
    searchTerm: string;
    searchShabadPankti: Pankti|null;
    recent: Pankti[];
};

const initSearchState = {
    searchTerm: "",
    searchShabadPankti: null,
    recent: [],
};

const searchReducer = (state: initSearchStateType, action: any) => {
    switch (action.type) {
        case GURBANI_SEARCH:
            return {
                ...state,
                searchTerm: action.payload.searchTerm
            };

        case SEARCH_SHABAD_PANKTI:
            const newPankti = action.payload.pankti;
            return {
                ...state,
                recent: [
                    newPankti,
                    ...state.recent.filter(p => p.id !== newPankti.id)
                ],
                searchShabadPankti: newPankti
            };
        
        case REMOVE_RECENT_PANKTI:
            return {
                ...state,
                recent: state.recent.filter((p) => p.id !== action.payload.id),
            };

        case CLEAR_RECENT_PANKTIS:
            return {
                ...state,
                recent: [],
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
