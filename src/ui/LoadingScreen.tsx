import styled, { keyframes } from 'styled-components';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';

const LoadingScreen = ({ progress }:  any) => {
  return (
    <Container>
      <SpinnerIcon />
      {typeof progress === 'number' && (
        <ProgressText>Downloading... {Math.round(progress)}%</ProgressText>
      )}
    </Container>
  );
};

export default LoadingScreen;

// Animation
const spin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

// Styled Components
const Container = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: #f2f2f2;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 9999;
`;

const SpinnerIcon = styled(AiOutlineLoading3Quarters)`
  font-size: 48px;
  color: #555;
  animation: ${spin} 1s linear infinite;
`;

const ProgressText = styled.div`
  margin-top: 16px;
  font-size: 18px;
  color: #555;
`;
