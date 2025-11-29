// src/hooks/useShabadNavigation.ts
import { KeyboardEvent, useCallback, useContext, useEffect } from "react";
import { SEARCH_SHABAD_PANKTI, SHABAD_AUTO_NEXT, SHABAD_SET_HOME } from "../state/ActionTypes";
import { AppContext, AppState, PAGE_SHABAD } from "../state/providers/AppProvider";
import { ShabadContext, ShabadState } from "../state/providers/ShabadProvider";
import { Pankti } from "../models/Pankti";
import { DB } from "./DB";
import { SearchContext } from "../state/providers/SearchProvider";
import { useSettings } from "../state/providers/SettingContext";

const useShabadNavigation = () => {
    const shabadContext: {state: ShabadState, dispatch: any} = useContext(ShabadContext);
    const appContext: {dispatch: any, state: AppState} = useContext(AppContext);
    const searchContext: {dispatch: any} = useContext(SearchContext);
    const { visibility } = useSettings();

    const handleShabadNavigation: any = useCallback(async (ev: KeyboardEvent) => {
        if (appContext.state.page !== PAGE_SHABAD) {
            return;
        }

        switch (ev.key) {
            case " ":
                ev.preventDefault();

                if (ev.ctrlKey) {
                    shabadContext.dispatch({
                        type: SHABAD_SET_HOME,
                        payload: {
                            home: shabadContext.state.current,
                        },
                    });
                    
                    break;
                }

                const panktis = shabadContext.state.panktis;
                const navigatePanktis = panktis.filter((pankti: Pankti) => pankti.visited !== true);
                if (shabadContext.state.current !== shabadContext.state.home ||
                    navigatePanktis.length === 0
                ) {
                    shabadContext.dispatch({
                        type: SHABAD_AUTO_NEXT,
                        payload: {
                            current: shabadContext.state.home
                        }
                    });
                    break;
                }

                let pilotIndex = -1;

                for (let i = 0; i < panktis.length; i++) {
                    if (panktis[i].visited !== true) {
                        pilotIndex = i;
                        break;
                    }
                }

                if (pilotIndex < 0) {
                    break;
                }

                shabadContext.dispatch({
                    type: SHABAD_AUTO_NEXT,
                    payload: {
                        current: pilotIndex
                    }
                });
                break;

            case "ArrowUp":
            case "ArrowLeft":
                ev.preventDefault();

                const prevIndex = shabadContext.state.current - 1;


                if (visibility["Akhand Paath"] && prevIndex < 0) {
                    const db = await DB.getInstance();
                    db.select(`
                        SELECT lines.*
                        FROM lines
                        WHERE shabad_id IN (
                            SELECT id
                            FROM shabads
                            WHERE order_id < (
                                SELECT order_id
                                FROM shabads
                                WHERE id = '${shabadContext.state.shabadId}'
                            )
                            ORDER BY order_id DESC
                            LIMIT 1
                        )
                        ORDER BY order_id DESC
                        limit 1
                    `).then((panktis: any) => {
                        if (!panktis) {
                            return;
                        }

                        searchContext.dispatch({
                            type: SEARCH_SHABAD_PANKTI,
                            payload: { pankti: panktis[0] }
                        });
                    });
                }

                if (prevIndex < 0) {
                    break;
                }

                shabadContext.dispatch({
                    type: SHABAD_AUTO_NEXT,
                    payload: {
                        current: prevIndex
                    }
                });
                break;

            case "ArrowRight":
            case "ArrowDown":
                ev.preventDefault();

                const nextIndex = shabadContext.state.current + 1;
                if (nextIndex < shabadContext.state.panktis.length) {
                    shabadContext.dispatch({
                        type: SHABAD_AUTO_NEXT,
                        payload: {
                            current: nextIndex
                        }
                    });
                }

                if (visibility["Akhand Paath"] && nextIndex >= shabadContext.state.panktis.length) {
                    const db = await DB.getInstance();
                    db.select(`
                        SELECT lines.*
                        FROM lines
                        WHERE shabad_id IN (
                            SELECT id
                            FROM shabads
                            WHERE order_id > (
                                SELECT order_id
                                FROM shabads
                                WHERE id = '${shabadContext.state.shabadId}'
                            )
                            ORDER BY order_id
                            LIMIT 1
                        )
                        ORDER BY order_id
                        limit 1
                    `).then((panktis: any) => {
                        if (!panktis) {
                            return;
                        }

                        searchContext.dispatch({
                            type: SEARCH_SHABAD_PANKTI,
                            payload: { pankti: panktis[0] }
                        });
                    });
                }
                break;
        }
    }, [shabadContext.dispatch, appContext.state.page, shabadContext.state]);

    useEffect(() => {
        window.addEventListener("keydown", handleShabadNavigation);

        return () => {
            window.removeEventListener("keydown", handleShabadNavigation);
        };
    }, [handleShabadNavigation]);
};

export default useShabadNavigation;
