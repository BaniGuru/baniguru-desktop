import { useMemo, useReducer } from "react";
import { createContext } from "use-context-selector";
import { Pankti } from "../../models/Pankti";
import { SHABAD_AUTO_NEXT, SHABAD_HOME, SHABAD_PANKTI, SHABAD_PANKTI_MARK_VISITED, SHABAD_PANKTI_NO_VISITED, SHABAD_PREV, SHABAD_RESET, SHABAD_SET_HOME, SHABAD_UPDATE } from "../ActionTypes";

export type ShabadState = {
    baniId: number | null,
    shabadId: string,
    panktis: Pankti[],
    shabadIds: string[],
    current: number;
    home: number;
};

const initShabadState: ShabadState = {
    baniId: null,
    shabadId: '',
    panktis: [],
    shabadIds: [],
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
        case SHABAD_RESET:
            return {
                ...initShabadState,
            };

        case SHABAD_AUTO_NEXT:
            if (payload.current < 0 ||
                payload.current >= state.panktis.length
            ) {
                break;
            }
        
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
                home: payload.home ??  payload.current,
            };

        case SHABAD_HOME:
            return {
                ...state,
                current: state.home
            };
        
        case "SHABAD_HOME_WITH_PANKTI":
            if (payload?.current >= 0 && payload.current < state.panktis.length) {
                return {
                    ...state,
                    current: payload.current,
                    home: payload.home,
                    panktis: markVisited(state.panktis, payload.current),
                };
            }
            break;

        case SHABAD_SET_HOME:
            return {
                ...state,
                current: payload.home,
                home: payload.home,
            };

        case SHABAD_PANKTI:
            if (payload?.current >= 0 && payload.current < state.panktis.length) {
                return {
                    ...state,
                    current: payload.current,
                    panktis: markVisited(state.panktis, payload.current)
                };
            }
            break;
        
        case SHABAD_PANKTI_NO_VISITED:
            if (payload?.current >= 0 && payload.current < state.panktis.length) {
                return {
                    ...state,
                    current: payload.current,
                };
            }
            break;

        case SHABAD_PANKTI_MARK_VISITED:
            if (payload?.current >= 0 && payload.current < state.panktis.length) {
                return {
                    ...state,
                    panktis: markVisited(state.panktis, payload.current)
                };
            }
            break;
    }

    return state;
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
    const value = useMemo(() => ({ state, dispatch }), [state]);

    return (
        <ShabadContext.Provider value={value}>
            { children }
        </ShabadContext.Provider>
    );
};

export {ShabadProvider, ShabadContext};
