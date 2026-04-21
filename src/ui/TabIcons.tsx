import { useContext } from "react";
import { FaBook, FaBookOpen, FaClock, FaCog, FaComment, FaSearch } from "react-icons/fa";
import { AppContext, PAGE_ANNOUNCEMENT } from "../state/providers/AppProvider";
import { SET_APP_PAGE } from "../state/ActionTypes";
import { SearchContext } from "../state/providers/SearchProvider";

const TabIcons: React.FC = () => {
    const {state, dispatch} = useContext(AppContext);
    const { setSearchTerm } = useContext(SearchContext);

    const switchTab = (tab: string) => {
        if (tab === "search") {
            setSearchTerm('');
        }

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
                    className={`px-4 py-2 flex-none ${state.page === PAGE_ANNOUNCEMENT ? "bg-gray-200" : "bg-gray-300"}`}
                    onClick={() => switchTab(PAGE_ANNOUNCEMENT)}
                >
                    <FaComment className="text-xl" />
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