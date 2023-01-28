import React, { ChangeEvent, Fragment, FunctionComponent, createRef, useCallback, useContext, useMemo, useRef, useState } from "react";
import { SearchContext } from "../../state/providers/SearchProvider";
import { GURBANI_SEARCH, SET_APP_PAGE } from "../../state/ActionTypes";
import styled from "styled-components";
import { DB } from "../../utils/DB";
import { Pankti } from "../../models/Pankti";
import Tab from "../../ui/Tab";
import { MdOutlineClear } from "react-icons/md";
import { BsKeyboard } from "react-icons/bs";
import SearchList from "./SearchList";

const SearchInput = styled.input`
    font-size: 18px;
    width: 100%;
    border-radius: 30px;
    margin: 0px 44px 0px 12px;
`;

const SearchButton = styled.button`
    background: #f0f0f0;
    border-radius: 30px;
    color: #444;
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
    background: none;
    color: #444;
    font-size: 24px;
    padding: 2px 6px;
    position: absolute;
    right: 4px;
    margin-top: 8px;
    box-shadow: none;
`;

const Row = styled.div`
    display: flex;
`;

const SearchPanel: FunctionComponent = () => {
    const {state, dispatch} = useContext(SearchContext);
    const [panktis, setPanktis] = useState<Pankti[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const searchInputRef = createRef<HTMLInputElement>();

    const appRef = useRef<number>(0);
    appRef.current++;
    console.log("search ref: ", appRef.current);

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

    return (
        <Tab>
            <Row>
                <SearchInput
                    ref={searchInputRef}
                    type="text"
                    onChange={handleSearch}
                    className="gurmukhi-font-1"
                    spellCheck="false"
                    autoComplete="off"
                />
                { searchTerm.length > 0 &&
                    <SearchButton title="search" onClick={clearSearch}>
                        <SearchIcon />
                    </SearchButton>
                }

                <KeyboardButton>
                    <BsKeyboard />
                </KeyboardButton>
            </Row>
            <SearchList panktis={panktis} />
        </Tab>
    );
};

export default SearchPanel;