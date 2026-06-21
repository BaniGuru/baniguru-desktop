import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { SearchContext } from "../../state/providers/SearchProvider";
import { SEARCH_SHABAD_PANKTI, SET_APP_PAGE, SHABAD_PANKTI, SHABAD_RESET, TOGGLE_PANEL } from "../../state/ActionTypes";
import styled from "styled-components";
import { Pankti } from "../../models/Pankti";
import { MdOutlineClear } from "react-icons/md";
import { BsKeyboard } from "react-icons/bs";
import SearchList from "./SearchList";
import { AppContext } from "../../state/providers/AppProvider";
import { useContextSelector } from "use-context-selector";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { useGurbaniSearch } from "../../utils/useGurbaniSearch";

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

const SearchPanel: React.FC = () => {
    const {dispatch, searchInputRef, searchTerm, setSearchTerm, panktis} = useContext(SearchContext);
    const {dispatch: appDispatch, fontSize, state} = useContext(AppContext);
    const [searchCleared, setSearchCleared] = useState(false);
    const { dispatch: shabadDispatch, shabadId, panktis: ShabadPanktis } = useContextSelector(
        ShabadContext,
        ctx => ({
            dispatch: ctx.dispatch,
            shabadId: ctx.state.shabadId,
            panktis: ctx.state.panktis
        })
    );
    const {
        listContainerRef,
        focusIndex,
        setFocusIndex,
    } = useGurbaniSearch();

    const appRef = useRef<number>(0);
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
                    setTimeout(() => {
                        searchInputRef.current?.setSelectionRange(start + 1, start + 1);
                    }, 0);
                }

                return;
            }


        if (event.key === 'c' && event.ctrlKey && searchInputRef?.current?.value) {
            setSearchTerm('');
            event.preventDefault();
        }

        if (event.key === 'a' && event.ctrlKey && searchInputRef.current) {
            searchInputRef.current.select();
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

    const clearSearch = useCallback(() => {
        if (searchInputRef.current !== null) {
            searchInputRef.current.value = "";
            searchInputRef.current.focus();
        }

        setSearchTerm("");
    }, [searchInputRef]);

    useEffect(() => {
        if (!searchCleared) {
            setSearchCleared(true);
            clearSearch();
        }
    }, [state.clear_search, searchCleared])

    const displayShabad = useCallback((pankti: Pankti) => {
        // current shabad
        if (pankti.shabad_id == shabadId) {
            shabadDispatch({
                type: SHABAD_PANKTI,
                payload: {
                    current: ShabadPanktis.findIndex(sPankti => sPankti.id === pankti.id),
                }
            });
            appDispatch({
                type: SET_APP_PAGE,
                payload: {
                    page: "shabad",
                    show_panel: false,
                }
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
            payload: {
                page: "shabad",
                show_panel: false,
            }
        });
    }, [shabadDispatch, dispatch, appDispatch]);

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