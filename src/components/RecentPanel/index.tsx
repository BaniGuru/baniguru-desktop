import { useContext, useCallback } from "react";
import { SearchContext } from "../../state/providers/SearchProvider";
import { AppContext } from "../../state/providers/AppProvider";
import {
  SEARCH_SHABAD_PANKTI,
  SET_APP_PAGE,
  REMOVE_RECENT_PANKTI,
  CLEAR_RECENT_PANKTIS,
} from "../../state/ActionTypes";
import Format from "../../utils/Format";
import { Pankti } from "../../models/Pankti";
import { MdClose } from "react-icons/md";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { saveBaniPosition } from "../../utils/BaniPositionTracker";

export const RecentPanel = () => {
  const { state, dispatch } = useContext(SearchContext);
  const { dispatch: appDispatch } = useContext(AppContext);
  const { state: shabadState } = useContext(ShabadContext);

  const recentPanktis = state.recent as Pankti[] | undefined;

  const displayShabad = useCallback(
    (pankti: Pankti) => {
      // Save bani position if in a bani
      if (shabadState.panktis.length > 0 && shabadState.panktis[0].bani_id != null) {
        saveBaniPosition(shabadState.panktis[0].bani_id, shabadState.current);
      }

      dispatch({
        type: SEARCH_SHABAD_PANKTI,
        payload: { pankti },
      });

      appDispatch({
        type: SET_APP_PAGE,
        payload: { page: "shabad" },
      });
    },
    [dispatch, appDispatch]
  );

  const removePankti = useCallback(
    (id: string) => {
      dispatch({
        type: REMOVE_RECENT_PANKTI,
        payload: { id },
      });
    },
    [dispatch]
  );

  const clearAll = useCallback(() => {
    dispatch({ type: CLEAR_RECENT_PANKTIS });
  }, [dispatch]);

  if (!recentPanktis || recentPanktis.length === 0) {
    return <div className="p-4 text-gray-600">No recent found.</div>;
  }

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        {recentPanktis.map((pankti) => (
          <div
            key={pankti.id}
            className="flex justify-between items-center mb-3 cursor-pointer hover:bg-gray-100 px-2 py-1 rounded transition border-b border-gray-200"
          >
            <span
              onClick={() => displayShabad(pankti)}
              className="gurmukhi-font-2 text-left flex-1"
              
            >
              {Format.removeVishraams(pankti.gurmukhi)}
            </span>
            <button
              onClick={() => removePankti(pankti.id)}
              className="mr-2 text-gray-400 hover:text-red-500"
              title="Remove"
            >
              <MdClose />
            </button>
          </div>
        ))}
      </div>

      <div className="pt-4 text-right">
        <button
          onClick={clearAll}
          className="bg-gray-600 text-white p-2 rounded-md hover:bg-red-700 transition text-sm"
        >
          Clear All
        </button>
      </div>
    </div>
  );
};

export default RecentPanel;
