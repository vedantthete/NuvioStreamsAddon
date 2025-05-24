const { addonBuilder } = require('stremio-addon-sdk');
const { getStreamsFromTmdbId, convertImdbToTmdb, isScraperApiKeyNeeded } = require('./scraper');
const manifest = require('./manifest.json');

// Initialize the addon
const builder = new addonBuilder(manifest);

// Define stream handler for movies
builder.defineStreamHandler(async (args) => {
    const { type, id, config } = args;

    const userScraperApiKey = (config && config.scraperApiKey) ? config.scraperApiKey : null;

    console.log(`Stream request for Stremio type: '${type}', id: '${id}'`);
    if (userScraperApiKey) {
        const maskedApiKey = userScraperApiKey.length > 8 
            ? `${userScraperApiKey.substring(0, 4)}...${userScraperApiKey.substring(userScraperApiKey.length - 4)}` 
            : userScraperApiKey;
        console.log(`  Using ScraperAPI Key: ${maskedApiKey}`);
    } else {
        console.log("  No ScraperAPI Key configured by user.");
    }

    if (isScraperApiKeyNeeded() && !userScraperApiKey) {
        console.log("  ScraperAPI key is required but not configured by the user.");
        return {
            streams: [{
                name: "Configuration Error",
                title: "Please configure your ScraperAPI Key in the addon settings.",
                type: "url",
                url: "#configurationError"
            }]
        };
    }
    
    if (type !== 'movie' && type !== 'series') {
        return { streams: [] };
    }
    
    let tmdbId;
    let tmdbTypeFromId;
    let seasonNum = null;
    let episodeNum = null;
    
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
        
        // Extract season and episode from IMDb ID format (e.g., tt1234567:1:2)
        const imdbParts = id.split(':');
        if (imdbParts.length >= 3 && type === 'series') {
            seasonNum = parseInt(imdbParts[1], 10);
            episodeNum = parseInt(imdbParts[2], 10);
            console.log(`  Parsed season ${seasonNum}, episode ${episodeNum} from IMDb ID`);
            
            // Use just the IMDb ID part for conversion
            const baseImdbId = imdbParts[0];
            const conversionResult = await convertImdbToTmdb(baseImdbId, userScraperApiKey);
            if (conversionResult && conversionResult.tmdbId && conversionResult.tmdbType) {
                tmdbId = conversionResult.tmdbId;
                tmdbTypeFromId = conversionResult.tmdbType;
                console.log(`  Successfully converted IMDb ID ${baseImdbId} to TMDB ${tmdbTypeFromId} ID ${tmdbId} (${conversionResult.title})`);
            } else {
                console.log(`  Failed to convert IMDb ID ${baseImdbId} to TMDB ID.`);
                return { streams: [] };
            }
        } else {
            // Regular movie IMDb ID
            const conversionResult = await convertImdbToTmdb(id, userScraperApiKey);
            if (conversionResult && conversionResult.tmdbId && conversionResult.tmdbType) {
                tmdbId = conversionResult.tmdbId;
                tmdbTypeFromId = conversionResult.tmdbType;
                console.log(`  Successfully converted IMDb ID ${id} to TMDB ${tmdbTypeFromId} ID ${tmdbId} (${conversionResult.title})`);
            } else {
                console.log(`  Failed to convert IMDb ID ${id} to TMDB ID.`);
                return { streams: [] };
            }
        }
    } else {
        console.log(`  Unrecognized ID format: ${id}`);
        return { streams: [] };
    }
    
    if (!tmdbId || !tmdbTypeFromId) {
        console.log('  Could not determine TMDB ID or type after processing Stremio ID.');
        return { streams: [] };
    }
    
    try {
        console.log(`Fetching streams for TMDB Type: '${tmdbTypeFromId}', ID: '${tmdbId}'${seasonNum !== null ? `, Season: ${seasonNum}` : ''}${episodeNum !== null ? `, Episode: ${episodeNum}` : ''}`);
        const streamsFromScraper = await getStreamsFromTmdbId(tmdbTypeFromId, tmdbId, seasonNum, episodeNum, userScraperApiKey);
        
        if (!streamsFromScraper || streamsFromScraper.length === 0) {
            console.log(`  No streams returned from scraper for TMDB ${tmdbTypeFromId}/${tmdbId}`);
            return { streams: [] };
        }
        
        const stremioStreamObjects = streamsFromScraper.map((stream, index) => {
            // Aligning with the working example provided by the user
            const qualityLabel = stream.quality || 'ORG';
            const sourceTitle = stream.title; // This is the descriptive title from our scraper
            let displayTitle = sourceTitle; // Default to full descriptive title

            // If it's a TV series episode, shorten the title for Stremio display
            if (tmdbTypeFromId === 'tv' && seasonNum !== null && episodeNum !== null) {
                // sourceTitle is typically: "Series Name - S<Season>E<EpisodeFromFile> - FileName - Quality"
                // We want to display: "Series Name - E<RequestedEpisode>"
                const seasonPattern = ` - S${seasonNum}`;
                const parts = sourceTitle.split(seasonPattern);
                if (parts.length > 0) {
                    const seriesName = parts[0]; // Get the part before " - S<seasonNum>..."
                    displayTitle = `${seriesName} - E${episodeNum}`;
                } 
                // If parsing fails, it defaults to the full sourceTitle, which is acceptable.
            }

            return {
                name: `ShowBox - ${qualityLabel}`, // Primary label in Stremio UI, e.g., "ShowBox - 1080p", "ShowBox - ORG"
                title: displayTitle, // MODIFIED: Use the potentially shortened title for TV episodes
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

        return {
            streams: stremioStreamObjects
        };
    } catch (err) {
        console.error(`Error in stream handler for TMDB ${tmdbTypeFromId}/${tmdbId}:`, err);
        return { streams: [] };
    }
});

// Build and export the addon
module.exports = builder.getInterface(); 