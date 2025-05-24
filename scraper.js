const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');

// Constants from unified_scraper.js
const SCRAPER_API_KEY = '96845d13e7a0a0d40fb4f148cd135ddc';
const FEBBOX_COOKIE = 'ui=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NDgwNjYzMjgsIm5iZiI6MTc0ODA2NjMyOCwiZXhwIjoxNzc5MTcwMzQ4LCJkYXRhIjp7InVpZCI6NzgyNDcwLCJ0b2tlbiI6ImUwMTAyNjIyOWMyOTVlOTFlOTY0MWJjZWZiZGE4MGUxIn19.Za7tx60gu8rq9pLw1LVuIjROaBJzgF_MV049B8NO3L8';
const FEBBOX_PLAYER_URL = "https://www.febbox.com/file/player";
const FEBBOX_FILE_SHARE_LIST_URL = "https://www.febbox.com/file/file_share_list";
const SCRAPER_API_URL = 'https://api.scraperapi.com/';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const CACHE_DIR = path.join(__dirname, '.cache');

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

// TMDB helper function to get ShowBox URL from TMDB ID
const getShowboxUrlFromTmdbInfo = async (tmdbType, tmdbId) => {
    const cacheSubDir = 'tmdb_api';
    const cacheKey = `tmdb-${tmdbType}-${tmdbId}.json`;
    const cachedTmdbData = await getFromCache(cacheKey, cacheSubDir);

    let tmdbData = cachedTmdbData;

    if (!tmdbData) {
        const tmdbApiUrl = `${TMDB_BASE_URL}/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
        console.log(`  Fetching TMDB data from: ${tmdbApiUrl}`);
        try {
            const response = await axios.get(tmdbApiUrl, { timeout: 10000 });
            tmdbData = response.data;
            if (tmdbData) {
                await saveToCache(cacheKey, tmdbData, cacheSubDir);
            } else {
                console.log(`  TMDB API call succeeded but returned no data for ${tmdbType}/${tmdbId}.`);
                return null;
            }
        } catch (error) {
            const errorMessage = error.response ? `${error.message} (Status: ${error.response.status})` : error.message;
            console.log(`  Error fetching data from TMDB for ${tmdbType}/${tmdbId}: ${errorMessage}`);
            if (error.response && error.response.status === 401) {
                console.error("  TMDB API Error: Unauthorized. Check if your TMDB_API_KEY is valid and active.");
            }
            return null;
        }
    }

    if (!tmdbData) return null;

    let title = null;
    let year = null;

    if (tmdbType === 'movie') {
        title = tmdbData.title || tmdbData.original_title;
        if (tmdbData.release_date && String(tmdbData.release_date).length >= 4) {
            year = String(tmdbData.release_date).substring(0, 4);
        }
    } else if (tmdbType === 'tv') {
        title = tmdbData.name || tmdbData.original_name;
        let rawFirstAirDate = tmdbData.first_air_date;
        if (rawFirstAirDate === "") {
            console.log(`  Raw TV TMDB data for ${tmdbId} (first_air_date) is an EMPTY STRING.`);
        } else {
            console.log(`  Raw TV TMDB data for ${tmdbId} (first_air_date):`, rawFirstAirDate);
        }

        if (rawFirstAirDate && String(rawFirstAirDate).length >= 4) {
            year = String(rawFirstAirDate).substring(0, 4);
        }
    }

    const safeTitle = title || "untitled";
    const slug = safeTitle.toLowerCase()
        .replace(/[\/\\_:,.'"()?!]+/g, ' ')
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

    const showboxPrefix = tmdbType === 'movie' ? 'm' : 't';
    let constructedShowboxUrl = `https://www.showbox.media/${tmdbType}/${showboxPrefix}-`;

    if (slug && slug !== 'untitled') {
        constructedShowboxUrl += `${slug}-`;
    }
    if (year) {
        constructedShowboxUrl += `${year}`;
    } else if (constructedShowboxUrl.endsWith('-')) {
        constructedShowboxUrl = constructedShowboxUrl.slice(0, -1);
    }

    console.log(`  Constructed ShowBox URL: ${constructedShowboxUrl}`);
    return constructedShowboxUrl;
};

// Function to fetch sources for a single FID
const fetchSourcesForSingleFid = async (fidToProcess, shareKey) => {
    const cacheSubDir = 'febbox_player';
    const cacheKey = `fid-${fidToProcess}_share-${shareKey}.json`;

    // 1. Attempt to retrieve from cache first
    console.log(`  Attempting to retrieve cached player data for FID: ${fidToProcess} (Share: ${shareKey}`);
    const cachedData = await getFromCache(cacheKey, cacheSubDir);

    if (cachedData) {
        const fidVideoLinks = [];
        // Logic to parse cachedData (re-used from original logic)
        if (Array.isArray(cachedData)) {
            for (const sourceItem of cachedData) {
                if (sourceItem.url && sourceItem.label) {
                    fidVideoLinks.push({
                        "label": String(sourceItem.label),
                        "url": String(sourceItem.url)
                    });
                }
            }
        } else if (typeof cachedData === 'object' && cachedData.label && cachedData.url) {
            fidVideoLinks.push({
                "label": String(cachedData.label),
                "url": String(cachedData.url)
            });
        } else if (typeof cachedData === 'string' && cachedData.startsWith('http')) {
            fidVideoLinks.push({ "label": "DirectLink (cached)", "url": cachedData.trim() });
        }

        if (fidVideoLinks.length > 0) {
            console.log(`    Using ${fidVideoLinks.length} cached video link(s) for FID ${fidToProcess}`);
            return fidVideoLinks;
        } else {
            console.log(`    Cached data found for FID ${fidToProcess} but was empty or malformed. Fetching fresh data.`);
        }
    } else {
        console.log(`  No cached player data found for FID: ${fidToProcess}. Fetching fresh data.`);
    }

    // 2. If not in cache, or cache was invalid, fetch fresh data
    console.log(`  Fetching fresh player data for video FID: ${fidToProcess} (Share: ${shareKey}`);

    const scraperApiPayloadForPost = {
        api_key: SCRAPER_API_KEY,
        url: FEBBOX_PLAYER_URL,
        keep_headers: 'true'
    };

    const targetPostData = new URLSearchParams();
    targetPostData.append('fid', fidToProcess);
    targetPostData.append('share_key', shareKey);

    const headers = {
        'Cookie': FEBBOX_COOKIE,
        'Content-Type': 'application/x-www-form-urlencoded'
    };

    try {
        const response = await axios.post(SCRAPER_API_URL, targetPostData.toString(), {
            params: scraperApiPayloadForPost,
            headers: headers,
            timeout: 20000
        });
        const playerContent = response.data;
        let freshFidVideoLinks = [];

        const sourcesMatch = playerContent.match(/var sources = (.*?);\\s*/s);
        if (!sourcesMatch) {
            console.log(`    Could not find sources array in player response for FID ${fidToProcess}`);
            if (playerContent.startsWith('http') && (playerContent.includes('.mp4') || playerContent.includes('.m3u8'))) {
                freshFidVideoLinks = [{ "label": "DirectLink", "url": playerContent.trim() }];
                await saveToCache(cacheKey, freshFidVideoLinks, cacheSubDir);
                console.log(`    Saved direct link to cache for FID ${fidToProcess}`);
                return freshFidVideoLinks;
            }
            try {
                const jsonResponse = JSON.parse(playerContent);
                if (jsonResponse.msg) {
                    console.log(`    FebBox API Error: ${jsonResponse.code} - ${jsonResponse.msg}`);
                }
            } catch (e) { /* Not a JSON error message */ }
            return []; // Return empty if no sources and not a direct link
        }

        const sourcesJsArrayString = sourcesMatch[1];
        try {
            const sourcesData = JSON.parse(sourcesJsArrayString);
            for (const sourceItem of sourcesData) {
                if (sourceItem.file && sourceItem.label) {
                    freshFidVideoLinks.push({
                        "label": String(sourceItem.label),
                        "url": String(sourceItem.file)
                    });
                }
            }
        } catch (e) {
            console.log(`    Error parsing sources JSON for FID ${fidToProcess}: ${e.message}`);
            return []; // Return empty if sources JSON is malformed
        }
        
        if (freshFidVideoLinks.length > 0) {
            console.log(`    Extracted ${freshFidVideoLinks.length} fresh video link(s) for FID ${fidToProcess}`);
            await saveToCache(cacheKey, freshFidVideoLinks, cacheSubDir); // Save fresh data
        } else {
            console.log(`    Fetched fresh data for FID ${fidToProcess}, but no valid links found.`);
        }
        return freshFidVideoLinks; // Return fresh data (could be empty)
    } catch (error) {
        console.log(`    Request error during fresh fetch for FID ${fidToProcess}: ${error.message}`);
        // Since we already tried cache, if fresh fetch fails, we return empty.
        return [];
    }
};

// ShowBox scraper class
class ShowBoxScraper {
    constructor() {
        this.baseUrl = SCRAPER_API_URL;
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.google.com/'
        };
    }

    async _makeRequest(url, isJsonExpected = false) {
        const cacheSubDir = 'showbox_generic';
        const simpleUrlKey = url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9_.-]/g, '_');
        const cacheKey = `${simpleUrlKey}${isJsonExpected ? '.json' : '.html'}`;

        const cachedData = await getFromCache(cacheKey, cacheSubDir);
        if (cachedData) {
            if ((isJsonExpected && typeof cachedData === 'object') || (!isJsonExpected && typeof cachedData === 'string')) {
                return cachedData;
            }
        }

        console.log(`ShowBoxScraper: Making request to: ${url} via ScraperAPI`);
 
        const payload = {
            api_key: SCRAPER_API_KEY,
            url: url,
            keep_headers: 'true'
        };
        const currentHeaders = { ...this.headers };
        if (isJsonExpected) {
            currentHeaders['Accept'] = 'application/json, text/javascript, */*; q=0.01';
            currentHeaders['X-Requested-With'] = 'XMLHttpRequest';
        }

        try {
            const response = await axios.get(this.baseUrl, { 
                params: payload, 
                headers: currentHeaders, 
                timeout: 30000 
            });
            const responseData = response.data;

            if (responseData) {
                await saveToCache(cacheKey, responseData, cacheSubDir);
            }
            return responseData;
        } catch (error) {
            const errorMessage = error.response ? `${error.message} (Status: ${error.response.status})` : error.message;
            console.log(`ShowBoxScraper: Request failed for ${url}: ${errorMessage}`);
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
        console.log(`ShowBoxScraper: Attempting to extract FebBox share link from: ${showboxUrl}`);
        
        let htmlContent = null;
        let contentInfo = this.extractContentIdAndType(showboxUrl, null);

        if (!contentInfo || !contentInfo.id || !contentInfo.type) {
            console.log("ShowBoxScraper: ID/Type not in URL, fetching HTML.");
            htmlContent = await this._makeRequest(showboxUrl);
            if (!htmlContent) {
                console.log(`ShowBoxScraper: Failed to fetch HTML for ${showboxUrl}.`);
                return [];
            }
            contentInfo = this.extractContentIdAndType(showboxUrl, htmlContent);
        }

        if (!contentInfo || !contentInfo.id || !contentInfo.type) {
            console.log(`ShowBoxScraper: Could not determine content ID/type for ${showboxUrl}.`);
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
        const apiResponseStr = await this._makeRequest(shareApiUrl, true);

        if (!apiResponseStr) {
            console.log(`ShowBoxScraper: Failed to get response from ShowBox share_link API`);
            return [];
        }
        
        try {
            const apiResponseJson = (typeof apiResponseStr === 'string') ? JSON.parse(apiResponseStr) : apiResponseStr;
            if (apiResponseJson.code === 1 && apiResponseJson.data && apiResponseJson.data.link) {
                const febboxShareUrl = apiResponseJson.data.link;
                console.log(`ShowBoxScraper: Successfully fetched FebBox URL: ${febboxShareUrl}`);
                return [{
                    "showbox_title": title,
                    "febbox_share_url": febboxShareUrl,
                    "showbox_content_id": contentId,
                    "showbox_content_type": contentType
                }];
            } else {
                console.log(`ShowBoxScraper: ShowBox share_link API did not succeed for '${title}'.`);
                return [];
            }
        } catch (e) {
            console.log(`ShowBoxScraper: Error decoding JSON from ShowBox share_link API: ${e.message}`);
            return [];
        }
    }
}

// Function to extract FIDs from FebBox share page
const extractFidsFromFebboxPage = async (febboxUrl) => {
    const cacheSubDir = 'febbox_page_html';
    const simpleUrlKey = febboxUrl.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const cacheKey = `${simpleUrlKey}.html`;

    let contentHtml = await getFromCache(cacheKey, cacheSubDir);

    if (!contentHtml) {
        const headers = { 'Cookie': FEBBOX_COOKIE };
        const payloadInitial = { api_key: SCRAPER_API_KEY, url: febboxUrl, keep_headers: 'true' };
        try {
            console.log(`Fetching FebBox page content from URL: ${febboxUrl}`);
            const response = await axios.get(SCRAPER_API_URL, { 
                params: payloadInitial, 
                headers: headers, 
                timeout: 20000 
            });
            contentHtml = response.data;
            if (typeof contentHtml === 'string' && contentHtml.length > 0) {
                await saveToCache(cacheKey, contentHtml, cacheSubDir);
            }
        } catch (error) {
            console.log(`Failed to fetch FebBox page: ${error.message}`);
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
                return { 
                    fids: [], 
                    shareKey,
                    directSources: sourcesData.map(source => ({
                        label: String(source.label || 'Default'),
                        url: String(source.file)
                    })).filter(source => !!source.url)
                };
            } catch (e) {
                console.log(`Error decoding direct jwplayer sources: ${e.message}`);
            }
        }
    }

    // File list check
    const fileElements = $('div.file');
    if (fileElements.length === 0) {
        return { fids: [], shareKey };
    }

    fileElements.each((index, element) => {
        const feEl = $(element);
        const dataId = feEl.attr('data-id');
        if (!dataId || !/^\d+$/.test(dataId) || feEl.hasClass('open_dir')) {
            return; // Skip folders or invalid IDs
        }
        videoFidsFound.push(dataId);
    });

    return { fids: [...new Set(videoFidsFound)], shareKey };
};

// Function to convert IMDb ID to TMDB ID using TMDB API
const convertImdbToTmdb = async (imdbId) => {
    if (!imdbId || !imdbId.startsWith('tt')) {
        console.log('  Invalid IMDb ID format provided for conversion.', imdbId);
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
            return cachedData;
        }
        console.log('    Cached data for IMDb conversion is malformed. Fetching fresh.');
    }

    const findApiUrl = `${TMDB_BASE_URL}/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
    console.log(`    Fetching from TMDB find API: ${findApiUrl}`);

    try {
        const response = await axios.get(findApiUrl, { timeout: 10000 });
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
                return result;
            } else {
                 console.log(`    Could not convert IMDb ID ${imdbId} to a usable TMDB movie/tv ID.`);
            }
        }
    } catch (error) {
        const errorMessage = error.response ? `${error.message} (Status: ${error.response.status})` : error.message;
        console.log(`    Error during TMDB find API call for IMDb ID ${imdbId}: ${errorMessage}`);
    }
    return null;
};

// Exposed API for the Stremio addon
// This will be a function to get streams from a TMDB ID
const getStreamsFromTmdbId = async (tmdbType, tmdbId, seasonNum = null, episodeNum = null) => {
    console.log(`Getting streams for TMDB ${tmdbType}/${tmdbId}${seasonNum !== null ? `, Season ${seasonNum}` : ''}${episodeNum !== null ? `, Episode ${episodeNum}` : ''}`);
    
    // First, get the ShowBox URL from TMDB ID
    const showboxUrl = await getShowboxUrlFromTmdbInfo(tmdbType, tmdbId);
    if (!showboxUrl) {
        console.log(`Could not construct ShowBox URL for TMDB ${tmdbType}/${tmdbId}`);
        return [];
    }
    
    // Then, get FebBox link from ShowBox
    const showboxScraper = new ShowBoxScraper();
    const febboxShareInfos = await showboxScraper.extractFebboxShareLinks(showboxUrl);
    if (!febboxShareInfos || febboxShareInfos.length === 0) {
        console.log(`No FebBox share links found for ${showboxUrl}`);
        return [];
    }
    
    // For each FebBox link, get the video sources
    const allStreams = [];
    
    for (const shareInfo of febboxShareInfos) {
        const febboxUrl = shareInfo.febbox_share_url;
        const showboxTitle = shareInfo.showbox_title || "Unknown Title";
        
        console.log(`Processing FebBox URL: ${febboxUrl} (${showboxTitle})`);
        
        // For TV shows, handle season and episode
        if (tmdbType === 'tv' && seasonNum !== null) {
            await processShowWithSeasonsEpisodes(febboxUrl, showboxTitle, seasonNum, episodeNum, allStreams);
        } else {
            // Handle movies or TV shows without season/episode specified (old behavior)
            // Extract FIDs from FebBox page
            const { fids, shareKey, directSources } = await extractFidsFromFebboxPage(febboxUrl);
            
            // If we have direct sources from player setup
            if (directSources && directSources.length > 0) {
                for (const source of directSources) {
                    allStreams.push({
                        title: `${showboxTitle} - ${source.label}`,
                        url: source.url,
                        quality: parseQualityFromLabel(source.label)
                    });
                }
                continue; // Skip FID processing if we have direct sources
            }
            
            // Process FIDs
            if (fids.length > 0 && shareKey) {
                for (const fid of fids) {
                    const sources = await fetchSourcesForSingleFid(fid, shareKey);
                    for (const source of sources) {
                        allStreams.push({
                            title: `${showboxTitle} - ${source.label}`,
                            url: source.url,
                            quality: parseQualityFromLabel(source.label)
                        });
                    }
                }
            } else {
                console.log(`No FIDs or share key found for ${febboxUrl}`);
            }
        }
    }
    
    // Sort streams by quality before returning
    const sortedStreams = sortStreamsByQuality(allStreams);
    
    if (sortedStreams.length > 0) {
        console.log(`Found ${sortedStreams.length} streams (sorted by quality):`);
        sortedStreams.forEach((stream, i) => {
            console.log(`  ${i+1}. ${stream.quality}: ${stream.title}`);
        });
    }
    
    return sortedStreams;
};

// Function to handle TV shows with seasons and episodes
const processShowWithSeasonsEpisodes = async (febboxUrl, showboxTitle, seasonNum, episodeNum, allStreams) => {
    console.log(`Processing TV Show: ${showboxTitle}, Season: ${seasonNum}, Episode: ${episodeNum !== null ? episodeNum : 'all'}`);
    
    // Cache for the main FebBox page
    const cacheSubDirMain = 'febbox_page_html';
    const simpleUrlKey = febboxUrl.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const cacheKeyMain = `${simpleUrlKey}.html`;
    
    // Try to get the main page from cache first
    let contentHtml = await getFromCache(cacheKeyMain, cacheSubDirMain);
    
    if (!contentHtml) {
        // If not cached, fetch the HTML content
        try {
            const response = await axios.get(SCRAPER_API_URL, {
                params: {
                    api_key: SCRAPER_API_KEY,
                    url: febboxUrl,
                    keep_headers: 'true'
                },
                headers: {
                    'Cookie': FEBBOX_COOKIE
                },
                timeout: 20000
            });
            
            contentHtml = response.data;
            if (typeof contentHtml === 'string' && contentHtml.length > 0) {
                await saveToCache(cacheKeyMain, contentHtml, cacheSubDirMain);
            }
        } catch (error) {
            console.log(`Failed to fetch HTML content from ${febboxUrl}: ${error.message}`);
            return;
        }
    }
    
    if (!contentHtml) {
        console.log(`No HTML content available for ${febboxUrl}`);
        return;
    }
    
    // Parse the HTML to find folders (seasons)
    const $ = cheerio.load(contentHtml);
    const shareKey = contentHtml.match(/(?:var share_key\s*=|share_key:\s*|shareid=)"?([a-zA-Z0-9]+)"?/)?.[1];
    
    if (!shareKey) {
        console.log(`Could not extract share_key from ${febboxUrl}`);
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
        const { fids, directSources } = await extractFidsFromFebboxPage(febboxUrl);
        
        if (directSources && directSources.length > 0) {
            for (const source of directSources) {
                allStreams.push({
                    title: `${showboxTitle} - ${source.label}`,
                    url: source.url,
                    quality: parseQualityFromLabel(source.label)
                });
            }
            return;
        }
        
        if (fids.length > 0) {
            for (const fid of fids) {
                const sources = await fetchSourcesForSingleFid(fid, shareKey);
                for (const source of sources) {
                    allStreams.push({
                        title: `${showboxTitle} - ${source.label}`,
                        url: source.url,
                        quality: parseQualityFromLabel(source.label)
                    });
                }
            }
        }
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
        return;
    }
    
    console.log(`Found season folder: ${selectedFolder.name} (ID: ${selectedFolder.id})`);
    
    // Cache for season folder content
    const cacheSubDirFolder = 'febbox_season_folders';
    const cacheKeyFolder = `share-${shareKey}_folder-${selectedFolder.id}.html`;
    
    // Try to get folder content from cache first
    let folderHtml = await getFromCache(cacheKeyFolder, cacheSubDirFolder);
    
    if (!folderHtml) {
        // If not cached, fetch the folder content
        try {
            const folderResponse = await axios.get(SCRAPER_API_URL, {
                params: {
                    api_key: SCRAPER_API_KEY,
                    url: `${FEBBOX_FILE_SHARE_LIST_URL}?share_key=${shareKey}&parent_id=${selectedFolder.id}&is_html=1&pwd=`,
                    keep_headers: 'true'
                },
                headers: {
                    'Cookie': FEBBOX_COOKIE,
                    'Referer': febboxUrl,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                timeout: 20000
            });
            
            if (folderResponse.data && typeof folderResponse.data === 'object' && folderResponse.data.html) {
                folderHtml = folderResponse.data.html;
            } else if (typeof folderResponse.data === 'string') {
                folderHtml = folderResponse.data;
            } else {
                console.log(`Invalid response format from folder API for ${selectedFolder.id}`);
                return;
            }
            
            if (folderHtml) {
                await saveToCache(cacheKeyFolder, folderHtml, cacheSubDirFolder);
            }
        } catch (error) {
            console.log(`Failed to fetch folder content for ${selectedFolder.id}: ${error.message}`);
            return;
        }
    }
    
    if (!folderHtml) {
        console.log(`No folder HTML content available for folder ${selectedFolder.id}`);
        return;
    }
    
    const $folder = cheerio.load(folderHtml);
    const episodeFids = [];
    const episodeDetails = [];
    
    $folder('div.file').each((index, element) => {
        const feEl = $folder(element);
        const dataId = feEl.attr('data-id');
        if (!dataId || !/^\d+$/.test(dataId) || feEl.hasClass('open_dir')) {
            return; // Skip folders or invalid IDs
        }
        
        const fileNameEl = feEl.find('p.file_name');
        const fileName = fileNameEl.length ? fileNameEl.text().trim() : `File_${dataId}`;
        
        episodeDetails.push({ 
            fid: dataId, 
            name: fileName,
            episodeNum: getEpisodeNumberFromName(fileName)
        });
    });
    
    // Sort episodes by their number
    episodeDetails.sort((a, b) => a.episodeNum - b.episodeNum);
    
    // If episode number specified, find matching episode
    if (episodeNum !== null) {
        let selectedEpisode = null;
        
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
            return;
        }
        
        console.log(`Found episode: ${selectedEpisode.name} (FID: ${selectedEpisode.fid})`);
        episodeFids.push(selectedEpisode.fid);
    } else {
        // If no episode specified, process all episodes
        episodeFids.push(...episodeDetails.map(ep => ep.fid));
    }
    
    // Get video sources for each episode FID
    for (const fid of episodeFids) {
        const sources = await fetchSourcesForSingleFid(fid, shareKey);
        for (const source of sources) {
            // Find the episode detail for this FID to include in title
            const episodeDetail = episodeDetails.find(ep => ep.fid === fid);
            const episodeName = episodeDetail ? episodeDetail.name : '';
            
            allStreams.push({
                title: `${showboxTitle} - S${seasonNum}${episodeNum ? `E${episodeNum}` : ''} - ${episodeName} - ${source.label}`,
                url: source.url,
                quality: parseQualityFromLabel(source.label)
            });
        }
    }
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
    
    return [...streams].sort((a, b) => {
        // Get quality values with fallback to "ORG"
        const qualityA = a.quality || "ORG";
        const qualityB = b.quality || "ORG";
        
        // Get sort order with fallback to highest number (put at bottom)
        const orderA = qualityOrder[qualityA] || 10;
        const orderB = qualityOrder[qualityB] || 10;
        
        // Lower value will appear at the bottom in Stremio (top of our list)
        return orderA - orderB;
    });
}

// Initialize the cache directory
ensureCacheDir(CACHE_DIR).catch(console.error);

module.exports = {
    getStreamsFromTmdbId,
    parseQualityFromLabel,
    convertImdbToTmdb
}; 