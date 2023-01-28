import Database from "tauri-plugin-sql-api";

let instance: Database;

const DB = {
    getInstance: async () => {
        if (!instance) {
            await Database.load("sqlite:gurbani.sqlite").then((res: Database) => {
                instance = res;
            });
        }

        return instance;
    },

    close: () => {
        instance.close();
    }
}

export {DB};