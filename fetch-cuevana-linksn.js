#!/usr/bin/env node

/**
 * Standalone script to fetch Cuevana3 streaming links by TMDB ID
 * Usage: 
 *   Movie:   node fetch-cuevana-links.js --movie 556574
 *   TV Show: node fetch-cuevana-links.js --show 1396 --season 1 --episode 1
 */

// Define constants
const FLAGS = { CORS_ALLOWED: 'CORS_ALLOWED' };
const BASE_URL = 'https://ws-m3u8.moonpic.qzz.io:3008/tmdb';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

// Helper function to convert number to base36
function intToBase36(num) {
  if (num === 0) return "0";
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let base36String = "";
  while (num > 0) {
    const remainder = num % 36;
    base36String = alphabet[remainder] + base36String;
    num = Math.floor(num / 36);
  }
  return base36String;
}

// Helper function to deobfuscate the packed JS from streamwish
function deobfuscateStreamwish(packedJs) {
  // Regex to capture p, a, c, k components. Made quotes around p and k flexible.
  const evalMatch = packedJs.match(/eval\(function\(p,a,c,k,e,d\)\{.*?return p\}\((['"])(.*?)\1,\s*(\d+),\s*(\d+),\s*(['"])(.*?)\5\.split\(['"]\|['"]\)/s);
  if (!evalMatch || evalMatch.length < 7) { 
    console.warn("Streamwish: Could not find eval function or its parameters consistently. Match length:", evalMatch ? evalMatch.length : 0);
    if (evalMatch) console.warn("Streamwish evalMatch parts:", evalMatch.slice(1, 7).join(" | "));
    return null;
  }

  let p = evalMatch[2]; // The packed code
  const a = parseInt(evalMatch[3], 10); // base for c.toString(a)
  let c = parseInt(evalMatch[4], 10); // count of keywords
  const k = evalMatch[6].split('|');   // keywords array

  if (isNaN(a) || isNaN(c)) {
    console.warn("Streamwish: Failed to parse radix 'a' or count 'c'.");
    return null;
  }
  
  while (c--) {
    const token = c.toString(a);
    if (k[c]) {
      const regex = new RegExp('\\b' + token + '\\b', 'g');
      p = p.replace(regex, k[c]);
    }
  }
  return p;
}

// Main function to scrape the links
async function scrapeLinks(mediaType, tmdbId, season, episode) {
  // Build the URL based on media type
  let url = '';
  if (mediaType === 'movie') {
    url = `${BASE_URL}/movie/${tmdbId}`;
  } else if (mediaType === 'show') {
    if (season == null || episode == null) {
      throw new Error('Season and episode numbers are required for TV shows');
    }
    url = `${BASE_URL}/tv/${tmdbId}/season/${season}/episode/${episode}`;
  } else {
    throw new Error('Unsupported media type. Use --movie or --show');
  }

  const initialHeaders = {
    'Origin': 'https://pstream.org',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36'
  };

  console.log(`Fetching data from ${url}...`);
  const response = await fetch(url, { headers: initialHeaders });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.embeds || !Array.isArray(data.embeds) || data.embeds.length === 0) {
    throw new Error('No valid embeds found in the response');
  }

  console.log(`Found ${data.embeds.length} embed(s). Processing...`);
  
  const streams = [];
  let embedStreamCounter = 0;

  for (const embed of data.embeds) {
    // Extract language from embedId
    let languageForEmbed = 'unk'; // Default to unknown
    if (embed.embedId && embed.embedId.startsWith('streamwish-')) {
      const langPart = embed.embedId.substring('streamwish-'.length);
      if (langPart) {
        languageForEmbed = langPart;
      }
    }

    let embedUrlObject;
    try {
      embedUrlObject = new URL(embed.url);
    } catch (e) {
      console.warn(`Invalid embed URL: ${embed.url}`);
      continue;
    }
    
    const embedHostname = embedUrlObject.hostname;
    const embedOrigin = embedUrlObject.origin;

    // Only process streamwish/swiftplayers embeds
    if (embed.url && (embedHostname.includes('streamwish.to') || embedHostname.includes('swiftplayers.com') || embedHostname.includes('playerswish.com'))) {
      embedStreamCounter++;
      console.log(`Processing embed: ${embed.url} (${languageForEmbed})`);
      
      try {
        const embedPageHeaders = { 
          'User-Agent': USER_AGENT,
          'Referer': embedOrigin
        };

        const embedResponse = await fetch(embed.url, { headers: embedPageHeaders });
        
        if (!embedResponse.ok) {
          console.warn(`Failed to fetch embed ${embed.url}: ${embedResponse.status} ${embedResponse.statusText}`);
          continue;
        }
        
        const embedPageText = await embedResponse.text();
        const deobfuscatedJs = deobfuscateStreamwish(embedPageText);

        if (deobfuscatedJs) {
          const m3u8MasterRegex = /"(?:hls[^"}]*)":\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/i;
          const masterMatch = deobfuscatedJs.match(m3u8MasterRegex);

          if (masterMatch && masterMatch[1]) {
            const masterPlaylistUrl = masterMatch[1];
            console.log(`Found master playlist: ${masterPlaylistUrl}`);
            
            const streamHeaders = {
              'Referer': 'https://swiftplayers.com/',
              'Origin': 'https://swiftplayers.com/',
              'User-Agent': USER_AGENT
            };

            let variantsFound = 0;
            try {
              const masterPlaylistResponse = await fetch(masterPlaylistUrl, { headers: streamHeaders });
              if (masterPlaylistResponse.ok) {
                const masterPlaylistText = await masterPlaylistResponse.text();
                const lines = masterPlaylistText.split(/\r?\n/);
                const masterBaseUrl = masterPlaylistUrl.substring(0, masterPlaylistUrl.lastIndexOf('/') + 1);
                
                for (let i = 0; i < lines.length; i++) {
                  if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
                    const streamInfoLine = lines[i];
                    let qualityLabel = 'auto';
                    
                    // Try to extract resolution
                    const resolutionMatch = streamInfoLine.match(/RESOLUTION=(\d+x(\d+))/);
                    if (resolutionMatch && resolutionMatch[2]) {
                      qualityLabel = resolutionMatch[2] + 'p';
                    } else {
                      // Fallback to bandwidth
                      const bandwidthMatch = streamInfoLine.match(/BANDWIDTH=(\d+)/);
                      if (bandwidthMatch) {
                        qualityLabel = Math.round(parseInt(bandwidthMatch[1]) / 1000) + 'k';
                      }
                    }

                    if (i + 1 < lines.length && lines[i+1].trim() && !lines[i+1].startsWith('#')) {
                      const mediaPlaylistPath = lines[i+1].trim();
                      const mediaPlaylistUrl = new URL(mediaPlaylistPath, masterBaseUrl).href;
                      
                      const streamId = `sw-${languageForEmbed}-${qualityLabel}-${embedStreamCounter}-${variantsFound}`;
                      
                      streams.push({
                        id: streamId,
                        type: 'hls',
                        language: languageForEmbed,
                        quality: qualityLabel,
                        playlist: mediaPlaylistUrl,
                        flags: [FLAGS.CORS_ALLOWED],
                        headers: streamHeaders,
                      });
                      
                      variantsFound++;
                      console.log(`Extracted variant: Lang(${languageForEmbed}) Qual(${qualityLabel})`);
                    }
                  }
                }
                
                // If no variants found but the playlist itself contains segments
                if (variantsFound === 0 && masterPlaylistText.includes('#EXTINF:')) {
                  streams.push({
                    id: `sw-${languageForEmbed}-auto-${embedStreamCounter}-0`,
                    type: 'hls',
                    language: languageForEmbed,
                    quality: 'auto',
                    playlist: masterPlaylistUrl,
                    flags: [FLAGS.CORS_ALLOWED],
                    headers: streamHeaders,
                  });
                  
                  variantsFound++;
                  console.log(`Using master as media playlist: Lang(${languageForEmbed}) Qual(auto)`);
                }

                if (variantsFound === 0) {
                  console.warn(`No media playlists found in master: ${masterPlaylistUrl}`);
                }
              } else {
                console.warn(`Failed to fetch master playlist: ${masterPlaylistResponse.status} ${masterPlaylistResponse.statusText}`);
              }
            } catch (err) {
              console.error(`Error processing master playlist: ${err.message || err}`);
            }
          } else {
            console.warn(`No M3U8 master link found in deobfuscated JS`);
          }
        } else {
          console.warn(`Failed to deobfuscate JavaScript`);
        }
      } catch (err) {
        console.error(`Error processing embed ${embed.url}: ${err.message || err}`);
      }
    } else {
      console.log(`Skipping non-streamwish embed: ${embed.url}`);
    }
  }

  return {
    embeds: data.embeds,
    streams: streams
  };
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--movie') {
      params.mediaType = 'movie';
      params.tmdbId = args[i + 1];
      i++;
    } else if (args[i] === '--show') {
      params.mediaType = 'show';
      params.tmdbId = args[i + 1];
      i++;
    } else if (args[i] === '--season') {
      params.season = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--episode') {
      params.episode = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  
  if (!params.mediaType || !params.tmdbId) {
    console.error('Error: Missing required parameters');
    printHelp();
    process.exit(1);
  }
  
  return params;
}

function printHelp() {
  console.log(`
Fetch Cuevana3 streaming links by TMDB ID

Usage:
  For movies:    node fetch-cuevana-links.js --movie <tmdbId>
  For TV shows:  node fetch-cuevana-links.js --show <tmdbId> --season <number> --episode <number>
  
Options:
  --movie <tmdbId>       Fetch links for a movie with the given TMDB ID
  --show <tmdbId>        Fetch links for a TV show with the given TMDB ID
  --season <number>      Season number (required for TV shows)
  --episode <number>     Episode number (required for TV shows)
  --help, -h             Show this help message
  
Example:
  node fetch-cuevana-links.js --movie 556574
  node fetch-cuevana-links.js --show 1396 --season 1 --episode 1
`);
}

// Main execution
async function main() {
  try {
    const params = parseArgs();
    const result = await scrapeLinks(params.mediaType, params.tmdbId, params.season, params.episode);
    
    // Print the final results
    console.log('\n--- RESULTS ---');
    console.log(`Total streams found: ${result.streams.length}`);
    
    // Group streams by language
    const streamsByLanguage = {};
    result.streams.forEach(stream => {
      if (!streamsByLanguage[stream.language]) {
        streamsByLanguage[stream.language] = [];
      }
      streamsByLanguage[stream.language].push(stream);
    });
    
    // Print streams by language and quality
    for (const [language, langStreams] of Object.entries(streamsByLanguage)) {
      console.log(`\n${language.toUpperCase()}:`);
      
      // Sort by quality (try to put higher quality first)
      langStreams.sort((a, b) => {
        // Extract number from quality label (e.g., "720p" -> 720)
        const aNum = parseInt(a.quality.match(/\d+/)?.[0] || '0', 10);
        const bNum = parseInt(b.quality.match(/\d+/)?.[0] || '0', 10);
        
        // Higher resolution first
        return bNum - aNum;
      });
      
      langStreams.forEach(stream => {
        console.log(`  [${stream.quality}] ${stream.playlist}`);
      });
    }
    
    // Export full JSON if needed
    // console.log('\nFull data:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error.message || error);
    process.exit(1);
  }
}

// Run the script
main(); 