import { useSettings } from "../state/providers/SettingContext";

export const ShabadTheme = ({name}: {name: string}) => {
    const { activeThemeName, setActiveTheme } = useSettings();

    return <div
        onClick={() => setActiveTheme(name)}
        className={`flex mx-4 text-lg ${activeThemeName === name ? 'bg-gray-400' : 'bg-gray-200'}`}
    >
        {name}
    </div>;
}
