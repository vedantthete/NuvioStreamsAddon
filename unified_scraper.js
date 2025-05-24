const axios = require('axios');
const cheerio = require('cheerio');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const readline = require('readline');
const fs = require('fs').promises; // Use promise-based fs for async operations
const path = require('path');

// Constants
const SCRAPER_API_KEY = '96845d13e7a0a0d40fb4f148cd135ddc'; // Replace with your actual key
const FEBBOX_COOKIE = 'ui=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NDgwNjYzMjgsIm5iZiI6MTc0ODA2NjMyOCwiZXhwIjoxNzc5MTcwMzQ4LCJkYXRhIjp7InVpZCI6NzgyNDcwLCJ0b2tlbiI6ImUwMTAyNjIyOWMyOTVlOTFlOTY0MWJjZWZiZGE4MGUxIn19.Za7tx60gu8rq9pLw1LVuIjROaBJzgF_MV049B8NO3L8'; // Replace if needed
const FEBBOX_PLAYER_URL = "https://www.febbox.com/file/player";
const FEBBOX_FILE_SHARE_LIST_URL = "https://www.febbox.com/file/file_share_list";
const SCRAPER_API_URL = 'https://api.scraperapi.com/';
const CACHE_DIR = path.join(__dirname, '.cache'); // Base cache directory
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c'; // <<< USER NEEDS TO REPLACE THIS
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Credit tracking
let apiRequestCounter = 0;

// --- Cache Helper Functions ---
async function ensureCacheDir(dirPath) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') {
            console.warn(`Warning: Could not create cache directory ${dirPath}: ${error.message}`);
        }
    }
}

async function getFromCache(cacheKey, subDir = '') {
    const cachePath = path.join(CACHE_DIR, subDir, cacheKey);
    try {
        const data = await fs.readFile(cachePath, 'utf-8');
        console.log(`  CACHE HIT for: ${path.join(subDir, cacheKey)}`);
        try {
            return JSON.parse(data); // Attempt to parse as JSON
        } catch (e) {
            return data; // Return as string if not JSON (e.g., HTML content)
        }
    } catch (error) {
        if (error.code !== 'ENOENT') { // ENOENT means file not found, which is a normal cache miss
            console.warn(`  CACHE READ ERROR for ${cacheKey}: ${error.message}`);
        }
        return null;
    }
}

async function saveToCache(cacheKey, content, subDir = '') {
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
}

// --- Helper for concurrent video stream fetching ---
async function fetchSourcesForSingleFid(fidToProcess, shareKey, apiKey, cookie) {
    const cacheSubDir = 'febbox_player';
    const cacheKey = `fid-${fidToProcess}_share-${shareKey}.json`;

    const cachedData = await getFromCache(cacheKey, cacheSubDir);
    if (cachedData) {
        const fidVideoLinks = [];
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
             console.log(`    Extracted ${fidVideoLinks.length} video link(s) for FID ${fidToProcess} from CACHE`);
        }
        return fidVideoLinks;
    }

    console.log(`  Fetching player data for video FID: ${fidToProcess} (Share: ${shareKey})`);
    
    const scraperApiPayloadForPost = {
        api_key: apiKey,
        url: FEBBOX_PLAYER_URL,
        keep_headers: 'true'
    };
    
    const targetPostData = new URLSearchParams();
    targetPostData.append('fid', fidToProcess);
    targetPostData.append('share_key', shareKey);

    const headers = {
        'Cookie': cookie,
        'Content-Type': 'application/x-www-form-urlencoded'
    };

    try {
        const response = await axios.post(SCRAPER_API_URL, targetPostData.toString(), {
            params: scraperApiPayloadForPost,
            headers: headers,
            timeout: 20000
        });
        apiRequestCounter++;
        const playerContent = response.data;
        let resultToCache = []; // This will be the array of link objects or a direct link string/object

        const sourcesMatch = playerContent.match(/var sources = (.*?);\s*/s);
        if (!sourcesMatch) {
            console.log(`    Could not find sources array in player response for FID ${fidToProcess}. Snippet: ${playerContent.substring(0, 100)}`);
            if (playerContent.startsWith('http') && (playerContent.includes('.mp4') || playerContent.includes('.m3u8'))) {
                resultToCache = [{ "label": "DirectLink", "url": playerContent.trim() }]; // Cache as an array with one object
                await saveToCache(cacheKey, resultToCache, cacheSubDir);
                return resultToCache;
            }
            try {
                const jsonResponse = JSON.parse(playerContent);
                if (jsonResponse.msg) {
                    console.log(`    FebBox API Error for FID ${fidToProcess}: ${jsonResponse.code} - ${jsonResponse.msg}`);
                }
            } catch (e) { /* Not a JSON error message */ }
            // Do not cache empty results from errors or no sources found, unless it's a direct link handled above.
            return [];
        }

        const sourcesJsArrayString = sourcesMatch[1];
        const sourcesData = JSON.parse(sourcesJsArrayString);
        const fidVideoLinks = [];
        for (const sourceItem of sourcesData) {
            if (sourceItem.file && sourceItem.label) {
                fidVideoLinks.push({
                    "label": String(sourceItem.label),
                    "url": String(sourceItem.file)
                });
            }
        }
        
        if (fidVideoLinks.length > 0) {
            console.log(`    Extracted ${fidVideoLinks.length} video link(s) for FID ${fidToProcess}`);
            resultToCache = fidVideoLinks;
            await saveToCache(cacheKey, resultToCache, cacheSubDir);
        }
        return fidVideoLinks;
    } catch (error) {
        if (error.response) {
            console.log(`    Request error for FID ${fidToProcess}: ${error.message} (Status: ${error.response.status})`);
        } else if (error.request) {
            console.log(`    Request error for FID ${fidToProcess}: No response received - ${error.message}`);
        } else {
            console.log(`    Unexpected error for FID ${fidToProcess}: ${error.message}`);
        }
        return [];
    }
}

async function getStreamsFromFids(videoFids, shareKey, apiKey, cookie) {
    const allVideoLinks = [];
    const promises = videoFids.map(fid => fetchSourcesForSingleFid(fid, shareKey, apiKey, cookie));
    
    const results = await Promise.allSettled(promises);

    results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
            allVideoLinks.push(...result.value);
        } else if (result.status === 'rejected') {
            console.log(`  A FID fetch generated an exception: ${result.reason}`);
        }
    });
    
    const uniqueVideoLinks = [];
    const seenUrls = new Set();
    for (const link of allVideoLinks) {
        if (!seenUrls.has(link.url)) {
            uniqueVideoLinks.push(link);
            seenUrls.add(link.url);
        }
    }
    return uniqueVideoLinks;
}

// --- Fetches HTML of a specific folder within a FebBox share ---
async function fetchFolderHtmlContent(shareKey, folderId, originalFebboxUrl, apiKey, cookie) {
    const cacheSubDir = 'febbox_folder_html';
    const cacheKey = `folder-${folderId}_share-${shareKey}.html`;

    const cachedData = await getFromCache(cacheKey, cacheSubDir);
    if (cachedData) {
        return cachedData; // HTML is stored as a string
    }

    console.log(`  Fetching content for folder ID: ${folderId} (Share: ${shareKey}) using URL ${originalFebboxUrl} as referer`);

    const targetHeaders = {
        'Cookie': cookie,
        'Referer': originalFebboxUrl,
        'X-Requested-With': 'XMLHttpRequest'
    };

    const targetParamsForFebbox = {
        share_key: shareKey,
        parent_id: folderId,
        is_html: '1',
        pwd: ''
    };

    const queryString = new URLSearchParams(targetParamsForFebbox).toString();
    const targetUrlForScraperapi = `${FEBBOX_FILE_SHARE_LIST_URL}?${queryString}`;

    const scraperApiParamsToSend = {
        api_key: apiKey,
        url: targetUrlForScraperapi,
        keep_headers: 'true'
    };

    try {
        console.log(`    Making GET request to ScraperAPI for: ${targetUrlForScraperapi}`);
        const response = await axios.get(SCRAPER_API_URL, {
            params: scraperApiParamsToSend,
            headers: targetHeaders,
            timeout: 20000
        });
        apiRequestCounter++;
        const responseData = response.data;
        let htmlToReturn = null;

        if (typeof responseData === 'object' && responseData !== null) {
            if (responseData.code === 1 && typeof responseData.html === 'string') {
                console.log(`    Successfully fetched HTML for folder ${folderId} (extracted from JSON response)`);
                htmlToReturn = responseData.html;
            } else {
                console.log(`    Folder content API for ${folderId} returned JSON but not in expected format or error: ${responseData.msg}`);
                // Do not cache this specific error case, return null to indicate failure
                return null;
            }
        } else if (typeof responseData === 'string') {
            console.log(`    Successfully fetched content for folder ${folderId} (assuming direct HTML)`);
            htmlToReturn = responseData;
        } else {
            console.log(`    Folder content API for ${folderId} returned an unexpected response type: ${typeof responseData}`);
            // Do not cache unexpected types, return null
            return null;
        }

        if (htmlToReturn) {
            await saveToCache(cacheKey, htmlToReturn, cacheSubDir);
        }
        return htmlToReturn;

    } catch (error) {
        if (error.response) {
            console.log(`    Request error fetching folder ${folderId} content: ${error.message} (Status: ${error.response.status})`);
        } else if (error.request) {
            console.log(`    Request error fetching folder ${folderId} content: No response received - ${error.message}`);
        } else {
            console.log(`    Unexpected error fetching folder ${folderId} content: ${error.message}`);
        }
        return null;
    }
}

// --- Main FebBox page/content processor ---
async function fetchFebboxPageContents(pageUrl = null, pageHtml = null, apiKey = SCRAPER_API_KEY, cookie = FEBBOX_COOKIE) {
    if (!pageUrl && !pageHtml) {
        return { "type": "error", "message": "Either pageUrl or pageHtml must be provided." };
    }

    let contentHtml = pageHtml;
    const currentUrl = pageUrl ? pageUrl : "(HTML provided directly)";

    if (!contentHtml && pageUrl) {
        const cacheSubDir = 'febbox_page_html';
        // Sanitize URL to create a safe filename
        const simpleUrlKey = pageUrl.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9_.-]/g, '_');
        const cacheKey = `${simpleUrlKey}.html`;

        const cachedData = await getFromCache(cacheKey, cacheSubDir);
        if (cachedData) {
            contentHtml = cachedData;
        } else {
            const headers = { 'Cookie': cookie };
            const payloadInitial = { api_key: apiKey, url: pageUrl, keep_headers: 'true' };
            try {
                console.log(`Fetching FebBox page/folder content from URL: ${pageUrl}`);
                const response = await axios.get(SCRAPER_API_URL, { params: payloadInitial, headers: headers, timeout: 20000 });
                apiRequestCounter++;
                contentHtml = response.data;
                if (typeof contentHtml === 'string' && contentHtml.length > 0) { // Basic check for valid HTML
                    await saveToCache(cacheKey, contentHtml, cacheSubDir);
                } else {
                    console.warn(`  Received non-string or empty content for ${pageUrl}, not caching.`);
                }
            } catch (error) {
                const errorMessage = error.response ? `${error.message} (Status: ${error.response.status})` : error.message;
                return { "type": "error", "message": `Failed to fetch ${pageUrl}: ${errorMessage}`, "original_url": pageUrl };
            }
        }
    }

    if (!contentHtml) {
        // This case should ideally be rare if caching miss leads to fetch or cache hit provides content
        return { "type": "error", "message": "No HTML content to parse after fetch/cache attempt.", "original_url": currentUrl };
    }

    let shareKey = null;
    if (pageUrl) {
        const matchShareKeyUrl = pageUrl.match(/\/share\/([a-zA-Z0-9]+)/);
        if (matchShareKeyUrl) {
            shareKey = matchShareKeyUrl[1];
        }
    }

    if (!shareKey) {
        const matchShareKeyHtml = contentHtml.match(/(?:var share_key\s*=|share_key:\s*|shareid=)"?([a-zA-Z0-9]+)"?/);
        if (matchShareKeyHtml) {
            shareKey = matchShareKeyHtml[1];
        }
    }

    if (!shareKey) {
        console.log(`Warning: Could not extract share_key from ${currentUrl} or its HTML. Subsequent calls might fail.`);
    }
    console.log(`Processing FebBox content. Share Key (best guess): ${shareKey} for URL/content from: ${currentUrl}`);

    const $ = cheerio.load(contentHtml);
    const videoFidsFound = [];
    const foldersFound = [];
    const videoFileDetailsFound = [];

    const fileElements = $('div.file');

    if (fileElements.length === 0) {
        const playerSetupMatch = contentHtml.match(/jwplayer\("[a-zA-Z0-9_-]+"\)\.setup/);
        if (playerSetupMatch) {
            const sourcesMatchDirect = contentHtml.match(/var sources = (.*?);\s*/s); // s flag for DOTALL
            if (sourcesMatchDirect) {
                const sourcesJsArrayString = sourcesMatchDirect[1];
                try {
                    const sourcesData = JSON.parse(sourcesJsArrayString);
                    const directVideoLinks = [];
                    for (const sourceItem of sourcesData) {
                        if (sourceItem.file && sourceItem.label) {
                            directVideoLinks.push({ "label": String(sourceItem.label), "url": String(sourceItem.file) });
                        }
                    }
                    if (directVideoLinks.length > 0) {
                        console.log(`Found ${directVideoLinks.length} direct video links (jwplayer sources) on ${currentUrl}`);
                        return { "type": "direct_videos", "video_links": directVideoLinks, "original_url": currentUrl };
                    }
                } catch (e) {
                    console.log(`Error decoding direct jwplayer sources JSON from ${currentUrl}: ${e.message}`);
                }
            } else {
                 console.log(`jwplayer setup found on ${currentUrl}, but direct sources not parsed.`);
            }
        }
        console.log(`No div.file elements found on ${currentUrl}. It might be a direct player page or an empty/error page.`);
        return { "type": "empty", "message": `No file or folder list structure (div.file) found on ${currentUrl}`, "original_url": currentUrl, "share_key": shareKey };
    }

    fileElements.each((index, element) => {
        const feEl = $(element);
        const dataId = feEl.attr('data-id');
        if (!dataId || !/^\d+$/.test(dataId)) {
            return; // Skip if data-id is missing or not a number
        }

        if (feEl.hasClass('open_dir')) {
            const folderNameEl = feEl.find('p.file_name');
            const folderName = folderNameEl.length ? folderNameEl.text().trim() : feEl.attr('data-path') || `Folder_${dataId}`;
            foldersFound.push({ "id": dataId, "name": folderName });
            console.log(`  Found folder: '${folderName}' (ID: ${dataId})`);
        } else {
            videoFidsFound.push(dataId);
            const fileNameEl = feEl.find('p.file_name');
            const fileNameText = fileNameEl.length ? fileNameEl.text().trim() : `File_${dataId}`;
            videoFileDetailsFound.push({ "name": fileNameText, "fid": dataId });
            console.log(`  Found video file entry: '${fileNameText}' (FID: ${dataId})`);
        }
    });

    if (videoFidsFound.length > 0) {
        return {
            "type": "videos", 
            "video_fids": [...new Set(videoFidsFound)], 
            "video_file_details": videoFileDetailsFound,
            "share_key": shareKey, 
            "original_url": currentUrl, 
            "cookie": cookie, 
            "api_key": apiKey
        };
    } else if (foldersFound.length > 0) {
        return { "type": "folders", "folders": foldersFound, "share_key": shareKey, "original_url": currentUrl, "cookie": cookie, "api_key": apiKey };
    } else {
        return { "type": "empty", "message": `No recognized video files or folders in div.file list on ${currentUrl}`, "original_url": currentUrl, "share_key": shareKey };
    }
}

// --- ShowBoxScraper class ---
class ShowBoxScraper {
    constructor(apiKey = SCRAPER_API_KEY) {
        this.apiKey = apiKey;
        this.baseUrl = SCRAPER_API_URL;
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.google.com/'
        };
    }

    async _makeRequest(url, isJsonExpected = false, postData = null) {
        const cacheSubDir = 'showbox_generic';
        // Create a cache key based on the target URL and whether JSON is expected (for API calls)
        // For POST requests, the cache key ideally should also include postData, but for simplicity here, we'll keep it URL-based.
        // This means different POSTs to the same URL will overwrite cache if not distinguished.
        // However, in this script, ShowBox POSTs are not used by _makeRequest.
        const simpleUrlKey = url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9_.-]/g, '_');
        const cacheKey = `${simpleUrlKey}${isJsonExpected ? '.json' : '.html'}`;

        // For ShowBox, we generally want fresh data for share links if the HTML might have changed.
        // However, for this implementation, we'll add simple caching.
        // A more advanced setup might have shorter TTLs or specific cache-busting for ShowBox.
        const cachedData = await getFromCache(cacheKey, cacheSubDir);
        if (cachedData) {
            // If JSON was expected and we got an object, or if not JSON and we got a string
            if ((isJsonExpected && typeof cachedData === 'object') || (!isJsonExpected && typeof cachedData === 'string')) {
                return cachedData;
            }
            console.log(`  CACHE MISMATCH for ${cacheKey} (expected ${isJsonExpected ? 'JSON' : 'string'}, got ${typeof cachedData}). Fetching fresh.`);
        }

        console.log(`ShowBoxScraper: Making ${postData ? "POST" : "GET"} ${isJsonExpected ? 'JSON ' : ''}request to: ${url} via ScraperAPI`);
 
        const payload = {
            api_key: this.apiKey,
            url: url,
            keep_headers: 'true'
        };
        const currentHeaders = { ...this.headers };
        if (isJsonExpected) {
            currentHeaders['Accept'] = 'application/json, text/javascript, */*; q=0.01';
            currentHeaders['X-Requested-With'] = 'XMLHttpRequest';
        }

        try {
            let response;
            if (postData) {
                const formBody = new URLSearchParams(postData).toString();
                currentHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
                response = await axios.post(this.baseUrl, formBody, { params: payload, headers: currentHeaders, timeout: 30000 });
            } else {
                response = await axios.get(this.baseUrl, { params: payload, headers: currentHeaders, timeout: 30000 });
            }
            apiRequestCounter++;
            const responseData = response.data;

            // Save to cache
            if (responseData) {
                 // If responseData is already an object (axios parsed JSON), it will be stringified by saveToCache
                 // If it's a string (HTML), it will be saved as is.
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
                
                if (!contentId) {
                    const playButton = $('[data-movie-id], [data-show-id], [data-id*="play"], .play-button[data-id]').first();
                    if (playButton.length) {
                        const tempId = playButton.attr('data-movie-id') || playButton.attr('data-show-id') || playButton.attr('data-id');
                        if (tempId && /^\d+$/.test(tempId)) {
                            contentId = tempId;
                            sourceOfId = "html_data_attribute";
                            if (!contentTypeVal) {
                                if (playButton.attr('data-movie-id') || url.toLowerCase().includes("movie")) contentTypeVal = '1';
                                else if (playButton.attr('data-show-id') || url.toLowerCase().includes("tv")) contentTypeVal = '2';
                            }
                        }
                    }
                }
            }
        }

        if (contentId && !contentTypeVal) {
            if (url.includes("/movie/") || (title.toLowerCase().includes("movie") && !title.toLowerCase().includes("tv"))) contentTypeVal = '1';
            else if (url.includes("/tv/") || title.toLowerCase().includes("tv") || title.toLowerCase().includes("series")) contentTypeVal = '2';
        }

        if (contentId && contentTypeVal) {
            console.log(`ShowBoxScraper: Extracted ID=${contentId}, Type=${contentTypeVal}, Title='${title}' (Source: ${sourceOfId})`);
            return { "id": contentId, "type": contentTypeVal, "title": title, "source": sourceOfId };
        }
        
        console.log(`ShowBoxScraper: Failed to extract ID/Type. Final: ID=${contentId}, TypeVal=${contentTypeVal}, Title='${title}'`);
        return null;
    }

    async extractFebboxShareLinks(showboxUrl) {
        console.log(`ShowBoxScraper: Attempting to extract FebBox share link from: ${showboxUrl}`);
        
        let htmlContent = null; // Will store HTML if fetched
        let contentInfo = this.extractContentIdAndType(showboxUrl, null); // Try URL first
        let htmlFetchedForId = false;

        if (!contentInfo || !contentInfo.id || !contentInfo.type) {
            console.log("ShowBoxScraper: ID/Type not in URL or initial check failed, fetching HTML.");
            htmlContent = await this._makeRequest(showboxUrl);
            htmlFetchedForId = true;
            if (!htmlContent) {
                console.log(`ShowBoxScraper: Failed to fetch HTML for ${showboxUrl}. Cannot get FebBox link.`);
                return [];
            }
            contentInfo = this.extractContentIdAndType(showboxUrl, htmlContent); // Try HTML after fetch
        }

        if (!contentInfo || !contentInfo.id || !contentInfo.type) {
            console.log(`ShowBoxScraper: Could not determine content ID/type for ${showboxUrl} even after fetching HTML (if attempted: ${htmlFetchedForId}).`);
            return [];
        }

        const { id: contentId, type: contentType, title } = contentInfo;

        // If HTML was fetched to get ID/Type, try parsing it for a direct FebBox link
        if (htmlContent) { 
            console.log(`ShowBoxScraper: HTML was fetched for ID/Type. Searching for direct FebBox link/key in it for '${title}'.`);
            const $ = cheerio.load(htmlContent);
            let directFebboxLink = null;

            $('a[href*="febbox.com/share/"]').each((i, elem) => {
                const href = $(elem).attr('href');
                if (href && href.includes("febbox.com/share/")) {
                    directFebboxLink = href;
                    console.log(`  Found direct FebBox link in <a> tag: ${directFebboxLink}`);
                    return false; 
                }
            });

            if (!directFebboxLink) {
                const scriptContents = $('script').map((i, el) => $(el).html()).get().join('\n');
                const shareKeyMatch = scriptContents.match(/['"](https?:\/\/www\.febbox\.com\/share\/[a-zA-Z0-9]+)['"]/);
                if (shareKeyMatch && shareKeyMatch[1]) {
                    directFebboxLink = shareKeyMatch[1];
                    console.log(`  Found direct FebBox link in <script> tag: ${directFebboxLink}`);
                }
            }

            if (directFebboxLink) {
                console.log(`ShowBoxScraper: Successfully found direct FebBox URL via HTML parsing: ${directFebboxLink} for '${title}'`);
                return [{
                    "showbox_title": title, 
                    "febbox_share_url": directFebboxLink,
                    "showbox_content_id": contentId,
                    "showbox_content_type": contentType
                }];
            } else {
                console.log(`ShowBoxScraper: Direct FebBox link/key not found in the fetched HTML. Proceeding with API call for '${title}'.`);
            }
        } else {
             console.log(`ShowBoxScraper: HTML was not fetched for ID/Type (ID likely from URL). Proceeding with API call for '${title}'.`);
        }

        // Fallback: API call if direct parsing didn't happen or failed, or HTML wasn't fetched
        console.log(`ShowBoxScraper: Making API call to /index/share_link for '${title}' (ID: ${contentId}, Type: ${contentType})`);
        const shareApiUrl = `https://www.showbox.media/index/share_link?id=${contentId}&type=${contentType}`;
        const apiResponseStr = await this._makeRequest(shareApiUrl, true);

        if (!apiResponseStr) {
            console.log(`ShowBoxScraper: Failed to get response from ShowBox share_link API: ${shareApiUrl}`);
            return [];
        }
        
        try {
            const apiResponseJson = (typeof apiResponseStr === 'string') ? JSON.parse(apiResponseStr) : apiResponseStr;
            if (apiResponseJson.code === 1 && apiResponseJson.data && apiResponseJson.data.link) {
                const febboxShareUrl = apiResponseJson.data.link;
                console.log(`ShowBoxScraper: Successfully fetched FebBox URL via API: ${febboxShareUrl} for '${title}'`);
                return [{
                    "showbox_title": title, 
                    "febbox_share_url": febboxShareUrl,
                    "showbox_content_id": contentId,
                    "showbox_content_type": contentType
                }];
            } else {
                const msg = apiResponseJson.msg || (typeof apiResponseStr === 'string' ? apiResponseStr.substring(0,200) : 'Invalid JSON structure');
                console.log(`ShowBoxScraper: ShowBox share_link API did not succeed for '${title}'. Response: ${msg}`);
                return [];
            }
        } catch (e) {
            console.log(`ShowBoxScraper: Error decoding JSON from ShowBox share_link API: ${e.message}. Response: ${String(apiResponseStr).substring(0, 200)}`);
            return [];
        }
    }
}

function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }))
}

// --- Function to get ShowBox URL from TMDB Info ---
async function getShowboxUrlFromTmdbInfo(tmdbType, tmdbId, tmdbApiKey) {
    if (tmdbApiKey === 'YOUR_TMDB_API_KEY_HERE' || !tmdbApiKey || tmdbApiKey === '439c478a771f35c05022f9feabcca01c') {
        // Check if the key is the placeholder OR the one the user seems to have hardcoded if it's a default/example.
        // For a real application, this key check would be more robust or ideally handled via environment variables.
        if (tmdbApiKey === 'YOUR_TMDB_API_KEY_HERE') {
             console.error("  Error: TMDB_API_KEY is still the placeholder. Please replace 'YOUR_TMDB_API_KEY_HERE' with your actual key.");
             return null;
        }
        // Assuming '439c478a771f35c05022f9feabcca01c' is a valid key the user has set, so no error here for that specific key.
    }

    const cacheSubDir = 'tmdb_api';
    const cacheKey = `tmdb-${tmdbType}-${tmdbId}.json`;
    const cachedTmdbData = await getFromCache(cacheKey, cacheSubDir);

    let tmdbData = cachedTmdbData;

    if (!tmdbData) {
        const tmdbApiUrl = `${TMDB_BASE_URL}/${tmdbType}/${tmdbId}?api_key=${tmdbApiKey}`;
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
        } else {
            console.log(`  Warning: Movie TMDB data for ${tmdbId} missing or has invalid release_date:`, tmdbData.release_date);
        }
    } else if (tmdbType === 'tv') {
        title = tmdbData.name || tmdbData.original_name;
        // More explicit logging for first_air_date
        let rawFirstAirDate = tmdbData.first_air_date;
        if (rawFirstAirDate === "") {
            console.log(`  Raw TV TMDB data for ${tmdbId} (first_air_date) is an EMPTY STRING.`);
        } else {
            console.log(`  Raw TV TMDB data for ${tmdbId} (first_air_date):`, rawFirstAirDate);
        }

        if (rawFirstAirDate && String(rawFirstAirDate).length >= 4) {
            year = String(rawFirstAirDate).substring(0, 4);
        } else {
            console.log(`  Warning: TV TMDB data for ${tmdbId} has missing or invalid first_air_date. Value was: '${rawFirstAirDate}'`);
        }
    }

    if (!title) {
        console.log(`  Could not extract title from TMDB data for ${tmdbType}/${tmdbId}.`);
    }
    if (!year) {
        console.log(`  Could not extract year from TMDB data for ${tmdbType}/${tmdbId}. This might lead to a less accurate ShowBox URL.`);
    }

    if (!title && !year) {
        console.error(`  Error: Both title and year are missing from TMDB data for ${tmdbType}/${tmdbId}. Cannot construct ShowBox URL.`);
        return null;
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
    } else {
        if (constructedShowboxUrl.endsWith('-') && slug && slug !== 'untitled') {
            // Only remove trailing hyphen if slug was added, and year is missing
            constructedShowboxUrl = constructedShowboxUrl.slice(0, -1);
        } else if (slug === 'untitled' && constructedShowboxUrl.endsWith('-')){
            // If title was missing and year is missing, avoid .../m-
             console.error(`  Error: Cannot form ShowBox URL without title and year for ${tmdbType}/${tmdbId}.`);
            return null;
        }
    }
    
    if (constructedShowboxUrl === `https://www.showbox.media/${tmdbType}/${showboxPrefix}-` || constructedShowboxUrl === `https://www.showbox.media/${tmdbType}/${showboxPrefix}`) {
        console.error(`  Error: Could not form a meaningful ShowBox URL (slug or year missing/invalid) for ${tmdbType}/${tmdbId}. Constructed: ${constructedShowboxUrl}`);
        return null;
    }

    console.log(`  Constructed ShowBox URL for TMDB ${tmdbType} ID ${tmdbId} ('${safeTitle}'): ${constructedShowboxUrl}`);
    return constructedShowboxUrl;
}

async function processFebboxContent(febboxUrl, showboxTitle, apiKey, cookie, cliArgs, visitedFolders = new Set()) {
    if (visitedFolders.has(febboxUrl)) {
        console.log(`Already visited/processed ${febboxUrl}, skipping to avoid loops.`);
        return [];
    }
    visitedFolders.add(febboxUrl);

    let allFoundStreams = [];
    const pageContentResult = await fetchFebboxPageContents(febboxUrl, null, apiKey, cookie);

    if (pageContentResult.type === "videos") {
        console.log(`  Found video file entries on: ${febboxUrl}`);
        const videoFids = pageContentResult.video_fids;
        const shareKey = pageContentResult.share_key;
        if (videoFids && videoFids.length > 0 && shareKey) {
            const streams = await getStreamsFromFids(videoFids, shareKey, apiKey, cookie);
            for (const stream of streams) {
                allFoundStreams.push({ "title": showboxTitle, "label": stream.label, "url": stream.url });
            }
        } else {
            console.log(`  Missing video_fids or share_key for video processing at ${febboxUrl}`);
        }
    } else if (pageContentResult.type === "direct_videos") {
        console.log(`  Found direct video links on: ${febboxUrl}`);
        for (const stream of pageContentResult.video_links) {
            allFoundStreams.push({ "title": showboxTitle, "label": stream.label, "url": stream.url });
        }
    } else if (pageContentResult.type === "folders") {
        console.log(`  Found folders on: ${febboxUrl}`);
        const folders = pageContentResult.folders;
        const shareKey = pageContentResult.share_key;
        const originalUrl = pageContentResult.original_url;
        // apiKey and cookie are passed from the function arguments, no need to re-extract from pageContentResult
        
        if (!shareKey) {
            console.log(`  Cannot process folders for ${febboxUrl} without a share_key.`);
            return allFoundStreams;
        }

        let selectedFoldersToProcess = [];
        
        if (cliArgs && cliArgs.season) {
            console.log(`  CLI argument --season '${cliArgs.season}' provided.`);
            let matchedFolder = null;
            const seasonQuery = String(cliArgs.season).toLowerCase();

            for (const folderData of folders) {
                const folderNameNumbers = (folderData.name.match(/\d+/g) || []).map(String);
                if (folderNameNumbers.includes(seasonQuery)) {
                    matchedFolder = folderData;
                    console.log(`  Matched season by number in name: '${matchedFolder.name}' (ID: ${matchedFolder.id})`);
                    break;
                }
            }
            
            if (!matchedFolder) {
                const seasonIdxChoice = parseInt(cliArgs.season, 10) - 1;
                if (!isNaN(seasonIdxChoice) && seasonIdxChoice >= 0 && seasonIdxChoice < folders.length) {
                    matchedFolder = folders[seasonIdxChoice];
                    console.log(`  Matched season by index (fallback): '${matchedFolder.name}' (ID: ${matchedFolder.id})`);
                }
            }

            if (!matchedFolder) {
                console.log(`  Season '${cliArgs.season}' not matched by specific number in name or index, trying general keyword.`);
                for (const folderData of folders) {
                    if (folderData.name.toLowerCase().includes(seasonQuery)) {
                        matchedFolder = folderData;
                        console.log(`  Matched season by general keyword in name: '${matchedFolder.name}' (ID: ${matchedFolder.id})`);
                        break;
                    }
                }
            }
            
            if (matchedFolder) {
                selectedFoldersToProcess = [matchedFolder];
            } else {
                console.log(`  Warning: Specified --season '${cliArgs.season}' not found. Available folders:`);
                // Fall through to interactive if not found
            }
        }
        
        if (selectedFoldersToProcess.length === 0) { // Interactive season selection
            console.log("  Available folders:");
            folders.forEach((folder, i) => console.log(`    ${i + 1}. ${folder.name} (ID: ${folder.id})`));
            
            while (true) {
                const choice = (await askQuestion("  Enter folder number to process, 'all', or 'skip': ")).trim().toLowerCase();
                if (choice === 'skip') break;
                if (choice === 'all') {
                    selectedFoldersToProcess = folders;
                    break;
                }
                const choiceIdx = parseInt(choice, 10) - 1;
                if (!isNaN(choiceIdx) && choiceIdx >= 0 && choiceIdx < folders.length) {
                    selectedFoldersToProcess = [folders[choiceIdx]];
                    break;
                } else {
                    console.log("  Invalid folder number. Please try again.");
                }
            }
        }

        for (const folderToProcess of selectedFoldersToProcess) {
            const folderId = folderToProcess.id;
            const folderName = folderToProcess.name;
            console.log(`\n  Attempting to process folder: '${folderName}' (ID: ${folderId})`);
            
            const folderHtml = await fetchFolderHtmlContent(shareKey, folderId, originalUrl, apiKey, cookie);
            
            if (folderHtml) {
                console.log(`  Parsing content of folder '${folderName}'`);
                const subContentResult = await fetchFebboxPageContents(null, folderHtml, apiKey, cookie);
                
                if (subContentResult.type === "videos") {
                    console.log(`    Found video file entries in folder '${folderName}'`);
                    let subVideoDetails = subContentResult.video_file_details || [];
                    const currentShareKeyForSubVideos = subContentResult.share_key || shareKey;

                    if (!currentShareKeyForSubVideos) {
                        console.log(`    Missing share_key for folder '${folderName}'. Skipping FID processing.`);
                        continue;
                    }
                    if (subVideoDetails.length === 0) {
                         console.log(`    No video file details found in folder '${folderName}'. Skipping FID processing for this folder.`);
                         continue;
                    }

                    // Episode Sorting Logic (similar to Python)
                    const getEpNumFromFilename = (name) => {
                        const nameLower = name.toLowerCase();
                        const patterns = [
                            /[._\s-]s\d{1,2}[._\s-]?e(\d{1,3})[._\s-]?/,
                            /[._\s-]e[cp]?[._\s-]?(\d{1,3})[._\s-]?/,
                            /episode[._\s-]?(\d{1,3})/,
                            /part[._\s-]?(\d{1,3})/,
                            /ep[._\s-]?(\d{1,3})/,
                            /pt[._\s-]?(\d{1,3})/
                        ];
                        for (const pattern of patterns) {
                            const match = nameLower.match(pattern);
                            if (match && match[1]) return parseFloat(match[1]);
                        }
                        const simpleNumMatches = nameLower.match(/(?<![a-zA-Z])(\d{1,3})(?![a-zA-Z0-9])/g);
                        if (simpleNumMatches && simpleNumMatches.length === 1) {
                            const num = parseFloat(simpleNumMatches[0]);
                            if (num > 0 && num < 200 && 
                                !( (String(Math.floor(num)) + "p" === nameLower) ||
                                   nameLower.includes("x" + String(Math.floor(num))) || 
                                   nameLower.includes("h" + String(Math.floor(num))) ||
                                   (nameLower.split(String(Math.floor(num))).length -1 > 1 && !["1","2"].includes(String(Math.floor(num))))
                                )) {
                                return num;
                            }
                        }
                        return Infinity;
                    };
                    let effectiveVideoDetailsList = [...subVideoDetails].sort((a, b) => getEpNumFromFilename(a.name) - getEpNumFromFilename(b.name));
                    
                    if (subVideoDetails.length > 0 && effectiveVideoDetailsList.length > 0 && getEpNumFromFilename(subVideoDetails[0].name) !== getEpNumFromFilename(effectiveVideoDetailsList[0].name) && getEpNumFromFilename(effectiveVideoDetailsList[0].name) !== Infinity) {
                        console.log(`    Episodes sorted by number. Original first: '${subVideoDetails[0].name}', Sorted first: '${effectiveVideoDetailsList[0].name}'.`);
                    } else if (effectiveVideoDetailsList.length > 0 && getEpNumFromFilename(effectiveVideoDetailsList[0].name) === Infinity) {
                        console.log("    Warning: Could not reliably extract episode numbers for sorting. Using original file order.");
                        effectiveVideoDetailsList = subVideoDetails; // Fallback
                    } else if (effectiveVideoDetailsList.length === 0 && subVideoDetails.length > 0) {
                        console.log("    Warning: Sorting episodes failed or resulted in an empty list. Using original file order.");
                         effectiveVideoDetailsList = subVideoDetails; // Fallback
                    }

                    let fidsToFetchForEpisode = [];
                    let selectedEpisodeNameForTitle = null;
                    const processAllInFolderFromCli = cliArgs && cliArgs.allEpisodes;
                    let episodeSelectedViaCli = false;

                    if (processAllInFolderFromCli) {
                        console.log(`  CLI argument --all-episodes provided. Selecting all episodes in '${folderName}'.`);
                        fidsToFetchForEpisode = effectiveVideoDetailsList.map(vd => vd.fid);
                    } else if (cliArgs && cliArgs.episode) {
                        console.log(`  CLI argument --episode '${cliArgs.episode}' provided for folder '${folderName}'.`);
                        const episodeQuery = String(cliArgs.episode).toLowerCase();
                        let matchedDetail = null;
                        const episodeIdxChoice = parseInt(episodeQuery, 10) -1;

                        if(!isNaN(episodeIdxChoice) && episodeIdxChoice >= 0 && episodeIdxChoice < effectiveVideoDetailsList.length) {
                            matchedDetail = effectiveVideoDetailsList[episodeIdxChoice];
                            if(matchedDetail) console.log(`    Automatically selecting episode by index from sorted list: '${matchedDetail.name}' (FID: ${matchedDetail.fid}).`);
                        } else {
                             console.log(`    Episode index '${cliArgs.episode}' out of range or invalid. Trying keyword match.`);
                            for (const videoDetail of effectiveVideoDetailsList) {
                                if (videoDetail.name.toLowerCase().includes(episodeQuery)) {
                                    matchedDetail = videoDetail;
                                    console.log(`    Automatically selecting episode by keyword: '${matchedDetail.name}' (FID: ${matchedDetail.fid}).`);
                                    break;
                                }
                            }
                        }
                        if (matchedDetail) {
                            fidsToFetchForEpisode = [matchedDetail.fid];
                            selectedEpisodeNameForTitle = matchedDetail.name;
                            episodeSelectedViaCli = true;
                        } else {
                            console.log(`    Warning: Specified --episode '${cliArgs.episode}' not found in '${folderName}'. Available episodes (sorted if possible):`);
                        }
                    }

                    if (fidsToFetchForEpisode.length === 0 && !episodeSelectedViaCli) { // Interactive episode selection
                        console.log(`    Episodes available in '${folderName}' (sorted if possible):`);
                        effectiveVideoDetailsList.forEach((vd, i) => console.log(`      ${i + 1}. ${vd.name} (FID: ${vd.fid})`));
                        
                        while (true) {
                            const epChoice = (await askQuestion(`    Enter episode number for '${folderName}', 'all', or 'skip': `)).trim().toLowerCase();
                            if (epChoice === 'skip') break;
                            if (epChoice === 'all') {
                                fidsToFetchForEpisode = effectiveVideoDetailsList.map(vd => vd.fid);
                                selectedEpisodeNameForTitle = null;
                                break;
                            }
                            const epIdx = parseInt(epChoice, 10) - 1;
                            if (!isNaN(epIdx) && epIdx >= 0 && epIdx < effectiveVideoDetailsList.length) {
                                fidsToFetchForEpisode = [effectiveVideoDetailsList[epIdx].fid];
                                selectedEpisodeNameForTitle = effectiveVideoDetailsList[epIdx].name;
                                console.log(`      Selected: ${selectedEpisodeNameForTitle}`);
                                break;
                            } else {
                                console.log("    Invalid episode number. Please try again.");
                            }
                        }
                    }

                    if (fidsToFetchForEpisode.length > 0) {
                        const streams = await getStreamsFromFids(fidsToFetchForEpisode, currentShareKeyForSubVideos, apiKey, cookie);
                        if (streams && streams.length > 0) {
                            for (const stream of streams) {
                                let streamTitlePrefix = `${showboxTitle} - ${folderName}`;
                                if (selectedEpisodeNameForTitle) {
                                    streamTitlePrefix += ` - ${selectedEpisodeNameForTitle}`;
                                }
                                allFoundStreams.push({ "title": streamTitlePrefix, "label": stream.label, "url": stream.url });
                            }
                        } else {
                            console.log(`    No streams returned from getStreamsFromFids for FIDs: ${fidsToFetchForEpisode.join(', ')} in folder '${folderName}'.`);
                        }
                    } else {
                         if (!(cliArgs && cliArgs.episode && !episodeSelectedViaCli)) { // Don't print if CLI episode failed and fell through
                           console.log(`    No FIDs selected or found to fetch for folder '${folderName}'.`);
                        }
                    }
                } else if (subContentResult.type === "folders") {
                    console.log(`    Found further sub-folders within '${folderName}'. Processing them is not yet implemented in this iteration.`);
                } else if (subContentResult.type === "direct_videos") {
                     console.log(`  Found direct video links in folder '${folderName}'`);
                     for (const stream of subContentResult.video_links) {
                        allFoundStreams.push({ "title": `${showboxTitle} - ${folderName}`, "label": stream.label, "url": stream.url });
                    }
                }else {
                    console.log(`    No videos found or error processing folder '${folderName}'. Type: ${subContentResult.type}`);
                }
            } else {
                console.log(`  Failed to fetch content for folder '${folderName}'. Skipping.`);
            }
        }
    } else if (pageContentResult.type === "empty") {
        console.log(`  ${pageContentResult.message}`);
    } else if (pageContentResult.type === "error") {
        console.log(`  Error processing ${febboxUrl}: ${pageContentResult.message}`);
    }
    return allFoundStreams;
}

// --- Main execution logic ---
async function main() {
    await ensureCacheDir(CACHE_DIR); // Ensure base cache directory exists

    const argv = yargs(hideBin(process.argv))
        .usage('Usage: node $0 [showbox_url] [options]')
        .positional('showbox_url', {
            describe: 'The ShowBox URL for a movie or TV show. Optional if --tmdb is used.',
            type: 'string'
        })
        .option('tmdb', {
            type: 'string',
            description: "TMDB ID and type, format: type/id (e.g., movie/12345 or tv/67890). Optional if showbox_url is used."
        })
        .option('season', {
            alias: 's',
            type: 'string',
            description: "Optional: Season number or name/keyword to directly process (e.g., '5', 'season 5')."
        })
        .option('episode', {
            alias: 'e',
            type: 'string',
            description: "Optional: Episode number (from listed files) or keyword in episode filename to directly process. Requires --season."
        })
        .option('all-episodes', {
            alias: 'ae',
            type: 'boolean',
            description: "Optional: Fetch all episodes from the specified --season, or from a chosen season if --season is not given. Overrides --episode."
        })
        .check((argv) => {
            if (!argv.showbox_url && !argv.tmdb) {
                throw new Error("You must provide either a showbox_url or use the --tmdb option.");
            }
            if (argv.showbox_url && argv.tmdb) {
                throw new Error("Please provide either a showbox_url or --tmdb, not both.");
            }
            if (argv.tmdb && !argv.tmdb.match(/^(movie|tv)\/\d+$/i)) {
                 throw new Error("--tmdb must be in the format type/id (e.g., movie/12345 or tv/67890).");
            }
            return true;
        })
        .help()
        .alias('help', 'h')
        .argv;

    let targetShowboxUrl = argv.showbox_url;

    // If TMDB ID is provided, try to get ShowBox URL from it
    if (argv.tmdb) {
        const [tmdbType, tmdbIdStr] = argv.tmdb.toLowerCase().split('/');
        const tmdbId = parseInt(tmdbIdStr, 10);
        console.log(`Attempting to find ShowBox URL for TMDB ${tmdbType} ID: ${tmdbId}`);
        targetShowboxUrl = await getShowboxUrlFromTmdbInfo(tmdbType, tmdbId, TMDB_API_KEY);
        if (!targetShowboxUrl) {
            console.error(`Could not derive ShowBox URL from TMDB ${tmdbType}/${tmdbId}. Exiting.`);
            process.exit(1);
        }
    }

    console.log(`Starting scraper for ShowBox URL: ${targetShowboxUrl}`);
    const startTime = Date.now(); // For execution time tracking
    apiRequestCounter = 0; // Reset counter at the beginning of main

    const showboxScraper = new ShowBoxScraper(SCRAPER_API_KEY);
    const febboxShareInfos = await showboxScraper.extractFebboxShareLinks(targetShowboxUrl);

    if (!febboxShareInfos || febboxShareInfos.length === 0) {
        console.log("No FebBox share links found from ShowBox. Exiting.");
        process.exit(0);
    }

    let grandTotalVideoStreams = [];
    for (const shareInfo of febboxShareInfos) {
        const febboxUrl = shareInfo.febbox_share_url;
        const showboxTitle = shareInfo.showbox_title || "Unknown Title from ShowBox";
        
        console.log(`\n--- Processing FebBox URL: ${febboxUrl} (from ShowBox title: ${showboxTitle}) ---`);
        
        const streamsFromThisFebboxLink = await processFebboxContent(
            febboxUrl, 
            showboxTitle, 
            SCRAPER_API_KEY, 
            FEBBOX_COOKIE, 
            argv, // Pass all parsed CLI args
            new Set() // Initialize visited set for each top-level FebBox link
        );
        
        if (streamsFromThisFebboxLink && streamsFromThisFebboxLink.length > 0) {
            grandTotalVideoStreams.push(...streamsFromThisFebboxLink);
        } else {
            console.log(`No video streams ultimately found from FebBox URL: ${febboxUrl} for '${showboxTitle}'`);
        }
    }

    if (grandTotalVideoStreams.length > 0) {
        console.log("\n--- Summary of all found video streams ---");
        grandTotalVideoStreams.forEach((streamDetail, i) => {
            console.log(`${i + 1}. Title: ${streamDetail.title} (Quality: ${streamDetail.label}) - URL: ${streamDetail.url}`);
        });
    } else {
        console.log("\nNo video streams found overall.");
    }
    
    // Print API usage summary
    const executionTime = (Date.now() - startTime) / 1000; // in seconds
    console.log(`\n--- ScraperAPI Usage Summary ---`);
    console.log(`Total API requests made: ${apiRequestCounter}`);
    console.log(`Approximate credits used: ${apiRequestCounter} credits`); // Assuming 1 credit per request
    console.log(`Total execution time: ${executionTime.toFixed(2)} seconds`);
}

if (require.main === module) {
    main().catch(err => {
        console.error("Unhandled error in main:", err);
        process.exit(1);
    });
} 