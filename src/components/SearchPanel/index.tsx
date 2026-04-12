import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { SearchContext } from "../../state/providers/SearchProvider";
import { GURBANI_SEARCH, SEARCH_SHABAD_PANKTI, SET_APP_PAGE, SET_PANKTIS, SHABAD_RESET } from "../../state/ActionTypes";
import styled from "styled-components";
import { DB } from "../../utils/DB";
import { Pankti } from "../../models/Pankti";
import { MdOutlineClear } from "react-icons/md";
import { BsKeyboard } from "react-icons/bs";
import SearchList from "./SearchList";
import { AppContext } from "../../state/providers/AppProvider";
import { useContextSelector } from "use-context-selector";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { ApiClient } from "../../utils/apiClient";

const SearchButton = styled.button`
    font-size: 14px;
    padding: 2px 6px;
    position: absolute;
    right: 58px;
    margin-top: 8px;
`;

const SearchIcon = styled(MdOutlineClear)`
    margin-top: -1px;
`;

const KeyboardButton = styled.button`
    color: #444;
`;

interface SearchPanelProps {
  apiClient: ApiClient | null;
}

const SearchPanel: React.FC<SearchPanelProps> = ({ apiClient }) => {
    const {dispatch, searchInputRef, searchTerm, setSearchTerm, panktis} = useContext(SearchContext);
    const [focusIndex, setFocusIndex] = useState(0);
    const {dispatch: appDispatch, fontSize} = useContext(AppContext);
    const { dispatch: shabadDispatch, shabadId } = useContextSelector(
        ShabadContext,
        ctx => ({
            dispatch: ctx.dispatch,
            shabadId: ctx.state.shabadId,
        })
    );
    const appRef = useRef<number>(0);
    const listContainerRef = useRef<HTMLUListElement | null>(null);
    appRef.current++;

    const searchRequestId = useRef(0);

    const handleSearchShortcuts = (event: React.KeyboardEvent<HTMLInputElement>) => {
        const blockedKeys: Record<string, string> = {
                "R": "r",
                "S": "s",
                "H": "h",
                "L": "l",
                "N": "n",
                "M": "m",
            };

            if (!event.ctrlKey && blockedKeys[event.key]) {
                event.preventDefault();

                const replacementChar = blockedKeys[event.key];

                const input = event.currentTarget;
                const start = input.selectionStart ?? 0;
                const end = input.selectionEnd ?? 0;

                const newValue =
                    searchTerm.slice(0, start) + replacementChar + searchTerm.slice(end);

                setSearchTerm(newValue);

                if (searchInputRef.current) {
                    searchInputRef.current.value = newValue;

                    setTimeout(() => {
                        searchInputRef.current?.setSelectionRange(start + 1, start + 1);
                    }, 0);
                }

                return;
            }


        if (event.key === 'c' && event.ctrlKey && searchInputRef?.current?.value) {
            searchInputRef.current.value = "";
            event.preventDefault();
        }

        if (event.key === 'ArrowDown' && panktis.length > 0) {
            setFocusIndex(Math.min(focusIndex + 1, panktis.length - 1));
        }

        if (event.key === 'ArrowUp' && panktis.length > 0) {
            setFocusIndex(Math.max(focusIndex - 1, 0));
        }

        if (event.key === 'Enter') {
            displayShabad(panktis[focusIndex]);
            event.preventDefault();
        }

        if (["w", "W", "y", "Y", "u", "U", "i", "I", "o", "O", "z", "Z"].includes(event.key)) {
            event.preventDefault();
        }
    };

    const searchByFirstLetters = async (value: string, requestId: number) => {
        const db = await DB.getInstance();
        db.select(`
            SELECT
                lines.*,
                CASE
                    WHEN first_letters like '${value}' THEN 1
                    WHEN first_letters like '${value}%' THEN 2
                    WHEN first_letters like '%${value}' THEN 3
                    WHEN first_letters like '%${value}%' THEN 4
                    ELSE 5
                END AS rank
            FROM lines
            INNER JOIN shabads ON lines.shabad_id = shabads.id
            WHERE
                first_letters like '%${value}%'
            ORDER BY shabads.source_id, rank
            LIMIT 100
        `).then((res: any) => {
            // Ignore if not latest search request
            if (requestId !== searchRequestId.current) return;

            if (!res) {
                return;
            }

            const panktis: Pankti[] = res;
            dispatch({
                type: SET_PANKTIS,
                payload: panktis
            });
            setFocusIndex(0);
            if (listContainerRef.current) {
                listContainerRef.current.scrollTo({
                    top: 0
                })
            }
        });
    }

    const searchByWords = async (value: string, requestId: number) => {
        const searchValue = value.trim();
        const db = await DB.getInstance();
        db.select(`
            SELECT
                search_lines.*,
                CASE
                    WHEN TRIM(gurmukhi_normalized) LIKE CONCAT('${searchValue}') THEN 1
                    WHEN TRIM(gurmukhi_normalized) LIKE CONCAT('${searchValue}', '%') THEN 2
                    WHEN TRIM(gurmukhi_normalized) LIKE CONCAT('% ', '${searchValue}') THEN 3
                    WHEN TRIM(gurmukhi_normalized) LIKE CONCAT('% ', '${searchValue}', '%') THEN 4
                    ELSE 5
                END AS rank
            FROM search_lines
            INNER JOIN shabads ON search_lines.shabad_id = shabads.id
            WHERE
                TRIM(gurmukhi_normalized) LIKE CONCAT('${searchValue}') OR
                TRIM(gurmukhi_normalized) LIKE CONCAT('${searchValue}', '%') OR
                TRIM(gurmukhi_normalized) LIKE CONCAT('% ', '${searchValue}') OR
                TRIM(gurmukhi_normalized) LIKE CONCAT('% ', '${searchValue}', '%')
            ORDER BY rank, shabads.source_id
            LIMIT 100
        `).then((res: any) => {
            // Ignore if not latest search request
            if (requestId !== searchRequestId.current) return;

            if (!res) {
                return;
            }

            const panktis: Pankti[] = res;
            dispatch({
                type: SET_PANKTIS,
                payload: panktis
            });
            setFocusIndex(0);
            if (listContainerRef.current) {
                listContainerRef.current.scrollTo({
                    top: 0
                })
            }
        });
    };

    const handleSearch = async (value: string) => {
        if (value.length < 2) {
            return;
        }

        const currentRequestId = ++searchRequestId.current;

        if (value.includes(' ')) {
            await searchByWords(value, currentRequestId);
        } else {
            await searchByFirstLetters(value, currentRequestId);
        }

        dispatch({
            type: GURBANI_SEARCH,
            payload: {
                searchTerm: value
            }
        });
    }

    const clearSearch = useCallback(() => {
        setSearchTerm("");

        if (searchInputRef.current !== null) {
            searchInputRef.current.value = "";
            searchInputRef.current.focus();
        }
    }, [searchInputRef]);

    const displayShabad = useCallback((pankti: Pankti) => {
        // current shabad
        if (pankti.shabad_id == shabadId) {
            appDispatch({
                type: SET_APP_PAGE,
                payload: { page: "shabad" }
            });
            return;
        }

        shabadDispatch({ type: SHABAD_RESET });
        dispatch({
            type: SEARCH_SHABAD_PANKTI,
            payload: { pankti }
        });

        appDispatch({
            type: SET_APP_PAGE,
            payload: { page: "shabad" }
        });
    }, [shabadDispatch, dispatch, appDispatch]);

    useEffect(() => {
        searchInputRef?.current?.focus();
        searchInputRef?.current?.select;
    }, []);

    useEffect(() => {
        if (! searchInputRef.current?.value) {
            return;
        }

        handleSearch(searchTerm);
    }, [searchTerm]);

    useEffect(() => {
        if (!apiClient) {
            return;
        }

        if (panktis.length > 20) {
            return;
        }

        const ids = panktis.map(pankti => pankti.id);
        apiClient.sendSearchPanktis(ids);
    }, [panktis]);

    return (
        <>
            <div className="flex-none">
                <div className="flex flex-row my-2">
                    <input
                        ref={searchInputRef}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        type="text"
                        className="gurmukhi-font-1 flex-1 mx-2 px-2 py-1 border-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400"
                        spellCheck="false"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        inputMode="none"
                        onKeyDown={handleSearchShortcuts}
                        style={{
                            padding: `${fontSize*0.25*0.5*0.2}px`,
                            paddingLeft: `${fontSize*0.25*0.5*0.8}px`,
                        }}
                    />
                    { searchTerm.length > 0 &&
                        <SearchButton title="search" onClick={clearSearch}>
                            <SearchIcon />
                        </SearchButton>
                    }

                    <KeyboardButton>
                        <BsKeyboard />
                    </KeyboardButton>
                </div>
            </div>
            <SearchList searchTerm={searchTerm ?? ""} listContainerRef={listContainerRef} panktis={panktis} current={focusIndex} displayShabad={displayShabad} />
        </>
    );
};

export default SearchPanel;