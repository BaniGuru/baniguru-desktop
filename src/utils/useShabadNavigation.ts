// src/hooks/useShabadNavigation.ts
import { KeyboardEvent, useContext, useEffect } from "react";
import { SHABAD_AUTO_NEXT, SHABAD_HOME, SHABAD_PREV, SHABAD_NEXT, SHABAD_SET_HOME, TOGGLE_PANEL, SET_APP_PAGE } from "../state/ActionTypes";
import { AppContext, AppState, PAGE_SHABAD } from "../state/providers/AppProvider";
import { ShabadContext } from "../state/providers/ShabadProvider";

const useShabadNavigation = () => {
    const shabadContext: any = useContext(ShabadContext);
    const appContext: {dispatch: any, state: AppState} = useContext(AppContext);

    const autoNavigate = (shabadContext: any) => {
        let shabadState = shabadContext.state;

        if (shabadState.pilot + 1 === shabadState.panktis.length) {
            shabadState.current = shabadState.home;
        } else {
            shabadState.pilot++;
            shabadState.current = shabadState.pilot;
            shabadState.panktis[shabadState.pilot].visited = true;
        }

        return shabadState;
    };

    useEffect(() => {
        const onESC: any = (ev: KeyboardEvent) => {
            handleShabadNavigation(ev);
        };

        window.addEventListener("keydown", onESC);

        return () => {
            window.removeEventListener("keydown", onESC);
        };
    }, [shabadContext.state, shabadContext.dispatch, appContext]);

    const handleShabadNavigation = (ev: KeyboardEvent) => {
        if (appContext.state.page !== PAGE_SHABAD) {
            return;
        }

        switch (ev.key) {
            case " ":
                if (ev.ctrlKey) {
                    shabadContext.dispatch({
                        type: SHABAD_SET_HOME,
                        payload: {
                            home: shabadContext.state.current,
                        },
                    });
                    ev.preventDefault();
                    break;
                }

                if (shabadContext.state.current === shabadContext.state.home) {
                    const shabadState = autoNavigate(shabadContext.state);
                    shabadContext.dispatch({
                        type: SHABAD_AUTO_NEXT,
                        payload: {
                            current: shabadState.current,
                            panktis: shabadState.panktis,
                            pilot: shabadState.pilot,
                        },
                    });
                    ev.preventDefault();
                    break;
                }

                shabadContext.dispatch({ type: SHABAD_HOME });
                ev.preventDefault();
                break;

            case "ArrowUp":
            case "ArrowLeft":
                shabadContext.dispatch({ type: SHABAD_PREV });
                ev.preventDefault();
                break;

            case "ArrowRight":
            case "ArrowDown":
                shabadContext.dispatch({ type: SHABAD_NEXT });
                ev.preventDefault();
                break;
        }
    }
};

export default useShabadNavigation;
