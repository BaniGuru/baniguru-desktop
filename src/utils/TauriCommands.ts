import { invoke } from "@tauri-apps/api/core";
import { Pankti } from "../models/Pankti";

export const updateServerPankti = async (pankti: Pankti) => {
  try {
    const updatedPankti = await invoke('update_pankti', {
      pankti: {
        gurmukhi: pankti.gurmukhi,
        punjabi: pankti.punjabi_translation ?? '',
        english: pankti.english_translation ?? '',
      },
    });

    console.log('Updated Panktis from backend:', updatedPankti);
  } catch (error) {
    console.error('Error invoking backend command:', error);
  }
};
