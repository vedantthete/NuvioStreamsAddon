// cache_populator.js
const { getStreamsFromTmdbId, convertImdbToTmdb } = require('./scraper');

async function populateCache() {
    const args = process.argv.slice(2); // Skip node executable and script path

    const usage = () => {
        console.log(`
Usage:
  node cache_populator.js convert <imdbId>
    Example: node cache_populator.js convert tt0111161

  node cache_populator.js streams movie <tmdbId>
    Example: node cache_populator.js streams movie 550

  node cache_populator.js streams tv <tmdbId> [seasonNumber] [episodeNumber]
    Example (whole season): node cache_populator.js streams tv 1396 1
    Example (specific episode): node cache_populator.js streams tv 1396 1 1
        `);
    };

    if (args.length < 2) {
        usage();
        return;
    }

    const command = args[0];

    if (command === 'convert') {
        if (args.length !== 2) {
            console.error('Error: Invalid arguments for "convert" command.');
            usage();
            return;
        }
        const imdbId = args[1];
        console.log(`Attempting to convert IMDb ID: ${imdbId} and cache the result...`);
        try {
            const result = await convertImdbToTmdb(imdbId);
            if (result) {
                console.log(`Conversion successful for ${imdbId}: TMDB ID ${result.tmdbId} (${result.tmdbType}), Title: ${result.title}`);
                console.log(`Data for this conversion should now be cached.`);
            } else {
                console.log(`Conversion failed or no data found for ${imdbId}. Check scraper logs for details.`);
            }
        } catch (error) {
            console.error(`Error during IMDb ID conversion for ${imdbId}:`, error.message);
        }
    } else if (command === 'streams') {
        if (args.length < 3) {
            console.error('Error: Invalid arguments for "streams" command.');
            usage();
            return;
        }
        const type = args[1];
        const tmdbId = args[2];
        let season = args[3] ? parseInt(args[3], 10) : null;
        let episode = args[4] ? parseInt(args[4], 10) : null;

        if (type !== 'movie' && type !== 'tv') {
            console.error('Error: Invalid type. Must be "movie" or "tv".');
            usage();
            return;
        }
        if (isNaN(parseInt(tmdbId, 10))) {
             console.warn(`Warning: TMDB ID "${tmdbId}" does not appear to be a valid number.`);
        }
        if (args[3] && isNaN(season)) {
            console.error('Error: Season number must be a number.');
            usage();
            return;
        }
        if (args[4] && isNaN(episode)) {
            console.error('Error: Episode number must be a number.');
            usage();
            return;
        }


        console.log(`Attempting to fetch streams for TMDB ${type}/${tmdbId}${season ? ` S${season}` : ''}${episode ? `E${episode}` : ''} and populate cache...`);
        try {
            const streams = await getStreamsFromTmdbId(type, tmdbId, season, episode);
            if (streams && streams.length > 0) {
                console.log(`Successfully fetched ${streams.length} streams for TMDB ${type}/${tmdbId}. All related data should now be cached.`);
            } else {
                console.log(`No streams found for TMDB ${type}/${tmdbId}. Some intermediate data might still be cached. Check scraper logs for details.`);
            }
        } catch (error) {
            console.error(`Error fetching streams for TMDB ${type}/${tmdbId}:`, error.message);
        }
    } else {
        console.error(`Error: Unknown command "${command}".`);
        usage();
    }
}

populateCache().catch(err => {
    console.error("Unhandled error in cache populator:", err.message);
    console.error("Stacktrace:", err.stack);
}); 