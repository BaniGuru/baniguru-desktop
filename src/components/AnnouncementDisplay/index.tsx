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
        color: "#111111",
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
        <div className="relative w-full min-h-screen flex items-center justify-center overflow-hidden"
            style={{
                background: "linear-gradient(to bottom, #f8f6f0, #ece7db)"
            }}
        >
            {/* vwihgurU */}
            {keyAnnouncement === 0 && (
                <div
                    className="relative gurmukhi-font-1 text-center mb-[10pc]"
                    style={{ ...baseStyle, fontSize: fontSize * 3.5 }}
                >
                    vwihgurU
                </div>
            )}

            {/* mUl mMqr */}
            {keyAnnouncement === -1 && (
                <div
                    className="relative gurmukhi-font-1 text-center mb-[10pc]"
                    style={{ ...baseStyle, fontSize: `${fontSize}px` }}
                >
                    <div>{"<>siqnwmu krqw purKu inrBau inrvYru"}</div>
                    <div>Akwl mUriq AjUnI sYBM gurpRswid ]</div>
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