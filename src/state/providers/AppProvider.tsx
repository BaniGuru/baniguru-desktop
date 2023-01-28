import React, { createContext, useReducer } from "react";
import { SET_APP_PAGE } from "../ActionTypes";

type AppState = {
    page: string;
};

const initAppState: AppState = {
    page: "search",
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
    dispatch: React.Dispatch<any>
}>({
    state: initAppState,
    dispatch: () => null
});

const AppProvider: React.FC<{ children: React.ReactNode}> = ({ children }) => {
    const [state, dispatch] = useReducer(appReducer, initAppState);

    return (
        <AppContext.Provider value={{state, dispatch}}>
            { children }
        </AppContext.Provider>
    );
};

export {AppProvider, AppContext};
