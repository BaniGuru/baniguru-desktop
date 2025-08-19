import { createContext, useReducer } from "react";
import { Pankti } from "../../models/Pankti";
import { SHABAD_AUTO_NEXT, SHABAD_HOME, SHABAD_NEXT, SHABAD_PANKTI, SHABAD_PREV, SHABAD_SET_HOME, SHABAD_UPDATE } from "../ActionTypes";

export type ShabadState = {
    panktis: Pankti[],
    current: number;
    home: number;
    pilot: number;
    auto_pilot: boolean;
};

const initShabadState: ShabadState = {
    panktis: [],
    current: -1,
    home: -1,
    pilot: -1,
    auto_pilot: false,
};

const shabadReducer = (state: ShabadState, action: any) => {
    let shabadState = {
        ...state
    };
    const payload = action?.payload;

    switch (action.type) {
        case SHABAD_AUTO_NEXT:
            if ((shabadState.pilot + 1) === shabadState.panktis.length) {
                shabadState.current = shabadState.home;
            } else {
                shabadState.pilot++;
                if (shabadState.pilot === shabadState.home) {
                    shabadState.panktis[shabadState.pilot].visited = true;
                    shabadState.pilot++;
                }
                shabadState.current = shabadState.pilot;
                shabadState.panktis[shabadState.pilot].visited = true;
                shabadState.auto_pilot = true;
            }

            break;

        case SHABAD_NEXT:
            if (state.current + 1 < state.panktis.length) {
                shabadState.current++;

                if (shabadState.auto_pilot) {
                    shabadState.pilot++;
                    shabadState.panktis[shabadState.pilot].visited = true;
                }

                if (shabadState.panktis[shabadState.current].bani_id) {
                    shabadState.panktis[shabadState.current].visited = true;
                }

                break;
            }

            break;

        case SHABAD_PREV:
            if (state.current === 0) {
                break;
            }

            shabadState.auto_pilot = false;
            shabadState.current -= 1;
            break;

        case SHABAD_UPDATE:
            shabadState = {
                ...initShabadState,
                ...payload,
                home: payload.current,
            };
            break;

        case SHABAD_HOME:
            shabadState.auto_pilot = false;
            shabadState.current = shabadState.home;
            break;

        case SHABAD_SET_HOME:
            shabadState.current = payload.home;
            shabadState.home = payload.home;
            break;

        case SHABAD_PANKTI:
            shabadState.auto_pilot = false;
            if (payload?.current >= 0 && payload.current < state.panktis.length) {
                shabadState.panktis[payload.current].visited = true;
                shabadState.current = payload.current;
            }
            break;
    }

    console.log('action: ', action);
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
