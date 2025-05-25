// cache_populator.js
const fs = require('fs').promises;
const path = require('path');
const {
    getShowboxUrlFromTmdbInfo, // Caches TMDB info
    ShowBoxScraper,          // Caches ShowBox pages and API responses
    extractFidsFromFebboxPage, // Caches FebBox share page HTML
    processShowWithSeasonsEpisodes, // Caches FebBox main page & season folder HTML
    // We will NOT call fetchSourcesForSingleFid or getStreamsFromTmdbId directly to avoid fetching final stream links
} = require('./scraper');

const TMDB_MASTER_LIST_FILE = path.join(__dirname, 'tmdb_master_list.json');
const SCRAPER_API_KEYS = [
    '97b86e829812f220d98e737205778cab',
    '96845d13e7a0a0d40fb4f148cd135ddc'
];
let currentApiKeyIndex = 0;
const MAX_ALLOWED_SEASONS = 25; // Define the maximum number of seasons allowed

// Simple delay function
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function getNextScraperApiKey() {
    const key = SCRAPER_API_KEYS[currentApiKeyIndex];
    currentApiKeyIndex = (currentApiKeyIndex + 1) % SCRAPER_API_KEYS.length;
    // console.log(`  Using ScraperAPI Key ending with: ...${key.slice(-4)}`);
    return key;
}

async function populateCacheForMediaItem(mediaItem) {
    const apiKey = getNextScraperApiKey();
    console.log(`\nProcessing: ${mediaItem.title} (${mediaItem.type} - ${mediaItem.tmdbId}) with API key ...${apiKey.slice(-4)}`);

    // Explicitly skip "One Piece"
    if (mediaItem.type === 'tv' && mediaItem.title && mediaItem.title.toLowerCase() === 'one piece') {
        console.log(`  Skipping TV show "One Piece" (ID: ${mediaItem.tmdbId}) explicitly by title.`);
        return;
    }

    // 1. Get ShowBox URL (this also caches TMDB data for the item)
    const tmdbInfo = await getShowboxUrlFromTmdbInfo(mediaItem.type, mediaItem.tmdbId, apiKey);
    if (!tmdbInfo || !tmdbInfo.showboxUrl) {
        console.log(`  Skipping ${mediaItem.title}: Could not get ShowBox URL.`);
        return;
    }
    console.log(`  Got ShowBox URL: ${tmdbInfo.showboxUrl}`);
    await delay(200); // Delay after TMDB interaction

    // 2. Get FebBox Share Link(s) (this caches ShowBox page HTML and its share_link API call)
    const showboxScraper = new ShowBoxScraper(apiKey);
    const febboxShareInfos = await showboxScraper.extractFebboxShareLinks(tmdbInfo.showboxUrl);
    if (!febboxShareInfos || febboxShareInfos.length === 0) {
        console.log(`  Skipping ${mediaItem.title}: No FebBox share links found from ShowBox.`);
        return;
    }
    console.log(`  Found ${febboxShareInfos.length} FebBox share link(s).`);
    await delay(200); // Delay after ShowBox interaction

    // 3. For each FebBox link, access it to cache its HTML and potentially season/episode listings
    for (const shareInfo of febboxShareInfos) {
        const febboxUrl = shareInfo.febbox_share_url;
        console.log(`  Processing FebBox URL for caching: ${febboxUrl}`);

        if (mediaItem.type === 'tv') {
            // Check for excessive seasons BEFORE processing them
            if (mediaItem.seasons && mediaItem.seasons.length > MAX_ALLOWED_SEASONS) {
                console.log(`  Skipping TV show ${mediaItem.title} (ID: ${mediaItem.tmdbId}) due to excessive seasons: ${mediaItem.seasons.length} (max allowed: ${MAX_ALLOWED_SEASONS}).`);
                // If we skip here, we might still want to cache the main FebBox page if it contains all episodes directly,
                // or we might decide to skip this FebBox URL entirely for this show.
                // For now, let's return from populateCacheForMediaItem to skip all processing for this show.
                return; // This will skip the entire media item if it has too many seasons.
            }

            if (mediaItem.seasons && mediaItem.seasons.length > 0) {
                for (const season of mediaItem.seasons) {
                    console.log(`    Caching season ${season.season_number} for ${mediaItem.title}`);
                    // Call processShowWithSeasonsEpisodes to cache main FebBox page and specific season folder HTML
                    // We pass an empty array for allStreams as we don't want to collect them here.
                    // We also pass null for episodeNum to indicate we are processing for the whole season page context.
                    try {
                        await processShowWithSeasonsEpisodes(febboxUrl, mediaItem.title, season.season_number, null, [], apiKey);
                        console.log(`      Cached FebBox main page and season ${season.season_number} folder list for ${febboxUrl}`);
                    } catch (e) {
                        console.error(`      Error processing season ${season.season_number} for ${mediaItem.title} at ${febboxUrl}: ${e.message}`);
                    }
                    await delay(500); // Delay between processing each season
                }
            } else {
                // For movies, or TV shows where season details weren't fetched/available in master list,
                // just fetch and cache the main FebBox share page.
                try {
                    await extractFidsFromFebboxPage(febboxUrl, apiKey);
                    console.log(`    Cached main FebBox page for ${febboxUrl}`);
                } catch (e) {
                    console.error(`    Error extracting FIDs/caching for ${febboxUrl}: ${e.message}`);
                }
            }
        } else {
            // For movies, just fetch and cache the main FebBox share page.
            try {
                await extractFidsFromFebboxPage(febboxUrl, apiKey);
                console.log(`    Cached main FebBox page for ${febboxUrl}`);
            } catch (e) {
                console.error(`    Error extracting FIDs/caching for ${febboxUrl}: ${e.message}`);
            }
        }
        await delay(300); // Delay after processing a FebBox URL
    }
}

async function main() {
    console.log("Starting Cache Populator...");
    let tmdbMasterList;
    try {
        const fileContent = await fs.readFile(TMDB_MASTER_LIST_FILE, 'utf-8');
        tmdbMasterList = JSON.parse(fileContent);
        console.log(`Successfully read ${tmdbMasterList.length} items from ${TMDB_MASTER_LIST_FILE}`);
    } catch (error) {
        console.error(`Error reading or parsing ${TMDB_MASTER_LIST_FILE}: ${error.message}`);
        console.error("Please ensure you run 'node fetch_tmdb_data.js' first to generate this file.");
        return;
    }

    if (!tmdbMasterList || tmdbMasterList.length === 0) {
        console.log("No media items found in the master list. Nothing to populate.");
        return;
    }

    let itemsProcessed = 0;
    for (const mediaItem of tmdbMasterList) {
        try {
            await populateCacheForMediaItem(mediaItem);
            itemsProcessed++;
            console.log(`  Completed processing for: ${mediaItem.title}. Total items processed: ${itemsProcessed}/${tmdbMasterList.length}`);
        } catch (error) {
            console.error(`Unhandled error processing ${mediaItem.title} (ID: ${mediaItem.tmdbId}): ${error.message}`);
            // Optionally, decide if you want to continue or stop on unhandled errors
        }
        await delay(1000); // Delay between processing each top-level media item (movie/show)
    }

    console.log("Cache population process finished.");
}

main().catch(err => {
    console.error("Unhandled critical error in cache populator main function:", err);
}); 