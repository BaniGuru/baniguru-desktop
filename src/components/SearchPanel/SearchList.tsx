import styled from "styled-components";
import { Pankti } from "../../models/Pankti";
import { useCallback, useContext, useRef } from "react";
import { SearchContext } from "../../state/providers/SearchProvider";
import { SEARCH_SHABAD_PANKTI, SET_APP_PAGE } from "../../state/ActionTypes";
import { AppContext } from "../../state/providers/AppProvider";

type SearchListProps = {
    panktis: Pankti[]
}

const List = styled.ul`
    height: 250px;
    margin-top: 12px;
    overflow-x: auto;
`;

const ListItem = styled.li`
    background: white;
    cursor: default;
    font-size: 20px;
    list-style: none;
    padding: 12px;
    text-align: left;
    border-top: 1px solid #ccc;
`;

const SearchList: React.FC<SearchListProps> = (props) => {
    const { panktis } = props;
    const {state, dispatch} = useContext(SearchContext);
    const appDispatch = useContext(AppContext).dispatch;

    const displayShabad = useCallback((pankti: Pankti) => {
        dispatch({
            type: SEARCH_SHABAD_PANKTI,
            payload: {
                pankti: pankti
            }
        });

        appDispatch({
            type: SET_APP_PAGE,
            payload: {
                page: "shabad",
            }
        });
    }, []);

    const appRef = useRef<number>(0);
    appRef.current++;
    console.log("search list ref: ", appRef.current);

    return (
        <List>
            {
                panktis.map((pankti: Pankti) => {
                    return (
                        <ListItem className="gurmukhi-font-1" onClick={() => displayShabad(pankti)}>
                            {pankti.gurmukhi.replaceAll(/[;]|[.]|[,]/g, '')}
                        </ListItem>
                    )
                })
            }
        </List>
    );
}

export default SearchList;