import { invoke } from "@tauri-apps/api/core";
import { Pankti } from "../models/Pankti";

export const updateServerPankti = async (pankti: Pankti, page: string) => {
  try {
    await invoke('update_pankti', {
      pankti: {
        gurmukhi: pankti.gurmukhi,
        punjabi: pankti.punjabi_translation ?? '',
        english: pankti.english_translation ?? '',
        page: page ?? '',
      },
    });
  } catch (error) {
    console.error('Error invoking backend command:', error);
  }
};
