const DownloadBookUpdate = (() => {
    const MAX_VOLUME = 100000;

    function parseTitle(rawTitle) {
        const text = String(rawTitle || '').normalize('NFKC');
        const complete = /완결/.test(text.replace(/미\s*완결|완결\s*(?:예정|미정|아님)/g, ''));
        const resolutions = [...text.matchAll(/(\d{3,4})\s*p(?:x)?\b/gi)].map(match => `${match[1]}px`);
        const volumeText = text
            .replace(/\d{3,4}\s*p(?:x)?\b/gi, ' ')
            .replace(/\d+(?:[.,]\d+)?\s*(?:KB|MB|GB|TB|%)/gi, ' ');
        const volumes = new Set();
        const totals = [];
        const addVolume = value => {
            if (Number.isSafeInteger(value) && value > 0 && value <= MAX_VOLUME) volumes.add(value);
        };
        const addSequence = sequence => {
            const tokens = sequence.match(/\d+|[~\-～〜〰∼–—ㅡ_/,，、&・·･]/g) || [];
            for (let index = 0; index < tokens.length; index += 2) {
                const current = Number(tokens[index]);
                addVolume(current);
                if (index > 0 && /^[~\-～〜〰∼–—ㅡ_]$/.test(tokens[index - 1])) {
                    const previous = Number(tokens[index - 2]);
                    if (previous > 0 && current >= previous && current <= MAX_VOLUME) {
                        for (let volume = previous + 1; volume < current; volume++) addVolume(volume);
                    }
                }
            }
        };
        const explicit = /((?:전|총)\s*)?(\d+(?:\s*(?:권|화)?\s*[~\-～〜〰∼–—ㅡ_/,，、&・·･]\s*\d+)*)\s*(?:권|화)(?![가-힣])/g;
        for (const match of volumeText.matchAll(explicit)) {
            if (match[1]) totals.push(Number(match[2]));
            else addSequence(match[2]);
        }
        if (!volumes.size && totals.length) {
            const total = Math.max(...totals);
            if (Number.isInteger(total) && total > 0 && total <= MAX_VOLUME) {
                for (let volume = 1; volume <= total; volume++) addVolume(volume);
            }
        }
        if (!volumes.size) {
            const range = volumeText.match(/\b\d+\s*[~\-～〜〰∼–—ㅡ_]\s*\d+\b/);
            if (range) addSequence(range[0]);
            else {
                const suffix = volumeText.replace(/[[({【（]\s*완결\s*[\])}】）]|완결/g, ' ').replace(/[[\](){}【】（）]/g, ' ');
                const number = suffix.match(/(?:^|\s)(\d+)\s*$/);
                if (number) addVolume(Number(number[1]));
            }
        }
        return {
            complete,
            volumes: [...volumes].sort((a, b) => a - b),
            resolution: [...new Set(resolutions)].join(',')
        };
    }

    function updateBook(existingBook, title, metadata, missingVols = []) {
        const volumes = metadata.volumes;
        if (!metadata.complete && !volumes.length) return null;
        const previousVolume = Math.max(0, Number(existingBook?.lastVol) || 0);
        const downloadedVolume = volumes.length ? volumes[volumes.length - 1] : 0;
        const latestVolume = Math.max(previousVolume, downloadedVolume);
        const downloaded = new Set(volumes);
        const missing = new Set(missingVols.map(Number).filter(volume => Number.isSafeInteger(volume) && volume > 0));
        if (downloadedVolume > previousVolume) {
            for (let volume = Math.floor(previousVolume) + 1; volume < downloadedVolume; volume++) {
                if (!downloaded.has(volume)) missing.add(volume);
            }
        }
        for (const volume of downloaded) missing.delete(volume);
        const nextMissing = [...missing].sort((a, b) => a - b);
        const type = metadata.complete ? 'complete'
            : !existingBook || downloadedVolume > previousVolume ? 'incomplete' : existingBook.type;
        const lastVol = latestVolume ? String(latestVolume) : existingBook?.lastVol || '';
        if (existingBook && type === existingBook.type && lastVol === String(existingBook.lastVol || '')
            && JSON.stringify(nextMissing) === JSON.stringify([...new Set(missingVols.map(Number))].sort((a, b) => a - b))) return null;
        return {
            ...existingBook,
            title: existingBook?.title || title,
            type,
            lastVol,
            resolution: existingBook?.resolution || metadata.resolution,
            missingVols: nextMissing,
            date: new Date().toISOString()
        };
    }

    return { parseTitle, updateBook };
})();
