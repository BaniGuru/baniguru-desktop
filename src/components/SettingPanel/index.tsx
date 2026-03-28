import { FaCheckCircle, FaEye, FaEyeSlash, FaTimesCircle } from "react-icons/fa";
import SettingInput from "../../ui/SettingInput";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ShabadTheme } from "../../ui/ShabadTheme";
import { LangType, useSettings } from "../../state/providers/SettingContext";
import { DB } from "../../utils/DB";

const languages = ["ਗੁਰਮੁਖੀ", "ਪੰਜਾਬੀ", "English", "Next Pankti"];

export const SettingPanel = () => {
  const [ip, setIP] = useState<string | null>(null);
  const [mics, setMics] = useState<string[]>([]);
  const {micName, setMicName, autoSearch, setAutoSearch} = useSettings();
  
  const { visibility, setVisibility } = useSettings();

  useEffect(() => {
    const fetchMics = async () => {
      try {
        const availableMics: any = await invoke<{ name: string }[]>("list_mics");
        setMics(availableMics);
      } catch (error) {
        console.error('Error fetching microphones:', error);
      }
    };

    fetchMics();
  }, []);

  useEffect(() => {
    invoke<string>('get_local_ip')
      .then(setIP);
  }, []);

  return (
    <div className="flex w-full flex-col my-4 space-y-2 overflow-auto">
      <div className="text-2xl ml-4">Visibility</div>
      {languages.map((lang) => (
        <SettingInput key={lang} lang={lang} Icon={visibility[lang as LangType] === true ? FaEye : FaEyeSlash} />
      ))}

      <hr />
      <div className="text-xl ml-4">Search Panel</div>
      <SettingInput lang="Width" name="panelWidth" />
      <SettingInput lang="Height" name="panelHeight" />

      <hr />

      <div className="text-2xl ml-4">Themes</div>
      <ShabadTheme name="Light" />
      <ShabadTheme name="Blue" />
      <ShabadTheme name="Dark" />
      <ShabadTheme name="Darker" />
      <ShabadTheme name="Sepia" />
      <ShabadTheme name="ShabadOs1" />
      <ShabadTheme name="ShabadOs2" />
      <ShabadTheme name="Bandi Chorh Diwas" />
      <ShabadTheme name="Guru Nanak Dev Ji" />

      <div className="flex flex-row items-center w-full">
        <div className={`flex-1 text-xl`}>Akhand Paath</div>
        <input
          type="checkbox"
          checked={visibility["Akhand Paath"]}
          className="w-14 h-10 text-center border border-gray-300 flex-none"
          onChange={(e) =>
            setVisibility({
              ...visibility,
              ["Akhand Paath"]: e.target.checked,
            })
          }
        />
      </div>

      <hr />
      <div className="text-2xl ml-4">Overlay</div>
      <div className="text-lg ml-4 flex">
        <div className="mr-2">Url: </div>
        <div>http://{ip}:54321/overlay</div>
      </div>
      <div className="text-lg ml-4 flex">
        <div className="mr-2">Settings: </div>
        <div>http://{ip}:54321/settings</div>
      </div>
      <div className="text-lg ml-4 flex">
        <div className="mr-2">Database: </div>
        <div>{DB.getDbPath()}</div>
      </div>
      <select onChange={(e) => setMicName(e.target.value)} value={micName || ''}>
        <option value='' disabled>Select a microphone</option>
        {mics.map((mic, index) => (
          <option key={index} value={mic}>
            {mic}
          </option>
        ))}
      </select>
      <div className="flex flex-row items-center w-full px-4">
        <div className={`flex-1 text-xl`}>Auto search</div>
        <div className="flex text-xl" onClick={() => setAutoSearch(!autoSearch)}>
          {
            autoSearch ? <FaCheckCircle className="text-green-600" /> : <FaTimesCircle className="text-black-400" />
          }
        </div>
      </div>
    </div>
  );
};