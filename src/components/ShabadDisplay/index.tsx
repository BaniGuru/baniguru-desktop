import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { SearchContext } from "../../state/providers/SearchProvider";
import Format from "../../utils/Format";
import { DB } from "../../utils/DB";
import styled from "styled-components";
import { Pankti } from "../../models/Pankti";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { SHABAD_AUTO_NEXT, SHABAD_HOME, SHABAD_NEXT, SHABAD_PREV, SHABAD_UPDATE } from "../../state/ActionTypes";

const Panel = styled.div`
    padding: 1rem;
`;

const Gurmukhi = styled.div`
    color: #01579b;
    font-size: 90px;
    line-height: 1.2;
    display: flex;
`;

const NextPanktiGurmukhi = styled.div`
    color: #5e9fd2ff;
    font-size: 70px;
    line-height: 1.2;
    position: absolute;
    bottom: 1.5rem;
    display: flex;
`;

const Punjabi = styled.div`
    color:rgb(73, 77, 79);
    font-size: 50px;
    line-height: 1.4;
    margin-top: 2rem;
    display: flex;
`;

const English = styled.div`
    color:rgb(81, 89, 94);
    font-size: 45px;
    line-height: 1.4;
    margin-top: 2rem;
    padding-left: 40px;
    padding-right: 40px;
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
                SELECT
                    lines.*,
                    punjabi.translation as punjabi_translation,
                    english.translation as english_translation
                FROM lines
                LEFT JOIN translations AS punjabi ON lines.id = punjabi.line_id AND punjabi.translation_source_id = 3
                LEFT JOIN translations AS english ON lines.id = english.line_id AND english.translation_source_id = 1
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
                        current: current,
                    }
                });
            });
        };

        loadShabad();
    }, [searchState]);

    const nextPankti = state.panktis[current+1]?.gurmukhi;

    if (current < 0) {
        return null;
    }

    return (
        <Panel className="w-screen flex flex-col items-center">
            <Gurmukhi className="gurmukhi-font-2 text-center">
                { Format.removeVishraams(state.panktis[current]?.gurmukhi) }
            </Gurmukhi>
            <Punjabi className="gurmukhi-font-2 text-center">
                { state.panktis[current]?.punjabi_translation }
            </Punjabi>
            <English className="text-center">
                { state.panktis[current]?.english_translation }
            </English>
            {
                nextPankti &&
                <NextPanktiGurmukhi className="gurmukhi-font-2 text-center">
                    { Format.removeVishraams(nextPankti) }
                </NextPanktiGurmukhi>
            }
        </Panel>
    );
};

export default ShabadDisplay;
