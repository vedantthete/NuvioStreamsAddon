const readline = require('readline');
const { getStreamsFromTmdbId, isScraperApiKeyNeeded } = require('./scraper.js');

const SCRAPER_API_KEY = '97b86e829812f220d98e737205778cab';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function runScraperInteractive() {
  console.time('runScraperInteractive_total');
  try {
    if (isScraperApiKeyNeeded() && !SCRAPER_API_KEY) {
      console.error("Error: Scraper API Key is needed but not provided in test_scraper.js.");
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

    const streams = await getStreamsFromTmdbId(type, tmdbId, seasonNum, episodeNum, SCRAPER_API_KEY);

    if (streams && streams.length > 0) {
      console.log("\n--- Found Streams ---");
      streams.forEach((stream, index) => {
        console.log(`${index + 1}. Title: ${stream.title}`);
        console.log(`   Quality: ${stream.quality}`);
        console.log(`   Size: ${stream.size || 'Unknown size'}`);
        console.log(`   URL: ${stream.url}\n`);
      });
    } else {
      console.log("\n--- No streams found. ---");
    }

  } catch (error) {
    console.error("\n--- An error occurred ---");
    console.error(error);
  } finally {
    rl.close();
    console.timeEnd('runScraperInteractive_total');
  }
}

runScraperInteractive(); 