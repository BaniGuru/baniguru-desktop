import type { ThemeColors } from "../utils/useTheme";
import background from "../assets/images/guru-ramdas-ji.png";

export const GURU_RAMDAS_THEME_NAME = "Guru Ramdas Ji";

export const GURU_RAMDAS_THEME: ThemeColors = {
  gurmukhi: "#39291f",
  punjabi: "#49382b",
  english: "#574536",
  background: `#fffbed url("${background}") center / 100% 100% no-repeat`,
  vishraam: { heavy: "#b56814", medium: "#386748", light: "#386748" },
  presentation: "portrait",
};
