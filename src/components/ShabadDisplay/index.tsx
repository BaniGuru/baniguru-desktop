import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { SearchContext } from "../../state/providers/SearchProvider";
import Format from "../../utils/Format";
import { DB } from "../../utils/DB";
import styled from "styled-components";
import { Pankti } from "../../models/Pankti";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { SHABAD_AUTO_NEXT, SHABAD_HOME, SHABAD_NEXT, SHABAD_PREV, SHABAD_UPDATE } from "../../state/ActionTypes";
import { E } from "@tauri-apps/api/path-e12e0e34";

const Gurmukhi = styled.div`
    color: #01579b;
    font-size: 130px;
    line-height: 150px;
`;

const ShabadDisplay: React.FC = () => {
    const searchState = useContext(SearchContext).state;
    const {state, dispatch } = useContext(ShabadContext);
    const current = state.current;

    useEffect(() => {
        const loadShabad = async () => {
            if (searchState.searchShabadPankti == null) {
                return;
            }

            const instance = await DB.getInstance();
            instance.select(`
                SELECT *
                FROM lines
                WHERE shabad_id = '${searchState.searchShabadPankti.shabad_id}'
            `).then((panktis: any) => {
                if (! panktis) {
                    return;
                }

                const current = panktis.findIndex(
                    (pankti: Pankti) => pankti.id === searchState.searchShabadPankti?.id
                );

                dispatch({
                    type: SHABAD_UPDATE,
                    payload: {
                        panktis: panktis,
                        current: current
                    }
                });
            });
        };

        loadShabad();
    }, [searchState]);

    return (
        <Gurmukhi className="gurmukhi-font-2">
            {
                current != -1 &&
                <div>
                    { Format.removeVishraams(state.panktis[current]?.gurmukhi) }
                </div>
            }
        </Gurmukhi>
    );
};

export default ShabadDisplay;
