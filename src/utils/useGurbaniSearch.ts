import { useContext, useEffect, useRef, useState } from "react";
import { SearchContext } from "../state/providers/SearchProvider";
import { DB } from "./DB";
import { Pankti } from "../models/Pankti";
import { GURBANI_SEARCH, SET_PANKTIS } from "../state/ActionTypes";

export function useGurbaniSearch() {
    const {dispatch, searchTerm, panktis} = useContext(SearchContext);

    const [focusIndex, setFocusIndex] = useState(0);
    const searchRequestId = useRef(0);
    const listContainerRef = useRef<HTMLUListElement | null>(null);

    const addBaniTags = (rows: any[]): Pankti[] => rows.map(row => ({
        ...row,
        bani_ids: (row.bani_ids_csv || "")
            .split("|")
            .filter(Boolean)
            .map((id: string) => Number(id)),
        bani_names: (row.bani_names_csv || "")
            .split("|")
            .filter(Boolean),
    }));

    useEffect(() => {
        if (!searchTerm || searchTerm.length < 2) {
            return;
        }

        handleSearch(searchTerm);
    }, [searchTerm]);

    const searchByFirstLetters = async (value: string, requestId: number) => {
        const db = await DB.getInstance();
        db.select(`
            SELECT
                lines.*,
                (
                    SELECT GROUP_CONCAT(bani_lines.bani_id, '|')
                    FROM bani_lines
                    WHERE bani_lines.line_id = lines.id
                ) AS bani_ids_csv,
                (
                    SELECT GROUP_CONCAT(banis.name_gurmukhi, '|')
                    FROM bani_lines
                    INNER JOIN banis ON banis.id = bani_lines.bani_id
                    WHERE bani_lines.line_id = lines.id
                ) AS bani_names_csv,
                CASE
                    WHEN first_letters like '${value}' THEN 1
                    WHEN first_letters like '${value}%' THEN 2
                    WHEN first_letters like '%${value}' THEN 3
                    WHEN first_letters like '%${value}%' THEN 4
                    ELSE 5
                END AS rank
            FROM lines
            INNER JOIN shabads ON lines.shabad_id = shabads.id
            WHERE
                first_letters like '%${value}%'
            ORDER BY shabads.source_id, rank
            LIMIT 100
        `).then((res: any) => {
            // Ignore if not latest search request
            if (requestId !== searchRequestId.current) return;

            if (!res) {
                return;
            }

            const panktis = addBaniTags(res);
            dispatch({
                type: SET_PANKTIS,
                payload: panktis
            });
            setFocusIndex(0);
            if (listContainerRef.current) {
                listContainerRef.current.scrollTo({
                    top: 0
                })
            }
        });
    }

    const searchByWords = async (value: string, requestId: number) => {
        const searchValue = value.trim();
        const db = await DB.getInstance();
        db.select(`
            SELECT
                search_lines.*,
                (
                    SELECT GROUP_CONCAT(bani_lines.bani_id, '|')
                    FROM bani_lines
                    WHERE bani_lines.line_id = search_lines.id
                ) AS bani_ids_csv,
                (
                    SELECT GROUP_CONCAT(banis.name_gurmukhi, '|')
                    FROM bani_lines
                    INNER JOIN banis ON banis.id = bani_lines.bani_id
                    WHERE bani_lines.line_id = search_lines.id
                ) AS bani_names_csv,
                CASE
                    WHEN TRIM(gurmukhi_normalized) LIKE CONCAT('${searchValue}') THEN 1
                    WHEN TRIM(gurmukhi_normalized) LIKE CONCAT('${searchValue}', '%') THEN 2
                    WHEN TRIM(gurmukhi_normalized) LIKE CONCAT('% ', '${searchValue}') THEN 3
                    WHEN TRIM(gurmukhi_normalized) LIKE CONCAT('% ', '${searchValue}', '%') THEN 4
                    ELSE 5
                END AS rank
            FROM search_lines
            INNER JOIN shabads ON search_lines.shabad_id = shabads.id
            WHERE
                TRIM(gurmukhi_normalized) LIKE CONCAT('${searchValue}') OR
                TRIM(gurmukhi_normalized) LIKE CONCAT('${searchValue}', '%') OR
                TRIM(gurmukhi_normalized) LIKE CONCAT('% ', '${searchValue}') OR
                TRIM(gurmukhi_normalized) LIKE CONCAT('% ', '${searchValue}', '%')
            ORDER BY rank, shabads.source_id
            LIMIT 100
        `).then((res: any) => {
            // Ignore if not latest search request
            if (requestId !== searchRequestId.current) return;

            if (!res) {
                return;
            }

            const panktis = addBaniTags(res);
            dispatch({
                type: SET_PANKTIS,
                payload: panktis
            });
            setFocusIndex(0);
            if (listContainerRef.current) {
                listContainerRef.current.scrollTo({
                    top: 0
                })
            }
        });
    };

    const handleSearch = async (value: string) => {
        if (value.length < 2) {
            return;
        }

        const currentRequestId = ++searchRequestId.current;

        if (value.includes(' ')) {
            await searchByWords(value, currentRequestId);
        } else {
            await searchByFirstLetters(value, currentRequestId);
        }

        dispatch({
            type: GURBANI_SEARCH,
            payload: {
                searchTerm: value
            }
        });
    }

    return {
        listContainerRef,
        focusIndex,
        setFocusIndex,
        panktis,
    }
};
