import React, { useState } from 'react';
import styled from 'styled-components';
import { FaWindowMinimize } from 'react-icons/fa';

type RootProps = {
    visible: boolean;
}

const Root = styled.div<RootProps>`
    position: absolute;
    right: 0;
    background: #efefef;
    height: 400px;
    width: 500px;
    box-shadow: 0px 2px 10px 0px rgb(0 0 0 / 30%);
    bottom: ${props => props.visible ? 0 : '-300px' };
`;

const Header = styled.div`
    padding: 0px;
    text-align: right;
`;

const MiniHeader = styled.div`
    position: absolute;
    display: block;
    bottom: 0;
    right: 0;
`;

const TabButton = styled.button`
    padding: 2px;
    min-width: 40px;
    margin: 6px;
    background: none;
    border: none;
    box-shadow: none;

    :hover {
        box-shadow: 0 2px 2px rgba(0, 0, 0, 0.2);
        background: #efefef;
    }
`;

const Tab: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [visible, setVisible] = useState(true);

    const toggleWindow = () => {
        setVisible(! visible);
    }

    return (
        <Root visible={visible}>
            <Header>
                <TabButton onClick={toggleWindow}>
                    <FaWindowMinimize />
                </TabButton>
            </Header>
            <MiniHeader>
                <FaWindowMinimize />
            </MiniHeader>
            { children }
        </Root>
    );
};

export default Tab;
