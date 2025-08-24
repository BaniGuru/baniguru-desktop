import { useContext, useCallback } from "react";
import { RecentShabad, SearchContext } from "../../state/providers/SearchProvider";
import { AppContext } from "../../state/providers/AppProvider";
import {
  SET_APP_PAGE,
  REMOVE_RECENT_PANKTI,
  CLEAR_RECENT_PANKTIS,
  SHABAD_UPDATE,
} from "../../state/ActionTypes";
import Format from "../../utils/Format";
import { MdClose } from "react-icons/md";
import { ShabadContext } from "../../state/providers/ShabadProvider";

export const RecentPanel = () => {
  const { state, dispatch } = useContext(SearchContext);
  const { dispatch: appDispatch } = useContext(AppContext);
  const { dispatch: shabadDispatch } = useContext(ShabadContext);

  const recentShabads = state.recent as RecentShabad[] | undefined;

  const displayShabad = useCallback(
    (shabadId: string) => {
      const recentIndex = state.recent.findIndex(r => r.shabadId === shabadId);
      if (recentIndex < 0) {
        return;
      }

      const recentShabad: RecentShabad = state.recent[recentIndex];
      shabadDispatch({
          type: SHABAD_UPDATE,
          payload: {
              shabadId: recentShabad.shabadId,
              panktis: recentShabad.panktis,
              home: recentShabad.home,
              current: recentShabad.current,
          }
      });

      appDispatch({
        type: SET_APP_PAGE,
        payload: { page: "shabad" },
      });
    },
    [dispatch, appDispatch, shabadDispatch, state.recent]
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

  if (!recentShabads || recentShabads.length === 0) {
    return <div className="p-4 text-gray-600">No recent found.</div>;
  }

  return (
    <div className="flex flex-col h-full py-2">
      <div className="flex-1 overflow-auto">
        {recentShabads.map((recentShabad) => (
          <div
            key={recentShabad.pankti.id}
            className="flex justify-between items-center mb-3 cursor-pointer hover:bg-gray-100 px-2 py-1 rounded transition border-b border-gray-200"
          >
            
            <button
              onClick={() => removePankti(recentShabad.pankti.shabad_id)}
              className="mr-4 text-gray-400 hover:bg-red-500 p-1 rounded-full hover:text-white"
              title="Remove"
            >
              <MdClose />
            </button>
            <span
              onClick={() => displayShabad(recentShabad.pankti.shabad_id)}
              className="gurmukhi-font-2 text-left flex-1 text-gray-600"
              
            >
              {Format.removeVishraams(recentShabad.pankti.gurmukhi)}
            </span>
          </div>
        ))}
      </div>

      <div className="text-right relative">
        <button
          onClick={clearAll}
          className="bg-gray-600 text-white p-2 rounded-md hover:bg-red-700 transition text-sm absolute right-8 bottom-2"
        >
          Clear
        </button>
      </div>
    </div>
  );
};

export default RecentPanel;
