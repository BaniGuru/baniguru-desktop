import { useCallback, useContext, useEffect, useRef } from "react";
import { ShabadContext, ShabadState } from "../../state/providers/ShabadProvider";
import { Pankti } from "../../models/Pankti";
import Format from "../../utils/Format";
import styled from "styled-components";
import { TiTick, TiTickOutline } from "react-icons/ti";
import { TbHome } from "react-icons/tb";
import { SHABAD_AUTO_NEXT, SHABAD_HOME, SHABAD_NEXT, SHABAD_PREV, SHABAD_SET_HOME, SHABAD_UPDATE } from "../../state/ActionTypes";

type ListItemProps = {
    active: boolean;
};

const List = styled.ul`
    height: 300px;
    margin-top: 12px;
    overflow-x: auto;
`;

const ListItem = styled.li<ListItemProps>`
    background: ${props => props.active ? "#dfdfdf" : "#f5f5f5"};
    color: #424242;
    cursor: default;
    font-size: 20px;
    list-style: none;
    padding: 8px 12px;
    text-align: left;
    display: flex;
`;

const VisitedStatus = styled.div`
    align-items: top;
    color: #bbb;
    display: flex;
    font-size: 16px;
    margin-left: 8px;
    margin-right: 12px;

    :hover :first-child {
        display: block;
    }

    :hover :last-child {
        display: none;
    }
`;

const VisitedChangeHomeIcon = styled(TbHome)`
    display: none;
`;

const ShabadList: React.FC = () => {
    const { state, dispatch } = useContext(ShabadContext);

    const setHome = (index: number) => {
        dispatch({
            type: SHABAD_SET_HOME,
            payload: {
                home: index,
            }
        });
    }

    useEffect(() => {
        const autoNavigate = (state: ShabadState) => {
            let shabadState = state;

            if (shabadState.pilot + 1 === shabadState.panktis.length) {
                shabadState.current = shabadState.home;
            } else {
                shabadState.pilot++;
                shabadState.current = shabadState.pilot;
                shabadState.panktis[shabadState.pilot].visited = true;
            }

            return shabadState;
        };

        const onESC = (ev: KeyboardEvent) => {
            switch (ev.key) {
                case "ArrowUp":
                    const shabadState = autoNavigate(state);
                    dispatch({ type: SHABAD_AUTO_NEXT, payload: {
                        current: shabadState.current,
                        panktis: shabadState.panktis,
                        pilot: shabadState.pilot
                    } });
                    ev.preventDefault();
                    break;
    
                case "ArrowDown":
                    dispatch({ type: SHABAD_HOME });
                    ev.preventDefault();
                    break;
    
                case "ArrowLeft":
                    dispatch({ type: SHABAD_PREV });
                    ev.preventDefault();
                    break;
    
                case "ArrowRight":
                    dispatch({ type: SHABAD_NEXT });
                    ev.preventDefault();
                    break;
    
                case " ":
                    dispatch({ type: SHABAD_HOME });
                    ev.preventDefault();
                    break;
            }
    
            ev.preventDefault();
        };

        window.addEventListener("keydown", onESC);
  
        return () => {
          window.removeEventListener("keydown", onESC);
        };
    }, [state]);

    return (
        <List>
            {
                state.panktis.map((pankti: Pankti, index: number) => {
                    return (
                        <ListItem className="gurmukhi-font-1" active={index === state.current}>
                            <VisitedStatus>
                                <VisitedChangeHomeIcon onClick={() => setHome(index)} />
                                {
                                    pankti.home ? <TbHome /> :
                                    pankti.visited ? <TiTick /> : <TiTickOutline />
                                }
                            </VisitedStatus>
                            {
                                Format.removeVishraams(pankti.gurmukhi)
                            }
                        </ListItem>
                    )
                })
            }
        </List>
    );
};

export default ShabadList;
