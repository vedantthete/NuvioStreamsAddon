// xprime.js
require('dotenv').config(); // To access process.env
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios'); // For making HTTP requests including HEAD requests
const crypto = require('crypto'); // For hashing URLs

const XPRIME_PROXY_URL = process.env.XPRIME_PROXY_URL;
const MAX_RETRIES_XPRIME = 3;
const RETRY_DELAY_MS_XPRIME = 1000;

// Determine cache directory based on environment
// Use /tmp/.cache when running on Vercel, otherwise use local .cache directory
const CACHE_DIR = process.env.VERCEL ? path.join('/tmp', '.cache') : path.join(__dirname, '.cache');

// Ensure cache directories exist
const ensureCacheDir = async (dirPath) => {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') {
            console.warn(`[Xprime.tv] Warning: Could not create cache directory ${dirPath}: ${error.message}`);
        }
    }
};

// Cache helpers
const getFromCache = async (cacheKey, subDir = '') => {
    if (process.env.DISABLE_CACHE === 'true') {
        console.log(`[Xprime.tv] CACHE DISABLED: Skipping read for ${path.join(subDir, cacheKey)}`);
        return null;
    }
    const cachePath = path.join(CACHE_DIR, subDir, cacheKey);
    try {
        const data = await fs.readFile(cachePath, 'utf-8');
        console.log(`[Xprime.tv] CACHE HIT for: ${path.join(subDir, cacheKey)}`);
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn(`[Xprime.tv] CACHE READ ERROR for ${cacheKey}: ${error.message}`);
        }
        return null;
    }
};

const saveToCache = async (cacheKey, content, subDir = '') => {
    if (process.env.DISABLE_CACHE === 'true') {
        console.log(`[Xprime.tv] CACHE DISABLED: Skipping write for ${path.join(subDir, cacheKey)}`);
        return;
    }
    const fullSubDir = path.join(CACHE_DIR, subDir);
    await ensureCacheDir(fullSubDir);
    const cachePath = path.join(fullSubDir, cacheKey);
    try {
        const dataToSave = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
        await fs.writeFile(cachePath, dataToSave, 'utf-8');
        console.log(`[Xprime.tv] SAVED TO CACHE: ${path.join(subDir, cacheKey)}`);
    } catch (error) {
        console.warn(`[Xprime.tv] CACHE WRITE ERROR for ${cacheKey}: ${error.message}`);
    }
};

// Helper function to fetch stream size using a HEAD request
const fetchStreamSize = async (url) => {
    const cacheSubDir = 'xprime_stream_sizes';
    
    // Create a hash of the URL to use as the cache key, instead of the URL itself
    // This avoids problems with very long URLs
    const urlHash = crypto.createHash('md5').update(url).digest('hex');
    const urlCacheKey = `${urlHash}.txt`;

    const cachedSize = await getFromCache(urlCacheKey, cacheSubDir);
    if (cachedSize !== null) { // Check for null specifically, as 'Unknown size' is a valid cached string
        return cachedSize;
    }

    try {
        // For m3u8, Content-Length is for the playlist file, not the stream segments.
        if (url.toLowerCase().includes('.m3u8')) {
            await saveToCache(urlCacheKey, 'Playlist (size N/A)', cacheSubDir);
            return 'Playlist (size N/A)'; // Indicate HLS playlist
        }
        
        // Use dynamic import for node-fetch within the function that actually makes the request
        const { default: fetch } = await import('node-fetch');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5-second timeout
        
        try {
            const response = await fetch(url, { 
                method: 'HEAD',
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            if (response.headers.has('content-length')) {
                const sizeInBytes = parseInt(response.headers.get('content-length'), 10);
                if (!isNaN(sizeInBytes)) {
                    let formattedSize;
                    if (sizeInBytes < 1024) formattedSize = `${sizeInBytes} B`;
                    else if (sizeInBytes < 1024 * 1024) formattedSize = `${(sizeInBytes / 1024).toFixed(2)} KB`;
                    else if (sizeInBytes < 1024 * 1024 * 1024) formattedSize = `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`;
                    else formattedSize = `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
                    
                    await saveToCache(urlCacheKey, formattedSize, cacheSubDir);
                    return formattedSize;
                }
            }
            await saveToCache(urlCacheKey, 'Unknown size', cacheSubDir);
            return 'Unknown size';
        } finally {
            clearTimeout(timeoutId);
        }
    } catch (error) {
        console.warn(`[Xprime.tv] Could not fetch size for ${url.substring(0, 50)}... : ${error.message}`);
        // Cache the error/unknown result too, to prevent re-fetching a known problematic URL quickly
        await saveToCache(urlCacheKey, 'Unknown size', cacheSubDir);
        return 'Unknown size';
    }
};

const BROWSER_HEADERS_XPRIME = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Upgrade-Insecure-Requests': '1',
    'Connection': 'keep-alive'
};

async function fetchWithRetryXprime(url, options, maxRetries = MAX_RETRIES_XPRIME) {
    const { default: fetch } = await import('node-fetch');
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                let errorBody = '';
                try { errorBody = await response.text(); } catch (e) { /* ignore */ }
                throw new Error(`HTTP error! Status: ${response.status} ${response.statusText}. Body: ${errorBody.substring(0, 200)}`);
            }
            return response;
        } catch (error) {
            lastError = error;
            console.warn(`[Xprime.tv] Fetch attempt ${attempt}/${maxRetries} failed for ${url}: ${error.message}`);
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS_XPRIME * Math.pow(2, attempt - 1)));
            }
        }
    }
    console.error(`[Xprime.tv] All fetch attempts failed for ${url}. Last error:`, lastError && lastError.message);
    if (lastError) throw lastError; // Ensure the error is thrown if all retries fail
    else throw new Error(`[Xprime.tv] All fetch attempts failed for ${url} without a specific error captured.`); // Fallback error
}

async function getXprimeStreams(title, year, type, seasonNum, episodeNum, useProxy = true) {
    if (!title || !year) {
        console.log('[Xprime.tv] Skipping fetch: title or year is missing.');
        return [];
    }

    let rawXprimeStreams = [];
    try {
        console.log(`[Xprime.tv] Attempting to fetch streams for '${title}' (${year}), Type: ${type}, S: ${seasonNum}, E: ${episodeNum}, UseProxy: ${useProxy}`);
        const xprimeName = encodeURIComponent(title);
        let xprimeApiUrl;

        // type here is tmdbTypeFromId which is 'movie' or 'tv'
        if (type === 'movie') {
            xprimeApiUrl = `https://backend.xprime.tv/primebox?name=${xprimeName}&year=${year}&fallback_year=${year}`;
        } else if (type === 'tv') { // 'tv' corresponds to series for Xprime
            if (seasonNum !== null && episodeNum !== null) {
                xprimeApiUrl = `https://backend.xprime.tv/primebox?name=${xprimeName}&year=${year}&fallback_year=${year}&season=${seasonNum}&episode=${episodeNum}`;
            } else {
                console.log('[Xprime.tv] Skipping series request: missing season/episode numbers.');
                return [];
            }
        } else {
            console.log(`[Xprime.tv] Skipping request: unknown type '${type}'.`);
            return [];
        }

        let fetchUrl = xprimeApiUrl;
        if (useProxy && XPRIME_PROXY_URL) {
            console.log(`[Xprime.tv] Using proxy: ${XPRIME_PROXY_URL}`);
            // Ensure proxy URL doesn't have a trailing slash before appending query params
            const cleanedProxyUrl = XPRIME_PROXY_URL.replace(/\/$/, '');
            fetchUrl = `${cleanedProxyUrl}/?destination=${encodeURIComponent(xprimeApiUrl)}`;
        } else {
            console.log(`[Xprime.tv] Fetching directly (Proxy disabled or not configured).`);
        }

        console.log(`[Xprime.tv] Fetching from: ${fetchUrl}`);
        const xprimeResponse = await fetchWithRetryXprime(fetchUrl, {
            headers: {
                ...BROWSER_HEADERS_XPRIME,
                'Origin': 'https://xprime.tv',
                'Referer': 'https://xprime.tv/',
            }
        });
        const xprimeResult = await xprimeResponse.json();

        const processXprimeItem = (item) => {
            if (item && typeof item === 'object' && !item.error && item.streams && typeof item.streams === 'object') {
                Object.entries(item.streams).forEach(([quality, fileUrl]) => {
                    if (fileUrl && typeof fileUrl === 'string') { // Ensure fileUrl is a non-empty string
                        rawXprimeStreams.push({
                            url: fileUrl,
                            quality: quality || 'Unknown',
                            // The title here is mostly for internal consistency before mapping in addon.js
                            title: `${title} - ${type === 'tv' ? `S${String(seasonNum).padStart(2,'0')}E${String(episodeNum).padStart(2,'0')} ` : ''}${quality}`,
                            provider: 'Xprime.tv', // This is key
                            codecs: [], // Xprime response doesn't detail codecs
                            size: 'Unknown size' // Default size, will be updated below
                        });
                    }
                });
            } else {
                console.log('[Xprime.tv] Skipping item due to missing/invalid streams or an error was reported by Xprime API:', item && item.error);
            }
        };

        if (Array.isArray(xprimeResult)) {
            xprimeResult.forEach(processXprimeItem);
        } else if (xprimeResult) { // Check if xprimeResult is not null/undefined
            processXprimeItem(xprimeResult);
        }
        
        // Fetch stream sizes concurrently for all Xprime streams
        if (rawXprimeStreams.length > 0) {
            console.time('[Xprime.tv] Fetch stream sizes');
            const sizePromises = rawXprimeStreams.map(async (stream) => {
                stream.size = await fetchStreamSize(stream.url);
                return stream; // Return the modified stream
            });
            const streamsWithSizes = await Promise.all(sizePromises);
            console.timeEnd('[Xprime.tv] Fetch stream sizes');
            
            console.log(`[Xprime.tv] Found ${rawXprimeStreams.length} streams with sizes.`);
        }
        
        return rawXprimeStreams;

    } catch (xprimeError) {
        console.error('[Xprime.tv] Error fetching or processing streams:', xprimeError.message);
        // It's good practice to log the stack trace for better debugging if available
        if (xprimeError.stack) {
            console.error(xprimeError.stack);
        }
        return []; // Return empty array on error
    }
}

// Initialize the cache directory
ensureCacheDir(CACHE_DIR).catch(console.error);

module.exports = { getXprimeStreams }; 