import styled from "styled-components";
import { Pankti } from "../../models/Pankti";
import { useContext, useEffect, useRef } from "react";
import { AppContext } from "../../state/providers/AppProvider";

type SearchListProps = {
    panktis: Pankti[];
    current: number;
    displayShabad: any;
    listContainerRef: React.MutableRefObject<HTMLUListElement | null>;
    searchTerm: string;
};

const ListItem = styled.li`
    cursor: default;
    list-style: none;
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

const highlightMatch = (ang: number, gurmukhi: string, searchTerm: string) => {
  // Normalize by removing punctuation and making everything lowercase for case-insensitive comparison
  let normalizedGurmukhi = gurmukhi.replace(/[;]|[.]|[,]/g, '');

  let normalizedSearchTerm = searchTerm.toLowerCase();

  let words = normalizedGurmukhi.split(' '); // Split the text by spaces
  let highlightedText = '';
  let searchIndex = 0; // Pointer to track where we are in the searchTerm

  // Iterate over each word
  for (let i = 0; i < words.length; i++) {
    let word = words[i];

    // If the current character of the word matches the corresponding character in searchTerm
    if (searchIndex < normalizedSearchTerm.length &&
        word[0]?.toLowerCase() === normalizedSearchTerm[searchIndex] ||
        (word[0]?.toLowerCase() === 'i' && word[1]?.toLowerCase() === normalizedSearchTerm[searchIndex])
    ) {
      // Highlight this word
      highlightedText += `<span style="font-weight: bold; color: #075c90;">${word}</span>`;

      // Move to the next character in the searchTerm
      searchIndex++;
    } else {
      // If no match, just add the word as is
      highlightedText += word;
    }

    // Add space between words
    if (i < words.length - 1) {
      highlightedText += ' ';
    }
  }

  return `
    <div style="display: flex; justify-content: space-between; align-items: baseline; width: 100%;">
      <span style="flex-grow: 1;">${highlightedText}</span>
      <span style="color: #91979a; font-size: 14px; margin-left: auto; white-space: nowrap;">(AMg: ${ang})</span>
    </div>
  `;
};

const HighlightedTextComponent = ({ ang, gurmukhi, searchTerm }: any) => {
  // Get the highlighted text
  const highlightedText = highlightMatch(ang, gurmukhi, searchTerm);

  return (
    <div
      dangerouslySetInnerHTML={{ __html: highlightedText }}
    />
  );
};

const SearchList: React.FC<SearchListProps> = ({ panktis, current, displayShabad, listContainerRef, searchTerm }) => {
    
    const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
    const { fontSize } = useContext(AppContext);

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
                    className={`gurmukhi-font-1 ${current === index ? 'bg-gray-200' : 'bg-gray-100'}`}
                    onClick={() => displayShabad(pankti)}
                    style={{
                        padding: `${fontSize*0.25*0.5}px`
                    }}
                >
                    
                    <HighlightedTextComponent ang={pankti.source_page} gurmukhi={pankti.gurmukhi} searchTerm={searchTerm} />
                </ListItem>
            ))}
        </ul>
    );
};

export default SearchList;