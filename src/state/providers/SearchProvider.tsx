import { createContext, createRef, RefObject, useState} from "react";
import { CLEAR_RECENT_PANKTIS, GURBANI_SEARCH, REMOVE_RECENT_PANKTI, SEARCH_SHABAD_PANKTI, RECENT_SEARCH_UPDATE } from "../ActionTypes";
import { Pankti } from "../../models/Pankti";
import * as React from "react";

export type recentShabad = {
    shabadId: string;
    pankti: Pankti;
    visited: [],
    home: number,
    active: number,
};

type initSearchStateType = {
    searchTerm: string;
    searchShabadPankti: Pankti|null;
    recent: recentShabad[];
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

        case SEARCH_SHABAD_PANKTI: {
            return {
                ...state,
                searchShabadPankti: action.payload.pankti
            };
        }

        case RECENT_SEARCH_UPDATE: {
            
            const shabadId = action.payload.shabadId;
            const alreadyExists = state.recent.some(p => p.shabadId === shabadId);

            return {
                ...state,
                recent: alreadyExists ? [
                    ...state.recent
                    // TODO: update current to search one
                ] :
                [
                    {
                        shabadId: action.payload.shabadId,
                        pankti: action.payload.pankti,
                        visited: [],
                        home: action.payload.home ?? 0,
                        active: action.payload.active ?? 0,
                    },
                    ...state.recent,
                ],
            };
        }

        case REMOVE_RECENT_PANKTI:
            return {
                ...state,
                recent: state.recent.filter((p) => p.shabadId !== action.payload.id),
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
