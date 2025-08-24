import * as React from "react";
import { createContext } from "react";
import { Pankti } from "../../models/Pankti";

export const BANI_ACTION_Add = "BANI_ADD";
export const BANI_ACTION_UPDATE = "BANI_ACTION_UPDATE";

export type BaniRecent = {
    baniId: number;
    panktis: Pankti[];
    current: number;
    home: number;
};

type BaniStateType = {
    currentBani: number;
    banis: BaniRecent[];
};

const initBaniState = {
    currentBani: -1,
    banis: []
}

const baniReducer = (state: BaniStateType, action: any) => {
    switch (action.type) {
        case BANI_ACTION_Add:
            return {
                ...state,
                banis: [
                    {
                        baniId: action.payload.baniId,
                        panktis: action.payload.panktis,
                        current: action.payload.current,
                        home: action.payload.home
                    },
                    ...state.banis
                ]
            };

        case BANI_ACTION_UPDATE:
            const index = state.banis.findIndex((baniRecent) => baniRecent.baniId === action.payload.baniId);
            if (index < 0) {
                break;
            }

            let banis = [
                ...state.banis
            ];
            banis[index] = {
                ...state.banis[index],
                ...action.payload,
            }
            return {
                ...state,
                banis: banis
            };
    }

    return state;
}

const BaniContext = createContext<{
    state: BaniStateType,
    dispatch: React.Dispatch<any>,
}>({
    state: initBaniState,
    dispatch: () => {}
});

const BaniProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
    const [state, dispatch] = React.useReducer(baniReducer, initBaniState);

    return (
        <BaniContext.Provider value={{state, dispatch}}>
            {children}
        </BaniContext.Provider>
    );
};

export {BaniProvider, BaniContext}
