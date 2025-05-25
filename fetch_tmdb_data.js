const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c'; // From scraper.js
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const OUTPUT_FILE = path.join(__dirname, 'tmdb_master_list.json');
const MAX_PAGES_PER_CATEGORY = 5; // Fetch top N pages for popular/trending
const MAX_ITEMS_PER_CATEGORY = 100; // Limit total items from each category

// Simple delay function to be respectful to the API
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

let requestCount = 0;
const MAX_REQUESTS_PER_SECOND = 20; // TMDB allows up to 40-50, being conservative
let lastRequestTime = Date.now();

async function makeTmdbRequest(url, params = {}) {
    requestCount++;
    const currentTime = Date.now();
    if (requestCount >= MAX_REQUESTS_PER_SECOND && (currentTime - lastRequestTime) < 1000) {
        const timeToWait = 1000 - (currentTime - lastRequestTime);
        // console.log(`Rate limit approaching, waiting for ${timeToWait}ms...`);
        await delay(timeToWait);
        requestCount = 0; // Reset count after waiting
        lastRequestTime = Date.now();
    } else if ((currentTime - lastRequestTime) >= 1000) {
        requestCount = 1; // Reset count if a second has passed
        lastRequestTime = currentTime;
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
            console.error("Rate limit hit hard. Waiting longer...");
            await delay(10000); // Wait 10 seconds if hit rate limit
        }
        return null;
    }
}

async function fetchPaginatedTmdbData(endpoint, itemLimit) {
    let allResults = [];
    let currentPage = 1;
    let totalPages = 1; // Initialize, will be updated by first API call

    console.log(`Fetching paginated data from ${endpoint}...`);
    while (currentPage <= totalPages && currentPage <= MAX_PAGES_PER_CATEGORY && allResults.length < itemLimit) {
        const data = await makeTmdbRequest(endpoint, { page: currentPage });
        if (data && data.results) {
            allResults.push(...data.results);
            totalPages = data.total_pages; // Update total pages from API response
            console.log(`  Fetched page ${currentPage}/${totalPages} for ${endpoint}. Items so far: ${allResults.length}`);
        } else {
            console.log(`  No data or results on page ${currentPage} for ${endpoint}. Stopping.`);
            break; // Stop if no data or results
        }
        currentPage++;
        if (allResults.length >= itemLimit) break;
        await delay(200); // Be nice to TMDB API between pages
    }
    return allResults.slice(0, itemLimit);
}

async function fetchMovieDetails(movieId) {
    const data = await makeTmdbRequest(`/movie/${movieId}`);
    if (!data) return null;
    return {
        tmdbId: String(data.id),
        type: 'movie',
        title: data.title || data.original_title,
        year: data.release_date ? String(data.release_date).substring(0, 4) : null,
        imdb_id: data.imdb_id
    };
}

async function fetchShowDetailsAndEpisodes(showId) {
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

    console.log(`  Fetching seasons for TV Show: ${showDetails.title} (ID: ${showId})`);
    for (const season of showData.seasons) {
        // Skip "Specials" (season_number 0) as they often cause issues or have no standard content
        if (season.season_number === 0) continue;

        console.log(`    Fetching episodes for Season ${season.season_number} of ${showDetails.title}`);
        const seasonData = await makeTmdbRequest(`/tv/${showId}/season/${season.season_number}`);
        await delay(100); // Delay between fetching each season
        if (seasonData && seasonData.episodes) {
            const seasonInfo = {
                season_number: season.season_number,
                episodes: seasonData.episodes.map(ep => ({
                    episode_number: ep.episode_number,
                    title: ep.name,
                    tmdb_id: String(ep.id), // Episode TMDB ID, might be useful later
                    air_date: ep.air_date
                }))
            };
            showDetails.seasons.push(seasonInfo);
        } else {
            console.log(`    Could not fetch episodes for Season ${season.season_number} of ${showDetails.title}`);
        }
    }
    return showDetails;
}


async function main() {
    console.log("Starting TMDB data fetch...");
    const allMedia = [];
    const processedIds = new Set(); // To avoid duplicates from different categories

    const categories = [
        { type: 'movie', endpoint: '/movie/popular', fetchFunction: fetchMovieDetails, label: "Popular Movies" },
        { type: 'movie', endpoint: '/trending/movie/week', fetchFunction: fetchMovieDetails, label: "Trending Movies" },
        // { type: 'tv', endpoint: '/tv/popular', fetchFunction: fetchShowDetailsAndEpisodes, label: "Popular TV Shows" }, // Temporarily disabled
        // { type: 'tv', endpoint: '/trending/tv/week', fetchFunction: fetchShowDetailsAndEpisodes, label: "Trending TV Shows" } // Temporarily disabled
    ];

    for (const category of categories) {
        console.log(`Fetching ${category.label}...`);
        const items = await fetchPaginatedTmdbData(category.endpoint, MAX_ITEMS_PER_CATEGORY);
        let count = 0;
        for (const item of items) {
            if (processedIds.has(String(item.id))) {
                // console.log(`  Skipping already processed ID: ${item.id} (${item.title || item.name})`);
                continue;
            }
            const details = await category.fetchFunction(item.id);
            if (details) {
                allMedia.push(details);
                processedIds.add(String(item.id));
                count++;
                console.log(`    Processed ${category.type} #${count}: ${details.title} (${details.year})`);
            }
            await delay(300); // Delay between fetching full details for each item
        }
        console.log(`Fetched ${count} new items from ${category.label}. Total media items: ${allMedia.length}
`);
    }

    try {
        await fs.writeFile(OUTPUT_FILE, JSON.stringify(allMedia, null, 2));
        console.log(`Successfully wrote ${allMedia.length} media items to ${OUTPUT_FILE}`);
    } catch (error) {
        console.error(`Error writing to ${OUTPUT_FILE}: ${error.message}`);
    }
    console.log("TMDB data fetch completed.");
}

main();
