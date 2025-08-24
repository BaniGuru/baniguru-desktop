import { ChangeEvent, FunctionComponent, useCallback, useContext, useEffect, useRef, useState } from "react";
import { SearchContext } from "../../state/providers/SearchProvider";
import { GURBANI_SEARCH, SEARCH_SHABAD_PANKTI, SET_APP_PAGE } from "../../state/ActionTypes";
import styled from "styled-components";
import { DB } from "../../utils/DB";
import { Pankti } from "../../models/Pankti";
import { MdOutlineClear } from "react-icons/md";
import { BsKeyboard } from "react-icons/bs";
import SearchList from "./SearchList";
import { AppContext } from "../../state/providers/AppProvider";

const SearchButton = styled.button`
    font-size: 14px;
    padding: 2px 6px;
    position: absolute;
    right: 58px;
    margin-top: 8px;
`;

const SearchIcon = styled(MdOutlineClear)`
    margin-top: 5px;
`;

const KeyboardButton = styled.button`
    color: #444;
`;

const SearchPanel: FunctionComponent = () => {
    const {dispatch, searchInputRef, searchTerm, setSearchTerm, panktis, setPanktis} = useContext(SearchContext);
    const [focusIndex, setFocusIndex] = useState(0);
    const appDispatch = useContext(AppContext).dispatch;
    const appRef = useRef<number>(0);
    const listContainerRef = useRef<HTMLUListElement | null>(null);
    appRef.current++;

    const handleSearchShortcuts = (event: React.KeyboardEvent<HTMLInputElement>) => {
        const blockedKeys: Record<string, string> = {
                "R": "r",
                "S": "s",
                "H": "h",
                "L": "l",
                "N": "n",
                "M": "m",
            };

            if (blockedKeys[event.key]) {
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

    const searchByFirstLetters = async (value: string) => {
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
            if (!res) {
                return;
            }

            const panktis: Pankti[] = res;
            setPanktis(panktis);
            setFocusIndex(0);
            if (listContainerRef.current) {
                listContainerRef.current.scrollTo({
                    top: 0
                })
            }
        });
    }

    const searchByWords = async (value: string) => {
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
            if (!res) {
                return;
            }

            const panktis: Pankti[] = res;
            setPanktis(panktis);
            setFocusIndex(0);
            if (listContainerRef.current) {
                listContainerRef.current.scrollTo({
                    top: 0
                })
            }
        });
    };

    const handleSearch = async (e: ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value.trim();
        setSearchTerm(value);
        if (value.length < 2) {
            return;
        }

        if (value.includes(' ')) {
            searchByWords(value);
        } else {
            searchByFirstLetters(value);
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
        dispatch({
            type: SEARCH_SHABAD_PANKTI,
            payload: { pankti }
        });

        appDispatch({
            type: SET_APP_PAGE,
            payload: { page: "shabad" }
        });
    }, []);

    useEffect(() => {
        searchInputRef?.current?.focus();
        searchInputRef?.current?.select;
    }, []);

    return (
        <>
            <div className="flex-none">
                <div className="flex flex-row my-2">
                    <input
                        ref={searchInputRef}
                        type="text"
                        onChange={handleSearch}
                        className="gurmukhi-font-1 flex-1 mx-2 px-4 py-2 border-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400"
                        spellCheck="false"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        inputMode="none"
                        onKeyDown={handleSearchShortcuts}
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
            <SearchList listContainerRef={listContainerRef} panktis={panktis} current={focusIndex} displayShabad={displayShabad} />
        </>
    );
};

export default SearchPanel;