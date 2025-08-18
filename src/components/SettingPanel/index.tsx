import { FaEye } from "react-icons/fa";
import SettingInput from "../../ui/SettingInput";

const languages = ["ਗੁਰਮੁਖੀ", "ਪੰਜਾਬੀ", "English", "Next Pankti"];

export const SettingPanel = () => {
  return (
    <div className="flex w-full flex-col my-4 space-y-2 overflow-auto">
      <div className="text-2xl ml-4">Visibility</div>
      {languages.map((lang) => (
        <SettingInput key={lang} lang={lang} Icon={FaEye} />
      ))}

      <hr />
      <div className="text-xl ml-4">Search Panel</div>
      <SettingInput lang="Width" name="panelWidth" />
      <SettingInput lang="Height" name="panelHeight" />
      <SettingInput lang="Font Size" name="panelFontSize" />

      <hr />
      <div className="text-2xl ml-4">Display</div>
      <SettingInput lang="Start Space" />
      <SettingInput lang="End Space" />
      <SettingInput lang="Left Space" />
      <SettingInput lang="Gurmukhi Space" />
      <SettingInput lang="Translation Space" />
    </div>
  );
};