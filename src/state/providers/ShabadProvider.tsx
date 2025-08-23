import { createContext, useReducer } from "react";
import { Pankti } from "../../models/Pankti";
import { SHABAD_AUTO_NEXT, SHABAD_HOME, SHABAD_NEXT, SHABAD_PANKTI, SHABAD_PREV, SHABAD_SET_HOME, SHABAD_UPDATE } from "../ActionTypes";

export type ShabadState = {
    shabadId: string,
    panktis: Pankti[],
    current: number;
    home: number;
};

const initShabadState: ShabadState = {
    shabadId: '',
    panktis: [],
    current: -1,
    home: -1,
};

const markVisited = (panktis: Pankti[], index: number) => {
    const panktisArr = [
        ...panktis
    ];
    panktisArr[index].visited = true;

    return panktisArr;
}

const shabadReducer = (state: ShabadState, action: any) => {
    const payload = action?.payload;

    switch (action.type) {
        case SHABAD_AUTO_NEXT:
            return {
                ...state,
                current: payload.current,
                panktis: markVisited(state.panktis, payload.current),
            };

        case SHABAD_PREV:
            if (state.current === 0) {
                break;
            }

            const prevIndex = state.current - 1;
            return {
                ...state,
                current: prevIndex,
                panktis: markVisited(state.panktis, prevIndex),
            };

        case SHABAD_UPDATE:
            return {
                ...initShabadState,
                ...payload,
                home: payload.current,
            };
            break;

        case SHABAD_HOME:
            return {
                ...state,
                current: state.home
            };
            break;

        case SHABAD_SET_HOME:
            return {
                ...state,
                current: payload.home,
                home: payload.home,
            };
            break;

        case SHABAD_PANKTI:
            if (payload?.current >= 0 && payload.current < state.panktis.length) {
                return {
                    ...state,
                    panktis: {
                        ...state.panktis,
                        [payload.current]: {
                            ...state.panktis[payload.current],
                            visited: true,
                        }
                    },
                    current: payload.home,
                    home: payload.home,
                };
            }
            break;
    }

    return shabadState;
}

const ShabadContext = createContext<{
    state: ShabadState;
    dispatch: React.Dispatch<any>
}>({
    state: initShabadState,
    dispatch: () => null
});

const ShabadProvider: React.FC<{ children: React.ReactNode}> = ({ children }: any) => {
    const [state, dispatch] = useReducer(shabadReducer, initShabadState);

    return (
        <ShabadContext.Provider value={{state, dispatch}}>
            { children }
        </ShabadContext.Provider>
    );
};

export {ShabadProvider, ShabadContext};
