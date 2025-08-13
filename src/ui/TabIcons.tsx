import { useContext } from "react";
import { FaBook, FaBookOpen, FaClock, FaCog, FaSearch } from "react-icons/fa";
import { AppContext } from "../state/providers/AppProvider";
import { SET_APP_PAGE } from "../state/ActionTypes";

const TabIcons: React.FC = () => {
    const {state, dispatch} = useContext(AppContext);

    const switchTab = (tab: string) => {
        dispatch({
            type: SET_APP_PAGE,
            payload: {
                page: tab
            }
        });
    }

    return (
        <div className="flex w-full bg-gray-300">
            <div className="flex flex-row w-full">
                <button
                    className={`px-4 py-2 flex-none ${state.page === "search" ? "bg-gray-200" : "bg-gray-300"}`}
                    onClick={() => switchTab('search')}
                >
                    <FaSearch className="text-xl" />
                </button>
                <button
                    className={`px-4 py-2 flex-none ${state.page === "shabad" ? "bg-gray-200" : "bg-gray-300"}`}
                    onClick={() => switchTab('shabad')}
                >
                    <FaBookOpen className="text-xl" />
                </button>
                <button
                    className={`px-4 py-2 flex-none ${state.page === "recent" ? "bg-gray-200" : "bg-gray-300"}`}
                    onClick={() => switchTab('recent')}
                >
                    <FaClock className="text-xl" />
                </button>
                <div className="flex-1"></div>
                <button
                    className={`px-4 py-2 flex-none ${state.page === "bani" ? "bg-gray-200" : "bg-gray-300"}`}
                    onClick={() => switchTab('bani')}
                >
                    <FaBook className="text-xl" />
                </button>
                <button
                    className={`px-4 py-2 flex-none ${state.page === "settings" ? "bg-gray-200" : "bg-gray-300"}`}
                    onClick={() => switchTab('settings')}
                >
                    <FaCog className="text-xl" />
                </button>
            </div>
        </div>
    );
};

export default TabIcons;