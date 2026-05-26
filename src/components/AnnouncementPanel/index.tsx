import { useAnnouncement } from "../../state/providers/AnnouncementProvider";

const AnnouncementPanel: React.FC = () => {
    const { setKeyAnnouncement } = useAnnouncement();

    const announcements = [
        "DMn gurU nwnk dyv jI",
        "DMn gurU AMgd dyv jI",
        "DMn gurU Amrdws swihb jI",
        "DMn gurU rwmdws swihb jI",
        "DMn gurU Arjun dyv jI",
        "DMn gurU hirgoibMd swihb jI",
        "DMn gurU hirrwie swihb jI",
        "DMn gurU hirikRSn swihb jI",
        "DMn gurU qyg bhwdr swihb jI",
        "DMn gurU goibMd isMG swihb jI",
        "DMn gurU gRMQ swihb jI",
        "Kwlsw swjnw idvs"
    ];

    return (
        <div className="flex flex-col w-full my-1 p-4 overflow-auto">
            <div className="flex flex-row gap-4">
                <div
                    className="gurmukhi-font-1 bg-gradient-to-r from-yellow-500 to-orange-600 text-white px-4 py-2 rounded-lg shadow-md hover:scale-105 transition-all duration-200 cursor-pointer font-semibold"
                    onClick={() => setKeyAnnouncement(0)}
                >
                    vwihgurU
                </div>

                <div
                    className="gurmukhi-font-1 bg-gradient-to-r from-yellow-500 to-orange-600 text-white px-4 py-2 rounded-lg shadow-md hover:scale-105 transition-all duration-200 cursor-pointer font-semibold"
                    onClick={() => setKeyAnnouncement(-1)}
                >
                    mUl mMqr
                </div>
            </div>

            <div className="flex flex-row gap-4 flex-wrap mt-4">
                {announcements.map((text, index) => (
                    <div
                        key={index}
                        className="gurmukhi-font-1 bg-gradient-to-r from-yellow-500 to-orange-600 text-white px-4 py-2 rounded-lg shadow-md hover:scale-105 transition-all duration-200 cursor-pointer font-semibold"
                        onClick={() => setKeyAnnouncement(index + 1)}
                    >
                        {text}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default AnnouncementPanel;