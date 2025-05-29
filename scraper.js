require('dotenv').config();
console.log(`Current DISABLE_CACHE value: '${process.env.DISABLE_CACHE}' (Type: ${typeof process.env.DISABLE_CACHE})`);
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// --- Cookie Management ---
let cookieIndex = 0;
let cookieCache = null; // This will store cookies from cookies.txt for fallback

// Function to load cookies from cookies.txt (for fallback)
const loadFallbackCookies = async () => {
    try {
        const cookiesPath = path.join(__dirname, 'cookies.txt');
        const cookiesContent = await fs.readFile(cookiesPath, 'utf-8');
        const loadedCookies = cookiesContent
            .split('\n')
            .filter(line => line.trim().length > 0)
            .map(cookie => cookie.trim());
        console.log(`Loaded ${loadedCookies.length} fallback cookies from cookies.txt`);
        return loadedCookies;
    } catch (error) {
        console.warn(`Warning: Could not load fallback cookies from cookies.txt: ${error.message}`);
        return [];
    }
};

// Function to get the appropriate cookie for a request
const getCookieForRequest = async () => {
    // 1. Prioritize user-supplied cookie (passed via global.currentRequestUserCookie)
    if (global.currentRequestUserCookie) {
        console.log('[CookieManager] Using user-supplied cookie from manifest URL.');
        return global.currentRequestUserCookie;
    }

    // 2. Fallback to rotating cookies from cookies.txt
    if (cookieCache === null) {
        cookieCache = await loadFallbackCookies();
    }
    
    if (!cookieCache || cookieCache.length === 0) {
        console.log('[CookieManager] No fallback cookies available in cookies.txt.');
        return ''; // No fallback cookies available
    }
    
    const fallbackCookie = cookieCache[cookieIndex];
    const currentFallbackIndex = cookieIndex + 1; // For 1-based logging
    cookieIndex = (cookieIndex + 1) % cookieCache.length;
    console.log(`[CookieManager] Using fallback cookie ${currentFallbackIndex} of ${cookieCache.length} from cookies.txt.`);
    return fallbackCookie;
};

// REMOVE: Old cookie functions like getInitialCookieForLookup, activeCookieMap, etc.
// const activeCookieMap = new Map();
// const getInitialCookieForLookup = async (lookupId) => { ... };
// const getNextCookie = async () => { ... }; // This is now handled by getCookieForRequest

// Helper function to fetch stream size using a HEAD request
const fetchStreamSize = async (url) => {
    const cacheSubDir = 'stream_sizes';
    // Create a cache key from the URL, ensuring it's filename-safe
    const urlCacheKey = url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9_.-]/g, '_') + '.txt';

    const cachedSize = await getFromCache(urlCacheKey, cacheSubDir);
    if (cachedSize !== null) { // Check for null specifically, as 'Unknown size' is a valid cached string
        // console.log(`  CACHE HIT for stream size: ${url} -> ${cachedSize}`);
        return cachedSize;
    }
    // console.log(`  CACHE MISS for stream size: ${url}`);

    try {
        // For m3u8, Content-Length is for the playlist file, not the stream segments.
        if (url.toLowerCase().includes('.m3u8')) {
            return 'Playlist (size N/A)'; // Indicate HLS playlist
        }
        const response = await axios.head(url, { timeout: 5000 }); // 5-second timeout for HEAD request
        if (response.headers['content-length']) {
            const sizeInBytes = parseInt(response.headers['content-length'], 10);
            if (!isNaN(sizeInBytes)) {
                if (sizeInBytes < 1024) return `${sizeInBytes} B`;
                if (sizeInBytes < 1024 * 1024) return `${(sizeInBytes / 1024).toFixed(2)} KB`;
                if (sizeInBytes < 1024 * 1024 * 1024) return `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`;
                return `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
            }
        }
        return 'Unknown size';
    } catch (error) {
        // console.warn(`  Could not fetch size for ${url}: ${error.message}`);
        // Cache the error/unknown result too, to prevent re-fetching a known problematic URL quickly
        await saveToCache(urlCacheKey, 'Unknown size', cacheSubDir);
        return 'Unknown size';
    }
};

// MODIFICATION: Removed hardcoded SCRAPER_API_KEY
// const SCRAPER_API_KEY = '96845d13e7a0a0d40fb4f148cd135ddc'; 
const FEBBOX_PLAYER_URL = "https://www.febbox.com/file/player";
const FEBBOX_FILE_SHARE_LIST_URL = "https://www.febbox.com/file/file_share_list";
// MODIFICATION: Remove SCRAPER_API_URL
// const SCRAPER_API_URL = 'https://api.scraperapi.com/';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
// Determine cache directory based on environment
// Use /tmp/.cache when running on Vercel, otherwise use local .cache directory
const CACHE_DIR = process.env.VERCEL ? path.join('/tmp', '.cache') : path.join(__dirname, '.cache');
console.log(`Using cache directory: ${CACHE_DIR}`);
// MODIFICATION: Remove hardcoded SHOWBOX_PROXY_URL, will use environment variable
// const SHOWBOX_PROXY_URL = "https://starlit-valkyrie-39f5ab.netlify.app/?destination="; 

// Ensure cache directories exist
const ensureCacheDir = async (dirPath) => {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') {
            console.warn(`Warning: Could not create cache directory ${dirPath}: ${error.message}`);
        }
    }
};

// Cache helpers
const getFromCache = async (cacheKey, subDir = '') => {
    if (process.env.DISABLE_CACHE === 'true') {
        console.log(`  CACHE DISABLED: Skipping read for ${path.join(subDir, cacheKey)}`);
        return null;
    }
    const cachePath = path.join(CACHE_DIR, subDir, cacheKey);
    try {
        const data = await fs.readFile(cachePath, 'utf-8');
        console.log(`  CACHE HIT for: ${path.join(subDir, cacheKey)}`);
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn(`  CACHE READ ERROR for ${cacheKey}: ${error.message}`);
        }
        return null;
    }
};

const saveToCache = async (cacheKey, content, subDir = '') => {
    if (process.env.DISABLE_CACHE === 'true') {
        console.log(`  CACHE DISABLED: Skipping write for ${path.join(subDir, cacheKey)}`);
        return;
    }
    const fullSubDir = path.join(CACHE_DIR, subDir);
    await ensureCacheDir(fullSubDir);
    const cachePath = path.join(fullSubDir, cacheKey);
    try {
        const dataToSave = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
        await fs.writeFile(cachePath, dataToSave, 'utf-8');
        console.log(`  SAVED TO CACHE: ${path.join(subDir, cacheKey)}`);
    } catch (error) {
        console.warn(`  CACHE WRITE ERROR for ${cacheKey}: ${error.message}`);
    }
};

// NEW FUNCTION: Search ShowBox and extract the most relevant URL
const _searchAndExtractShowboxUrl = async (searchTerm, originalTmdbTitle, mediaYear, showboxScraperInstance, tmdbType) => {
    const cacheSubDir = 'showbox_search_results';
    
    // Add a cache version to invalidate previous incorrect cached results
    const CACHE_VERSION = "v2"; // Increment this whenever the search algorithm significantly changes
    
    // Create a proper hash for the cache key to avoid filename issues with special characters
    // const cacheKeyData = `${CACHE_VERSION}_${originalTmdbTitle}_${mediaYear || 'noYear'}`;
    const cacheKeyData = `${CACHE_VERSION}_${tmdbType}_${originalTmdbTitle}_${mediaYear || 'noYear'}`;
    const cacheKeyHash = crypto.createHash('md5').update(cacheKeyData).digest('hex');
    const searchTermKey = `${cacheKeyHash}.txt`;
    
    // Log what we're looking for to help with debugging
    console.log(`  Searching for ShowBox match for: "${originalTmdbTitle}" (${mediaYear || 'N/A'}) [Cache key: ${cacheKeyHash}]`);
    
    const cachedBestUrl = await getFromCache(searchTermKey, cacheSubDir);
    if (cachedBestUrl) {
        console.log(`  CACHE HIT for ShowBox search best match URL (${originalTmdbTitle} ${mediaYear || ''}): ${cachedBestUrl}`);
        if (cachedBestUrl === 'NO_MATCH_FOUND') return { url: null, score: -1 };
        return { url: cachedBestUrl, score: 10 }; // Assume a good score for a cached valid URL
    }
    
    // Special characters often cause search issues, create a cleaned version of the search term
    // Replace special characters with spaces, ensure words are properly separated
    const cleanedSearchTerm = searchTerm.replace(/[&\-_:;,.]/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`  CACHE MISS for ShowBox search. Using cleaned search term: "${cleanedSearchTerm}" (Original: "${searchTerm}")`);

    // Try multiple search strategies if needed
    const searchStrategies = [
        { term: cleanedSearchTerm, description: "cleaned search term" }
    ];
    
    // For titles with "&", create specific search strategies
    if (originalTmdbTitle.includes('&')) {
        // Try with "and" instead of "&" (very common replacement)
        const andTitle = originalTmdbTitle.replace(/&/g, 'and');
        if (mediaYear) {
            searchStrategies.push({ term: `${andTitle} ${mediaYear}`, description: "& replaced with 'and', with year" });
        }
        searchStrategies.push({ term: andTitle, description: "& replaced with 'and'" });
        
        // Try with just the first part before "&"
        const firstPart = originalTmdbTitle.split('&')[0].trim();
        if (firstPart.length > 3 && mediaYear) {
            searchStrategies.push({ term: `${firstPart} ${mediaYear}`, description: "first part before &, with year" });
        }
    }
    
    // Add TMDB title with year as a strategy (if not already in the strategies)
    if (mediaYear && !searchStrategies.some(s => s.term === `${originalTmdbTitle} ${mediaYear}`)) {
        searchStrategies.push({ term: `${originalTmdbTitle} ${mediaYear}`, description: "original TMDB title with year" });
    }
    
    // Add original TMDB title only
    searchStrategies.push({ term: originalTmdbTitle, description: "original TMDB title only" });
    
    // Add direct year search for popular movies (especially if the title is very common)
    if (mediaYear) {
        searchStrategies.push({ term: mediaYear, description: "year only (for popular movies)" });
    }
    
    // If the title contains multiple words, add a search with just the first part to catch shortened titles
    const titleWords = originalTmdbTitle.split(/\s+/);
    if (titleWords.length > 1) {
        const firstWord = titleWords[0];
        if (firstWord.length > 3 && !searchStrategies.some(s => s.term === firstWord)) { // Only use significant first words
            searchStrategies.push({ 
                term: mediaYear ? `${firstWord} ${mediaYear}` : firstWord,
                description: "first word of title" 
            });
        }
    }
    
    let bestResult = { url: null, score: -1, strategy: null };
    
    for (const strategy of searchStrategies) {
        const searchUrl = `https://www.showbox.media/search?keyword=${encodeURIComponent(strategy.term)}`;
        console.log(`  Searching ShowBox with URL: ${searchUrl} (Strategy: ${strategy.description})`);

    const htmlContent = await showboxScraperInstance._makeRequest(searchUrl);
    if (!htmlContent) {
            console.log(`  Failed to fetch ShowBox search results for strategy: ${strategy.description}`);
            continue; // Try next strategy
    }

    const $ = cheerio.load(htmlContent);
        const searchResults = [];

    // Helper for simple string similarity (case-insensitive, removes non-alphanumeric)
    const simplifyString = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
    const simplifiedTmdbTitle = simplifyString(originalTmdbTitle);

    $('div.film-poster').each((i, elem) => {
        const linkElement = $(elem).find('a.film-poster-ahref');
        const itemTitle = linkElement.attr('title');
        const itemHref = linkElement.attr('href');

        if (itemTitle && itemHref) {
            const simplifiedItemTitle = simplifyString(itemTitle);
            
            // Attempt to extract year from title if present, e.g., "Title (YYYY)"
            let itemYear = null;
            const yearMatch = itemTitle.match(/\((\d{4})\)$/);
            if (yearMatch && yearMatch[1]) {
                itemYear = yearMatch[1];
            }

                // IMPROVED SCORING LOGIC
            let score = 0;
                
                // Exact title match (case-insensitive)
                if (itemTitle.toLowerCase() === originalTmdbTitle.toLowerCase()) {
                    score += 10; // Strong bonus for exact match
                }
                // Simplified title contains the entire simplified TMDB title
                else if (simplifiedItemTitle.includes(simplifiedTmdbTitle)) {
                    score += 7; // Good bonus for containing the entire title
                }
                // TMDB title contains the simplified item title (could be abbreviation/shortened)
                else if (simplifiedTmdbTitle.includes(simplifiedItemTitle) && simplifiedItemTitle.length > 3) {
                    score += 3; // Small bonus for being contained in the TMDB title
                }
                
                // Word-by-word match calculation for multi-word titles
                const tmdbWords = originalTmdbTitle.toLowerCase().split(/\s+/);
                const itemWords = itemTitle.toLowerCase().split(/\s+/);
                
                let wordMatchCount = 0;
                for (const tmdbWord of tmdbWords) {
                    if (tmdbWord.length <= 2) continue; // Skip very short words
                    if (itemWords.some(itemWord => itemWord.includes(tmdbWord) || tmdbWord.includes(itemWord))) {
                        wordMatchCount++;
                    }
                }
                
                // Add score based on percentage of words matched
                if (tmdbWords.length > 0) {
                    const wordMatchPercent = wordMatchCount / tmdbWords.length;
                    score += wordMatchPercent * 5; // Up to 5 points for word matches
                }
                
                // STRICT YEAR MATCHING
                if (mediaYear && itemYear) {
                    if (mediaYear === itemYear) {
                        score += 8; // Strong bonus for exact year match
                    } else {
                        // Small penalty for year mismatch, larger for bigger differences
                        const yearDiff = Math.abs(parseInt(mediaYear) - parseInt(itemYear));
                        if (yearDiff <= 1) {
                            score -= 1; // Small penalty for 1 year difference
                        } else {
                            score -= Math.min(5, yearDiff) * 2; // Larger penalty for bigger differences
                        }
                    }
                } else if (mediaYear && !itemYear) {
                    // If we have a year but the item doesn't, apply a small penalty
                    score -= 2;
                }
                
                // Media type matching - bonus for matching the expected type
                const isMovie = itemHref.includes('/movie/');
                const isTv = itemHref.includes('/tv/');
                
                // Expected type based on URL (very basic logic - could be improved)
                // const expectedTypeIsMovie = !mediaYear || parseInt(mediaYear) >= 1900; // Most common scenario // REMOVED OLD LOGIC
                
                // NEW MEDIA TYPE SCORING based on tmdbType parameter
                if (tmdbType === 'movie') {
                    if (isMovie) {
                        score += 7; // Strong bonus for matching movie type
                    } else if (isTv) {
                        score -= 7; // Strong penalty for TV show when movie expected
                    }
                } else if (tmdbType === 'tv') {
                    if (isTv) {
                        score += 7; // Strong bonus for matching TV type
                    } else if (isMovie) {
                        score -= 7; // Strong penalty for movie when TV show expected
                    }
                }
                // if ((expectedTypeIsMovie && isMovie) || (!expectedTypeIsMovie && isTv)) { // REMOVED OLD LOGIC
                //     score += 3; // Bonus for matching expected type
                // } else if ((expectedTypeIsMovie && isTv) || (!expectedTypeIsMovie && isMovie)) {
                //     score -= 3; // Penalty for wrong type
                // }
                
                searchResults.push({
                    title: itemTitle,
                    href: itemHref,
                    year: itemYear,
                    score: score,
                    isMovie: isMovie,
                    isTv: isTv
                });
            }
        });
        
        // Sort by score and pick the best one
        searchResults.sort((a, b) => b.score - a.score);

        if (searchResults.length > 0) {
            console.log(`  Search results for strategy "${strategy.description}":`);
            searchResults.slice(0, 3).forEach((result, i) => {
                console.log(`    ${i+1}. Title: "${result.title}", Year: ${result.year || 'N/A'}, Score: ${result.score.toFixed(1)}, URL: ${result.href}`);
            });
            
            const bestMatch = searchResults[0];
            if (bestMatch.score > bestResult.score) {
                bestResult = {
                    url: `https://www.showbox.media${bestMatch.href}`,
                    score: bestMatch.score,
                    strategy: strategy.description
                };
            }
    } else {
            console.log(`  No results found for strategy "${strategy.description}"`);
        }
        
        // If we found a really good match (score > 18), don't try more strategies
        if (bestResult.score > 18) { // New threshold
            console.log(`  Found excellent match with score ${bestResult.score.toFixed(1)} using strategy "${bestResult.strategy}", stopping search`);
            break;
        }
    }

    // Final decision based on all strategies
    if (bestResult.url) {
        // Analyze match confidence based on score and exact year match
        let matchConfidence = "HIGH";
        if (bestResult.score < 8) {
            matchConfidence = "LOW";
        } else if (bestResult.score < 15) {
            matchConfidence = "MEDIUM";
        }
        
        // Check if URL contains the correct year (if we have a media year)
        let yearInUrl = false;
        if (mediaYear) {
            yearInUrl = bestResult.url.includes(mediaYear);
        }
        
        const confidenceWarning = matchConfidence !== "HIGH" ? 
            `[⚠️ ${matchConfidence} CONFIDENCE MATCH - may not be correct]` : "";
        
        console.log(`  Best overall match: ${bestResult.url} (Score: ${bestResult.score.toFixed(1)}, Strategy: ${bestResult.strategy}) ${confidenceWarning}`);
        
        // Add extra warning for suspicious year mismatches
        if (mediaYear && !yearInUrl && matchConfidence !== "HIGH") {
            console.log(`  ⚠️ WARNING: Year ${mediaYear} not found in URL path. This may be the wrong content!`);
        }
        
        await saveToCache(searchTermKey, bestResult.url, cacheSubDir);
        return { url: bestResult.url, score: bestResult.score };
    } else {
        console.log(`  No suitable match found on ShowBox search for: ${originalTmdbTitle} (${mediaYear || 'N/A'})`);
        await saveToCache(searchTermKey, 'NO_MATCH_FOUND', cacheSubDir);
        return { url: null, score: -1 };
    }
};

// TMDB helper function to get ShowBox URL from TMDB ID
// MODIFICATION: Remove scraperApiKey parameter
const getShowboxUrlFromTmdbInfo = async (tmdbType, tmdbId) => {
    console.time('getShowboxUrlFromTmdbInfo_total');
    const cacheSubDir = 'tmdb_api';
    const cacheKey = `tmdb-${tmdbType}-${tmdbId}.json`;
    let tmdbData = await getFromCache(cacheKey, cacheSubDir);
    if (!tmdbData) {
        const tmdbApiUrl = `${TMDB_BASE_URL}/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
        console.log(`  Fetching TMDB data from: ${tmdbApiUrl}`);
        try {
            const response = await axios.get(tmdbApiUrl, { timeout: 10000 });
            tmdbData = response.data;
            if (tmdbData) await saveToCache(cacheKey, tmdbData, cacheSubDir);
            else { console.log('No TMDB data'); return null; }
        } catch (error) { console.log('Error fetching TMDB', error); return null; }
    }
    // Ensure tmdbData is available
    if (!tmdbData) {
        console.log(`  Could not fetch TMDB data for ${tmdbType}/${tmdbId}. Cannot proceed to ShowBox search.`);
        return null;
    }


    let title = null;
    let year = null;
    // let originalTitleForShowbox = null; // Removed the Andor specific fix for now

    if (tmdbType === 'movie') {
        title = tmdbData.title || tmdbData.original_title;
        if (tmdbData.release_date && String(tmdbData.release_date).length >= 4) {
            year = String(tmdbData.release_date).substring(0, 4);
        }
    } else if (tmdbType === 'tv') {
        title = tmdbData.name || tmdbData.original_name;
        let rawFirstAirDate = tmdbData.first_air_date;
        if (rawFirstAirDate && String(rawFirstAirDate).length >= 4) {
            year = String(rawFirstAirDate).substring(0, 4);
        }
    }

    if (!title) {
        console.log(`  Could not determine title from TMDB data for ${tmdbType}/${tmdbId}.`);
        return null;
    }
    
    const searchTerm = year ? `${title} ${year}` : title;
    console.log(`  Preparing to search ShowBox with term: "${searchTerm}" (Original TMDB title: "${title}", Year: ${year || 'N/A'})`);

    // We need an instance of ShowBoxScraper to call _makeRequest
    // Assuming ShowBoxScraper is instantiated somewhere accessible or we pass it
    // For now, let's assume getStreamsFromTmdbId (the caller) will pass it,
    // or we instantiate it here if this function is called standalone.
    // THIS IS A TEMPORARY SIMPLIFICATION - ShowBoxScraper instance needs to be handled properly.
    const showboxScraperInstance = new ShowBoxScraper(); // Simplified for now

    // First attempt: Search with title + year
    let searchResult = await _searchAndExtractShowboxUrl(searchTerm, title, year, showboxScraperInstance, tmdbType);
    let showboxUrl = searchResult.url;
    let matchScore = searchResult.score;

    // If the first attempt is poor (no URL or low score), try searching with title only
    // Define a low score threshold, e.g., 2. If score is below this, try without year.
    const lowScoreThreshold = 2;
    if (!showboxUrl || matchScore < lowScoreThreshold) {
        console.log(`  Initial search for "${searchTerm}" yielded a poor result (URL: ${showboxUrl}, Score: ${matchScore}). Retrying search without year.`);
        const searchTermWithoutYear = title; // Search with title only
        const fallbackSearchResult = await _searchAndExtractShowboxUrl(searchTermWithoutYear, title, null, showboxScraperInstance, tmdbType);
        
        // Use fallback if it's better or if the initial search failed completely
        if (fallbackSearchResult.url && fallbackSearchResult.score > matchScore) {
            console.log(`  Fallback search for "${searchTermWithoutYear}" provided a better result (URL: ${fallbackSearchResult.url}, Score: ${fallbackSearchResult.score}).`);
            showboxUrl = fallbackSearchResult.url;
            matchScore = fallbackSearchResult.score; // Update score to reflect the better match
        } else if (fallbackSearchResult.url && !showboxUrl) {
            console.log(`  Fallback search for "${searchTermWithoutYear}" provided a result (URL: ${fallbackSearchResult.url}, Score: ${fallbackSearchResult.score}) where initial search failed.`);
            showboxUrl = fallbackSearchResult.url;
            matchScore = fallbackSearchResult.score;
        } else {
            console.log(`  Fallback search for "${searchTermWithoutYear}" did not yield a better result. Sticking with initial result (URL: ${showboxUrl}, Score: ${matchScore}).`);
        }
    }

    if (!showboxUrl) {
        console.log(`  Could not find a ShowBox URL via search for: ${title}`);
        // Fallback to old slug construction as a last resort? Or just fail?
        // For now, let's just fail if search fails.
        return null;
    }
    
    // The year and title here are from TMDB, which is fine.
    // The showboxUrl is now the one found from search.
    return { showboxUrl: showboxUrl, year: year, title: title };
};

// Function to fetch sources for a single FID
// MODIFICATION: Remove scraperApiKey parameter
const fetchSourcesForSingleFid = async (fidToProcess, shareKey) => { // Removed lookupId parameter
    // console.log(`  Fetching player data for video FID: ${fidToProcess} (Share: ${shareKey}) - Caching disabled for these links.`);
    // console.time(`fetchSourcesForSingleFid_${fidToProcess}`);
    
    const targetPostData = new URLSearchParams();
    targetPostData.append('fid', fidToProcess);
    targetPostData.append('share_key', shareKey);

    const cookieForRequest = await getCookieForRequest(); // Simplified cookie call
    
    const baseHeaders = {
        'Cookie': `ui=${cookieForRequest}`,
        'Content-Type': 'application/x-www-form-urlencoded'
    };

    // MODIFICATION: Removed ScraperAPI conditional logic
    // const useScraperApi = process.env.USE_SCRAPER_API === 'true';
    // const scraperApiKey = process.env.SCRAPER_API_KEY_VALUE;

    let finalPostUrl = FEBBOX_PLAYER_URL;
    let postDataForAxios = targetPostData.toString();
    let axiosConfig = { headers: baseHeaders, timeout: 20000 };

    // if (useScraperApi && scraperApiKey) {
    //     finalPostUrl = SCRAPER_API_BASE_URL; // Use defined base URL
    //     axiosConfig.params = { api_key: scraperApiKey, url: FEBBOX_PLAYER_URL, keep_headers: 'true' };
    //     // postDataForAxios remains targetPostData.toString(), as it's the body for ScraperAPI POST
    //     console.log(`  Fetching player data for FID ${fidToProcess} via ScraperAPI POST to ${FEBBOX_PLAYER_URL}`);
    // } else {
    //     console.log(`  Fetching fresh player data for video FID: ${fidToProcess} (Share: ${shareKey}) directly to ${FEBBOX_PLAYER_URL}`);
    // }
    console.log(`  Fetching fresh player data for video FID: ${fidToProcess} (Share: ${shareKey}) directly to ${FEBBOX_PLAYER_URL}`);


    try {
        const response = await axios.post(finalPostUrl, postDataForAxios, axiosConfig);
        const playerContent = response.data;

        const sourcesMatch = playerContent.match(/var sources = (.*?);\s*/s);
        if (!sourcesMatch) {
            console.log(`    Could not find sources array in player response for FID ${fidToProcess}`);
            if (playerContent.startsWith('http') && (playerContent.includes('.mp4') || playerContent.includes('.m3u8'))) {
                return [{ "label": "DirectLink", "url": playerContent.trim() }];
            }
            try {
                const jsonResponse = JSON.parse(playerContent);
                if (jsonResponse.msg) {
                    console.log(`    FebBox API Error: ${jsonResponse.code} - ${jsonResponse.msg}`);
                }
            } catch (e) { /* Not a JSON error message */ }
            return [];
        }

        const sourcesJsArrayString = sourcesMatch[1];
        const sourcesData = JSON.parse(sourcesJsArrayString);
        const fidVideoLinks = [];
        for (const sourceItem of sourcesData) {
            if (sourceItem.file && sourceItem.label) {
                let detailedFilename = null;
                try {
                    const urlParams = new URLSearchParams(new URL(sourceItem.file).search);
                    if (urlParams.has('KEY5')) {
                        detailedFilename = urlParams.get('KEY5');
                    }
                } catch (e) {
                    // console.warn('Could not parse URL to get KEY5:', sourceItem.file, e.message);
                }
                fidVideoLinks.push({
                    "label": String(sourceItem.label),
                    "url": String(sourceItem.file),
                    "detailedFilename": detailedFilename // Add extracted filename
                });
            }
        }
        
        if (fidVideoLinks.length > 0) {
            console.log(`    Extracted ${fidVideoLinks.length} fresh video link(s) for FID ${fidToProcess}`);
        }
        // console.timeEnd(`fetchSourcesForSingleFid_${fidToProcess}`);
        return fidVideoLinks;
    } catch (error) {
        console.log(`    Request error for FID ${fidToProcess}: ${error.message}`);
        console.log(`    Fresh fetch failed for FID ${fidToProcess}.`);
        // console.timeEnd(`fetchSourcesForSingleFid_${fidToProcess}`);
        return [];
    }
};

// ShowBox scraper class
class ShowBoxScraper {
    // MODIFICATION: Constructor accepts scraperApiKey -> MODIFICATION: Constructor no longer needs scraperApiKey
    constructor() {
        // MODIFICATION: baseUrl is now the ShowBox base or not strictly needed if full URLs are used
        // this.baseUrl = SCRAPER_API_URL; // Removed
        // this.scraperApiKey = scraperApiKey; // Store it -> Removed
        this.baseHeaders = { // MODIFICATION: Renamed to baseHeaders and expanded
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin', // Or 'cross-site' if appropriate, but start with same-origin or none
            'Sec-Fetch-User': '?1',
            'DNT': '1', // Do Not Track
            'Sec-GPC': '1' // Global Privacy Control
            // 'Referer': 'https://www.google.com/' // Referer can be problematic, let's test without it first or make it more dynamic if needed
        };
    }

    async _makeRequest(url, isJsonExpected = false) {
        const cacheSubDir = 'showbox_generic';
        const simpleUrlKey = url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9_.-]/g, '_');
        const cacheKey = `${simpleUrlKey}${isJsonExpected ? '.json' : '.html'}`;
        const timerLabel = `ShowBoxScraper_makeRequest_${simpleUrlKey}`;

        const cachedData = await getFromCache(cacheKey, cacheSubDir);
        if (cachedData) {
            if ((isJsonExpected && typeof cachedData === 'object') || (!isJsonExpected && typeof cachedData === 'string')) {
                return cachedData;
            }
        }

        const showboxProxyUrlFromEnv = process.env.SHOWBOX_PROXY_URL_VALUE;
        let requestUrl = url;

        if (showboxProxyUrlFromEnv && showboxProxyUrlFromEnv.trim() !== '') {
            requestUrl = `${showboxProxyUrlFromEnv}${encodeURIComponent(url)}`;
            console.log(`ShowBoxScraper: Making request to: ${url} via Proxy: ${showboxProxyUrlFromEnv}`);
        } else {
            console.log(`ShowBoxScraper: Making direct request to: ${url}`);
        }
        
        // const proxiedUrl = `${SHOWBOX_PROXY_URL}${encodeURIComponent(url)}`; // Old way
        // console.log(`ShowBoxScraper: Making request to: ${url} via Proxy: ${SHOWBOX_PROXY_URL}`); // Old log
        // console.log(`ShowBoxScraper: Making direct request to: ${url}`); // Old log
        console.time(timerLabel);
 
        const currentHeaders = { ...this.baseHeaders };
        if (isJsonExpected) {
            currentHeaders['Accept'] = 'application/json, text/javascript, */*; q=0.01';
            currentHeaders['X-Requested-With'] = 'XMLHttpRequest';
            currentHeaders['Sec-Fetch-Dest'] = 'empty';
            currentHeaders['Sec-Fetch-Mode'] = 'cors'; 
            delete currentHeaders['Upgrade-Insecure-Requests'];
        }

        try {
            // MODIFICATION: Direct GET request to the URL -> MODIFICATION: Use proxiedUrl -> MODIFICATION: Use requestUrl
            const response = await axios.get(requestUrl, { 
                headers: currentHeaders, 
                timeout: 30000 // Consider increasing if proxy adds significant latency
            });
            const responseData = response.data;

            if (responseData) {
                await saveToCache(cacheKey, responseData, cacheSubDir);
            }
            console.timeEnd(timerLabel);
            return responseData;
        } catch (error) {
            const errorMessage = error.response ? `${error.message} (Status: ${error.response.status})` : error.message;
            console.log(`ShowBoxScraper: Request failed for ${url}: ${errorMessage}`);
            console.timeEnd(timerLabel);
            return null;
        }
    }

    extractContentIdAndType(url, htmlContent) {
        let contentId = null;
        let contentTypeVal = null;
        let title = "Unknown Title";
        let sourceOfId = "unknown";

        const urlMatchDetail = url.match(/\/(movie|tv)\/detail\/(\d+)(?:-([a-zA-Z0-9-]+))?/);
        if (urlMatchDetail) {
            const contentTypeStr = urlMatchDetail[1];
            contentId = urlMatchDetail[2];
            contentTypeVal = contentTypeStr === 'movie' ? '1' : '2';
            const slugTitle = urlMatchDetail[3];
            if (slugTitle) {
                title = slugTitle.replace(/-/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
            }
            sourceOfId = "url_direct";
        }

        if (htmlContent) {
            const $ = cheerio.load(htmlContent);
            let extractedHtmlTitle = null;
            const titleElementH2 = $('h2.heading-name a');
            if (titleElementH2.length) {
                extractedHtmlTitle = titleElementH2.text().trim();
            } else {
                const titleElementH1 = $('h1.heading-name, h1.title');
                if (titleElementH1.length) {
                    extractedHtmlTitle = titleElementH1.text().trim();
                } else {
                    const titleElementMeta = $('meta[property="og:title"]');
                    if (titleElementMeta.length) {
                        extractedHtmlTitle = titleElementMeta.attr('content')?.trim();
                    } else {
                        const titleElementPlain = $('title, .movie-title, .tv-title');
                        if (titleElementPlain.length) {
                            extractedHtmlTitle = titleElementPlain.first().text().trim();
                        }
                    }
                }
            }
            
            if (extractedHtmlTitle) {
                title = extractedHtmlTitle;
                if (title.includes(" - ShowBox")) title = title.split(" - ShowBox")[0].trim();
                if (title.includes("| ShowBox")) title = title.split("| ShowBox")[0].trim();
            }

            if (!contentId || !contentTypeVal) {
                const headingLinkSelector = 'h2.heading-name a[href*="/detail/"], h1.heading-name a[href*="/detail/"]';
                const headingLink = $(headingLinkSelector).first();
                if (headingLink.length) {
                    const href = headingLink.attr('href');
                    if (href) {
                        const idTypeMatchHtml = href.match(/\/(movie|tv)\/detail\/(\d+)/);
                        if (idTypeMatchHtml) {
                            contentId = idTypeMatchHtml[2];
                            contentTypeVal = idTypeMatchHtml[1] === 'movie' ? '1' : '2';
                            sourceOfId = "html_heading_link";
                        }
                    }
                }

                if (!contentId) {
                    const shareDiv = $('div.sharethis-inline-share-buttons');
                    if (shareDiv.length) {
                        let linkElements = shareDiv.find('a[href*="/movie/detail/"], a[href*="/tv/detail/"]');
                        const dataUrlOnDiv = shareDiv.attr('data-url');
                        if (linkElements.length === 0 && dataUrlOnDiv) {
                            const dummyLinkSoup = cheerio.load(`<a href="${dataUrlOnDiv}"></a>`);
                            if (dummyLinkSoup('a').length) linkElements = dummyLinkSoup('a');
                        }
                        
                        linkElements.each((i, el) => {
                            const href = $(el).attr('href');
                            if (href) {
                                const idTypeMatchShare = href.match(/\/(movie|tv)\/detail\/(\d+)/);
                                if (idTypeMatchShare) {
                                    contentId = idTypeMatchShare[2];
                                    contentTypeVal = idTypeMatchShare[1] === 'movie' ? '1' : '2';
                                    sourceOfId = "html_share_div";
                                    return false; // break loop
                                }
                            }
                        });
                    }
                }
            }
        }

        if (contentId && contentTypeVal) {
            return { "id": contentId, "type": contentTypeVal, "title": title, "source": sourceOfId };
        }
        
        return null;
    }

    async extractFebboxShareLinks(showboxUrl) {
        const timerLabel = `extractFebboxShareLinks_total_${showboxUrl.replace(/[^a-zA-Z0-9]/g, '')}`;
        console.log(`ShowBoxScraper: Attempting to extract FebBox share link from: ${showboxUrl}`);
        console.time(timerLabel);
        
        try {
            let htmlContent = null;
            let contentInfo = this.extractContentIdAndType(showboxUrl, null);

            if (!contentInfo || !contentInfo.id || !contentInfo.type) {
                console.log("ShowBoxScraper: ID/Type not in URL, fetching HTML.");
                htmlContent = await this._makeRequest(showboxUrl);
                if (!htmlContent) {
                    console.log(`ShowBoxScraper: Failed to fetch HTML for ${showboxUrl}.`);
                    console.timeEnd(timerLabel);
                    return [];
                }
                contentInfo = this.extractContentIdAndType(showboxUrl, htmlContent);
            }

            if (!contentInfo || !contentInfo.id || !contentInfo.type) {
                console.log(`ShowBoxScraper: Could not determine content ID/type for ${showboxUrl}.`);
                console.timeEnd(timerLabel);
                return [];
            }

            const { id: contentId, type: contentType, title } = contentInfo;

            if (htmlContent) {
                const $ = cheerio.load(htmlContent);
                let directFebboxLink = null;

                $('a[href*="febbox.com/share/"]').each((i, elem) => {
                    const href = $(elem).attr('href');
                    if (href && href.includes("febbox.com/share/")) {
                        directFebboxLink = href;
                        return false;
                    }
                });

                if (!directFebboxLink) {
                    const scriptContents = $('script').map((i, el) => $(el).html()).get().join('\n');
                    const shareKeyMatch = scriptContents.match(/['"](https?:\/\/www\.febbox\.com\/share\/[a-zA-Z0-9]+)['"]/);
                    if (shareKeyMatch && shareKeyMatch[1]) {
                        directFebboxLink = shareKeyMatch[1];
                    }
                }

                if (directFebboxLink) {
                    console.log(`ShowBoxScraper: Successfully fetched FebBox URL: ${directFebboxLink} from HTML`);
                    console.timeEnd(timerLabel);
                    return [{
                        "showbox_title": title,
                        "febbox_share_url": directFebboxLink,
                        "showbox_content_id": contentId,
                        "showbox_content_type": contentType
                    }];
                }
            }

            // API call if direct parsing didn't work
            console.log(`ShowBoxScraper: Making API call for ${title} (ID: ${contentId}, Type: ${contentType})`);
            const shareApiUrl = `https://www.showbox.media/index/share_link?id=${contentId}&type=${contentType}`;
            const apiTimerLabel = `extractFebboxShareLinks_apiCall_${contentId}`;
            console.time(apiTimerLabel);
            const apiResponseStr = await this._makeRequest(shareApiUrl, true);
            console.timeEnd(apiTimerLabel);

            if (!apiResponseStr) {
                console.log(`ShowBoxScraper: Failed to get response from ShowBox share_link API`);
                console.timeEnd(timerLabel);
                return [];
            }
            
            try {
                const apiResponseJson = (typeof apiResponseStr === 'string') ? JSON.parse(apiResponseStr) : apiResponseStr;
                if (apiResponseJson.code === 1 && apiResponseJson.data && apiResponseJson.data.link) {
                    const febboxShareUrl = apiResponseJson.data.link;
                    console.log(`ShowBoxScraper: Successfully fetched FebBox URL: ${febboxShareUrl} from API`);
                    console.timeEnd(timerLabel);
                    return [{
                        "showbox_title": title,
                        "febbox_share_url": febboxShareUrl,
                        "showbox_content_id": contentId,
                        "showbox_content_type": contentType
                    }];
                } else {
                    console.log(`ShowBoxScraper: ShowBox share_link API did not succeed for '${title}'.`);
                    console.timeEnd(timerLabel);
                    return [];
                }
            } catch (e) {
                console.log(`ShowBoxScraper: Error decoding JSON from ShowBox share_link API: ${e.message}`);
                console.timeEnd(timerLabel);
                return [];
            }
        } catch (error) {
            // Catch any unexpected errors from the outer logic
            console.error(`ShowBoxScraper: Unexpected error in extractFebboxShareLinks for ${showboxUrl}: ${error.message}`);
            console.timeEnd(timerLabel);
            return [];
        }
    }
}

// Function to extract FIDs from FebBox share page
// MODIFICATION: Accept scraperApiKey -> MODIFICATION: Remove scraperApiKey
const extractFidsFromFebboxPage = async (febboxUrl) => { // Removed lookupId parameter
    const timerLabel = `extractFidsFromFebboxPage_total_${febboxUrl.replace(/[^a-zA-Z0-9]/g, '')}`;
    // console.time(timerLabel);
    let directSources = []; // Initialize directSources
    const cacheSubDirHtml = 'febbox_page_html';
    const cacheSubDirParsed = 'febbox_parsed_page'; // New subdir for parsed data
    const simpleUrlKey = febboxUrl.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const cacheKeyHtml = `${simpleUrlKey}.html`;
    const cacheKeyParsed = `${simpleUrlKey}.json`; // Parsed data will be JSON

    // Check for cached parsed data first
    const cachedParsedData = await getFromCache(cacheKeyParsed, cacheSubDirParsed);
    if (cachedParsedData && typeof cachedParsedData === 'object') { // Ensure it's an object
        // console.log(`  CACHE HIT for parsed FebBox page data: ${febboxUrl}`);
        // console.timeEnd(timerLabel);
        return cachedParsedData; // Return { fids, shareKey, directSources }
    }
    // console.log(`  CACHE MISS for parsed FebBox page data: ${febboxUrl}`);

    let contentHtml = await getFromCache(cacheKeyHtml, cacheSubDirHtml);

    if (!contentHtml) {
        const cookieForRequest = await getCookieForRequest(); // Simplified cookie call
        const baseHeaders = { 'Cookie': `ui=${cookieForRequest}` };
        const fetchTimerLabel = `extractFidsFromFebboxPage_fetch_${febboxUrl.replace(/[^a-zA-Z0-9]/g, '')}`;
        
        // MODIFICATION: Removed ScraperAPI conditional logic
        // const useScraperApi = process.env.USE_SCRAPER_API === 'true';
        // const scraperApiKey = process.env.SCRAPER_API_KEY_VALUE;

        let finalGetUrl = febboxUrl;
        let axiosConfig = { headers: baseHeaders, timeout: 20000 };

        // if (useScraperApi && scraperApiKey) {
        //     finalGetUrl = SCRAPER_API_BASE_URL; // Use defined base URL
        //     axiosConfig.params = { api_key: scraperApiKey, url: febboxUrl, keep_headers: 'true' };
        //     console.log(`Fetching FebBox page content from URL: ${febboxUrl} via ScraperAPI`);
        // } else {
        //     console.log(`Fetching FebBox page content from URL: ${febboxUrl} directly`);
        // }
        console.log(`Fetching FebBox page content from URL: ${febboxUrl} directly`);

        try {
            // console.time(fetchTimerLabel);
            const response = await axios.get(finalGetUrl, axiosConfig);
            // console.timeEnd(fetchTimerLabel);
            contentHtml = response.data;
            if (typeof contentHtml === 'string' && contentHtml.length > 0) {
                await saveToCache(cacheKeyHtml, contentHtml, cacheSubDirHtml);
            }
        } catch (error) {
            console.log(`Failed to fetch FebBox page: ${error.message}`);
            if (fetchTimerLabel) console.timeEnd(fetchTimerLabel); // Ensure timer ends on error if started
            // console.timeEnd(timerLabel);
            return { fids: [], shareKey: null };
        }
    }

    let shareKey = null;
    const matchShareKeyUrl = febboxUrl.match(/\/share\/([a-zA-Z0-9]+)/);
    if (matchShareKeyUrl) {
        shareKey = matchShareKeyUrl[1];
    } else if (contentHtml) {
        const matchShareKeyHtml = contentHtml.match(/(?:var share_key\s*=|share_key:\s*|shareid=)"?([a-zA-Z0-9]+)"?/);
        if (matchShareKeyHtml) {
            shareKey = matchShareKeyHtml[1];
        }
    }

    if (!shareKey) {
        console.log(`Warning: Could not extract share_key from ${febboxUrl}`);
        // console.timeEnd(timerLabel);
        return { fids: [], shareKey: null };
    }

    // Extract FIDs from the content HTML
    const $ = cheerio.load(contentHtml);
    const videoFidsFound = [];
    
    // Direct player source check
    const playerSetupMatch = contentHtml.match(/jwplayer\("[a-zA-Z0-9_-]+"\)\.setup/);
    if (playerSetupMatch) {
        const sourcesMatchDirect = contentHtml.match(/var sources = (.*?);\s*/s);
        if (sourcesMatchDirect) {
            try {
                const sourcesJsArrayString = sourcesMatchDirect[1];
                const sourcesData = JSON.parse(sourcesJsArrayString);
                directSources = sourcesData.map(source => ({
                    label: String(source.label || 'Default'),
                    url: String(source.file)
                })).filter(source => !!source.url);
                return { 
                    fids: [], 
                    shareKey,
                    directSources
                };
            } catch (e) {
                console.log(`Error decoding direct jwplayer sources: ${e.message}`);
            }
        }
    }

    // File list check
    const fileElements = $('div.file');
    if (fileElements.length === 0 && !(directSources && directSources.length > 0) ) { // Check if directSources also not found
        console.log(`No files or direct sources found on FebBox page: ${febboxUrl}`);
        // console.timeEnd(timerLabel);
        return { fids: [], shareKey, directSources: [] }; // Return empty directSources as well
    }

    fileElements.each((index, element) => {
        const feEl = $(element);
        const dataId = feEl.attr('data-id');
        if (!dataId || !/^\d+$/.test(dataId) || feEl.hasClass('open_dir')) {
            return; // Skip folders or invalid IDs
        }
        videoFidsFound.push(dataId);
    });

    // At the end of the function, before returning, save the parsed data
    const parsedResult = { fids: [...new Set(videoFidsFound)], shareKey, directSources };
    await saveToCache(cacheKeyParsed, parsedResult, cacheSubDirParsed);
    // console.log(`  SAVED PARSED FebBox page data to cache: ${febboxUrl}`);
    // console.timeEnd(timerLabel);
    return parsedResult;
};

// Function to convert IMDb ID to TMDB ID using TMDB API
// MODIFICATION: Accept scraperApiKey (though not directly used for TMDB calls here, kept for consistency if future needs arise)
// -> MODIFICATION: Remove scraperApiKey parameter as it's not used for TMDB.
const convertImdbToTmdb = async (imdbId) => {
    console.time(`convertImdbToTmdb_total_${imdbId}`);
    if (!imdbId || !imdbId.startsWith('tt')) {
        console.log('  Invalid IMDb ID format provided for conversion.', imdbId);
        console.timeEnd(`convertImdbToTmdb_total_${imdbId}`);
        return null;
    }
    console.log(`  Attempting to convert IMDb ID: ${imdbId} to TMDB ID.`);

    const cacheSubDir = 'tmdb_external_id';
    const cacheKey = `imdb-${imdbId}.json`;
    const cachedData = await getFromCache(cacheKey, cacheSubDir);

    if (cachedData) {
        console.log(`    IMDb to TMDB conversion found in CACHE for ${imdbId}:`, cachedData);
        // Ensure cached data has the expected structure
        if (cachedData.tmdbId && cachedData.tmdbType) {
            console.timeEnd(`convertImdbToTmdb_total_${imdbId}`);
            return cachedData;
        }
        console.log('    Cached data for IMDb conversion is malformed. Fetching fresh.');
    }

    const findApiUrl = `${TMDB_BASE_URL}/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
    console.log(`    Fetching from TMDB find API: ${findApiUrl}`);
    console.time(`convertImdbToTmdb_apiCall_${imdbId}`);

    try {
        const response = await axios.get(findApiUrl, { timeout: 10000 });
        console.timeEnd(`convertImdbToTmdb_apiCall_${imdbId}`);
        const findResults = response.data;

        if (findResults) {
            let result = null;
            // TMDB API returns results in arrays like movie_results, tv_results etc.
            // We prioritize movie results, then tv results.
            if (findResults.movie_results && findResults.movie_results.length > 0) {
                result = { tmdbId: String(findResults.movie_results[0].id), tmdbType: 'movie', title: findResults.movie_results[0].title || findResults.movie_results[0].original_title };
            } else if (findResults.tv_results && findResults.tv_results.length > 0) {
                result = { tmdbId: String(findResults.tv_results[0].id), tmdbType: 'tv', title: findResults.tv_results[0].name || findResults.tv_results[0].original_name };
            } else if (findResults.person_results && findResults.person_results.length > 0) {
                // Could handle other types if necessary, e.g. person, but for streams, movie/tv are key
                console.log(`    IMDb ID ${imdbId} resolved to a person, not a movie or TV show on TMDB.`);
            } else {
                console.log(`    No movie or TV results found on TMDB for IMDb ID ${imdbId}. Response:`, JSON.stringify(findResults).substring(0,200));
            }

            if (result && result.tmdbId && result.tmdbType) {
                console.log(`    Successfully converted IMDb ID ${imdbId} to TMDB ${result.tmdbType} ID ${result.tmdbId} (${result.title})`);
                await saveToCache(cacheKey, result, cacheSubDir);
                console.timeEnd(`convertImdbToTmdb_total_${imdbId}`);
                return result;
            } else {
                 console.log(`    Could not convert IMDb ID ${imdbId} to a usable TMDB movie/tv ID.`);
            }
        }
    } catch (error) {
        if (console.timeEnd && typeof console.timeEnd === 'function') console.timeEnd(`convertImdbToTmdb_apiCall_${imdbId}`); // Ensure timer ends on error
        const errorMessage = error.response ? `${error.message} (Status: ${error.response.status})` : error.message;
        console.log(`    Error during TMDB find API call for IMDb ID ${imdbId}: ${errorMessage}`);
    }
    console.timeEnd(`convertImdbToTmdb_total_${imdbId}`);
    return null;
};

// Exposed API for the Stremio addon
// This will be a function to get streams from a TMDB ID
// MODIFICATION: Accept scraperApiKey -> MODIFICATION: Remove scraperApiKey
const getStreamsFromTmdbId = async (tmdbType, tmdbId, seasonNum = null, episodeNum = null) => {
    // REMOVE: lookupId creation and initial cookie call for lookupId, as cookie is now per-request context
    // const lookupId = `${tmdbType}_${tmdbId}_...`;
    // await getInitialCookieForLookup(lookupId);
    
    const mainTimerLabel = `getStreamsFromTmdbId_total_${tmdbType}_${tmdbId}` + (seasonNum ? `_s${seasonNum}` : '') + (episodeNum ? `_e${episodeNum}` : '');
    console.time(mainTimerLabel);
    console.log(`Getting streams for TMDB ${tmdbType}/${tmdbId}${seasonNum !== null ? `, Season ${seasonNum}` : ''}${episodeNum !== null ? `, Episode ${episodeNum}` : ''}`);
    
    // Then, get the ShowBox URL from TMDB ID
    const tmdbInfo = await getShowboxUrlFromTmdbInfo(tmdbType, tmdbId);
    if (!tmdbInfo || !tmdbInfo.showboxUrl) {
        console.log(`Could not construct ShowBox URL for TMDB ${tmdbType}/${tmdbId}`);
        console.timeEnd(mainTimerLabel);
        return [];
    }
    const showboxUrl = tmdbInfo.showboxUrl;
    const mediaYear = tmdbInfo.year; // Year from TMDB
    // const originalTmdbMediaTitle = tmdbInfo.title; // Title from TMDB, if needed later

    // Then, get FebBox link from ShowBox
    const showboxScraper = new ShowBoxScraper();
    const febboxShareInfos = await showboxScraper.extractFebboxShareLinks(showboxUrl);
    if (!febboxShareInfos || febboxShareInfos.length === 0) {
        console.log(`No FebBox share links found for ${showboxUrl}`);
        console.timeEnd(mainTimerLabel);
        return [];
    }
    
    // For each FebBox link, get the video sources
    const allStreams = [];
    
    for (const shareInfo of febboxShareInfos) {
        const febboxUrl = shareInfo.febbox_share_url;
        // MODIFICATION: Construct base title, add year for movies
        let baseStreamTitle = shareInfo.showbox_title || "Unknown Title";
        if (tmdbType === 'movie' && mediaYear) {
            baseStreamTitle = `${baseStreamTitle} (${mediaYear})`;
        }
        
        console.log(`Processing FebBox URL: ${febboxUrl} (${baseStreamTitle})`);
        
        // For TV shows, handle season and episode
        if (tmdbType === 'tv' && seasonNum !== null) {
            // Pass baseStreamTitle (which will be just show name for TV)
            // REMOVE: lookupId parameter from processShowWithSeasonsEpisodes call
            await processShowWithSeasonsEpisodes(febboxUrl, baseStreamTitle, seasonNum, episodeNum, allStreams);
        } else {
            // Handle movies or TV shows without season/episode specified (old behavior)
            // Extract FIDs from FebBox page - REMOVE lookupId
            const { fids, shareKey, directSources } = await extractFidsFromFebboxPage(febboxUrl);
            
            // If we have direct sources from player setup
            if (directSources && directSources.length > 0) {
                for (const source of directSources) {
                    const streamTitle = `${baseStreamTitle} - ${source.label}`;
                    // directSources from extractFidsFromFebboxPage don't have KEY5 pre-parsed.
                    // We'd need to parse source.url here if we want KEY5 from them.
                    // For now, stick to streamTitle for directSources, or modify extractFidsFromFebboxPage for them too.
                    let key5FromDirectSource = null;
                    try {
                        const urlParams = new URLSearchParams(new URL(source.url).search);
                        if (urlParams.has('KEY5')) {
                            key5FromDirectSource = urlParams.get('KEY5');
                        }
                    } catch(e) { /* ignore if URL parsing fails */ }
                    allStreams.push({
                        title: streamTitle, 
                        url: source.url,
                        quality: parseQualityFromLabel(source.label),
                        codecs: extractCodecDetails(key5FromDirectSource || streamTitle) 
                    });
                }
                continue; // Skip FID processing if we have direct sources
            }
            
            // Process FIDs
            if (fids.length > 0 && shareKey) {
                // console.time(...);
                // REMOVE lookupId from fetchSourcesForSingleFid call
                const fidPromises = fids.map(fid => fetchSourcesForSingleFid(fid, shareKey));
                const fidSourcesArray = await Promise.all(fidPromises);
                // console.timeEnd(...);
                // ... (fidSourcesArray processing) ...

                for (const sources of fidSourcesArray) {
                    for (const source of sources) {
                        const streamTitle = `${baseStreamTitle} - ${source.label}`;
                        allStreams.push({
                            title: streamTitle, 
                            url: source.url,
                            quality: parseQualityFromLabel(source.label),
                            codecs: extractCodecDetails(source.detailedFilename || streamTitle) 
                        });
                    }
                }
            } else if (!directSources || directSources.length === 0) { // only log if no FIDs AND no direct sources
                console.log(`No FIDs or share key found, and no direct sources for ${febboxUrl}`);
            }
        }
    }
    
    // Fetch sizes for all streams concurrently
    if (allStreams.length > 0) {
        console.time(`getStreamsFromTmdbId_fetchStreamSizes_${tmdbType}_${tmdbId}`);
        const sizePromises = allStreams.map(async (stream) => {
            stream.size = await fetchStreamSize(stream.url);
            return stream; // Return the modified stream
        });
        // await Promise.all(sizePromises); // This already modifies streams in place, but to be safe, reassign
        const streamsWithSizes = await Promise.all(sizePromises);
        console.timeEnd(`getStreamsFromTmdbId_fetchStreamSizes_${tmdbType}_${tmdbId}`);
        // allStreams = streamsWithSizes; // Not strictly necessary as objects are modified by reference, but good practice
    } else {
        // If allStreams is empty, no need to reassign or do anything.
    }

    // Sort streams by quality before returning
    const sortedStreams = sortStreamsByQuality(allStreams);
    
    // Filter out 360p and 480p streams specifically for streams marked as from ShowBox
    const streamsToShowBoxFiltered = sortedStreams.filter(stream => {
        // This filter applies if the stream object has a `provider` property set to 'ShowBox'
        // (This property is added in addon.js before getStreamsFromTmdbId calls sortStreamsByQuality)
        // However, getStreamsFromTmdbId from scraper.js doesn't know about this `provider` property inherently.
        // For this filter to work as intended *within scraper.js before returning to addon.js*,
        // the streams coming from ShowBox within scraper.js itself would need to be identifiable.
        // Let's assume for now that all streams processed by *this* function are implicitly ShowBox
        // or that the filtering is primarily for when this function is used standalone for ShowBox.
        // A cleaner way would be to have ShowBox-specific stream fetching functions always tag their streams.

        // Given that this function (getStreamsFromTmdbId in scraper.js) primarily orchestrates ShowBox and FebBox interaction,
        // we can assume streams in `allStreams` here are candidates for this ShowBox-specific filter.
        const quality = stream.quality ? String(stream.quality).toLowerCase() : '';
        if (quality === '360p' || quality === '480p') {
            // We need a way to be sure this is a ShowBox stream. 
            // If the stream.title uniquely identifies it as ShowBox-derived, that could work, or a specific flag.
            // For now, applying generally as this function is ShowBox-centric in scraper.js
            console.log(`  Filtering out potential ShowBox low-quality stream: ${stream.title} (${stream.quality})`);
            return false; // Exclude 360p and 480p
        }
        return true; // Keep all other streams
    });

    // NEW: Apply size limit if not using a personal cookie
    let finalFilteredStreams = streamsToShowBoxFiltered;
    if (!global.currentRequestUserCookie) { // Check if personal cookie is NOT set
        console.log('[SizeLimit] No personal cookie detected. Applying 9GB size limit to ShowBox streams.');
        const NINE_GB_IN_BYTES = 9 * 1024 * 1024 * 1024;
        finalFilteredStreams = streamsToShowBoxFiltered.filter(stream => {
            const sizeInBytes = parseSizeToBytes(stream.size);
            if (sizeInBytes >= NINE_GB_IN_BYTES) {
                console.log(`[SizeLimit] Filtering out ShowBox stream due to size (${stream.size || 'Unknown size'}): ${stream.title}`);
                return false;
            }
            return true;
        });
    }

    if (finalFilteredStreams.length > 0) {
        console.log(`Found ${finalFilteredStreams.length} streams (sorted, ShowBox-low-quality-filtered, and size-limited if applicable):`);
        finalFilteredStreams.forEach((stream, i) => {
            console.log(`  ${i+1}. ${stream.quality} (${stream.size || 'Unknown size'}) [${(stream.codecs || []).join(', ') || 'No codec info'}]: ${stream.title}`);
        });
    }
    console.timeEnd(mainTimerLabel);
    return finalFilteredStreams;
};

// Function to handle TV shows with seasons and episodes
// MODIFICATION: Accept scraperApiKey -> MODIFICATION: Remove scraperApiKey
// New parameter: resolveFids, defaults to true. If false, skips fetching sources for FIDs.
const processShowWithSeasonsEpisodes = async (febboxUrl, showboxTitle, seasonNum, episodeNum, allStreams, resolveFids = true) => { // Removed lookupId parameter
    const processTimerLabel = `processShowWithSeasonsEpisodes_total_s${seasonNum}` + (episodeNum ? `_e${episodeNum}` : '_all') + (resolveFids ? '_resolve' : '_noresolve');
    console.time(processTimerLabel);
    console.log(`Processing TV Show: ${showboxTitle}, Season: ${seasonNum}, Episode: ${episodeNum !== null ? episodeNum : 'all'}${resolveFids ? '' : ' (FIDs not resolved)'}`);
    
    let selectedEpisode = null; // Ensure selectedEpisode is declared here

    // Cache for the main FebBox page
    const cacheSubDirMain = 'febbox_page_html';
    const simpleUrlKey = febboxUrl.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const cacheKeyMain = `${simpleUrlKey}.html`;
    
    // Try to get the main page from cache first
    let contentHtml = await getFromCache(cacheKeyMain, cacheSubDirMain);
    
    if (!contentHtml) {
        // If not cached, fetch the HTML content
        const fetchMainPageTimer = `processShowWithSeasonsEpisodes_fetchMainPage_s${seasonNum}`;
        console.time(fetchMainPageTimer);

        const cookieForRequest = await getCookieForRequest(); // Simplified cookie call
        
        // MODIFICATION: Removed ScraperAPI conditional logic
        // const useScraperApi = process.env.USE_SCRAPER_API === 'true';
        // const scraperApiKey = process.env.SCRAPER_API_KEY_VALUE;
        let finalFebboxUrl = febboxUrl;
        let axiosConfigMainPage = {
            headers: { 'Cookie': `ui=${cookieForRequest}` },
            timeout: 20000
        };

        // ... existing code ...
        console.log(`Fetching main FebBox page ${febboxUrl} directly`);

        try {
            const response = await axios.get(finalFebboxUrl, axiosConfigMainPage);
            contentHtml = response.data;
            if (typeof contentHtml === 'string' && contentHtml.length > 0) {
                await saveToCache(cacheKeyMain, contentHtml, cacheSubDirMain);
            }
            console.timeEnd(fetchMainPageTimer);
        } catch (error) {
            console.log(`Failed to fetch HTML content from ${febboxUrl}: ${error.message}`);
            console.timeEnd(fetchMainPageTimer); // End timer on error
            console.timeEnd(processTimerLabel);
            return;
        }
    }
    
    if (!contentHtml) {
        console.log(`No HTML content available for ${febboxUrl}`);
        console.timeEnd(processTimerLabel);
        return;
    }
    
    // Parse the HTML to find folders (seasons)
    const $ = cheerio.load(contentHtml);
    const shareKey = contentHtml.match(/(?:var share_key\s*=|share_key:\s*|shareid=)"?([a-zA-Z0-9]+)"?/)?.[1];
    
    if (!shareKey) {
        console.log(`Could not extract share_key from ${febboxUrl}`);
        console.timeEnd(processTimerLabel);
        return;
    }
    
    const folders = [];
    const fileElements = $('div.file.open_dir');
    
    fileElements.each((index, element) => {
        const feEl = $(element);
        const dataId = feEl.attr('data-id');
        if (!dataId || !/^\d+$/.test(dataId)) {
            return; // Skip if data-id is missing or not a number
        }
        
        const folderNameEl = feEl.find('p.file_name');
        const folderName = folderNameEl.length ? folderNameEl.text().trim() : feEl.attr('data-path') || `Folder_${dataId}`;
        folders.push({ id: dataId, name: folderName });
    });
    
    if (folders.length === 0) {
        console.log(`No season folders found on ${febboxUrl}`);
        // It might be directly files, so try the original logic as fallback
        console.time(`processShowWithSeasonsEpisodes_fallbackDirect_s${seasonNum}`);
        const { fids, directSources } = await extractFidsFromFebboxPage(febboxUrl);
        console.timeEnd(`processShowWithSeasonsEpisodes_fallbackDirect_s${seasonNum}`);
        
        if (directSources && directSources.length > 0) {
            for (const source of directSources) {
                const streamTitle = `${showboxTitle} - ${source.label}`;
                allStreams.push({
                    title: streamTitle, 
                    url: source.url,
                    quality: parseQualityFromLabel(source.label),
                    codecs: extractCodecDetails(source.detailedFilename || streamTitle) 
                });
            }
            console.timeEnd(processTimerLabel);
            return;
        }
        
        if (fids.length > 0) {
            console.time(`processShowWithSeasonsEpisodes_fallbackFids_s${seasonNum}_concurrent`);
            const fallbackFidPromises = fids.map(fid => fetchSourcesForSingleFid(fid, shareKey));
            const fallbackFidSourcesArray = await Promise.all(fallbackFidPromises);
            console.timeEnd(`processShowWithSeasonsEpisodes_fallbackFids_s${seasonNum}_concurrent`);

            for (const sources of fallbackFidSourcesArray) {
                for (const source of sources) {
                    const streamTitle = `${showboxTitle} - ${source.label}`;
                    allStreams.push({
                        title: streamTitle, 
                        url: source.url,
                        quality: parseQualityFromLabel(source.label),
                        codecs: extractCodecDetails(source.detailedFilename || streamTitle) 
                    });
                }
            }
        }
        console.timeEnd(processTimerLabel);
        return;
    }
    
    // Find matching season folder
    let selectedFolder = null;
    for (const folder of folders) {
        const folderNameLower = folder.name.toLowerCase();
        if (
            folderNameLower.includes(`season ${seasonNum}`) || 
            folderNameLower.includes(`s${seasonNum}`) ||
            folderNameLower.includes(`season${seasonNum}`) ||
            folderNameLower === `s${seasonNum}` ||
            folderNameLower === `season ${seasonNum}` ||
            (folderNameLower.match(/\d+/g) || []).includes(String(seasonNum))
        ) {
            selectedFolder = folder;
            break;
        }
    }
    
    // If no exact match, try index-based approach (season 1 = first folder)
    if (!selectedFolder && seasonNum > 0 && seasonNum <= folders.length) {
        selectedFolder = folders[seasonNum - 1];
    }
    
    if (!selectedFolder) {
        console.log(`Could not find season ${seasonNum} folder in ${febboxUrl}`);
        console.timeEnd(processTimerLabel);
        return;
    }
    
    console.log(`Found season folder: ${selectedFolder.name} (ID: ${selectedFolder.id})`);
    
    // Cache for season folder content
    const cacheSubDirFolderHtml = 'febbox_season_folders'; 
    const cacheSubDirFolderParsed = 'febbox_parsed_season_folders'; 
    const cacheKeyFolderHtml = `share-${shareKey}_folder-${selectedFolder.id}.html`;
    const cacheKeyFolderParsed = `share-${shareKey}_folder-${selectedFolder.id}_parsed.json`;
    
    let folderHtml = null; 
    let episodeDetails = []; // Declare episodeDetails here, initialized as an empty array
    let episodeFids = []; // Declare episodeFids here, initialized as an empty array

    const cachedParsedEpisodeList = await getFromCache(cacheKeyFolderParsed, cacheSubDirFolderParsed);
    if (cachedParsedEpisodeList && Array.isArray(cachedParsedEpisodeList)) {
        console.log(`  CACHE HIT for parsed episode list: Season ${seasonNum}, Folder ${selectedFolder.id}`);
        episodeDetails.push(...cachedParsedEpisodeList); // Populate if cache hit
    } else {
        // Parsed list not in cache, so we need to process HTML
        // console.log(`  CACHE MISS for parsed episode list: Season ${seasonNum}, Folder ${selectedFolder.id}`);
        folderHtml = await getFromCache(cacheKeyFolderHtml, cacheSubDirFolderHtml); // Assign to the higher-scoped folderHtml
        
        if (!folderHtml) {
            const fetchFolderTimer = `processShowWithSeasonsEpisodes_fetchFolder_s${seasonNum}_id${selectedFolder.id}`;
            console.time(fetchFolderTimer);
            try {
                const targetFolderListUrl = `${FEBBOX_FILE_SHARE_LIST_URL}?share_key=${shareKey}&parent_id=${selectedFolder.id}&is_html=1&pwd=`;
                
                const cookieForRequestFolder = await getCookieForRequest(); // Simplified cookie call
                let finalFolderUrl = targetFolderListUrl;
                let axiosConfigFolder = {
                    headers: {
                        'Cookie': `ui=${cookieForRequestFolder}`,
                        'Referer': febboxUrl,
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    timeout: 20000
                };

                console.log(`Fetching FebBox folder ${targetFolderListUrl} directly`);

                const folderResponse = await axios.get(finalFolderUrl, axiosConfigFolder);
                console.log(`  FebBox folder list response status: ${folderResponse.status}`);
                console.log(`  FebBox folder list response content-type: ${folderResponse.headers['content-type']}`);
                // Log the beginning of the data to inspect its structure
                const responseDataPreview = (typeof folderResponse.data === 'string') 
                    ? folderResponse.data.substring(0, 500) 
                    : JSON.stringify(folderResponse.data).substring(0,500);
                console.log(`  FebBox folder list response data (preview): ${responseDataPreview}`);
                
                if (folderResponse.data && typeof folderResponse.data === 'object' && folderResponse.data.html) {
                    folderHtml = folderResponse.data.html;
                    console.log(`    Successfully extracted HTML from FebBox folder list JSON response.`);
                } else if (typeof folderResponse.data === 'string') {
                    folderHtml = folderResponse.data;
                    console.log(`    Received direct HTML string from FebBox folder list response.`);
                } else {
                    console.log(`    Invalid or unexpected response format from FebBox folder API for ${selectedFolder.id}. Data: ${JSON.stringify(folderResponse.data)}`);
                    // folderHtml remains null
                }
                
                if (folderHtml && folderHtml.trim().length > 0) { // Also check if html is not just whitespace
                    await saveToCache(cacheKeyFolderHtml, folderHtml, cacheSubDirFolderHtml);
                    console.log(`    Cached FebBox folder HTML for ${selectedFolder.id}`);
                } else {
                    console.log(`    Folder HTML from FebBox was empty or null for ${selectedFolder.id}. Not caching.`);
                    folderHtml = null; // Ensure it's explicitly null if empty
                }
                console.timeEnd(fetchFolderTimer);
            } catch (error) {
                console.error(`  ERROR fetching FebBox folder content for ${selectedFolder.id}: ${error.message}`);
                if (error.response) {
                    console.error(`    FebBox Error Status: ${error.response.status}`);
                    console.error(`    FebBox Error Data: ${JSON.stringify(error.response.data)}`);
                }
                // console.timeEnd(fetchFolderTimer); // fetchFolderTimer might not be defined if cache hit for HTML but miss for parsed
                console.timeEnd(processTimerLabel); // End outer timer
                return; // Exit if fetching folder content fails
            }
        }
    }
    
    // If episodeDetails is populated from cache, folderHtml might be null. That's okay.
    // If episodeDetails is still empty, we must have folderHtml to parse.
    if (episodeDetails.length === 0) { // Only proceed if we didn't get data from parsed cache
        if (!folderHtml) { // If still no folderHtml (e.g. HTML cache miss and fetch fail), then error out
            console.log(`No folder HTML content available (and no cached parsed list) for folder ${selectedFolder.id}`);
            console.timeEnd(processTimerLabel);
            return;
        }

        // Parse the folderHtml since we didn't have a cached parsed list
        const $folder = cheerio.load(folderHtml);
        $folder('div.file').each((index, element) => {
            const feEl = $folder(element);
            const dataId = feEl.attr('data-id');
            if (!dataId || !/^\d+$/.test(dataId) || feEl.hasClass('open_dir')) {
                return; 
            }
            
            const fileNameEl = feEl.find('p.file_name');
            const fileName = fileNameEl.length ? fileNameEl.text().trim() : `File_${dataId}`;
            
            episodeDetails.push({ 
                fid: dataId, 
                name: fileName,
                episodeNum: getEpisodeNumberFromName(fileName)
            });
        });

        // After parsing, save the extracted episodeDetails to its cache
        // This will also save an empty array if parsing yields no episodes, preventing re-parsing of empty folders
        await saveToCache(cacheKeyFolderParsed, episodeDetails, cacheSubDirFolderParsed);
        if (episodeDetails.length > 0) {
            // console.log(`  SAVED PARSED episode list to cache: Season ${seasonNum}, Folder ${selectedFolder.id}`);
        }
    }
    
    // Sort episodes by their number (whether from cache or freshly parsed)
    // Ensure episodeDetails is sorted if populated
    if(episodeDetails.length > 0) {
      episodeDetails.sort((a, b) => a.episodeNum - b.episodeNum);
    }
    
    // If episode number specified, find matching episode
    if (episodeNum !== null) {
        // First try exact episode number match
        for (const episode of episodeDetails) {
            if (episode.episodeNum === episodeNum) {
                selectedEpisode = episode;
                break;
            }
        }
        
        // If no match by number, try index-based (episode 1 = first file)
        if (!selectedEpisode && episodeNum > 0 && episodeNum <= episodeDetails.length) {
            selectedEpisode = episodeDetails[episodeNum - 1];
        }
        
        if (!selectedEpisode) {
            console.log(`Could not find episode ${episodeNum} in season folder ${selectedFolder.name}`);
            console.timeEnd(processTimerLabel);
            return;
        }
        
        console.log(`Found episode: ${selectedEpisode.name} (FID: ${selectedEpisode.fid})`);
        episodeFids.push(selectedEpisode.fid); // Now episodeFids is already declared
    } else {
        // If no episode specified, process all episodes
        // Ensure episodeDetails is populated before mapping
        if (episodeDetails.length > 0) {
            episodeFids.push(...episodeDetails.map(ep => ep.fid)); // episodeFids is already declared
        } else {
            console.log(`  No episode details found for folder ${selectedFolder.name} to extract FIDs for all episodes.`);
        }
    }
    
    // Get video sources for each episode FID
    if (resolveFids && episodeFids.length > 0) { // Check resolveFids flag here
      const episodeTimerLabel = `processShowWithSeasonsEpisodes_fetchEpisodeSources_s${seasonNum}` + (episodeNum ? `_e${episodeNum}`: '_allEp_concurrent');
      console.time(episodeTimerLabel);
      const episodeSourcePromises = episodeFids.map(fid => fetchSourcesForSingleFid(fid, shareKey));
      const episodeSourcesResults = await Promise.all(episodeSourcePromises);
      console.timeEnd(episodeTimerLabel);

      for (const result of episodeSourcesResults) {
        const { fid, sources } = result;
        for (const source of sources) {
            const episodeDetail = episodeDetails.find(ep => ep.fid === fid);
            const episodeName = episodeDetail ? episodeDetail.name : '';
            
            const streamTitle = `${showboxTitle} - S${seasonNum}${episodeNum && selectedEpisode && fid === selectedEpisode.fid ? `E${episodeNum}` : (episodeDetail ? `E${episodeDetail.episodeNum}`: '')} - ${episodeName} - ${source.label}`;
            allStreams.push({
                title: streamTitle, 
                url: source.url,
                quality: parseQualityFromLabel(source.label),
                codecs: extractCodecDetails(source.detailedFilename || streamTitle) 
            });
        }
      }
    } else if (!resolveFids && episodeFids.length > 0) {
        console.log(`  Skipping FID resolution for ${episodeFids.length} episodes in S${seasonNum} as per request.`);
    }
    console.timeEnd(processTimerLabel);
};

// Helper function to get episode number from filename
function getEpisodeNumberFromName(name) {
    const nameLower = name.toLowerCase();
    
    // Common TV episode naming patterns
    const patterns = [
        /[._\s-]s\d{1,2}[._\s-]?e(\d{1,3})[._\s-]?/,  // S01E01, s1e1
        /[._\s-]e[cp]?[._\s-]?(\d{1,3})[._\s-]?/,     // E01, EP01
        /episode[._\s-]?(\d{1,3})/,                   // Episode 1
        /part[._\s-]?(\d{1,3})/,                      // Part 1
        /ep[._\s-]?(\d{1,3})/,                         // Ep 1
        /pt[._\s-]?(\d{1,3})/                          // Pt 1
    ];
    
    for (const pattern of patterns) {
        const match = nameLower.match(pattern);
        if (match && match[1]) {
            return parseInt(match[1], 10);
        }
    }
    
    // Try to find standalone numbers that might be episode numbers
    const simpleNumMatches = nameLower.match(/(?<![a-zA-Z])(\d{1,3})(?![a-zA-Z0-9])/g);
    if (simpleNumMatches && simpleNumMatches.length === 1) {
        const num = parseInt(simpleNumMatches[0], 10);
        // Avoid quality indicators like 1080p or dimensions like 1920x1080
        if (num > 0 && num < 200 && 
            !((simpleNumMatches[0] + "p") === nameLower) &&
            !nameLower.includes("x" + simpleNumMatches[0]) && 
            !nameLower.includes("h" + simpleNumMatches[0]) &&
            (nameLower.split(simpleNumMatches[0]).length - 1 <= 1 || !["1","2"].includes(simpleNumMatches[0]))
        ) {
            return num;
        }
    }
    
    // Default to infinity (for sorting purposes)
    return Infinity;
}

// Helper function to parse quality from label
function parseQualityFromLabel(label) {
    if (!label) return "ORG";
    
    const labelLower = String(label).toLowerCase();
    
    if (labelLower.includes('1080p') || labelLower.includes('1080')) {
        return "1080p";
    } else if (labelLower.includes('720p') || labelLower.includes('720')) {
        return "720p";
    } else if (labelLower.includes('480p') || labelLower.includes('480')) {
        return "480p";
    } else if (labelLower.includes('360p') || labelLower.includes('360')) {
        return "360p";
    } else if (labelLower.includes('2160p') || labelLower.includes('2160') || 
              labelLower.includes('4k') || labelLower.includes('uhd')) {
        return "2160p";
    } else if (labelLower.includes('hd')) {
        return "720p"; // Assuming HD is 720p
    } else if (labelLower.includes('sd')) {
        return "480p"; // Assuming SD is 480p
    }
    
    // Use ORG (original) label for unknown quality
    return "ORG";
}

// Helper function to parse size string to bytes
const parseSizeToBytes = (sizeString) => {
    if (!sizeString || typeof sizeString !== 'string') return Number.MAX_SAFE_INTEGER;

    const sizeLower = sizeString.toLowerCase();

    if (sizeLower.includes('unknown') || sizeLower.includes('n/a')) {
        return Number.MAX_SAFE_INTEGER; // Sort unknown/NA sizes last
    }

    const units = {
        gb: 1024 * 1024 * 1024,
        mb: 1024 * 1024,
        kb: 1024,
        b: 1
    };

    const match = sizeString.match(/([\d.]+)\s*(gb|mb|kb|b)/i);
    if (match && match[1] && match[2]) {
        const value = parseFloat(match[1]);
        const unit = match[2].toLowerCase();
        if (!isNaN(value) && units[unit]) {
            return Math.floor(value * units[unit]);
        }
    }
    return Number.MAX_SAFE_INTEGER; // Fallback for unparsed strings
};

// Helper function to extract codec details from a string (filename/label)
const extractCodecDetails = (text) => {
    if (!text || typeof text !== 'string') return [];
    const details = new Set();
    const lowerText = text.toLowerCase();

    // Video Codecs & Technologies
    if (lowerText.includes('dolby vision') || lowerText.includes('dovi') || lowerText.includes('.dv.')) details.add('DV');
    if (lowerText.includes('hdr10+') || lowerText.includes('hdr10plus')) details.add('HDR10+');
    else if (lowerText.includes('hdr')) details.add('HDR'); // General HDR if not HDR10+
    if (lowerText.includes('sdr')) details.add('SDR');
    
    if (lowerText.includes('av1')) details.add('AV1');
    else if (lowerText.includes('h265') || lowerText.includes('x265') || lowerText.includes('hevc')) details.add('H.265');
    else if (lowerText.includes('h264') || lowerText.includes('x264') || lowerText.includes('avc')) details.add('H.264');
    
    // Audio Codecs
    if (lowerText.includes('atmos')) details.add('Atmos');
    if (lowerText.includes('truehd') || lowerText.includes('true-hd')) details.add('TrueHD');
    if (lowerText.includes('dts-hd ma') || lowerText.includes('dtshdma') || lowerText.includes('dts-hdhr')) details.add('DTS-HD MA');
    else if (lowerText.includes('dts-hd')) details.add('DTS-HD'); // General DTS-HD if not MA/HR
    else if (lowerText.includes('dts') && !lowerText.includes('dts-hd')) details.add('DTS'); // Plain DTS

    if (lowerText.includes('eac3') || lowerText.includes('e-ac-3') || lowerText.includes('dd+') || lowerText.includes('ddplus')) details.add('EAC3');
    else if (lowerText.includes('ac3') || (lowerText.includes('dd') && !lowerText.includes('dd+') && !lowerText.includes('ddp'))) details.add('AC3'); // Plain AC3/DD
    
    if (lowerText.includes('aac')) details.add('AAC');
    if (lowerText.includes('opus')) details.add('Opus');
    if (lowerText.includes('mp3')) details.add('MP3');

    // Bit depth (less common but useful)
    if (lowerText.includes('10bit') || lowerText.includes('10-bit')) details.add('10-bit');
    else if (lowerText.includes('8bit') || lowerText.includes('8-bit')) details.add('8-bit');

    return Array.from(details);
};

// Utility function to sort streams by quality in order of resolution
function sortStreamsByQuality(streams) {
    // Since Stremio displays streams from bottom to top,
    // we need to sort in reverse order to what we want to show
    const qualityOrder = {
        "ORG": 1,     // ORG will show at the top (since it's at the bottom of the list)
        "2160p": 2,
        "1080p": 3,
        "720p": 4, 
        "480p": 5,
        "360p": 6     // 360p will show at the bottom
    };

    // Provider sort order: lower number means earlier in array (lower in Stremio UI for same quality/size)
    const providerSortKeys = {
        'HollyMovieHD': 1,
        'Soaper TV': 2,
        'Xprime.tv': 3,
        'ShowBox': 4,
        // Default for unknown providers
        default: 99 
    };
    
    return [...streams].sort((a, b) => {
        const qualityA = a.quality || "ORG";
        const qualityB = b.quality || "ORG";
        
        const orderA = qualityOrder[qualityA] || 10;
        const orderB = qualityOrder[qualityB] || 10;
        
        // First, compare by quality order
        if (orderA !== orderB) {
            return orderA - orderB;
        }
        
        // If qualities are the same, compare by size (descending - larger sizes first means earlier in array)
        const sizeAInBytes = parseSizeToBytes(a.size);
        const sizeBInBytes = parseSizeToBytes(b.size);
        
        if (sizeAInBytes !== sizeBInBytes) {
            return sizeBInBytes - sizeAInBytes; 
        }

        // If quality AND size are the same, compare by provider
        const providerA = a.provider || 'default';
        const providerB = b.provider || 'default';

        const providerOrderA = providerSortKeys[providerA] || providerSortKeys.default;
        const providerOrderB = providerSortKeys[providerB] || providerSortKeys.default;

        return providerOrderA - providerOrderB;
    });
}

// Initialize the cache directory
ensureCacheDir(CACHE_DIR).catch(console.error);

// Initialize fallback cookies on startup (optional, can be lazy-loaded too)
loadFallbackCookies().then(fallbackCookies => {
    cookieCache = fallbackCookies; // Store loaded fallback cookies
    // console.log(`Initialized ${cookieCache ? cookieCache.length : 0} fallback cookies.`);
}).catch(err => {
    console.warn(`Failed to initialize fallback cookies: ${err.message}`);
});

module.exports = {
    getStreamsFromTmdbId,
    parseQualityFromLabel,
    convertImdbToTmdb,
    getShowboxUrlFromTmdbInfo,
    ShowBoxScraper, 
    extractFidsFromFebboxPage,
    processShowWithSeasonsEpisodes,
    sortStreamsByQuality
}; 