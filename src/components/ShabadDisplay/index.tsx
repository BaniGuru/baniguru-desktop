import { useContext, useEffect } from "react";
import { SearchContext } from "../../state/providers/SearchProvider";
import Format from "../../utils/Format";
import { DB } from "../../utils/DB";
import styled from "styled-components";
import { Pankti } from "../../models/Pankti";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { SHABAD_UPDATE } from "../../state/ActionTypes";
import { useSettings } from "../../state/providers/SettingContext";
import { updateServerPankti } from "../../utils/TauriCommands";

const Panel = styled.div`
    padding: 1rem;
`;

interface FontProps {
  fontSize: number;
}

const Gurmukhi = styled.div<FontProps>`
    color: #01579b;
    font-size: ${({ fontSize }) => `${fontSize}px`};
    line-height: 1.2;
    display: flex;
`;

const NextPanktiGurmukhi = styled.div<FontProps>`
    color: #5e9fd2ff;
    font-size: ${({ fontSize }) => `${fontSize}px`};
    line-height: 1.2;
    position: absolute;
    bottom: 1.5rem;
    display: flex;
`;

const Punjabi = styled.div<FontProps>`
    color:rgb(73, 77, 79);
    font-size: ${({ fontSize }) => `${fontSize}px`};
    line-height: 1.4;
    margin-top: 2rem;
    display: flex;
`;

const English = styled.div<FontProps>`
    color:rgb(81, 89, 94);
    font-size: ${({ fontSize }) => `${fontSize}px`};
    line-height: 1.4;
    margin-top: 2rem;
    padding-left: 40px;
    padding-right: 40px;
`;

const ShabadDisplay: React.FC = () => {
    const searchState = useContext(SearchContext).state;
    const {state, dispatch } = useContext(ShabadContext);
    const { fontSizes } = useSettings();
    const current = state.current;

    useEffect(() => {
        const sendDataToBackend = async () => {
            if (state.current < 0) return;

            await updateServerPankti(state.panktis[state.current]);  // Call the utility function
        };

        sendDataToBackend();
    }, [state.panktis]);

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
            <Gurmukhi className="gurmukhi-font-2 text-center" fontSize={fontSizes["ਗੁਰਮੁਖੀ"]}>
                { Format.removeVishraams(state.panktis[current]?.gurmukhi) }
            </Gurmukhi>
            <Punjabi className="gurmukhi-font-2 text-center" fontSize={fontSizes["ਪੰਜਾਬੀ"]}>
                { state.panktis[current]?.punjabi_translation }
            </Punjabi>
            <English className="text-center" fontSize={fontSizes["English"]}>
                { state.panktis[current]?.english_translation }
            </English>
            {
                nextPankti &&
                <NextPanktiGurmukhi className="gurmukhi-font-2 text-center" fontSize={fontSizes["Next Pankti"]}>
                    { Format.removeVishraams(nextPankti) }
                </NextPanktiGurmukhi>
            }
        </Panel>
    );
};

export default ShabadDisplay;
