// cache_populator.js
require('dotenv').config(); // Ensure .env variables are loaded
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline'); // Added readline
const {
    getShowboxUrlFromTmdbInfo, // Now uses search, doesn't take apiKey from scraper.js
    ShowBoxScraper,          // Constructor from scraper.js doesn't take apiKey
    extractFidsFromFebboxPage, // from scraper.js, uses env vars for ScraperAPI for FebBox
    processShowWithSeasonsEpisodes, // from scraper.js, uses env vars for ScraperAPI for FebBox
} = require('./scraper.js'); // Explicitly using scraper.js for proxy/direct mode logic

const TMDB_MASTER_LIST_FILE = path.join(__dirname, 'tmdb_master_list.json');
// MODIFICATION: Removed SCRAPER_API_KEYS and currentApiKeyIndex
const MAX_ALLOWED_SEASONS = 25;

// Simple delay function
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper function for user input
function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans.trim().toLowerCase());
    }));
}

async function populateCacheForMediaItem(mediaItem) {
    // MODIFICATION: Removed scraperApiKey logic as scraper.js no longer uses it directly.
    console.log(`\nProcessing: ${mediaItem.title} (${mediaItem.type} - ${mediaItem.tmdbId}) using proxy/direct mode.`);

    if (mediaItem.type === 'tv' && mediaItem.title && mediaItem.title.toLowerCase() === 'one piece') {
        console.log(`  Skipping TV show "One Piece" (ID: ${mediaItem.tmdbId}) explicitly by title.`);
        return;
    }

    // 1. Get ShowBox URL (this also caches TMDB data for the item)
    // getShowboxUrlFromTmdbInfo from scraper.js no longer takes apiKey
    const tmdbInfo = await getShowboxUrlFromTmdbInfo(mediaItem.type, mediaItem.tmdbId);
    if (!tmdbInfo || !tmdbInfo.showboxUrl) {
        console.log(`  Skipping ${mediaItem.title}: Could not get ShowBox URL.`);
        return;
    }
    console.log(`  Got ShowBox URL: ${tmdbInfo.showboxUrl}`);
    await delay(200);

    // 2. Get FebBox Share Link(s)
    // ShowBoxScraper constructor from scraper.js doesn't take apiKey
    const showboxScraper = new ShowBoxScraper(); 
    const febboxShareInfos = await showboxScraper.extractFebboxShareLinks(tmdbInfo.showboxUrl);
    if (!febboxShareInfos || febboxShareInfos.length === 0) {
        console.log(`  Skipping ${mediaItem.title}: No FebBox share links found from ShowBox.`);
        return;
    }
    console.log(`  Found ${febboxShareInfos.length} FebBox share link(s).`);
    await delay(200);

    for (const shareInfo of febboxShareInfos) {
        const febboxUrl = shareInfo.febbox_share_url;
        console.log(`  Processing FebBox URL for caching: ${febboxUrl}`);

        if (mediaItem.type === 'tv') {
            if (mediaItem.seasons && mediaItem.seasons.length > MAX_ALLOWED_SEASONS) {
                console.log(`  Skipping TV show ${mediaItem.title} (ID: ${mediaItem.tmdbId}) due to excessive seasons: ${mediaItem.seasons.length} (max allowed: ${MAX_ALLOWED_SEASONS}).`);
                return;
            }

            if (mediaItem.seasons && mediaItem.seasons.length > 0) {
                for (const season of mediaItem.seasons) {
                    console.log(`    Caching season ${season.season_number} for ${mediaItem.title}`);
                    try {
                        // processShowWithSeasonsEpisodes from scraper.js no longer takes apiKey
                        // Pass resolveFids: false to prevent fetching actual stream links
                        await processShowWithSeasonsEpisodes(febboxUrl, mediaItem.title, season.season_number, null, [], false);
                        console.log(`      Cached FebBox main page and season ${season.season_number} folder list for ${febboxUrl} (FID resolution skipped).`);
                    } catch (e) {
                        console.error(`      Error processing season ${season.season_number} for ${mediaItem.title} at ${febboxUrl}: ${e.message}`);
                    }
                    await delay(500);
                }
            } else {
                try {
                    // extractFidsFromFebboxPage from scraper.js no longer takes apiKey
                    await extractFidsFromFebboxPage(febboxUrl);
                    console.log(`    Cached main FebBox page for ${febboxUrl}`);
                } catch (e) {
                    console.error(`    Error extracting FIDs/caching for ${febboxUrl}: ${e.message}`);
                }
            }
        } else {
            try {
                 // extractFidsFromFebboxPage from scraper.js no longer takes apiKey
                await extractFidsFromFebboxPage(febboxUrl);
                console.log(`    Cached main FebBox page for ${febboxUrl}`);
            } catch (e) {
                console.error(`    Error extracting FIDs/caching for ${febboxUrl}: ${e.message}`);
            }
        }
        await delay(300);
    }
}

async function main() {
    console.log("Starting Cache Populator (Proxy/Direct Mode for ShowBox, Env Var for FebBox API)...");

    const typeToProcess = await askQuestion("Which media type do you want to populate cache for? (movie / tv / both): ");

    if (!['movie', 'tv', 'both'].includes(typeToProcess)) {
        console.error("Invalid selection. Please enter 'movie', 'tv', or 'both'. Exiting.");
        return;
    }

    console.log(`Selected type to process: ${typeToProcess}`);

    // MODIFICATION: Removed USE_SCRAPER_API check as scraper.js no longer uses it.
    // if (process.env.USE_SCRAPER_API === 'true' && !process.env.SCRAPER_API_KEY_VALUE) {
    //     console.warn("Warning: USE_SCRAPER_API is true, but SCRAPER_API_KEY_VALUE is not set in .env. FebBox calls might fail if they need API key.");
    // }
    if (process.env.SHOWBOX_PROXY_URL_VALUE) {
        console.log(`Using ShowBox Proxy: ${process.env.SHOWBOX_PROXY_URL_VALUE}`);
    }

    let tmdbMasterList;
    try {
        const fileContent = await fs.readFile(TMDB_MASTER_LIST_FILE, 'utf-8');
        let parsedList = JSON.parse(fileContent);
        console.log(`Successfully read ${parsedList.length} items from ${TMDB_MASTER_LIST_FILE}`);
        
        if (typeToProcess !== 'both') {
            tmdbMasterList = parsedList.filter(item => item.type === typeToProcess);
            console.log(`Filtered list to ${tmdbMasterList.length} items of type '${typeToProcess}'.`);
        } else {
            tmdbMasterList = parsedList;
            console.log(`Processing all ${tmdbMasterList.length} items (movies and TV shows).`);
        }

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