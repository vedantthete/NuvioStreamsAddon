const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c'; // From scraper.js
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const OUTPUT_FILE = path.join(__dirname, 'tmdb_master_list.json');
// const MAX_PAGES_PER_CATEGORY = 50; // No longer needed
// const MAX_ITEMS_PER_CATEGORY = 1000; // No longer needed
// const GIST_CSV_URL = 'https://gist.githubusercontent.com/hcgiub001/8ac97085513734eb51a5fca7657bdba5/raw/tmdb.imdb.list.001'; // REMOVE

const TRAKT_API_URL = 'https://api.trakt.tv';
const TRAKT_CLIENT_ID = 'be696ed9c455935bde7cb0188fd3ee87588e442d00e93b3d7e0f76bd52d5d336';
const TRAKT_API_VERSION = '2';
const TRAKT_ITEMS_PER_PAGE_LIMIT = 50; // Renamed from TRAKT_ITEMS_PER_LIST_LIMIT
const TRAKT_MAX_PAGES_PER_LIST = 3;   // Fetch up to 3 pages per Trakt list

// Simple delay function to be respectful to the API
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

let tmdbRequestCount = 0; // Renamed from requestCount for clarity
const MAX_TMDB_REQUESTS_PER_SECOND = 20;
let lastTmdbRequestTime = Date.now(); // Renamed for clarity

async function makeTmdbRequest(url, params = {}) {
    tmdbRequestCount++;
    const currentTime = Date.now();
    if (tmdbRequestCount >= MAX_TMDB_REQUESTS_PER_SECOND && (currentTime - lastTmdbRequestTime) < 1000) {
        const timeToWait = 1000 - (currentTime - lastTmdbRequestTime);
        // console.log(`TMDB Rate limit approaching, waiting for ${timeToWait}ms...`);
        await delay(timeToWait);
        tmdbRequestCount = 0; 
        lastTmdbRequestTime = Date.now();
    } else if ((currentTime - lastTmdbRequestTime) >= 1000) {
        tmdbRequestCount = 1; 
        lastTmdbRequestTime = currentTime;
    }

    try {
        // console.log(`Fetching TMDB: ${url} with params: ${JSON.stringify(params)}`);
        const response = await axios.get(`${TMDB_BASE_URL}${url}`, {
            params: { ...params, api_key: TMDB_API_KEY },
            timeout: 15000
        });
        return response.data;
    } catch (error) {
        const errorMessage = error.response ? `${error.message} (Status: ${error.response.status})` : error.message;
        console.error(`Error fetching TMDB data from ${url}: ${errorMessage}`);
        if (error.response && error.response.status === 429) {
            console.error("TMDB Rate limit hit hard. Waiting longer...");
            await delay(10000); 
        }
        return null;
    }
}

// Remove fetchPaginatedTmdbData function - no longer used
// // ... existing code ...
// async function fetchPaginatedTmdbData(endpoint, itemLimit) {
// // ... existing code ...
// }

// Remove fetchGistCsvData function
// // ... existing code ...
// async function fetchGistCsvData() {
// // ... existing code ...
// }

// Remove getTmdbMediaType function (will get type='tv' from Trakt shows, or fetchMovieDetails if needed)
// // ... existing code ...
// async function getTmdbMediaType(tmdbId) {
// // ... existing code ...
// }

async function fetchMovieDetails(movieId) { // Keep this, might be useful if Trakt provides movies too
    const data = await makeTmdbRequest(`/movie/${movieId}`);
    if (!data) return null;
    return {
        tmdbId: String(data.id),
        type: 'movie',
        title: data.title || data.original_title,
        year: data.release_date ? String(data.release_date).substring(0, 4) : null,
        imdb_id: data.imdb_id // Keep imdb_id
    };
}

async function fetchShowDetailsAndEpisodes(showId) { // Keep this
    const showData = await makeTmdbRequest(`/tv/${showId}`);
    if (!showData) return null;

    const showDetails = {
        tmdbId: String(showData.id),
        type: 'tv',
        title: showData.name || showData.original_name,
        year: showData.first_air_date ? String(showData.first_air_date).substring(0, 4) : null,
        imdb_id: showData.external_ids && showData.external_ids.imdb_id ? showData.external_ids.imdb_id : null,
        seasons: []
    };

    // console.log(`  Fetching seasons for TV Show: ${showDetails.title} (ID: ${showId})`); // Reduced verbosity
    for (const season of showData.seasons) {
        if (season.season_number === 0) continue; 

        // console.log(`    Fetching episodes for Season ${season.season_number} of ${showDetails.title}`); // Reduced verbosity
        const seasonData = await makeTmdbRequest(`/tv/${showId}/season/${season.season_number}`);
        await delay(100); 
        if (seasonData && seasonData.episodes) {
            const seasonInfo = {
                season_number: season.season_number,
                episodes: seasonData.episodes.map(ep => ({
                    episode_number: ep.episode_number,
                    title: ep.name,
                    tmdb_id: String(ep.id), 
                    air_date: ep.air_date
                }))
            };
            showDetails.seasons.push(seasonInfo);
        } else {
            // console.log(`    Could not fetch episodes for Season ${season.season_number} of ${showDetails.title}`); // Reduced verbosity
        }
    }
    return showDetails;
}

// Generalized function to fetch data from various Trakt lists
async function fetchTraktListData(endpointPath, itemType) {
    console.log(`Fetching Trakt.tv ${itemType} list from ${endpointPath} (up to ${TRAKT_MAX_PAGES_PER_LIST} pages, ${TRAKT_ITEMS_PER_PAGE_LIMIT} items/page)...`);
    let allFetchedItems = [];

    for (let page = 1; page <= TRAKT_MAX_PAGES_PER_LIST; page++) {
        console.log(`  Fetching page ${page} for ${endpointPath}...`);
        try {
            const response = await axios.get(`${TRAKT_API_URL}${endpointPath}`, {
                params: {
                    page: page,
                    limit: TRAKT_ITEMS_PER_PAGE_LIMIT,
                    extended: 'ids'
                },
                headers: {
                    'Content-Type': 'application/json',
                    'trakt-api-key': TRAKT_CLIENT_ID,
                    'trakt-api-version': TRAKT_API_VERSION
                },
                timeout: 20000
            });

            if (response.data && Array.isArray(response.data)) {
                if (response.data.length === 0) {
                    console.log(`    Page ${page} for ${endpointPath} returned no items. Stopping pagination for this list.`);
                    break; 
                }

                // Diagnostic log for movie endpoints
                if (itemType === 'movie') {
                    console.log(`    RAW DATA (Page ${page}, ${endpointPath}): ${response.data.length} items received. First item raw:`, JSON.stringify(response.data[0], null, 2));
                }

                const itemsFromPage = response.data.map(item => {
                    let sourceItem;
                    if (itemType === 'show') {
                        sourceItem = item.show;
                    } else { // itemType === 'movie'
                        // Handle potential structures for movie items from Trakt
                        if (item.movie) { // e.g., /movies/trending seems to have item.movie
                            sourceItem = item.movie;
                        } else { // e.g., /movies/popular previously seemed to have item as the movie object itself
                            sourceItem = item;
                        }
                    }
                    
                    if (!sourceItem || !sourceItem.ids || !sourceItem.ids.tmdb) {
                         if (itemType === 'movie' && (page === 1)) { 
                            // console.log(`    DIAGNOSTIC (Movie Filter): Item filtered out. Raw item:`, JSON.stringify(item, null, 2), `Reason: Missing sourceItem, sourceItem.ids, or sourceItem.ids.tmdb. SourceItem was:`, JSON.stringify(sourceItem, null, 2));
                        }
                        return null;
                    }
                    return {
                        title: sourceItem.title,
                        year: sourceItem.year,
                        tmdbId: String(sourceItem.ids.tmdb),
                        imdbId: sourceItem.ids.imdb ? String(sourceItem.ids.imdb) : null,
                        type: itemType === 'show' ? 'tv' : 'movie'
                    };
                }).filter(item => item && item.tmdbId);

                allFetchedItems.push(...itemsFromPage);
                console.log(`    Fetched ${itemsFromPage.length} valid items from page ${page} for ${endpointPath}.`);
                
                // If fewer items than limit are returned, it's likely the last page
                if (response.data.length < TRAKT_ITEMS_PER_PAGE_LIMIT) {
                    console.log(`    Page ${page} for ${endpointPath} returned fewer items than limit. Assuming last page for this list.`);
                    break;
                }

            } else {
                console.error(`  No data or unexpected format received from Trakt.tv (Page ${page}, ${endpointPath}).`);
                // Optionally break or continue based on desired error handling for a single page failure
                break; 
            }
        } catch (error) {
            const errorMessage = error.response ? `${error.message} (Status: ${error.response.status} - ${error.response.data ? JSON.stringify(error.response.data) : ''})` : error.message;
            console.error(`  Error fetching from Trakt.tv (Page ${page}, ${endpointPath}): ${errorMessage}`);
            // If one page fails, we might want to stop trying for this list
            break; 
        }
        if (page < TRAKT_MAX_PAGES_PER_LIST) {
             await delay(500); // Brief delay between fetching pages of the same list
        }
    }
    console.log(`Successfully fetched a total of ${allFetchedItems.length} ${itemType}s with TMDB IDs from Trakt.tv endpoint ${endpointPath} over ${TRAKT_MAX_PAGES_PER_LIST} page(s).`);
    return allFetchedItems;
}

async function main() {
    console.log("Starting TMDB data fetch (Source: Trakt.tv lists)...");
    // const allNewMedia = []; // This will be replaced by direct additions to masterData
    let existingMedia = [];
    const processedTmdbIds = new Set(); // Keeps track of TMDB IDs already in masterData or processed in this run

    try {
        const fileContent = await fs.readFile(OUTPUT_FILE, 'utf8');
        if (fileContent) {
            existingMedia = JSON.parse(fileContent);
            for (const mediaItem of existingMedia) {
                if (mediaItem && mediaItem.tmdbId) {
                    processedTmdbIds.add(String(mediaItem.tmdbId));
                }
            }
            console.log(`Loaded ${existingMedia.length} existing media items. ${processedTmdbIds.size} unique TMDB IDs pre-processed.`);
        }
    } catch (error) {
        if (error.code === 'ENOENT') console.log(`${OUTPUT_FILE} not found. Will create a new one if items are added.`);
        else console.error(`Error reading ${OUTPUT_FILE}: ${error.message}. Starting fresh.`);
        existingMedia = [];
    }

    let masterData = [...existingMedia]; // This will be the live list, updated and saved periodically
    let totalTmdbDetailsFetchedThisRun = 0; // Counts TMDB detail fetches in this run
    let itemsAppendedToMasterFileThisRun = 0; // Counts items actually added to masterData and thus to the file this run

    const traktEndpointsToFetch = [
        { path: '/shows/trending', type: 'show', label: 'Trending Shows' },
        { path: '/shows/popular', type: 'show', label: 'Popular Shows' },
        { path: '/shows/streaming', type: 'show', label: 'Streaming Shows' },
        { path: '/movies/trending', type: 'movie', label: 'Trending Movies' },
        { path: '/movies/popular', type: 'movie', label: 'Popular Movies' },
        { path: '/movies/streaming', type: 'movie', label: 'Streaming Movies' }
    ];

    for (const endpoint of traktEndpointsToFetch) {
        console.log(`\n--- Processing Trakt List: ${endpoint.label} ---`);
        const traktItems = await fetchTraktListData(endpoint.path, endpoint.type);
        let itemsAddedFromThisListToFile = 0;
        let itemsDetailedFromThisList = 0;

        if (traktItems.length > 0) {
            for (const traktItem of traktItems) {
                if (!traktItem.tmdbId) continue;
                
                // Check if we already have full details for this TMDB ID (either from file or this run)
                if (processedTmdbIds.has(traktItem.tmdbId)) {
                    // console.log(`  Skipping "${traktItem.title}" (TMDB ID: ${traktItem.tmdbId}) - already processed or in master list.`);
                    continue;
                }

                console.log(`  Fetching TMDB details for "${traktItem.title}" (Type: ${traktItem.type}, TMDB ID: ${traktItem.tmdbId}) from Trakt list "${endpoint.label}"`);
                let details = null;
                if (traktItem.type === 'tv') {
                    details = await fetchShowDetailsAndEpisodes(traktItem.tmdbId);
                } else if (traktItem.type === 'movie') {
                    details = await fetchMovieDetails(traktItem.tmdbId);
                }
                totalTmdbDetailsFetchedThisRun++; // Count each attempt to fetch details

                if (details) {
                    itemsDetailedFromThisList++;
                    if (!details.imdb_id && traktItem.imdbId) {
                        details.imdb_id = traktItem.imdbId;
                        console.log(`    Used IMDb ID from Trakt (${traktItem.imdbId}) for "${details.title}".`);
                    }
                    
                    // This check is slightly redundant if processedTmdbIds is managed perfectly,
                    // but good as a final safeguard before modifying masterData.
                    if (!processedTmdbIds.has(details.tmdbId)) {
                        masterData.push(details);
                        processedTmdbIds.add(details.tmdbId); // Ensure this ID is marked as processed
                        itemsAddedFromThisListToFile++;
                        itemsAppendedToMasterFileThisRun++;
                    }
                    console.log(`    Processed from "${endpoint.label}": ${details.title} (${details.year || 'N/A'})`);
                } else {
                    console.log(`    Could not fetch TMDB details for "${traktItem.title}" (TMDB ID: ${traktItem.tmdbId})`);
                }
                await delay(350);
            }
            console.log(`  Fetched TMDB details for ${itemsDetailedFromThisList} items from Trakt list "${endpoint.label}".`);
            if (itemsAddedFromThisListToFile > 0) {
                try {
                    await fs.writeFile(OUTPUT_FILE, JSON.stringify(masterData, null, 2));
                    console.log(`  SUCCESS: Saved ${itemsAddedFromThisListToFile} new item(s) to master list after "${endpoint.label}". List total: ${masterData.length}.`);
                } catch (error) {
                    console.error(`  ERROR writing to ${OUTPUT_FILE} after "${endpoint.label}": ${error.message}`);
                }
            } else {
                console.log(`  No new items were added to the master list from "${endpoint.label}".`);
            }
        }
    }

    console.log(`\n--- Run Summary ---`);
    console.log(`Total TMDB detail fetch attempts this run: ${totalTmdbDetailsFetchedThisRun}`);
    console.log(`Total new items appended to the master list this run: ${itemsAppendedToMasterFileThisRun}`);
    if (masterData.length === 0 && itemsAppendedToMasterFileThisRun === 0 && existingMedia.length === 0) {
         console.log(`No items were processed and the master list remains empty or was not created.`);
    } else {
        console.log(`Master list now contains ${masterData.length} items.`);
    }
    console.log("TMDB data fetch (from Trakt.tv lists) completed.");
}

main(); // Keep main invocation
