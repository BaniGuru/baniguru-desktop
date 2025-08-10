import React, { ChangeEvent, Fragment, FunctionComponent, KeyboardEventHandler, createRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { SearchContext } from "../../state/providers/SearchProvider";
import { GURBANI_SEARCH, SEARCH_SHABAD_PANKTI, SET_APP_PAGE } from "../../state/ActionTypes";
import styled from "styled-components";
import { DB } from "../../utils/DB";
import { Pankti } from "../../models/Pankti";
import Tab from "../../ui/Tab";
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
    const {state, dispatch, searchInputRef, searchTerm, setSearchTerm, panktis, setPanktis} = useContext(SearchContext);
    const [focusIndex, setFocusIndex] = useState(0);
    const [showShabad, setShowShabad] = useState(false);
    const appDispatch = useContext(AppContext).dispatch;

    const appRef = useRef<number>(0);
    appRef.current++;
    // console.log("search ref: ", appRef.current);

    const handleSearchShortcuts = (event: React.KeyboardEvent<HTMLInputElement>) => {
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
        console.log(event.key);
    };

    const handleSearch = async (e: ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setSearchTerm(value);
        if (value.length < 2) {
            return;
        }

        const db = await DB.getInstance();

        db.select(`
            SELECT
                *,
                CASE
                    WHEN first_letters like '${value}' THEN 1
                    WHEN first_letters like '${value}%' THEN 2
                    WHEN first_letters like '%${value}' THEN 3
                    WHEN first_letters like '%${value}%' THEN 4
                END AS rank
            FROM lines
            WHERE
                first_letters like '%${value}%'
            ORDER BY rank
            LIMIT 100
        `).then((res: any) => {
            if (!res) {
                return;
            }

            const panktis: Pankti[] = res;
            setPanktis(panktis);
            setFocusIndex(0);
        });

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
    }, [dispatch, appDispatch]);

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
            <SearchList panktis={panktis} current={focusIndex} displayShabad={displayShabad} />
        </>
    );
};

export default SearchPanel;