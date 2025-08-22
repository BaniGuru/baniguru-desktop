import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";

let instance: Database | void;

let dbPath: String;

const DB = {
    schemaExists: false,

    setDbPath: (path: string) => {
        dbPath = path;
    },

    getInstance: async () => {
        if (!instance) {
            instance = await Database.load("sqlite:" + dbPath);
            await DB.addSchema(instance);            
        }

        return instance;
    },

    addSchema: async (db: Database) => {
        if (DB.schemaExists) {
            return;
        }

        await db.execute("DROP TABLE IF EXISTS search_lines;");
        await db.execute(`
            CREATE TABLE search_lines (
                id VARCHAR(4),
                shabad_id VARCHAR(3),
                source_page INTEGER,
                source_line INTEGER,
                first_letters TEXT,
                vishraam_first_letters TEXT,
                gurmukhi TEXT,
                pronunciation TEXT,
                pronunciation_information TEXT,
                type_id INTEGER,
                order_id INTEGER,
                gurmukhi_normalized TEXT
            );
        `);

        await db.execute(`
            INSERT INTO search_lines (
                id, shabad_id, source_page, source_line,
                first_letters, vishraam_first_letters, gurmukhi,
                pronunciation, pronunciation_information,
                type_id, order_id, gurmukhi_normalized
            )
            SELECT
                id, shabad_id, source_page, source_line,
                first_letters, vishraam_first_letters, gurmukhi,
                pronunciation, pronunciation_information,
                type_id, order_id,
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                REPLACE(REPLACE(REPLACE(REPLACE(
                    gurmukhi, 'w', ''), 'W', ''), 'y', ''), 'Y', ''),
                    'u', ''), 'U', ''), 'i', ''), 'I', ''),
                    'o', ''), 'O', ''), 'z', ''), 'Z', ''),
                    '.', ''), ',', ''), ';', ''), ']', ''),
                    '1', ''), '2', ''), '3', ''), '4', ''),
                    '5', ''), '6', ''), '7', ''), '8', ''),
                    '9', ''), 'Í', ''), '®', ''), '-', ''),
                    '^', ''), '¤', ''), '\`', ''), '&', ''),
                    'M', ''), '@', ''), 'R', ''), '´', '')
            FROM lines;
        `);
    },

    close: () => {
        instance?.close();
    },

    downloadDb: async () => {
        try {
            await invoke<string>('download_sqlite_file', {
                url: 'https://github.com/shabados/database/releases/download/4.8.7/database.sqlite',
            });
        } catch (error) {
            console.error('Failed to download SQLite DB:', error);
        }
    }
}

export {DB};