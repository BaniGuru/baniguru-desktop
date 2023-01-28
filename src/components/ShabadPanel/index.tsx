import React, { ChangeEvent, Fragment, FunctionComponent, createRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { SearchContext } from "../../state/providers/SearchProvider";
import { GURBANI_SEARCH } from "../../state/ActionTypes";
import styled from "styled-components";
import { DB } from "../../utils/DB";
import { Pankti } from "../../models/Pankti";
import Tab from "../../ui/Tab";
import { MdClear, MdOutlineClear } from "react-icons/md";
import { BsKeyboard } from "react-icons/bs";
import ShabadList from "./ShabadList";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import TabIcons from "../../ui/TabIcons";

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
    margin-top: 3px;
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

const ShabadPanel: FunctionComponent = () => {
    const state = useContext(ShabadContext).state;

    console.log(state);

    const appRef = useRef<number>(0);
    appRef.current++;

    console.log("SHABAD PANEL ref: ", appRef.current);

    return (
        <Tab>
            <ShabadList />
            <TabIcons />
        </Tab>
    );
};

export default ShabadPanel;