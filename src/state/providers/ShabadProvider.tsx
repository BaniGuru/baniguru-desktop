import React, { createContext, useReducer } from "react";
import { Pankti } from "../../models/Pankti";
import { SHABAD_AUTO_NEXT, SHABAD_HOME, SHABAD_NEXT, SHABAD_PREV, SHABAD_SET_HOME, SHABAD_UPDATE } from "../ActionTypes";

export type ShabadState = {
    panktis: Pankti[],
    current: number;
    home: number;
    pilot: number;
};

const initShabadState: ShabadState = {
    panktis: [],
    current: -1,
    home: -1,
    pilot: -1,
};

const shabadReducer = (state: ShabadState, action: any) => {
    let shabadState = state;
    const payload = action?.payload;

    switch (action.type) {
        case SHABAD_AUTO_NEXT:
            return {
                ...state,
                ...payload,
            };

        case SHABAD_NEXT:
            shabadState.panktis[state.current + 1].visited = true;

            return {
                ...shabadState,
                current: state.current + 1,
            };

        case SHABAD_PREV:
            shabadState.panktis[state.current - 1].visited = true;

            return {
                ...state,
                current: state.current - 1,
            };

        case SHABAD_UPDATE:
            payload.panktis[payload.current].home = true;
            shabadState.pilot = -1;

            return {
                ...shabadState,
                ...payload
            };

        case SHABAD_HOME:
            return {
                ...state,
                current: state.home
            };

        case SHABAD_SET_HOME:
            shabadState.panktis[shabadState.home].home = false;
            shabadState.panktis[action.payload.home].home = true;

            return {
                ...state,
                home: action.payload.home,
                current: action.payload.home
            }
    }

    return {
        ...state
    };
}

const ShabadContext = createContext<{
    state: ShabadState;
    dispatch: React.Dispatch<any>
}>({
    state: initShabadState,
    dispatch: () => null
});

const ShabadProvider: React.FC<{ children: React.ReactNode}> = ({ children }) => {
    const [state, dispatch] = useReducer(shabadReducer, initShabadState);

    return (
        <ShabadContext.Provider value={{state, dispatch}}>
            { children }
        </ShabadContext.Provider>
    );
};

export {ShabadProvider, ShabadContext};
