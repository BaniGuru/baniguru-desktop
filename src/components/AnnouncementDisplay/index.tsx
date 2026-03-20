import { useContext, useEffect, useRef, useState } from "react";
import { AppContext } from "../../state/providers/AppProvider";
import { useAnnouncement } from "../../state/providers/AnnouncementProvider";

export const AnnouncementDisplay = () => {
    const { fontSize } = useContext(AppContext);
    const { keyAnnouncement } = useAnnouncement();

    const textRef = useRef<HTMLDivElement>(null);
    const [dynamicSize, setDynamicSize] = useState(fontSize * 1.8);

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
    ];

    const baseStyle = {
        fontWeight: 900,
        color: "#d1d5db",
        textShadow: `
            0 1px 0 #ffffff40,
            0 2px 4px rgba(0,0,0,0.8),
            0 0 12px rgba(255,255,255,0.15)
        `
    };

    useEffect(() => {
        if (keyAnnouncement > 0 && textRef.current) {
            let size = fontSize * 1.8;
            const el = textRef.current;

            // reset first
            el.style.fontSize = `${size}px`;

            while (el.scrollWidth > el.clientWidth && size > 10) {
                size -= 1;
                el.style.fontSize = `${size}px`;
            }

            setDynamicSize(size);
        }
    }, [keyAnnouncement, fontSize]);

    return (
        <div className="relative w-full min-h-screen flex items-center justify-center overflow-hidden bg-[#0b1c24]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#123c4a_0%,#0b1c24_75%)]"></div>
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:20px_20px]"></div>

            {/* vwihgurU */}
            {keyAnnouncement === 0 && (
                <div
                    className="relative gurmukhi-font-1 text-center mb-[10pc]"
                    style={{ ...baseStyle, fontSize: fontSize * 2.8 }}
                >
                    vwihgurU
                </div>
            )}

            {/* mUl mMqr */}
            {keyAnnouncement === -1 && (
                <div
                    className="relative gurmukhi-font-1 text-center mb-[10pc]"
                    style={{ ...baseStyle, fontSize }}
                >
                    <div>{"<> siqnwmu krqw purKu inrBau inrvYru"}</div>
                    <div>Akwl mUriq AjUnI sYBM gur pRswid ]</div>
                </div>
            )}

            {/* Guru announcements */}
            {keyAnnouncement > 0 && (
                <div className="w-full px-6">
                    <div
                        ref={textRef}
                        className="relative gurmukhi-font-1 text-center mb-[10pc] whitespace-nowrap overflow-hidden"
                        style={{
                            ...baseStyle,
                            fontSize: dynamicSize
                        }}
                    >
                        {announcements[keyAnnouncement - 1]}
                    </div>
                </div>
            )}
        </div>
    );
};