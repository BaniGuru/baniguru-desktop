import { useContext } from "react";
import { FaSearch } from "react-icons/fa";
import styled from "styled-components";
import { AppContext } from "../state/providers/AppProvider";
import { SET_APP_PAGE } from "../state/ActionTypes";

const Root = styled.div`
    bottom: 0;
    left: 0;
    position: absolute;
`;

const TabButton = styled.div`
    padding: 12px;
    background: #e0e0e0;
`;

const SearchIcon = styled(FaSearch)`
    padding: 0px 4px;
`;

const TabIcons: React.FC = () => {
    const dispatch = useContext(AppContext).dispatch;

    const switchTab = (tab: string) => {
        dispatch({
            type: SET_APP_PAGE,
            payload: {
                page: 'search'
            }
        });
    }

    return (
        <Root>
            <TabButton onClick={() => switchTab('search')}>
                <SearchIcon />
            </TabButton>
        </Root>
    );
};

export default TabIcons;