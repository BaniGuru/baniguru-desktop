import { useContext, useCallback, useEffect, useState } from "react";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { AppContext } from "../../state/providers/AppProvider";
import { DB } from "../../utils/DB";
import { Pankti } from "../../models/Pankti";
import { SET_APP_PAGE, SHABAD_UPDATE } from "../../state/ActionTypes";
import { BANI_ACTION_Add, BaniContext, BaniRecent } from "../../state/providers/BaniProvider";

type Bani = {
  id: number;
  name_gurmukhi: string;
  name_english: string;
};

export const BaniPanel = () => {
  const { state: shabadState, dispatch: shabadDispatch } = useContext(ShabadContext);
  const { state: baniState, dispatch: baniDispatch} = useContext(BaniContext);
  const { dispatch: appDispatch } = useContext(AppContext);

  const [banis, setBanis] = useState<Bani[]>([]);
  const [loadingBaniId, setLoadingBaniId] = useState<number | null>(null);
  const [loadingBanis, setLoadingBanis] = useState(false);

  // Fetch all banis on mount
  useEffect(() => {
    const fetchBanis = async () => {
      setLoadingBanis(true);
      try {
        const db = await DB.getInstance();
        const result: Bani[] = await db.select(`
          SELECT id, name_gurmukhi, name_english
          FROM banis
          ORDER BY CASE WHEN id = 13 THEN 0 ELSE 1 END, id
        `);
        setBanis(result || []);
      } catch (err) {
        console.error("Failed to fetch banis", err);
      } finally {
        setLoadingBanis(false);
      }
    };
    fetchBanis();
  }, []);

  // Load bani lines when a bani is clicked
  const loadBaniLines = useCallback(
    async (baniId: number) => {
      setLoadingBaniId(baniId);
      const index = baniState.banis.findIndex((baniRecent: BaniRecent) => baniRecent.baniId === baniId)
      if (index >= 0) {
        console.log('bani exists already');
        const bani = baniState.banis[index];
        shabadDispatch({
          type: SHABAD_UPDATE,
          payload: {
            baniId: baniId,
            panktis: bani.panktis,
            current: bani.current,
            home: bani.home
          },
        });

        appDispatch({ type: SET_APP_PAGE, payload: { page: "shabad" } });
        return;
      }

      // Save current bani position before switching
      // if (
      //   shabadState.panktis.length > 0 &&
      //   shabadState.panktis[0].bani_id != null
      // ) {
      //   saveBaniPosition(shabadState.panktis[0].bani_id, shabadState.current);
      // }

      const db = await DB.getInstance();
      const lines: any = await db.select(`
        SELECT
          lines.*,
          bani_lines.line_id,
          bani_lines.bani_id,
          punjabi.translation as punjabi_translation,
          english.translation as english_translation
        FROM bani_lines
        INNER JOIN lines ON lines.id = bani_lines.line_id
        INNER JOIN shabads ON lines.shabad_id = shabads.id
        LEFT JOIN translations AS punjabi ON lines.id = punjabi.line_id AND (
            (shabads.source_id = 1 AND punjabi.translation_source_id = 6) OR
            (shabads.source_id != 1 AND punjabi.translation_source_id IN (8, 11, 13, 15, 17, 19, 21))
        )
        LEFT JOIN translations AS english ON lines.id = english.line_id AND (
            (shabads.source_id = 1 AND english.translation_source_id = 1) OR
            (shabads.source_id != 1 AND english.translation_source_id IN (7, 9, 10, 12, 14, 16, 18, 20, 22))
        )
        WHERE bani_id = ${baniId}
        ORDER BY line_group, order_id
      `);

      if (!lines || lines.length === 0) {
        console.warn("No lines found for bani", baniId);
        return;
      }

      const panktis: Pankti[] = lines.map((line: any) => ({
        id: line.line_id,
        bani_id: line.bani_id,
        gurmukhi: line.gurmukhi,
        punjabi_translation: line.punjabi_translation,
        english_translation: line.english_translation,
        visited: false,
        home: false,
      }));

      baniDispatch({
          type: BANI_ACTION_Add,
          payload: {
          baniId: baniId,
          panktis: panktis,
          current: 0,
          home: 0,
          }
      });

      shabadDispatch({
        type: SHABAD_UPDATE,
        payload: {
          baniId: baniId,
          panktis,
          current: 0,
        },
      });

      appDispatch({ type: SET_APP_PAGE, payload: { page: "shabad" } });
    },
    [shabadDispatch, appDispatch, baniDispatch, shabadState, BANI_ACTION_Add]
  );

  if (loadingBanis) {
    return <div className="p-4 text-center text-gray-600">Loading Banis...</div>;
  }

  return (
    <div className="p-4 flex flex-col h-full">
      <ul className="space-y-3 overflow-auto flex-1 gurmukhi-font-2">
        {banis.map((bani) => (
          <li
            key={bani.id}
            className={`cursor-pointer text-gray-700 hover:text-gray-900 border-b border-gray-200 pb-2 gurmukhi-font ${
              loadingBaniId === bani.id ? "opacity-50 pointer-events-none" : ""
            }`}
            onClick={() => loadBaniLines(bani.id)}
            title={bani.name_english}
          >
            {bani.name_gurmukhi}
          </li>
        ))}
      </ul>

      {loadingBaniId && (
        <div className="text-center mt-2 text-gray-600">Loading bani...</div>
      )}
    </div>
  );
};

export default BaniPanel;
