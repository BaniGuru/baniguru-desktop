import React, { createContext} from "react";
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
    state: initSearchStateType;
    dispatch: React.Dispatch<any>
}>({
    state: initSearchState,
    dispatch: () => null
});

const SearchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [state, dispatch] = React.useReducer(searchReducer, initSearchState);

    return (
        <SearchContext.Provider value={{state, dispatch}}>
            {children}
        </SearchContext.Provider>
    );
}

export {SearchProvider, SearchContext};
