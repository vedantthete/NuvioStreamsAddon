require('dotenv').config(); // Load environment variables
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');

// Helper function to fetch stream size using a HEAD request
const fetchStreamSize = async (url) => {
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
        return 'Unknown size';
    }
};

// Constants from unified_scraper.js
// MODIFICATION: Remove hardcoded SCRAPER_API_KEY
// const SCRAPER_API_KEY = '96845d13e7a0a0d40fb4f148cd135ddc'; 
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

// TMDB helper function to get ShowBox URL from TMDB ID
// MODIFICATION: Accept scraperApiKey
const getShowboxUrlFromTmdbInfo = async (tmdbType, tmdbId, scraperApiKey) => {
    console.time('getShowboxUrlFromTmdbInfo_total');
    const cacheSubDir = 'tmdb_api';
    const cacheKey = `tmdb-${tmdbType}-${tmdbId}.json`;
    const cachedTmdbData = await getFromCache(cacheKey, cacheSubDir);

    let tmdbData = cachedTmdbData;

    if (!tmdbData) {
        const tmdbApiUrl = `${TMDB_BASE_URL}/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
        console.log(`  Fetching TMDB data from: ${tmdbApiUrl}`);
        console.time('getShowboxUrlFromTmdbInfo_tmdbApiCall');
        try {
            const response = await axios.get(tmdbApiUrl, { timeout: 10000 });
            tmdbData = response.data;
            if (tmdbData) {
                await saveToCache(cacheKey, tmdbData, cacheSubDir);
            } else {
                console.log(`  TMDB API call succeeded but returned no data for ${tmdbType}/${tmdbId}.`);
                console.timeEnd('getShowboxUrlFromTmdbInfo_tmdbApiCall');
                console.timeEnd('getShowboxUrlFromTmdbInfo_total');
                return null;
            }
        } catch (error) {
            const errorMessage = error.response ? `${error.message} (Status: ${error.response.status})` : error.message;
            console.log(`  Error fetching data from TMDB for ${tmdbType}/${tmdbId}: ${errorMessage}`);
            if (error.response && error.response.status === 401) {
                console.error("  TMDB API Error: Unauthorized. Check if your TMDB_API_KEY is valid and active.");
            }
            console.timeEnd('getShowboxUrlFromTmdbInfo_tmdbApiCall');
            console.timeEnd('getShowboxUrlFromTmdbInfo_total');
            return null;
        }
        console.timeEnd('getShowboxUrlFromTmdbInfo_tmdbApiCall');
    }

    if (!tmdbData) {
        console.timeEnd('getShowboxUrlFromTmdbInfo_total');
        return null;
    }

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
    console.timeEnd('getShowboxUrlFromTmdbInfo_total');
    return { showboxUrl: constructedShowboxUrl, year: year, title: title };
};

// Function to fetch sources for a single FID
// MODIFICATION: Accept scraperApiKey
const fetchSourcesForSingleFid = async (fidToProcess, shareKey, scraperApiKey) => {
    console.log(`  Fetching fresh player data for video FID: ${fidToProcess} (Share: ${shareKey}) - Caching disabled for these links.`);
    console.time(`fetchSourcesForSingleFid_${fidToProcess}`);
    
    const scraperApiPayloadForPost = {
        // MODIFICATION: Use passed scraperApiKey
        api_key: scraperApiKey, 
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
            timeout: 20000 // MODIFICATION: Consider increasing this if timeouts persist
        });
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
        console.timeEnd(`fetchSourcesForSingleFid_${fidToProcess}`);
        return fidVideoLinks;
    } catch (error) {
        console.log(`    Request error for FID ${fidToProcess}: ${error.message}`);
        console.log(`    Fresh fetch failed for FID ${fidToProcess}.`);
        console.timeEnd(`fetchSourcesForSingleFid_${fidToProcess}`);
        return [];
    }
};

// ShowBox scraper class
class ShowBoxScraper {
    // MODIFICATION: Constructor accepts scraperApiKey
    constructor(scraperApiKey) {
        this.baseUrl = SCRAPER_API_URL;
        this.scraperApiKey = scraperApiKey; // Store it
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
        const timerLabel = `ShowBoxScraper_makeRequest_${simpleUrlKey}`;

        const cachedData = await getFromCache(cacheKey, cacheSubDir);
        if (cachedData) {
            if ((isJsonExpected && typeof cachedData === 'object') || (!isJsonExpected && typeof cachedData === 'string')) {
                return cachedData;
            }
        }

        console.log(`ShowBoxScraper: Making request to: ${url} via ScraperAPI`);
        console.time(timerLabel);
 
        const payload = {
            // MODIFICATION: Use stored scraperApiKey
            api_key: this.scraperApiKey, 
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
// MODIFICATION: Accept scraperApiKey
const extractFidsFromFebboxPage = async (febboxUrl, scraperApiKey) => {
    const timerLabel = `extractFidsFromFebboxPage_total_${febboxUrl.replace(/[^a-zA-Z0-9]/g, '')}`;
    console.time(timerLabel);
    let directSources = []; // Initialize directSources
    const cacheSubDir = 'febbox_page_html';
    const simpleUrlKey = febboxUrl.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const cacheKey = `${simpleUrlKey}.html`;

    let contentHtml = await getFromCache(cacheKey, cacheSubDir);

    if (!contentHtml) {
        const headers = { 'Cookie': FEBBOX_COOKIE };
        const payloadInitial = { api_key: scraperApiKey, url: febboxUrl, keep_headers: 'true' };
        const fetchTimerLabel = `extractFidsFromFebboxPage_fetch_${febboxUrl.replace(/[^a-zA-Z0-9]/g, '')}`;
        try {
            console.log(`Fetching FebBox page content from URL: ${febboxUrl}`);
            console.time(fetchTimerLabel);
            const response = await axios.get(SCRAPER_API_URL, { 
                params: payloadInitial, 
                headers: headers, 
                timeout: 20000 
            });
            console.timeEnd(fetchTimerLabel);
            contentHtml = response.data;
            if (typeof contentHtml === 'string' && contentHtml.length > 0) {
                await saveToCache(cacheKey, contentHtml, cacheSubDir);
            }
        } catch (error) {
            console.log(`Failed to fetch FebBox page: ${error.message}`);
            if (fetchTimerLabel) console.timeEnd(fetchTimerLabel); // Ensure timer ends on error if started
            console.timeEnd(timerLabel);
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
        console.timeEnd(timerLabel);
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
        console.timeEnd(timerLabel);
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

    console.timeEnd(timerLabel);
    return { fids: [...new Set(videoFidsFound)], shareKey, directSources }; // ensure directSources is always an array
};

// Function to convert IMDb ID to TMDB ID using TMDB API
// MODIFICATION: Accept scraperApiKey (though not directly used for TMDB calls here, kept for consistency if future needs arise)
const convertImdbToTmdb = async (imdbId, scraperApiKey) => {
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
// MODIFICATION: Accept scraperApiKey
const getStreamsFromTmdbId = async (tmdbType, tmdbId, seasonNum = null, episodeNum = null, scraperApiKey) => {
    const mainTimerLabel = `getStreamsFromTmdbId_total_${tmdbType}_${tmdbId}` + (seasonNum ? `_s${seasonNum}` : '') + (episodeNum ? `_e${episodeNum}` : '');
    console.time(mainTimerLabel);
    console.log(`Getting streams for TMDB ${tmdbType}/${tmdbId}${seasonNum !== null ? `, Season ${seasonNum}` : ''}${episodeNum !== null ? `, Episode ${episodeNum}` : ''}`);
    
    // First, get the ShowBox URL from TMDB ID
    // MODIFICATION: Pass scraperApiKey
    const tmdbInfo = await getShowboxUrlFromTmdbInfo(tmdbType, tmdbId, scraperApiKey);
    if (!tmdbInfo || !tmdbInfo.showboxUrl) {
        console.log(`Could not construct ShowBox URL for TMDB ${tmdbType}/${tmdbId}`);
        console.timeEnd(mainTimerLabel);
        return [];
    }
    const showboxUrl = tmdbInfo.showboxUrl;
    const mediaYear = tmdbInfo.year; // Year from TMDB
    // const originalTmdbMediaTitle = tmdbInfo.title; // Title from TMDB, if needed later

    // Then, get FebBox link from ShowBox
    // MODIFICATION: Pass scraperApiKey to ShowBoxScraper constructor
    const showboxScraper = new ShowBoxScraper(scraperApiKey);
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
            // MODIFICATION: Pass scraperApiKey
            await processShowWithSeasonsEpisodes(febboxUrl, baseStreamTitle, seasonNum, episodeNum, allStreams, scraperApiKey);
        } else {
            // Handle movies or TV shows without season/episode specified (old behavior)
            // Extract FIDs from FebBox page
            // MODIFICATION: Pass scraperApiKey
            const { fids, shareKey, directSources } = await extractFidsFromFebboxPage(febboxUrl, scraperApiKey);
            
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
                console.time(`getStreamsFromTmdbId_fetchFids_concurrent_${shareInfo.febbox_share_url.replace(/[^a-zA-Z0-9]/g, '')}`);
                const fidPromises = fids.map(fid => fetchSourcesForSingleFid(fid, shareKey, scraperApiKey));
                const fidSourcesArray = await Promise.all(fidPromises);
                console.timeEnd(`getStreamsFromTmdbId_fetchFids_concurrent_${shareInfo.febbox_share_url.replace(/[^a-zA-Z0-9]/g, '')}`);

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
    
    if (sortedStreams.length > 0) {
        console.log(`Found ${sortedStreams.length} streams (sorted by quality):`);
        sortedStreams.forEach((stream, i) => {
            console.log(`  ${i+1}. ${stream.quality} (${stream.size || 'Unknown size'}) [${(stream.codecs || []).join(', ') || 'No codec info'}]: ${stream.title}`);
        });
    }
    console.timeEnd(mainTimerLabel);
    return sortedStreams;
};

// Function to handle TV shows with seasons and episodes
// MODIFICATION: Accept scraperApiKey
const processShowWithSeasonsEpisodes = async (febboxUrl, showboxTitle, seasonNum, episodeNum, allStreams, scraperApiKey) => {
    const processTimerLabel = `processShowWithSeasonsEpisodes_total_s${seasonNum}` + (episodeNum ? `_e${episodeNum}` : '');
    console.time(processTimerLabel);
    console.log(`Processing TV Show: ${showboxTitle}, Season: ${seasonNum}, Episode: ${episodeNum !== null ? episodeNum : 'all'}`);
    
    let selectedEpisode = null; // MODIFICATION: Declare selectedEpisode at function scope

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
        try {
            const response = await axios.get(SCRAPER_API_URL, {
                params: {
                    api_key: scraperApiKey,
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
        const { fids, directSources } = await extractFidsFromFebboxPage(febboxUrl, scraperApiKey);
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
            const fallbackFidPromises = fids.map(fid => fetchSourcesForSingleFid(fid, shareKey, scraperApiKey));
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
    const cacheSubDirFolder = 'febbox_season_folders';
    const cacheKeyFolder = `share-${shareKey}_folder-${selectedFolder.id}.html`;
    
    // Try to get folder content from cache first
    let folderHtml = await getFromCache(cacheKeyFolder, cacheSubDirFolder);
    
    if (!folderHtml) {
        // If not cached, fetch the folder content
        const fetchFolderTimer = `processShowWithSeasonsEpisodes_fetchFolder_s${seasonNum}_id${selectedFolder.id}`;
        console.time(fetchFolderTimer);
        try {
            const folderResponse = await axios.get(SCRAPER_API_URL, {
                params: {
                    api_key: scraperApiKey,
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
                console.timeEnd(fetchFolderTimer);
                console.timeEnd(processTimerLabel);
                return;
            }
            
            if (folderHtml) {
                await saveToCache(cacheKeyFolder, folderHtml, cacheSubDirFolder);
            }
            console.timeEnd(fetchFolderTimer);
        } catch (error) {
            console.log(`Failed to fetch folder content for ${selectedFolder.id}: ${error.message}`);
            console.timeEnd(fetchFolderTimer); // End timer on error
            console.timeEnd(processTimerLabel);
            return;
        }
    }
    
    if (!folderHtml) {
        console.log(`No folder HTML content available for folder ${selectedFolder.id}`);
        console.timeEnd(processTimerLabel);
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
        episodeFids.push(selectedEpisode.fid);
    } else {
        // If no episode specified, process all episodes
        episodeFids.push(...episodeDetails.map(ep => ep.fid));
    }
    
    // Get video sources for each episode FID
    if (episodeFids.length > 0) {
      const episodeTimerLabel = `processShowWithSeasonsEpisodes_fetchEpisodeSources_s${seasonNum}` + (episodeNum ? `_e${episodeNum}`: '_allEp_concurrent');
      console.time(episodeTimerLabel);
      const episodeSourcePromises = episodeFids.map(fid => fetchSourcesForSingleFid(fid, shareKey, scraperApiKey).then(sources => ({ fid, sources })));
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
    
    return [...streams].sort((a, b) => {
        const qualityA = a.quality || "ORG";
        const qualityB = b.quality || "ORG";
        
        const orderA = qualityOrder[qualityA] || 10;
        const orderB = qualityOrder[qualityB] || 10;
        
        // First, compare by quality order
        if (orderA !== orderB) {
            return orderA - orderB;
        }
        
        // If qualities are the same, compare by size (descending - larger sizes first)
        const sizeAInBytes = parseSizeToBytes(a.size);
        const sizeBInBytes = parseSizeToBytes(b.size);
        
        return sizeBInBytes - sizeAInBytes;
    });
}

// Initialize the cache directory
ensureCacheDir(CACHE_DIR).catch(console.error);

// MODIFICATION: Add isScraperApiKeyNeeded function
const isScraperApiKeyNeeded = () => {
    // Since most core functionalities (ShowBox, FebBox) use ScraperAPI
    return true; 
};

module.exports = {
    getStreamsFromTmdbId,
    parseQualityFromLabel,
    convertImdbToTmdb,
    isScraperApiKeyNeeded,
    // Functions needed by cache_populator.js
    getShowboxUrlFromTmdbInfo,
    ShowBoxScraper, 
    extractFidsFromFebboxPage,
    processShowWithSeasonsEpisodes
}; 