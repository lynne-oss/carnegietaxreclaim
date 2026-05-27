declare module 'react-native-background-timer' {
  const BackgroundTimer: {
    setTimeout(fn: () => void, delay: number): number;
    clearTimeout(id: number): void;
    setInterval(fn: () => void, delay: number): number;
    clearInterval(id: number): void;
  };
  export default BackgroundTimer;
}
