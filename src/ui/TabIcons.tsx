import { useContext } from "react";
import { FaSearch } from "react-icons/fa";
import styled from "styled-components";
import { AppContext } from "../state/providers/AppProvider";
import { SET_APP_PAGE } from "../state/ActionTypes";

const TabIcons: React.FC = () => {
    const dispatch = useContext(AppContext).dispatch;

    const switchTab = (tab: string) => {
        dispatch({
            type: SET_APP_PAGE,
            payload: {
                page: 'search'
            }
        });
    }

    return (
        <div className="flex w-full bg-gray-200 px-4 py-2">
            <div onClick={() => switchTab('search')} className="">
                <FaSearch />
            </div>
        </div>
    );
};

export default TabIcons;