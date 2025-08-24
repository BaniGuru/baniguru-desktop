import { createContext, createRef, RefObject, useState} from "react";
import { CLEAR_RECENT_PANKTIS, GURBANI_SEARCH, REMOVE_RECENT_PANKTI, SEARCH_SHABAD_PANKTI, RECENT_SEARCH_UPDATE, RECENT_VISITED_UPDATE } from "../ActionTypes";
import { Pankti } from "../../models/Pankti";
import * as React from "react";

export type RecentShabad = {
    shabadId: string;
    pankti: Pankti;
    panktis: Pankti[],
    home: number,
    current: number,
};

type initSearchStateType = {
    searchTerm: string;
    searchShabadPankti: Pankti|null;
    recent: RecentShabad[];
};

const initSearchState = {
    searchTerm: "",
    searchShabadPankti: null,
    recent: [],
};

const searchReducer = (state: initSearchStateType, action: any) => {
    const payload = action.payload;

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

        case RECENT_SEARCH_UPDATE:
            const shabadId = action.payload.shabadId;
            const recentIndex = state.recent.findIndex(r => r.shabadId === shabadId);
            if (recentIndex >= 0) {
                break;
            }

            return {
                ...state,
                recent: [
                    {
                        shabadId: action.payload.shabadId,
                        pankti: action.payload.pankti,
                        panktis: action.payload.panktis,
                        home: action.payload.home ?? 0,
                        current: action.payload.current ?? 0,
                    },
                    ...state.recent,
                ]
            };

        case RECENT_VISITED_UPDATE:
            const index = state.recent.findIndex(p => p.shabadId === payload.shabadId);
            if (index < 0) {
                break;
            }

            let recent = [
                ...state.recent
            ];
            recent[index] = {
                ...state.recent[index],
                panktis: payload.panktis,
                home: payload.home,
                current: payload.current,
            };

            return {
                ...state,
                recent: recent
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
    }

    return state;
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
