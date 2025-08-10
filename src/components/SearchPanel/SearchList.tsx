import styled from "styled-components";
import { Pankti } from "../../models/Pankti";
import { useEffect, useRef } from "react";

type SearchListProps = {
    panktis: Pankti[];
    current: number;
    displayShabad: any;
};

const ListItem = styled.li`
    cursor: default;
    font-size: 20px;
    list-style: none;
    padding: 12px;
    text-align: left;
    border-top: 1px solid #ccc;
`;

function smoothScrollTo(element: HTMLElement, target: number, duration: number = 500) {
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

const SearchList: React.FC<SearchListProps> = ({ panktis, current, displayShabad }) => {
    

    const listContainerRef = useRef<HTMLUListElement | null>(null);
    const itemRefs = useRef<Array<HTMLLIElement | null>>([]);

    useEffect(() => {
        const container = listContainerRef.current;
        const item = itemRefs.current[current];

        if (container && item) {
            const containerRect = container.getBoundingClientRect();
            const itemRect = item.getBoundingClientRect();

            const containerScrollTop = container.scrollTop;
            const offset = itemRect.top - containerRect.top;

            const scrollTo = containerScrollTop + offset - container.clientHeight / 2 + item.clientHeight / 2;

            smoothScrollTo(container, scrollTo, 1000);
        }
    }, [current]);

    return (
        <ul ref={listContainerRef} className="flex-1 flex flex-col overflow-y-auto">
            {panktis.map((pankti, index) => (
                <ListItem
                    key={index}
                    ref={(el) => {
                        itemRefs.current[index] = el;
                    }}
                    className={`gurmukhi-font-1 ${current === index ? 'bg-gray-200' : 'bg-white'}`}
                    onClick={() => displayShabad(pankti)}
                >
                    {pankti.gurmukhi.replaceAll(/[;]|[.]|[,]/g, '')}
                </ListItem>
            ))}
        </ul>
    );
};

export default SearchList;