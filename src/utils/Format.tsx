type VishraamStyles = {
    heavy: React.CSSProperties;
    medium: React.CSSProperties;
    light: React.CSSProperties;
};

// Helper to convert a JS style object to a valid inline style string
const styleToString = (styleObj: React.CSSProperties): string => {
    return Object.entries(styleObj)
        .map(([key, value]) => `${camelToKebab(key)}:${value}`)
        .join('; ');
};

// Converts camelCase to kebab-case
const camelToKebab = (str: string): string =>
    str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

const Format = {
    removeVishraams: (text: string|undefined) => {
        if (!text) {
            return "";
        }

        return text.replaceAll(/[;]|[.]|[,]/g, '');
    },
    formatVishraams: (
        text: string | undefined,
        styles: VishraamStyles
    ): string => {
        if (!text) return "";

        const words = text.split(/\s+/);
        const formattedWords = words.map(word => {
            if (word.endsWith(';')) {
                return `<span style="${styleToString(styles.heavy)}">${word.slice(0, -1)}</span>`;
            } else if (word.endsWith('.')) {
                return `<span style="${styleToString(styles.medium)}">${word.slice(0, -1)}</span>`;
            } else if (word.endsWith(',')) {
                return `<span style="${styleToString(styles.light)}">${word.slice(0, -1)}</span>`;
            } else {
                return `<span>${word}</span>`;
            }
        });

        return formattedWords.join('&nbsp;');
    }
};

export default Format;