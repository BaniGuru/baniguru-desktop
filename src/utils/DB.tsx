import Database from "@tauri-apps/plugin-sql";

// import { appDataDir } from '@tauri-apps/api/path';
import { invoke } from "@tauri-apps/api/core";

let instance: Database;

let dbPath: String;

const DB = {
    setDbPath: (path: string) => {
        dbPath = path;
    },
    getInstance: async () => {
        if (!instance) {
            console.log('db path: ', dbPath);
            await Database.load("sqlite:" + dbPath).then((res: Database) => {
                instance = res;
                console.log(res);
                // appDataDir().then(res => console.log(res));
            });
        }

        return instance;
    },

    close: () => {
        instance.close();
    },

    downloadDb: async () => {
        try {
            console.log('downloading db');
            const dbPath = await invoke<string>('download_sqlite_file', {
                url: 'https://github.com/shabados/database/releases/download/4.8.7/database.sqlite',
            });
            console.log('SQLite DB downloaded to:', dbPath);
        } catch (error) {
            console.error('Failed to download SQLite DB:', error);
        }
    }
}

export {DB};