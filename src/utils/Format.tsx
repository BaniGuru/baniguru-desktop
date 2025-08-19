const Format = {
    removeVishraams: (text: string|undefined) => {
        if (!text) {
            return "";
        }

        return text.replaceAll(/[;]|[.]|[,]/g, '');
    },
};

export default Format;