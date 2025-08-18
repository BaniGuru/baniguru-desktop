import { useContext, useEffect, useRef } from "react";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { Pankti } from "../../models/Pankti";
import Format from "../../utils/Format";
import styled from "styled-components";
import { TiTick, TiTickOutline } from "react-icons/ti";
import { TbHome } from "react-icons/tb";
import { SHABAD_PANKTI, SHABAD_SET_HOME } from "../../state/ActionTypes";

type ListItemProps = {
    active: boolean;
};

const ListItem = styled.li<ListItemProps>`
    background: ${props => props.active ? "#dfdfdf" : "#f5f5f5"};
    color: #424242;
    cursor: default;
    list-style: none;
    padding: 8px 12px;
    text-align: left;
    display: flex;
`;

const VisitedStatus = styled.div`
    align-items: center;
    color: #bbb;
    display: flex;
    font-size: 22px;
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

function smoothScrollTo(element: HTMLElement, target: number, duration: number = 800) {
    const start = element.scrollTop;
    const change = target - start;
    const startTime = performance.now();

    const animateScroll = (currentTime: number) => {
        const time = Math.min((currentTime - startTime) / duration, 1);
        const easedTime = easeInOutQuad(time);
        element.scrollTop = start + change * easedTime;

        if (time < 1) {
            requestAnimationFrame(animateScroll);
        }
    };

    requestAnimationFrame(animateScroll);
}

function easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

const ShabadPanel: React.FC = () => {
    const { state, dispatch } = useContext(ShabadContext);
    const listRef = useRef<HTMLUListElement | null>(null);
    const itemRefs = useRef<Array<HTMLLIElement | null>>([]);

    const setHome = (index: number) => {
        dispatch({
            type: SHABAD_SET_HOME,
            payload: {
                home: index,
            }
        });
    }

    const showPankti = (index: any) => {
        dispatch({ type: SHABAD_PANKTI, payload: {
            current: index
        }});
    };

    useEffect(() => {
        const container = listRef.current;
        const item = itemRefs.current[state.current];

        if (container && item) {
            const containerRect = container.getBoundingClientRect();
            const itemRect = item.getBoundingClientRect();

            const containerScrollTop = container.scrollTop;
            const offset = itemRect.top - containerRect.top;

            const targetScroll = containerScrollTop + offset - container.clientHeight / 2 + item.clientHeight / 2;

            smoothScrollTo(container, targetScroll, 800); // Duration in ms
        }
    }, [state.current]);

    return (
        <ul className="flex-1 overflow-y-auto" ref={listRef}>
            {state.panktis.map((pankti: Pankti, index: number) => (
                <ListItem
                    key={index}
                    ref={(el) => {
                        itemRefs.current[index] = el;
                    }}
                    className="gurmukhi-font-1"
                    active={index === state.current}
                    onClick={() => showPankti(index)}
                >
                    <VisitedStatus>
                        <VisitedChangeHomeIcon onClick={() => setHome(index)} />
                        {
                            index === state.home ? <TbHome /> :
                            pankti.visited ? <TiTick /> : <TiTickOutline />
                        }
                    </VisitedStatus>
                    {Format.removeVishraams(pankti.gurmukhi)}
                </ListItem>
            ))}
        </ul>
    );
};

export default ShabadPanel;
