import { createContext, useContext, useState, ReactNode } from "react";

type AnnouncementContextType = {
  keyAnnouncement: number;
  setKeyAnnouncement: (key: number) => void;
  textAnnouncement: string;
  setTextAnnouncement: (text: string) => void;
};

const AnnouncementContext = createContext<AnnouncementContextType>({
  keyAnnouncement: 0,
  setKeyAnnouncement: () => {},
  textAnnouncement: "",
  setTextAnnouncement: () => {},
});

export const AnnouncementProvider = ({ children }: { children: ReactNode }) => {
  const [keyAnnouncement, setKeyAnnouncement] = useState<number>(0);
  const [textAnnouncement, setTextAnnouncement] = useState("");

  return (
    <AnnouncementContext.Provider
      value={{
        keyAnnouncement,
        setKeyAnnouncement,
        textAnnouncement,
        setTextAnnouncement,
      }}
    >
      {children}
    </AnnouncementContext.Provider>
  );
};

export const useAnnouncement = () => {
  const context = useContext(AnnouncementContext);
  if (!context) {
    throw new Error("useAnnouncement must be used within AnnouncementProvider");
  }
  return context;
};