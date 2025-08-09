import React, { createContext, useReducer, useState } from "react";
import { SET_APP_PAGE } from "../ActionTypes";

type AppState = {
    page: string;
    // dbPath: string;
};

const initAppState: AppState = {
    page: "search",
    // dbPath: "",
};

const appReducer = (state: AppState, action: any) => {
    switch (action.type) {
        case SET_APP_PAGE:
            console.log("set page");
            return {
                ...state,
                page: action.payload.page
            };
    }

    return state;
}

const AppContext = createContext<{
    state: AppState;
    dispatch: React.Dispatch<any>,
    dbPath: String,
    setDbPath: React.Dispatch<any>,
}>({
    state: initAppState,
    dispatch: () => null,
    dbPath: "",
    setDbPath: () => null,
});

const AppProvider: React.FC<{ children: React.ReactNode}> = ({ children }) => {
    const [state, dispatch] = useReducer(appReducer, initAppState);
    const [dbPath, setDbPath] = useState("");

    return (
        <AppContext.Provider value={{state, dispatch, dbPath, setDbPath}}>
            { children }
        </AppContext.Provider>
    );
};

export {AppProvider, AppContext};
