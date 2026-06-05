import {
  FaBolt,
  FaCheckCircle,
  FaEye,
  FaEyeSlash,
  FaMicrophone,
  FaPaintBrush,
  FaSlidersH,
  FaTimesCircle,
  FaWindowMaximize,
  FaClipboard,
  FaClipboardCheck,
  FaLock,
  FaUnlock
} from "react-icons/fa";
import SettingInput from "../../ui/SettingInput";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ShabadTheme } from "../../ui/ShabadTheme";
import { LangType, useSettings } from "../../state/providers/SettingContext";
import { DB } from "../../utils/DB";

const languages = ["ਗੁਰਮੁਖੀ", "ਪੰਜਾਬੀ", "English", "Next Pankti"];

type Tab =
  | "visibility"
  | "search"
  | "themes"
  | "overlay"
  | "speech"
  | "automation";

const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "automation", label: "Automation", icon: FaBolt },
  { id: "speech", label: "Speech", icon: FaMicrophone },
  { id: "visibility", label: "Visibility", icon: FaEye },
  { id: "search", label: "Search", icon: FaSlidersH },
  { id: "themes", label: "Themes", icon: FaPaintBrush },
  { id: "overlay", label: "Overlay", icon: FaWindowMaximize },
];

export const SettingPanel = () => {
  const [activeTab, setActiveTab] = useState<Tab>("automation");
  const [ip, setIP] = useState<string | null>(null);
  const [mics, setMics] = useState<string[]>([]);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminUnlocking, setAdminUnlocking] = useState(false);

  const {
    micName,
    setMicName,
    autoSearch,
    setAutoSearch,
    audioStream,
    setAudioStream,
    autoNext,
    setAutoNext,
    speechRegion,
    setSpeechRegion,
    visibility,
    setVisibility,
    apiToken,
    setApiToken,
    speechUsToken,
    setSpeechUsToken,
    speechJpToken,
    setSpeechJpToken,
  } = useSettings();

  useEffect(() => {
    const fetchMics = async () => {
      try {
        const availableMics: string[] = await invoke("list_mics");
        setMics(availableMics);
      } catch (error) {
        console.error("Error fetching microphones:", error);
      }
    };

    fetchMics();
  }, []);

  useEffect(() => {
    const loadIP = async () => {
      try {
        const ip = await invoke<string>("get_local_ip");
        setIP(ip);
      } catch (err) {
        console.error("Failed to get local IP:", err);
      }
    };

    loadIP();
  }, []);

  const handleAdminToggle = async () => {
    if (adminUnlocked) {
      setAdminUnlocked(false);
      return;
    }

    try {
      setAdminUnlocking(true);

      const allowed = await invoke<boolean>("request_admin_permission");

      if (allowed) {
        setAdminUnlocked(true);
      }
    } catch (error) {
      console.error("Admin permission denied:", error);
    } finally {
      setAdminUnlocking(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <nav className="shrink-0 border-b border-gray-300 bg-gray-50 px-2 py-2">
        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;

            return (
              <button
                key={tab.id}
                title={tab.label}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm transition-all
                  ${
                    activeTab === tab.id
                      ? "bg-blue-600 text-white shadow"
                      : "text-gray-600 hover:bg-gray-200"
                  }
                `}
              >
                <Icon size={15} />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <main className="flex-1 overflow-auto p-4">
        {activeTab === "visibility" && (
          <section>
            <div className="mb-4 text-2xl font-semibold">Visibility</div>

            <div className="space-y-2">
              {languages.map((lang) => (
                <SettingInput
                  key={lang}
                  lang={lang}
                  Icon={
                    visibility[lang as LangType] === true
                      ? FaEye
                      : FaEyeSlash
                  }
                />
              ))}

              <div className="flex flex-row items-center w-full pt-2">
                <div className="flex-1 text-xl">Akhand Paath</div>
                <input
                  type="checkbox"
                  checked={visibility["Akhand Paath"]}
                  className="h-6 w-6"
                  onChange={(e) =>
                    setVisibility({
                      ...visibility,
                      ["Akhand Paath"]: e.target.checked,
                    })
                  }
                />
              </div>
            </div>
          </section>
        )}

        {activeTab === "search" && (
          <section>
            <div className="mb-4 text-2xl font-semibold">Search Panel</div>

            <div className="space-y-2">
              <SettingInput lang="Width" name="panelWidth" />
              <SettingInput lang="Height" name="panelHeight" />
            </div>
          </section>
        )}

        {activeTab === "themes" && (
          <section>
            <div className="mb-4 text-2xl font-semibold">Themes</div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <ShabadTheme name="BaniGuru" />
              <ShabadTheme name="Light" />
              <ShabadTheme name="Blue" />
              <ShabadTheme name="Dark" />
              <ShabadTheme name="Darker" />
              <ShabadTheme name="Sepia" />
              <ShabadTheme name="ShabadOs1" />
              <ShabadTheme name="ShabadOs2" />
              <ShabadTheme name="Bandi Chorh Diwas" />
              <ShabadTheme name="Guru Nanak Dev Ji" />
            </div>
          </section>
        )}

        {activeTab === "overlay" && (
          <section>
            <div className="mb-4 text-2xl font-semibold">Overlay</div>

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <InfoItem
                label="Overlay URL"
                value={`http://${ip}:54321/overlay`}
              />

              <InfoItem
                label="Settings URL"
                value={`http://${ip}:54321/settings`}
              />

              <InfoItem
                label="Database Path"
                value={DB.getDbPath()}
                isLast
              />
            </div>
          </section>
        )}

        {activeTab === "speech" && (
          <section>
            <div className="mb-4 text-2xl font-semibold">Speech</div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block">Microphone</label>
                <select
                  className="w-full rounded border border-gray-300 px-2 py-2"
                  value={micName || ""}
                  onChange={(e) => setMicName(e.target.value)}
                >
                  <option value="" disabled>
                    Select microphone
                  </option>

                  {mics.map((mic, index) => (
                    <option key={index} value={mic}>
                      {mic}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block">Region</label>
                <select
                  className="w-full rounded border border-gray-300 px-2 py-2"
                  value={speechRegion || ""}
                  onChange={(e) => setSpeechRegion(e.target.value)}
                >
                  <option value="" disabled>
                    Select Speech Region
                  </option>
                  <option value="us">United States</option>
                  <option
                    value="jp"
                    disabled={!speechJpToken?.trim()}
                  >
                    Japan {!speechJpToken?.trim() ? "(API key required first)" : ""}
                  </option>
                </select>
              </div>

              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 px-4 py-3">
                  <div className="text-lg font-medium">Admin Settings</div>
                  <div className="mt-0.5 text-sm text-gray-500">
                    API and speech tokens are protected from accidental changes.
                  </div>
                </div>

                {adminUnlocked && (
                  <div className="space-y-4 px-4 py-4">
                    <TokenInput
                      label="API Token"
                      value={apiToken}
                      onChange={setApiToken}
                    />

                    <TokenInput
                      label="Speech US Token"
                      value={speechUsToken}
                      onChange={setSpeechUsToken}
                    />

                    <TokenInput
                      label="Speech JP Token"
                      value={speechJpToken}
                      onChange={setSpeechJpToken}
                    />
                  </div>
                )}

                <div className="border-t border-gray-200 px-4 py-3">
                  <button
                    type="button"
                    onClick={handleAdminToggle}
                    disabled={adminUnlocking}
                    className={`
                      flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium
                      ${
                        adminUnlocked
                          ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          : "bg-blue-600 text-white hover:bg-blue-700"
                      }
                      ${adminUnlocking ? "cursor-not-allowed opacity-60" : ""}
                    `}
                  >
                    {adminUnlocked ? (
                      <>
                        <FaLock />
                        Lock admin settings
                      </>
                    ) : (
                      <>
                        <FaUnlock />
                        {adminUnlocking ? "Requesting admin permission..." : "Unlock admin settings"}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "automation" && (
          <section>
            <div className="mb-4 text-2xl font-semibold">Automation</div>

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <ToggleRow
                label="Auto Search"
                description="Automatically search when speech is detected."
                value={autoSearch}
                onClick={() => setAutoSearch(!autoSearch)}
              />

              <ToggleRow
                label="Auto Next"
                description="Move to the next pankti automatically."
                value={autoNext}
                onClick={() => setAutoNext(!autoNext)}
              />

              <ToggleRow
                label="Audio Stream"
                description="Enable live audio stream for recognition."
                value={audioStream}
                onClick={() => setAudioStream(!audioStream)}
                isLast
              />
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

const ToggleRow = ({
  label,
  description,
  value,
  onClick,
  isLast = false,
}: {
  label: string;
  description?: string;
  value: boolean;
  onClick: () => void;
  isLast?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`
      flex w-full items-center px-4 py-3 text-left transition-colors hover:bg-gray-50
      ${!isLast ? "border-b border-gray-200" : ""}
    `}
  >
    <div className="flex-1">
      <div className="text-lg font-medium">{label}</div>
      {description && (
        <div className="mt-0.5 text-sm text-gray-500">{description}</div>
      )}
    </div>

    <div className="ml-4 text-xl">
      {value ? (
        <FaCheckCircle className="text-green-600" />
      ) : (
        <FaTimesCircle className="text-red-700" />
      )}
    </div>
  </button>
);

const InfoItem = ({
  label,
  value,
  isLast = false,
}: {
  label: string;
  value: string;
  isLast?: boolean;
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);

    setCopied(true);

    setTimeout(() => {
      setCopied(false);
    }, 1500);
  };

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3
        ${!isLast ? "border-b border-gray-200" : ""}
      `}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-500">
          {label}
        </div>

        <div className="mt-1 break-all text-sm">
          {value}
        </div>
      </div>

      <button
        onClick={handleCopy}
        className="
          flex h-8 w-8 items-center justify-center
          rounded-md text-gray-500
          hover:bg-gray-100 hover:text-gray-700
        "
        title="Copy"
      >
        {copied ? (
          <FaClipboardCheck className="text-green-600" />
        ) : (
          <FaClipboard />
        )}
      </button>
    </div>
  );
};

const TokenInput = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {label}
      </label>

      <div className="flex overflow-hidden rounded border border-gray-300 bg-white">
        <input
          type={visible ? "text" : "password"}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 px-3 py-2 text-sm outline-none"
          placeholder={`Enter ${label}`}
        />

        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="border-l border-gray-300 px-3 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
          title={visible ? "Hide token" : "Reveal token"}
        >
          {visible ? <FaEyeSlash /> : <FaEye />}
        </button>
      </div>
    </div>
  );
};