import { createContext, useReducer, useState } from "react";
import { SET_APP_PAGE, TOGGLE_PANEL } from "../ActionTypes";

export type AppState = {
    page: string;
    prev_page: string;
    show_panel: boolean;
    // dbPath: string;
};

export const PAGE_SEARCH = "search";
export const PAGE_SHABAD = "shabad";
export const PAGE_BANI = "bani";
export const PAGE_ANNOUNCEMENT = "announcement";

const initAppState: AppState = {
    page: "search",
    prev_page: "",
    show_panel: true,
    // dbPath: "",
};

const appReducer = (state: AppState, action: any) => {
    switch (action.type) {
        case SET_APP_PAGE:
            return {
                ...state,
                prev_page: state.page,
                ...action.payload,
            };
        case TOGGLE_PANEL:
            let page = state.page;
            if (state.show_panel && page !== PAGE_ANNOUNCEMENT) {
                page = PAGE_SHABAD;
            }
            return {
                ...state,
                page: page,
                show_panel: !state.show_panel,
            }
    }

    return state;
}

const AppContext = createContext<{
    state: AppState;
    dispatch: React.Dispatch<any>,
    dbPath: string,
    setDbPath: React.Dispatch<any>,
    terms: string[],
    setTerms: React.Dispatch<any>,
    fontSize: number,
    setFontSize: React.Dispatch<any>
}>({
    state: initAppState,
    dispatch: () => null,
    dbPath: "",
    setDbPath: () => null,
    terms: [],
    setTerms: () => null,
    fontSize: 16,
    setFontSize: () => null,
});

const AppProvider: React.FC<{ children: React.ReactNode}> = ({ children }) => {
    const [state, dispatch] = useReducer(appReducer, initAppState);
    const [dbPath, setDbPath] = useState("");
    const [terms, setTerms] = useState([]);
    const [fontSize, setFontSize] = useState<number>(16);

    return (
        <AppContext.Provider value={{
            terms,
            setTerms,
            state,
            dispatch,
            dbPath, 
            setDbPath,
            fontSize,
            setFontSize,
        }}>
            { children }
        </AppContext.Provider>
    );
};

export {AppProvider, AppContext};
