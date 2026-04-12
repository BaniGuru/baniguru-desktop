import { createContext, createRef, RefObject, useState} from "react";
import { CLEAR_RECENT_PANKTIS, GURBANI_SEARCH, REMOVE_RECENT_PANKTI, SEARCH_SHABAD_PANKTI, RECENT_SEARCH_UPDATE, RECENT_VISITED_UPDATE, SELECT_PANKTI, SET_PANKTIS } from "../ActionTypes";
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
    panktis: Pankti[];
};

const initSearchState = {
    searchTerm: "",
    searchShabadPankti: null,
    recent: [],
    panktis: [],
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

        case SELECT_PANKTI: {
            const pankti = state.panktis.find(
                (p) => p.id === action.payload.id
            );

            if (!pankti || state.searchShabadPankti?.id == action.payload.id) {
                return {
                    ...state
                };
            }

            return {
                ...state,
                searchShabadPankti: pankti || null
            };
        }

        case SET_PANKTIS:
            return {
                ...state,
                panktis: action.payload
            };

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
}>({
    state: initSearchState,
    dispatch: () => {},
    searchInputRef: createRef<HTMLInputElement>(),
    searchTerm: "",
    setSearchTerm: () => {},
    panktis: [],
});

const SearchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [state, dispatch] = React.useReducer(searchReducer, initSearchState);
    const searchInputRef = createRef<HTMLInputElement>();
    const [searchTerm, setSearchTerm] = useState("");

    return (
        <SearchContext.Provider value={{
            state, dispatch, searchInputRef, searchTerm, setSearchTerm, panktis: state.panktis
        }}>
            {children}
        </SearchContext.Provider>
    );
}

export {SearchProvider, SearchContext};
