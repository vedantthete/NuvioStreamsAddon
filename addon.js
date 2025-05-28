const { addonBuilder } = require('stremio-addon-sdk');
require('dotenv').config(); // Ensure environment variables are loaded

const { getXprimeStreams } = require('./xprime.js'); // Import from xprime.js

// --- Constants ---
const TMDB_API_URL = 'https://api.themoviedb.org/3';
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Determine which scraper to use based on environment variable
let scraper;
if (process.env.SCRAPER_MODE === 'api') {
    console.log('Using ScraperAPI mode with scraperapi.js');
    scraper = require('./scraperapi.js');
} else {
    // Default to proxy/direct mode
    console.log('Using proxy/direct mode with scraper.js');
    scraper = require('./scraper.js');
}

// Destructure the required functions from the selected scraper
const { getStreamsFromTmdbId, convertImdbToTmdb } = scraper;

const manifest = require('./manifest.json');

// Initialize the addon
const builder = new addonBuilder(manifest);

// --- Helper Functions ---
async function fetchWithRetry(url, options, maxRetries = MAX_RETRIES) {
    const { default: fetchFunction } = await import('node-fetch'); // Dynamically import
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetchFunction(url, options); // Use the dynamically imported function
            if (!response.ok) {
                let errorBody = '';
                try {
                    errorBody = await response.text();
                } catch (e) { /* ignore */ }
                throw new Error(`HTTP error! Status: ${response.status} ${response.statusText}. Body: ${errorBody.substring(0, 200)}`);
            }
            return response;
        } catch (error) {
            lastError = error;
            console.warn(`Fetch attempt ${attempt}/${maxRetries} failed for ${url}: ${error.message}`);
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * Math.pow(2, attempt - 1)));
            }
        }
    }
    console.error(`All fetch attempts failed for ${url}. Last error:`, lastError.message);
    throw lastError;
}

// Define stream handler for movies
builder.defineStreamHandler(async (args) => {
    const { type, id, config } = args;

    // Helper to get flag emoji from URL hostname
    const getFlagEmojiForUrl = (url) => {
        try {
            const hostname = new URL(url).hostname;
            // Match common patterns like xx, xxN, xxNN at the start of a part of the hostname
            const match = hostname.match(/^([a-zA-Z]{2,3})[0-9]{0,2}(?:[.-]|$)/i);
            if (match && match[1]) {
                const countryCode = match[1].toLowerCase();
                const flagMap = {
                    'us': '🇺🇸', 'usa': '🇺🇸',
                    'gb': '🇬🇧', 'uk': '🇬🇧',
                    'ca': '🇨🇦',
                    'de': '🇩🇪',
                    'fr': '🇫🇷',
                    'nl': '🇳🇱',
                    'hk': '🇭🇰',
                    'sg': '🇸🇬',
                    'jp': '🇯🇵',
                    'au': '🇦🇺',
                    'in': '🇮🇳',
                    // Add more as needed
                };
                return flagMap[countryCode] || '🏳️'; // Default to white flag if no specific match
            }
        } catch (e) {
            // Invalid URL or other error
        }
        return '🏳️'; // Default flag
    };

    const userScraperApiKey = (config && config.scraperApiKey) ? config.scraperApiKey : null;

    console.log(`Stream request for Stremio type: '${type}', id: '${id}'`);
    if (userScraperApiKey) {
        const maskedApiKey = userScraperApiKey.length > 8 
            ? `${userScraperApiKey.substring(0, 4)}...${userScraperApiKey.substring(userScraperApiKey.length - 4)}` 
            : userScraperApiKey;
        console.log(`  Using ScraperAPI Key: ${maskedApiKey}`);
    } else {
        console.log("  No ScraperAPI Key configured by user.");
    }

    if (type !== 'movie' && type !== 'series') {
        return { streams: [] };
    }
    
    let tmdbId;
    let tmdbTypeFromId;
    let seasonNum = null;
    let episodeNum = null;
    let initialTitleFromConversion = null; // To store title from IMDb conversion
    
    const idParts = id.split(':');
    
    if (idParts[0] === 'tmdb') {
        tmdbId = idParts[1];
        tmdbTypeFromId = type === 'movie' ? 'movie' : 'tv';
        console.log(`  Received TMDB ID directly: ${tmdbId} for type ${tmdbTypeFromId}`);
        
        // Check for season and episode
        if (idParts.length >= 4 && type === 'series') {
            seasonNum = parseInt(idParts[2], 10);
            episodeNum = parseInt(idParts[3], 10);
            console.log(`  Parsed season ${seasonNum}, episode ${episodeNum} from Stremio ID`);
        }
    } else if (id.startsWith('tt')) {
        console.log(`  Received IMDb ID: ${id}. Attempting to convert to TMDB ID.`);
        
        const imdbParts = id.split(':');
        let baseImdbId = id; // Default to full ID for movies

        if (imdbParts.length >= 3 && type === 'series') {
            seasonNum = parseInt(imdbParts[1], 10);
            episodeNum = parseInt(imdbParts[2], 10);
            baseImdbId = imdbParts[0]; // Use only the IMDb ID part for conversion
            console.log(`  Parsed season ${seasonNum}, episode ${episodeNum} from IMDb ID parts`);
        }
        
        const conversionResult = await convertImdbToTmdb(baseImdbId, userScraperApiKey);
        if (conversionResult && conversionResult.tmdbId && conversionResult.tmdbType) {
            tmdbId = conversionResult.tmdbId;
            tmdbTypeFromId = conversionResult.tmdbType;
            initialTitleFromConversion = conversionResult.title; // Capture title from conversion
            console.log(`  Successfully converted IMDb ID ${baseImdbId} to TMDB ${tmdbTypeFromId} ID ${tmdbId} (${initialTitleFromConversion || 'No title returned'})`);
        } else {
            console.log(`  Failed to convert IMDb ID ${baseImdbId} to TMDB ID.`);
            return { streams: [] };
        }
    } else {
        console.log(`  Unrecognized ID format: ${id}`);
        return { streams: [] };
    }
    
    if (!tmdbId || !tmdbTypeFromId) {
        console.log('  Could not determine TMDB ID or type after processing Stremio ID.');
        return { streams: [] };
    }

    let movieOrSeriesTitle = initialTitleFromConversion;
    let movieOrSeriesYear = null;

    if (tmdbId && TMDB_API_KEY) {
        try {
            let detailsUrl;
            if (tmdbTypeFromId === 'movie') {
                detailsUrl = `${TMDB_API_URL}/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`;
            } else { // 'tv'
                detailsUrl = `${TMDB_API_URL}/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`;
            }
            
            console.log(`Fetching details from TMDB: ${detailsUrl}`);
            const tmdbDetailsResponse = await fetchWithRetry(detailsUrl, {});
            if (!tmdbDetailsResponse.ok) throw new Error(`TMDB API error: ${tmdbDetailsResponse.status}`);
            const tmdbDetails = await tmdbDetailsResponse.json();

            if (tmdbTypeFromId === 'movie') {
                if (!movieOrSeriesTitle) movieOrSeriesTitle = tmdbDetails.title;
                movieOrSeriesYear = tmdbDetails.release_date ? tmdbDetails.release_date.substring(0, 4) : null;
            } else { // 'tv'
                if (!movieOrSeriesTitle) movieOrSeriesTitle = tmdbDetails.name;
                movieOrSeriesYear = tmdbDetails.first_air_date ? tmdbDetails.first_air_date.substring(0, 4) : null;
            }
            console.log(`  Fetched/Confirmed TMDB details: Title='${movieOrSeriesTitle}', Year='${movieOrSeriesYear}'`);
        } catch (e) {
            console.error(`  Error fetching details from TMDB: ${e.message}`);
        }
    } else if (tmdbId && !TMDB_API_KEY) {
        console.warn("TMDB_API_KEY is not configured. Cannot fetch full title/year. Xprime.tv functionality might be limited or fail.");
    }
    
    let combinedRawStreams = [];

    // --- Parallel Fetching of Streams ---
    console.log('Initiating parallel fetch for ShowBox and Xprime.tv streams...');

    const showBoxPromise = getStreamsFromTmdbId(tmdbTypeFromId, tmdbId, seasonNum, episodeNum, userScraperApiKey)
        .then(streams => {
            if (streams && streams.length > 0) {
                console.log(`  Successfully fetched ${streams.length} streams from ShowBox.`);
                return streams.map(stream => ({ ...stream, provider: 'ShowBox' }));
            }
            console.log(`  No streams returned from ShowBox for TMDB ${tmdbTypeFromId}/${tmdbId}`);
            return [];
        })
        .catch(err => {
            console.error(`Error fetching ShowBox streams:`, err.message);
            return []; // Return empty array on error
        });

    let xprimePromise;
    if (movieOrSeriesTitle && movieOrSeriesYear) {
        xprimePromise = getXprimeStreams(movieOrSeriesTitle, movieOrSeriesYear, tmdbTypeFromId, seasonNum, episodeNum)
            // getXprimeStreams already adds provider and handles its errors, returning [] on failure.
            .then(streams => {
                if (streams && streams.length > 0) {
                    console.log(`  Successfully fetched ${streams.length} streams from Xprime.tv.`);
                }
                return streams; // streams already have provider info and are an empty array on error
            })
            .catch(err => { // This catch is a fallback, xprime.js should handle its internal errors
                console.error('Fallback error catcher for Xprime.tv in addon.js:', err.message);
                return [];
            });
    } else {
        console.log('[Xprime.tv] Skipping fetch in addon.js because title or year is missing or not applicable.');
        xprimePromise = Promise.resolve([]); // Resolve with empty array if skipped
    }
    
    try {
        const results = await Promise.all([showBoxPromise, xprimePromise]);
        const showBoxResults = results[0] || [];
        const xprimeResults = results[1] || [];

        combinedRawStreams = combinedRawStreams.concat(showBoxResults);
        combinedRawStreams = combinedRawStreams.concat(xprimeResults);
        
        console.log(`Total raw streams after parallel fetch: ${combinedRawStreams.length}`);

    } catch (error) {
        // This catch block might be redundant if individual promises handle their errors and return [].
        // However, it can catch unexpected errors from Promise.all itself if any arise, though unlikely with .catch in each promise.
        console.error('Error during Promise.all execution for stream fetching:', error);
        // combinedRawStreams will remain as initialized (empty) or with partial results if one promise was resolved before an error
        // But the .catch in each promise should prevent Promise.all from rejecting outright.
    }
    
    if (combinedRawStreams.length === 0) {
        console.log(`  No streams found from any provider for TMDB ${tmdbTypeFromId}/${tmdbId}`);
        return { streams: [] };
    }
        
    const stremioStreamObjects = combinedRawStreams.map((stream) => {
        const qualityLabel = stream.quality || 'UNK'; // UNK for unknown
        
        let displayTitle;
        if (tmdbTypeFromId === 'tv' && seasonNum !== null && episodeNum !== null && movieOrSeriesTitle) {
            displayTitle = `${movieOrSeriesTitle} S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`;
        } else if (movieOrSeriesTitle) {
            displayTitle = movieOrSeriesTitle;
        } else {
            displayTitle = stream.title || "Unknown Title"; // Fallback to the title from the raw stream data
        }

        const flagEmoji = getFlagEmojiForUrl(stream.url);

        let providerDisplayName = stream.provider; // Default to the existing provider name
        if (stream.provider === 'Xprime.tv') {
            providerDisplayName = 'XPRIME ⚡';
        } else if (stream.provider === 'ShowBox') {
            providerDisplayName = 'ShowBox';
        }

        let nameDisplay;
        if (stream.provider === 'Xprime.tv') {
            nameDisplay = `${providerDisplayName} - ${qualityLabel}`; // No flag for XPRIME ⚡
        } else {
            nameDisplay = `${flagEmoji} ${providerDisplayName} - ${qualityLabel}`; // Flag for others (e.g., ShowBox 💎)
        }
        
        const nameVideoTechTags = [];
        if (stream.codecs && Array.isArray(stream.codecs)) {
            // For Xprime.tv, keep the original behavior (only show highest priority HDR codec)
            if (stream.provider === 'Xprime.tv') {
                if (stream.codecs.includes('DV')) {
                    nameVideoTechTags.push('DV');
                } else if (stream.codecs.includes('HDR10+')) {
                    nameVideoTechTags.push('HDR10+');
                } else if (stream.codecs.includes('HDR')) {
                    nameVideoTechTags.push('HDR');
                }
            } 
            // For ShowBox, include all HDR-related codecs
            else if (stream.provider === 'ShowBox') {
                if (stream.codecs.includes('DV')) {
                    nameVideoTechTags.push('DV');
                }
                if (stream.codecs.includes('HDR10+')) {
                    nameVideoTechTags.push('HDR10+');
                }
                if (stream.codecs.includes('HDR')) {
                    nameVideoTechTags.push('HDR');
                }
            }
            // For any other provider, use the original behavior
            else {
                if (stream.codecs.includes('DV')) {
                    nameVideoTechTags.push('DV');
                } else if (stream.codecs.includes('HDR10+')) {
                    nameVideoTechTags.push('HDR10+');
                } else if (stream.codecs.includes('HDR')) {
                    nameVideoTechTags.push('HDR');
                }
            }
        }
        if (nameVideoTechTags.length > 0) {
            nameDisplay += ` | ${nameVideoTechTags.join(' | ')}`;
        }

        let titleParts = [];
        if (stream.size && stream.size !== 'Unknown size' && !stream.size.toLowerCase().includes('n/a')) {
            titleParts.push(stream.size);
        }

        if (stream.codecs && Array.isArray(stream.codecs) && stream.codecs.length > 0) {
            stream.codecs.forEach(codec => {
                if (['DV', 'HDR10+', 'HDR', 'SDR'].includes(codec)) {
                    titleParts.push(`✨ ${codec}`);
                } else if (['Atmos', 'TrueHD', 'DTS-HD MA'].includes(codec)) {
                    titleParts.push(`🔊 ${codec}`);
                } else if (['H.265', 'H.264', 'AV1'].includes(codec)) {
                    titleParts.push(`🎞️ ${codec}`);
                } else if (['EAC3', 'AC3', 'AAC', 'Opus', 'MP3', 'DTS-HD', 'DTS'].includes(codec)) { 
                    titleParts.push(`🎧 ${codec}`);
                } else if (['10-bit', '8-bit'].includes(codec)) {
                    titleParts.push(`⚙️ ${codec}`);
                } else {
                    titleParts.push(codec); 
                }
            });
        }
            
        const titleSecondLine = titleParts.join(" • ");
        const finalTitle = titleSecondLine ? `${displayTitle}\n${titleSecondLine}` : displayTitle;

        return {
            name: nameDisplay, 
            title: finalTitle, 
            url: stream.url,
            type: 'url', // CRITICAL: This is the type of the stream itself, not the content
            availability: 2, 
            behaviorHints: {
                notWebReady: true // As per the working example, indicates Stremio might need to handle it carefully or use external player
            }
        };
    });

    console.log("--- BEGIN Stremio Stream Objects to be sent ---");
    // Log first 3 streams to keep logs shorter
    const streamSample = stremioStreamObjects.slice(0, 3);
    console.log(JSON.stringify(streamSample, null, 2));
    if (stremioStreamObjects.length > 3) {
        console.log(`... and ${stremioStreamObjects.length - 3} more streams`);
    }
    console.log("--- END Stremio Stream Objects to be sent ---");

    return {
        streams: stremioStreamObjects
    };
});

// Build and export the addon
module.exports = builder.getInterface(); 