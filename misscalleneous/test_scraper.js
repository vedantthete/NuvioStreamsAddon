require('dotenv').config(); // Load environment variables from .env file
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

// Get ScraperAPI key from environment if available, otherwise use a fallback
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY_VALUE || '97b86e829812f220d98e737205778cab';

async function runScraperInteractive() {
  try {
    // Let user choose which scraper to use
    console.log("\n==== SCRAPER MODE SELECTION ====");
    console.log("1. ScraperAPI mode (uses scraperapi.js)");
    console.log("   - Uses ScraperAPI service to bypass website blocks");
    console.log("   - Requires a valid ScraperAPI key");
    console.log("   - More reliable but has usage costs");
    console.log("\n2. Proxy/Direct mode (uses scraper.js)");
    console.log("   - Uses direct connections or optional proxy");
    console.log("   - No ScraperAPI costs");
    console.log("   - May encounter website blocks");
    console.log("   - Can be configured to use a proxy via SHOWBOX_PROXY_URL_VALUE");
    console.log("\n============================");
    const scraperChoice = await question("Enter your choice (1 or 2): ");
    
    // Load appropriate scraper based on user input
    let scraper;
    if (scraperChoice === '1') {
      console.log('\n✅ Using ScraperAPI mode with scraperapi.js');
      scraper = require('./scraperapi.js');
    } else {
      console.log('\n✅ Using Proxy/Direct mode with scraper.js');
      scraper = require('./scraper.js');
    }
    
    // Show current environment configuration
    console.log("\n==== CURRENT CONFIGURATION ====");
    console.log(`ScraperAPI Key: ${SCRAPER_API_KEY ? "Configured" : "Not configured"}`);
    console.log(`ShowBox Proxy URL: ${process.env.SHOWBOX_PROXY_URL_VALUE || "Not configured"}`);
    console.log(`Cache Disabled: ${process.env.DISABLE_CACHE === 'true' ? "Yes" : "No"}`);
    console.log("===============================\n");
    
    // Destructure the required functions from the selected scraper
    const { getStreamsFromTmdbId, isScraperApiKeyNeeded } = scraper;
    
    if (isScraperApiKeyNeeded() && !SCRAPER_API_KEY) {
      console.error("⚠️ Error: Scraper API Key is needed but not provided in test_scraper.js.");
      rl.close();
      return;
    }

    const tmdbId = await question("Enter TMDB ID (e.g., 603 for movie, 1396 for TV): ");
    if (!tmdbId) {
      console.log("TMDB ID is required.");
      rl.close();
      return;
    }

    const type = (await question("Enter type ('movie' or 'tv'): ")).toLowerCase();
    if (type !== 'movie' && type !== 'tv') {
      console.log("Invalid type. Please enter 'movie' or 'tv'.");
      rl.close();
      return;
    }

    let seasonNum = null;
    let episodeNum = null;

    if (type === 'tv') {
      const seasonStr = await question("Enter Season Number (optional, press Enter to skip): ");
      if (seasonStr) {
        seasonNum = parseInt(seasonStr, 10);
        if (isNaN(seasonNum)) {
          console.log("Invalid season number.");
          rl.close();
          return;
        }

        const episodeStr = await question("Enter Episode Number (optional, press Enter to skip if you want all episodes of the season): ");
        if (episodeStr) {
          episodeNum = parseInt(episodeStr, 10);
          if (isNaN(episodeNum)) {
            console.log("Invalid episode number.");
            rl.close();
            return;
          }
        }
      }
    }

    console.log(`\nFetching streams for TMDB ID: ${tmdbId}, Type: ${type}${seasonNum ? ', Season: ' + seasonNum : ''}${episodeNum ? ', Episode: ' + episodeNum : ''}...`);
    
    // Start the timer right before making the API calls
    console.time('scraping_execution_time');

    const streams = await getStreamsFromTmdbId(type, tmdbId, seasonNum, episodeNum, SCRAPER_API_KEY);

    if (streams && streams.length > 0) {
      console.log("\n===== FOUND STREAMS =====");
      console.log(`Total streams found: ${streams.length}`);
      
      streams.forEach((stream, index) => {
        console.log(`\n📺 STREAM #${index + 1}`);
        console.log(`🎬 Title: ${stream.title}`);
        console.log(`🔍 Quality: ${stream.quality}`);
        console.log(`📊 Size: ${stream.size || 'Unknown size'}`);
        if (stream.codecs && stream.codecs.length > 0) {
          console.log(`🎞️ Codecs: ${stream.codecs.join(', ')}`);
        } else {
          console.log(`🎞️ Codecs: N/A`);
        }
        console.log(`🔗 URL: ${stream.url}`);
      });
      console.log("\n=======================");
    } else {
      console.log("\n❌ No streams found.");
    }

  } catch (error) {
    console.error("\n--- An error occurred ---");
    console.error(error);
  } finally {
    rl.close();
  }
}

// Wait for readline interface to fully close before ending timer
runScraperInteractive().then(() => {
  // Add a small delay to ensure all cleanup is complete
  setTimeout(() => {
    console.timeEnd('scraping_execution_time');
  }, 100);
}); 