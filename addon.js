const { addonBuilder } = require('stremio-addon-sdk');
require('dotenv').config(); // Ensure environment variables are loaded

// NEW: Read environment variable for Cuevana
const ENABLE_CUEVANA_PROVIDER = process.env.ENABLE_CUEVANA_PROVIDER !== 'false'; // Defaults to true if not set or not 'false'
console.log(`[addon.js] Cuevana provider fetching enabled: ${ENABLE_CUEVANA_PROVIDER}`);

// NEW: Read environment variable for HollyMovieHD
const ENABLE_HOLLYMOVIEHD_PROVIDER = process.env.ENABLE_HOLLYMOVIEHD_PROVIDER !== 'false'; // Defaults to true if not set or not 'false'
console.log(`[addon.js] HollyMovieHD provider fetching enabled: ${ENABLE_HOLLYMOVIEHD_PROVIDER}`);

const { getXprimeStreams } = require('./providers/xprime.js'); // Import from xprime.js
const { getHollymovieStreams } = require('./providers/hollymoviehd.js'); // Import from hollymoviehd.js
const { getSoaperTvStreams } = require('./providers/soapertv.js'); // Import from soapertv.js
const { getCuevanaStreams } = require('./providers/cuevana.js'); // Import from cuevana.js
const { getHianimeStreams } = require('./providers/hianime.js'); // Import from hianime.js
const { getStreamContent } = require('./providers/vidsrcextractor.js'); // Import from vidsrcextractor.js

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
    console.log('Using proxy/direct mode with Showbox.js');
    scraper = require('./providers/Showbox.js');
}

// Destructure the required functions from the selected scraper
const { getStreamsFromTmdbId, convertImdbToTmdb, sortStreamsByQuality } = scraper;

const manifest = require('./manifest.json');

// Initialize the addon
const builder = new addonBuilder(manifest);

// --- Helper Functions ---

// NEW: Helper function to parse quality strings into numerical values
function parseQuality(qualityString) {
    if (!qualityString || typeof qualityString !== 'string') {
        return 0; // Default for unknown or undefined
    }
    const q = qualityString.toLowerCase();

    if (q.includes('4k') || q.includes('2160')) return 2160;
    if (q.includes('1440')) return 1440;
    if (q.includes('1080')) return 1080;
    if (q.includes('720')) return 720;
    if (q.includes('576')) return 576;
    if (q.includes('480')) return 480;
    if (q.includes('360')) return 360;
    if (q.includes('240')) return 240;

    // Handle kbps by extracting number, e.g., "2500k" -> 2.5 (lower than p values)
    const kbpsMatch = q.match(/(\d+)k/);
    if (kbpsMatch && kbpsMatch[1]) {
        return parseInt(kbpsMatch[1], 10) / 1000; // Convert to a small number relative to pixel heights
    }

    if (q.includes('hd')) return 720; // Generic HD
    if (q.includes('sd')) return 480; // Generic SD

    // Lower quality tags
    if (q.includes('cam') || q.includes('camrip')) return 100;
    if (q.includes('ts') || q.includes('telesync')) return 200;
    if (q.includes('scr') || q.includes('screener')) return 300;
    if (q.includes('dvdscr')) return 350;
    if (q.includes('r5') || q.includes('r6')) return 400;


    return 0; // Default for anything else not recognized
}

// NEW: Helper function to filter streams by minimum quality
function filterStreamsByQuality(streams, minQualitySetting, providerName) {
    if (!minQualitySetting || minQualitySetting.toLowerCase() === 'all') {
        console.log(`[${providerName}] No minimum quality filter applied (set to 'all' or not specified).`);
        return streams; // No filtering needed
    }

    const minQualityNumeric = parseQuality(minQualitySetting);
    if (minQualityNumeric === 0 && minQualitySetting.toLowerCase() !== 'all') { // Check if minQualitySetting was something unrecognized
        console.warn(`[${providerName}] Minimum quality setting '${minQualitySetting}' was not recognized. No filtering applied.`);
        return streams;
    }

    console.log(`[${providerName}] Filtering streams. Minimum quality: ${minQualitySetting} (Parsed as: ${minQualityNumeric}). Original count: ${streams.length}`);

    const filteredStreams = streams.filter(stream => {
        const streamQualityNumeric = parseQuality(stream.quality);
        return streamQualityNumeric >= minQualityNumeric;
    });

    console.log(`[${providerName}] Filtered count: ${filteredStreams.length}`);
    return filteredStreams;
}

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

// Helper function for fetching with a timeout
function fetchWithTimeout(promise, timeoutMs, providerName) {
  return new Promise((resolve) => { // Always resolve to prevent Promise.all from rejecting
    let timer = null;

    const timeoutPromise = new Promise(r => {
      timer = setTimeout(() => {
        console.log(`[${providerName}] Request timed out after ${timeoutMs}ms. Returning empty array.`);
        r({ streams: [], provider: providerName, error: new Error('Timeout') }); // Resolve with an object indicating timeout
      }, timeoutMs);
    });

    Promise.race([promise, timeoutPromise])
      .then((result) => {
        clearTimeout(timer);
        // Ensure the result is an object with a streams array, even if the original promise resolved with just an array
        if (Array.isArray(result)) {
          resolve({ streams: result, provider: providerName });
        } else if (result && typeof result.streams !== 'undefined') {
          resolve(result); // Already in the expected format (e.g. from timeoutPromise)
        } else {
          // This case might happen if the promise resolves with something unexpected
          console.warn(`[${providerName}] Resolved with unexpected format. Returning empty array. Result:`, result);
          resolve({ streams: [], provider: providerName });
        }
      })
      .catch(error => {
        clearTimeout(timer);
        console.error(`[${providerName}] Error fetching streams: ${error.message}. Returning empty array.`);
        resolve({ streams: [], provider: providerName, error }); // Resolve with an object indicating error
      });
  });
}

// Define function to get streams from VidSrc
async function getVidSrcStreams(tmdbId, mediaType, seasonNum = null, episodeNum = null) {
    try {
        console.log(`[VidSrc] Attempting to fetch streams for TMDB ID: ${tmdbId}, Type: ${mediaType}, Season: ${seasonNum}, Episode: ${episodeNum}`);
        
        // Convert TMDB ID to IMDb ID for VidSrc
        // This is a simplified example - you might need to implement proper TMDB to IMDb conversion
        // For now, assuming we have access to the IMDb ID from the caller
        let imdbId;
        if (tmdbId.startsWith('tt')) {
            imdbId = tmdbId; // Already an IMDb ID
        } else {
            // You would need to implement this conversion
            // For example, using the convertTmdbToImdb function if available
            // imdbId = await convertTmdbToImdb(tmdbId, mediaType);
            console.log(`[VidSrc] TMDB ID conversion not implemented yet. Skipping...`);
            return [];
        }
        
        // Format the ID according to VidSrc requirements
        let vidsrcId;
        if (mediaType === 'movie') {
            vidsrcId = imdbId;
        } else if (mediaType === 'tv' && seasonNum !== null && episodeNum !== null) {
            vidsrcId = `${imdbId}:${seasonNum}:${episodeNum}`;
        } else {
            console.log(`[VidSrc] Invalid parameters for TV show. Need season and episode numbers.`);
            return [];
        }
        
        // Call the getStreamContent function from vidsrcextractor.js
        const typeForVidSrc = mediaType === 'movie' ? 'movie' : 'series';
        const results = await getStreamContent(vidsrcId, typeForVidSrc);
        
        if (!results || results.length === 0) {
            console.log(`[VidSrc] No streams found for ${vidsrcId}.`);
            return [];
        }
        
        // Process the results into the standard stream format
        const streams = [];
        
        for (const result of results) {
            if (result.streams && result.streams.length > 0) {
                for (const streamInfo of result.streams) {
                    const quality = streamInfo.quality.includes('x') 
                        ? streamInfo.quality.split('x')[1] + 'p' // Convert "1280x720" to "720p"
                        : streamInfo.quality; // Keep as is for kbps or unknown
                    
                    streams.push({
                        title: result.name || "VidSrc Stream",
                        url: streamInfo.url,
                        quality: quality,
                        provider: "VidSrc",
                        // You can add additional metadata if needed
                        size: "Unknown size",
                        languages: ["Unknown"],
                        subtitles: [],
                        // If the referer is needed for playback
                        headers: result.referer ? { referer: result.referer } : undefined
                    });
                }
            }
        }
        
        console.log(`[VidSrc] Successfully extracted ${streams.length} streams.`);
        return streams;
    } catch (error) {
        console.error(`[VidSrc] Error fetching streams:`, error.message);
        return [];
    }
}

// Define stream handler for movies
builder.defineStreamHandler(async (args) => {
    const { type, id, config: sdkConfig } = args;

    // Read config from global set by server.js middleware
    const requestSpecificConfig = global.currentRequestConfig || {};
    console.log(`[addon.js] Read from global.currentRequestConfig: ${JSON.stringify(requestSpecificConfig)}`);

    // NEW: Get minimum quality preferences
    const minQualitiesPreferences = requestSpecificConfig.minQualities || {};
    if (Object.keys(minQualitiesPreferences).length > 0) {
        console.log(`[addon.js] Minimum quality preferences: ${JSON.stringify(minQualitiesPreferences)}`);
    } else {
        console.log(`[addon.js] No minimum quality preferences set by user.`);
    }

    console.log("--- FULL ARGS OBJECT (from SDK) ---");
    console.log(JSON.stringify(args, null, 2));
    console.log("--- SDK ARGS.CONFIG (still logging for comparison) ---");
    console.log(JSON.stringify(sdkConfig, null, 2)); // Log the original sdkConfig
    console.log("---------------------------------");

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
                return flagMap[countryCode] || ''; // Return empty string if no match
            }
        } catch (e) {
            // Invalid URL or other error
        }
        return ''; // Default to empty string
    };

    const userScraperApiKey = (sdkConfig && sdkConfig.scraperApiKey) ? sdkConfig.scraperApiKey : null;
    
    // Use values from requestSpecificConfig (derived from global)
    let userRegionPreference = requestSpecificConfig.region || null;
    let userCookie = requestSpecificConfig.cookie || null; // Already decoded by server.js
    
    // Log the request information in a more detailed way
    console.log(`Stream request for Stremio type: '${type}', id: '${id}'`);
    
    let selectedProvidersArray = null;
    if (requestSpecificConfig.providers) {
        selectedProvidersArray = requestSpecificConfig.providers.split(',').map(p => p.trim().toLowerCase());
    }
    
    console.log(`Effective request details: ${JSON.stringify({
        hasScraperApiKey: !!userScraperApiKey,
        regionPreference: userRegionPreference || 'none',
        hasCookie: !!userCookie,
        selectedProviders: selectedProvidersArray ? selectedProvidersArray.join(', ') : 'all'
    })}`);
    
    if (userRegionPreference) {
        console.log(`[addon.js] Using region from global config: ${userRegionPreference}`);
    } else {
        console.log(`[addon.js] No region preference found in global config.`);
    }
    
    if (userCookie) {
        console.log(`[addon.js] Using cookie from global config (length: ${userCookie.length})`);
    } else {
        console.log(`[addon.js] No cookie found in global config.`);
    }

    if (selectedProvidersArray) {
        console.log(`[addon.js] Using providers from global config: ${selectedProvidersArray.join(', ')}`);
    } else {
        console.log('[addon.js] No specific providers selected by user in global config, will attempt all.');
    }

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
    let initialTitleFromConversion = null;
    let isAnimation = false; // <--- New flag to track if content is animation
    
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
        
        // Pass userRegionPreference and userCookie directly to convertImdbToTmdb
        const conversionResult = await convertImdbToTmdb(baseImdbId, userRegionPreference);
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

            // Check for Animation genre
            if (tmdbDetails.genres && Array.isArray(tmdbDetails.genres)) {
                if (tmdbDetails.genres.some(genre => genre.name.toLowerCase() === 'animation')) {
                    isAnimation = true;
                    console.log('  Content identified as Animation based on TMDB genres.');
                }
            }

        } catch (e) {
            console.error(`  Error fetching details from TMDB: ${e.message}`);
        }
    } else if (tmdbId && !TMDB_API_KEY) {
        console.warn("TMDB_API_KEY is not configured. Cannot fetch full title/year/genres. Hianime and Xprime.tv functionality might be limited or fail.");
    }
    
    let combinedRawStreams = [];

    // --- Parallel Fetching of Streams ---
    console.log('Initiating parallel fetch for ShowBox, Xprime.tv, HollyMovieHD, and Soaper TV streams (in that priority order after ShowBox)...');

    // --- Provider Selection Logic ---
    const shouldFetch = (providerId) => {
        if (!selectedProvidersArray) return true; // If no selection, fetch all
        return selectedProvidersArray.includes(providerId.toLowerCase());
    };

    // Pass userRegionPreference and userCookie directly to getStreamsFromTmdbId
    const showBoxPromise = shouldFetch('showbox') ? getStreamsFromTmdbId(tmdbTypeFromId, tmdbId, seasonNum, episodeNum, userRegionPreference, userCookie)
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
        }) : Promise.resolve([]);

    let xprimePromise;
    if (shouldFetch('xprime') && movieOrSeriesTitle && movieOrSeriesYear) {
        // Read the XPRIME_USE_PROXY environment variable
        const useXprimeProxy = process.env.XPRIME_USE_PROXY !== 'false'; // Defaults to true if not set or not exactly 'false'
        console.log(`[Xprime.tv] Proxy usage for Xprime.tv: ${useXprimeProxy}`);

        xprimePromise = getXprimeStreams(movieOrSeriesTitle, movieOrSeriesYear, tmdbTypeFromId, seasonNum, episodeNum, useXprimeProxy)
            .then(streams => {
                if (streams && streams.length > 0) {
                    console.log(`  Successfully fetched ${streams.length} streams from Xprime.tv.`);
                    return streams.map(stream => ({ ...stream, provider: 'Xprime.tv' }));
                }
                return [];
            })
            .catch(err => { 
                console.error('Fallback error catcher for Xprime.tv in addon.js:', err.message);
                return [];
            });
    } else {
        if (shouldFetch('xprime')) console.log('[Xprime.tv] Skipping fetch in addon.js because title or year is missing or not applicable.');
        else console.log('[Xprime.tv] Skipping fetch: Not selected by user.');
        xprimePromise = Promise.resolve([]); 
    }

    const soaperTvPromise = shouldFetch('soapertv') ? getSoaperTvStreams(tmdbId, tmdbTypeFromId, seasonNum, episodeNum)
        .then(streams => {
            if (streams && streams.length > 0) {
                console.log(`  Successfully fetched ${streams.length} streams from Soaper TV.`);
                return streams.map(stream => ({ ...stream, provider: 'Soaper TV' }));
            }
            console.log(`  No streams returned from Soaper TV for TMDB ${tmdbTypeFromId}/${tmdbId}`);
            return [];
        })
        .catch(err => {
            console.error(`Error fetching Soaper TV streams:`, err.message);
            return []; 
        }) : Promise.resolve([]);
        
    let hollymoviePromise;
    if (ENABLE_HOLLYMOVIEHD_PROVIDER && shouldFetch('hollymoviehd') && (type === 'movie' || type === 'series' && episodeNum)) { // Ensure it's a movie or a specific episode
        const isMovie = type === 'movie';
        try {
            const mediaTypeForHolly = isMovie ? 'movie' : 'tv';
            console.log(`[HollyMovieHD] Preparing to call getHollymovieStreams with TMDB ID: ${tmdbId}, Type: ${mediaTypeForHolly}, S: ${seasonNum || ''}, E: ${episodeNum || ''}`);
            const originalHollymoviePromise = getHollymovieStreams(tmdbId, mediaTypeForHolly, seasonNum, episodeNum);
            hollymoviePromise = fetchWithTimeout(
                originalHollymoviePromise, 
                15000, // 15-second timeout
                'HollyMovieHD'
            ).then(result => {
                if (result && result.streams) {
                    return result.streams.map(s => ({ ...s, provider: 'HollyMovieHD' }));
                }
                console.warn('[HollyMovieHD] fetchWithTimeout did not return expected streams array. Result:', result);
                return [];
            });
        } catch (hollyError) { 
            console.error('[HollyMovieHD] Error setting up HollyMovieHD promise:', hollyError.message);
            hollymoviePromise = Promise.resolve([]); 
        }
    } else {
        if (!ENABLE_HOLLYMOVIEHD_PROVIDER) {
            console.log('[HollyMovieHD] Skipping fetch: Disabled by environment variable (ENABLE_HOLLYMOVIEHD_PROVIDER=false).');
        } else if (!shouldFetch('hollymoviehd')) {
            console.log('[HollyMovieHD] Skipping fetch: Not selected by user.');
        } else {
            console.log('[HollyMovieHD] Skipping fetch because content is not a movie or a specific episode.');
        }
        hollymoviePromise = Promise.resolve([]); 
    }
    
    // Updated Cuevana Promise Logic
    let cuevanaPromise = Promise.resolve([]); 
    if (ENABLE_CUEVANA_PROVIDER && shouldFetch('cuevana')) {
        console.log('[Cuevana] Attempting to fetch: Enabled by environment variable and user selection.');
        cuevanaPromise = (async () => {
            try {
                let cuevanaStreams = [];
                if (tmdbTypeFromId === 'movie') {
                    cuevanaStreams = await getCuevanaStreams(tmdbId, 'movie');
                } else if (tmdbTypeFromId === 'tv' && seasonNum !== null && episodeNum !== null) {
                    cuevanaStreams = await getCuevanaStreams(tmdbId, 'tv', seasonNum, episodeNum);
                }
                if (cuevanaStreams && cuevanaStreams.length > 0) {
                    console.log(`  Successfully fetched ${cuevanaStreams.length} streams from Cuevana.`);
                    return cuevanaStreams; 
                }
                console.log(`  No streams returned from Cuevana for TMDB ${tmdbTypeFromId}/${tmdbId}`);
                return [];
            } catch (err) {
                console.error(`Error fetching Cuevana streams:`, err.message);
                return [];
            }
        })();
    } else {
        if (!ENABLE_CUEVANA_PROVIDER) {
            console.log('[Cuevana] Skipping fetch: Disabled by environment variable (ENABLE_CUEVANA_PROVIDER=false).');
        } else { // Implies shouldFetch('cuevana') was false
            console.log('[Cuevana] Skipping fetch: Not selected by user.');
        }
        // cuevanaPromise is already Promise.resolve([])
    }

    let hianimePromise = Promise.resolve([]); 
    if (shouldFetch('hianime')) {
        if (tmdbTypeFromId === 'tv' && seasonNum !== null && episodeNum !== null && isAnimation) {
            console.log('[Hianime] Initiating fetch because content is a TV show episode AND identified as Animation.');
            hianimePromise = getHianimeStreams(tmdbId, seasonNum, episodeNum)
                .then(streams => {
                    if (streams && streams.length > 0) {
                        console.log(`  Successfully fetched ${streams.length} streams from Hianime.`);
                        return streams; 
                    }
                    console.log(`  No streams returned from Hianime for TMDB ${tmdbTypeFromId}/${tmdbId} S${seasonNum}E${episodeNum}`);
                    return [];
                })
                .catch(err => {
                    console.error(`Error fetching Hianime streams:`, err.message);
                    return [];
                });
        } else {
            if (tmdbTypeFromId === 'tv' && !isAnimation) {
                console.log('[Hianime] Skipping fetch: content is a TV show episode BUT NOT identified as Animation.');
            } else if (tmdbTypeFromId !== 'tv'){
                console.log('[Hianime] Skipping fetch: content is not a TV show.');
            } else {
                console.log('[Hianime] Skipping fetch: missing season/episode or not identified as Animation TV show.');
            }
        }
    } else {
        console.log('[Hianime] Skipping fetch: Not selected by user.');
    }
    
    // Add VidSrc promise
    const vidSrcPromise = shouldFetch('vidsrc') ? (async () => {
        try {
            // For VidSrc, we can directly use the getVidSrcStreams function
            const vidSrcStreams = await getVidSrcStreams(
                id.startsWith('tt') ? id.split(':')[0] : tmdbId, 
                tmdbTypeFromId, 
                seasonNum, 
                episodeNum
            );
            
            if (vidSrcStreams && vidSrcStreams.length > 0) {
                console.log(`  Successfully fetched ${vidSrcStreams.length} streams from VidSrc.`);
                return vidSrcStreams.map(stream => ({ ...stream, provider: 'VidSrc' }));
            }
            console.log(`  No streams returned from VidSrc for ID ${id}`);
            return [];
        } catch (err) {
            console.error(`Error fetching VidSrc streams:`, err.message);
            return [];
        }
    })() : Promise.resolve([]);
    
    try {
        // Ensure all promises are actual Promise objects before Promise.all
        const promisesToAwait = [
            showBoxPromise,
            xprimePromise,
            hollymoviePromise,
            soaperTvPromise,
            cuevanaPromise,
            hianimePromise,
            vidSrcPromise
        ].map(p => p || Promise.resolve([])); // Ensure every element is a promise

        const results = await Promise.all(promisesToAwait); 
        
        const streamsByProvider = {};

        // Correctly assign results based on whether they were fetched
        // AND apply quality filtering before sorting
        if (shouldFetch('showbox')) {
            let fetchedStreams = results[promisesToAwait.indexOf(showBoxPromise)] || [];
            const minQuality = minQualitiesPreferences.showbox;
            fetchedStreams = filterStreamsByQuality(fetchedStreams, minQuality, 'ShowBox');
            streamsByProvider['ShowBox'] = sortStreamsByQuality(fetchedStreams);
        }
        if (shouldFetch('xprime')) {
            let fetchedStreams = results[promisesToAwait.indexOf(xprimePromise)] || [];
            const minQuality = minQualitiesPreferences.xprime;
            fetchedStreams = filterStreamsByQuality(fetchedStreams, minQuality, 'Xprime.tv');
            streamsByProvider['Xprime.tv'] = sortStreamsByQuality(fetchedStreams);
        }
        if (shouldFetch('hollymoviehd')) {
            let fetchedStreams = results[promisesToAwait.indexOf(hollymoviePromise)] || [];
            const minQuality = minQualitiesPreferences.hollymoviehd;
            fetchedStreams = filterStreamsByQuality(fetchedStreams, minQuality, 'HollyMovieHD');
            streamsByProvider['HollyMovieHD'] = sortStreamsByQuality(fetchedStreams);
        }
        if (shouldFetch('soapertv')) {
            let fetchedStreams = results[promisesToAwait.indexOf(soaperTvPromise)] || [];
            const minQuality = minQualitiesPreferences.soapertv;
            fetchedStreams = filterStreamsByQuality(fetchedStreams, minQuality, 'Soaper TV');
            streamsByProvider['Soaper TV'] = sortStreamsByQuality(fetchedStreams);
        }
        if (shouldFetch('cuevana')) {
            let fetchedStreams = results[promisesToAwait.indexOf(cuevanaPromise)] || [];
            const minQuality = minQualitiesPreferences.cuevana;
            fetchedStreams = filterStreamsByQuality(fetchedStreams, minQuality, 'Cuevana');
            streamsByProvider['Cuevana'] = sortStreamsByQuality(fetchedStreams);
        }
        if (shouldFetch('hianime')) {
            let fetchedStreams = results[promisesToAwait.indexOf(hianimePromise)] || [];
            const minQuality = minQualitiesPreferences.hianime;
            fetchedStreams = filterStreamsByQuality(fetchedStreams, minQuality, 'Hianime');
            streamsByProvider['Hianime'] = sortStreamsByQuality(fetchedStreams);
        }
        if (shouldFetch('vidsrc')) {
            let fetchedStreams = results[promisesToAwait.indexOf(vidSrcPromise)] || [];
            const minQuality = minQualitiesPreferences.vidsrc;
            fetchedStreams = filterStreamsByQuality(fetchedStreams, minQuality, 'VidSrc');
            streamsByProvider['VidSrc'] = sortStreamsByQuality(fetchedStreams);
        }

        // Combine streams in the preferred provider order, only including fetched ones
        combinedRawStreams = [];
        const providerOrder = ['ShowBox', 'Xprime.tv', 'HollyMovieHD', 'Soaper TV', 'Cuevana', 'Hianime', 'VidSrc'];
        providerOrder.forEach(providerKey => {
            if (streamsByProvider[providerKey] && streamsByProvider[providerKey].length > 0) {
                combinedRawStreams.push(...streamsByProvider[providerKey]);
            }
        });
        
        console.log(`Total raw streams after provider-ordered fetch: ${combinedRawStreams.length}`);

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
    
    // We'll skip global quality sorting, as we've already sorted each provider's streams by quality
    // const sortedCombinedStreams = sortStreamsByQuality(combinedRawStreams);
    const sortedCombinedStreams = combinedRawStreams;
    console.log(`Total streams after provider-ordered sorting: ${sortedCombinedStreams.length}`);
        
    const stremioStreamObjects = sortedCombinedStreams.map((stream) => {
        const qualityLabel = stream.quality || 'UNK'; // UNK for unknown
        
        let displayTitle;
        if (tmdbTypeFromId === 'tv' && seasonNum !== null && episodeNum !== null && movieOrSeriesTitle) {
            displayTitle = `${movieOrSeriesTitle} S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`;
        } else if (movieOrSeriesTitle) {
            if (tmdbTypeFromId === 'movie' && movieOrSeriesYear) {
                displayTitle = `${movieOrSeriesTitle} (${movieOrSeriesYear})`;
            } else {
                displayTitle = movieOrSeriesTitle;
            }
        } else {
            displayTitle = stream.title || "Unknown Title"; // Fallback to the title from the raw stream data
        }

        const flagEmoji = getFlagEmojiForUrl(stream.url);

        let providerDisplayName = stream.provider; // Default to the existing provider name
        if (stream.provider === 'Xprime.tv') {
            providerDisplayName = 'XPRIME ⚡';
        } else if (stream.provider === 'ShowBox') {
            providerDisplayName = 'ShowBox';
        } else if (stream.provider === 'HollyMovieHD') {
            providerDisplayName = 'HollyMovieHD'; // Changed from HollyHD
        } else if (stream.provider === 'Soaper TV') {
            providerDisplayName = 'Soaper TV';
        } else if (stream.provider === 'Cuevana') {
            // Include language in the provider display name
            let langForDisplay = stream.language ? stream.language.toUpperCase() : 'UNK';
            if (langForDisplay === 'SPANISH') {
                langForDisplay = 'ESP';
            }
            // Add other specific mappings here if they become necessary in the future, e.g.:
            // else if (langForDisplay === 'LATINO') {
            //     langForDisplay = 'LAT';
            // }
            providerDisplayName = `Cuevana ${langForDisplay} 🎭`;
        } else if (stream.provider === 'Hianime') {
            // For Hianime, language is 'dub' or 'sub' from the stream object
            const category = stream.language ? (stream.language === 'sub' ? 'OG' : stream.language.toUpperCase()) : 'UNK';
            providerDisplayName = `Hianime ${category} 🍥`;
        }

        let nameDisplay;
        if (stream.provider === 'Cuevana') {
            let qualitySuffix = '';
            const quality = stream.quality || 'UNK'; // qualityLabel is essentially stream.quality
            const qualityNumberMatch = quality.match(/^(\d+)p$/); // Match "720p", "1080p" etc.
            
            if (qualityNumberMatch) {
                const resolution = parseInt(qualityNumberMatch[1], 10);
                if (resolution >= 1080) {
                    qualitySuffix = ` - ${quality}`; // e.g., " - 1080p"
                }
                // If below 1080p, qualitySuffix remains empty, so no quality is shown
            } 
            // If it's 'auto', 'UNK', or a bitrate (e.g., '700k'), qualitySuffix also remains empty.
            
            nameDisplay = `${providerDisplayName}${qualitySuffix}`;
            // Note: flagEmoji is typically not applicable to Cuevana's stream URLs with current logic
        } else if (stream.provider === 'Hianime') {
            // Hianime specific display (Quality is included in title from hianime.js)
            // So, we might just use the stream.title directly or format similarly to Cuevana if preferred
            // For now, let's assume stream.title is already formatted as `Hianime CATEGORY - Quality`
            nameDisplay = stream.title || `${providerDisplayName} - ${stream.quality || 'Auto'}`;
            // If stream.title already includes providerDisplayName, we can simplify:
            // nameDisplay = stream.title; 
        } else { // For other providers (ShowBox, Xprime, etc.)
            const qualityLabel = stream.quality || 'UNK';
            if (flagEmoji) {
                nameDisplay = `${flagEmoji} ${providerDisplayName} - ${qualityLabel}`;
            } else {
                nameDisplay = `${providerDisplayName} - ${qualityLabel}`;
            }
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

    // No need to clean up global variables since we're not using them anymore
    console.log(`Request for ${id} completed successfully`);

    return {
        streams: stremioStreamObjects
    };
});

// Build and export the addon
module.exports = builder.getInterface(); 