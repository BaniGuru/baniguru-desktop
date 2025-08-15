import { FaMinus, FaPlus } from "react-icons/fa";
import { useSettings } from "../state/providers/SettingContext";

const fontLanguages = ["ਗੁਰਮੁਖੀ", "ਪੰਜਾਬੀ", "English", "Next Pankti"];
const spacingKeys = ["Start Space", "End Space", "Content Space"];

const normalizeSpacingKey = (label: string) =>
  label.replace(" ", "").charAt(0).toLowerCase() + label.replace(" ", "").slice(1);

const SettingInput = ({
  lang,
  Icon,
}: {
  lang: string;
  Icon?: React.ElementType;
}) => {
  const {
    fontSizes,
    displaySpacing,
    updateFontSize,
    updateSpacing,
  } = useSettings();

  const isFont = fontLanguages.includes(lang);
  const isSpacing = spacingKeys.includes(lang);

  const getValue = () => {
    if (isFont) {
      return fontSizes[lang as keyof typeof fontSizes];
    }
    if (isSpacing) {
      const key = normalizeSpacingKey(lang) as keyof typeof displaySpacing;
      return displaySpacing[key];
    }
    return "";
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    if (isNaN(value)) return;
    updateValue(value);
  };

  const updateValue = (newValue: number) => {
    if (isFont) {
      updateFontSize(lang as keyof typeof fontSizes, newValue);
    } else if (isSpacing) {
      const key = normalizeSpacingKey(lang) as keyof typeof displaySpacing;
      updateSpacing(key, newValue);
    }
  };

  const increment = () => {
    const current = getValue();
    if (typeof current === "number" && current < 99) {
      updateValue(current + 1);
    }
  };

  const decrement = () => {
    const current = getValue();
    if (typeof current === "number" && current > 1) {
      updateValue(current - 1);
    }
  };

  return (
    <div className="flex flex-row items-center w-full">
      {Icon && <Icon className="mx-4 flex-none text-xl" />}
      <div className={`flex-1 text-xl ${!Icon ? 'ml-4' : ''}`}>{lang}</div>

      <button
        className="w-10 h-10 flex-none flex items-center justify-center rounded bg-gray-200 hover:bg-gray-300"
        onClick={decrement}
      >
        <FaMinus />
      </button>

      <input
        type="text"
        className="w-14 h-10 text-center border border-gray-300 flex-none"
        min={1}
        max={99}
        value={getValue()}
        onChange={handleChange}
      />

      <button
        className="w-10 h-10 mr-8 flex-none flex items-center justify-center rounded bg-gray-200 hover:bg-gray-300"
        onClick={increment}
      >
        <FaPlus />
      </button>
    </div>
  );
};

export default SettingInput;
