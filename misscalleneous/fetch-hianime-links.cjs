#!/usr/bin/env node

// Standalone Node.js script to fetch HLS stream links from Hianime (netmagcdn.com only)
// for a specific TV show episode using its TMDB ID.
// Usage: node fetch-hianime-links.js --show <TMDB_ID> --season <S_NUM> --episode <E_NUM>
// Example: node fetch-hianime-links.js --show 127532 --season 1 --episode 1

const https = require('https');

// --- Configuration & Constants ---
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const API_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://pstream.org',
};
const TMDB_API_KEY = '5b9790d9305dca8713b9a0afad42ea8d'; // Public API key

const SERVERS_TO_TRY = [
  { server: 'hd-1', category: 'dub' },
  { server: 'hd-1', category: 'sub' },
  { server: 'hd-2', category: 'dub' },
  { server: 'hd-2', category: 'sub' },
];

// --- Helper Functions ---

async function fetchJson(url, options = {}, attempt = 1) {
  try {
    const response = await fetch(url, {
      agent: new https.Agent({ rejectUnauthorized: false }), // Allow self-signed certs if any issues arise
       ...options,
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Could not read error text');
      console.error(`API Error: ${response.status} for ${url}. Response: ${errorText}`);
      if (response.status === 403 && attempt < 3) { // Retry for 403s sometimes helps
        console.warn(`Retrying fetch for ${url} (attempt ${attempt + 1}) after 403...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        return fetchJson(url, options, attempt + 1);
      }
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return response.json();
  } catch (error) {
    console.error(`Fetch error for ${url}:`, error.message);
    throw error;
  }
}


async function searchAnimeOnHianime(title, seasonNumber = null) {
  const searchUrl = `https://hianime.pstream.org/api/v2/hianime/search?q=${encodeURIComponent(title)}`;
  console.log(`Searching for anime: "${title}"...`);
  const data = await fetchJson(searchUrl, { headers: API_HEADERS });

  if (!data.success || !data.data.animes || data.data.animes.length === 0) {
    throw new Error(`Anime "${title}" not found on Hianime or no animes array in response.`);
  }
  
  // Extract the main title without season/part information
  const mainTitle = title.split(':')[0].trim();
  
  // Print all available matches
  console.log('All available matches on Hianime:');
  data.data.animes.forEach((anime, index) => {
    console.log(`${index+1}. ID: ${anime.id}, Name: ${anime.name}`);
  });
  
  // Filter results to only include anime that contain the main title
  const relevantResults = data.data.animes.filter(anime => 
    anime.name.toLowerCase().includes(mainTitle.toLowerCase())
  );
  
  console.log(`Found ${relevantResults.length} results containing the main title "${mainTitle}"`);
  
  // If seasonNumber is provided, try to find the matching season
  if (seasonNumber !== null && relevantResults.length > 0) {
    console.log(`Looking for entries matching season ${seasonNumber}...`);
    
    // Season keywords to look for
    const seasonKeywords = [
      `season ${seasonNumber}`,
      `s${seasonNumber}`,
      `${seasonNumber}rd season`,
      `${seasonNumber}nd season`,
      `${seasonNumber}th season`,
      `${seasonNumber}st season`
    ];
    
    // First try to find direct season number matches
    let seasonMatch = relevantResults.find(anime => 
      seasonKeywords.some(keyword => 
        anime.name.toLowerCase().includes(keyword.toLowerCase())
      )
    );
    
    if (seasonMatch) {
      console.log(`Found direct season number match: ${seasonMatch.name}`);
      return {
        slug: seasonMatch.id,
        useRelativeEpisodeNumber: true
      };
    }
    
    // Filter out movies when looking for TV seasons
    const nonMovieEntries = relevantResults.filter(anime => 
      !anime.name.toLowerCase().includes('movie') && 
      !anime.id.toLowerCase().includes('movie')
    );
    
    if (nonMovieEntries.length > 0) {
      console.log(`Found ${nonMovieEntries.length} non-movie entries`);
    
      // If no direct season number match, try finding entries with specific arc names
      // Common patterns for Demon Slayer and other anime
      if (seasonNumber === 2) {
        // For season 2, look for entries containing 'entertainment district', 'mugen train' (TV), etc.
        const seasonArcMatch = nonMovieEntries.find(anime => {
          const lowerName = anime.name.toLowerCase();
          return lowerName.includes('entertainment district') || 
                 (lowerName.includes('mugen train') && !lowerName.includes('movie')) ||
                 lowerName.includes('arc tv');
        });
        
        if (seasonArcMatch) {
          console.log(`Found likely season 2 arc match: ${seasonArcMatch.name}`);
          return {
            slug: seasonArcMatch.id,
            useRelativeEpisodeNumber: true
          };
        }
      }
      
      if (seasonNumber === 3) {
        // For season 3, look for entries containing 'swordsmith village', etc.
        const seasonArcMatch = nonMovieEntries.find(anime => 
          anime.name.toLowerCase().includes('swordsmith')
        );
        
        if (seasonArcMatch) {
          console.log(`Found likely season 3 arc match: ${seasonArcMatch.name}`);
          return {
            slug: seasonArcMatch.id,
            useRelativeEpisodeNumber: true
          };
        }
      }
      
      if (seasonNumber === 4) {
        // For season 4, look for entries containing 'hashira training', etc.
        const seasonArcMatch = nonMovieEntries.find(anime => 
          anime.name.toLowerCase().includes('hashira')
        );
        
        if (seasonArcMatch) {
          console.log(`Found likely season 4 arc match: ${seasonArcMatch.name}`);
          return {
            slug: seasonArcMatch.id,
            useRelativeEpisodeNumber: true
          };
        }
      }
      
      // If we're looking for season 2, try to find the first non-base non-movie entry
      if (seasonNumber === 2) {
        // Get the base entry (likely season 1) - one with the shortest name or closest to main title
        const baseEntry = nonMovieEntries.find(anime => 
          anime.name.toLowerCase() === title.toLowerCase() || 
          anime.name.toLowerCase() === mainTitle.toLowerCase()
        ) || nonMovieEntries.sort((a, b) => a.name.length - b.name.length)[0];
        
        // Remove base entry from consideration
        const nonBaseEntries = nonMovieEntries.filter(anime => anime.id !== baseEntry.id);
        
        if (nonBaseEntries.length > 0) {
          // Sort by ID (assuming lower non-base ID = season 2)
          const seasonEntries = nonBaseEntries.sort((a, b) => {
            const numA = parseInt(a.id.match(/\d+$/)?.[0] || '0');
            const numB = parseInt(b.id.match(/\d+$/)?.[0] || '0');
            return numA - numB; // Sort ascending
          });
          
          const season2Candidate = seasonEntries[0];
          console.log(`Using first non-base non-movie entry for season 2: ${season2Candidate.name}`);
          return {
            slug: season2Candidate.id,
            useRelativeEpisodeNumber: true
          };
        }
      }
    }
    
    // If season 1 is requested, find entry without special suffixes and isn't a movie
    if (seasonNumber === 1) {
      const season1Candidates = relevantResults.filter(anime => 
        !anime.name.toLowerCase().includes('movie') &&
        !anime.id.toLowerCase().includes('movie')
      ).sort((a, b) => a.name.length - b.name.length);
      
      if (season1Candidates.length > 0) {
        const baseEntry = season1Candidates[0];
        console.log(`Using base non-movie entry for season 1: ${baseEntry.name}`);
        return {
          slug: baseEntry.id,
          useRelativeEpisodeNumber: true
        };
      }
    }
  }
  
  // Default: use exact title match or first result if no season-specific match found
  const exactMatch = data.data.animes.find(anime => anime.name.toLowerCase() === title.toLowerCase());
  const animeSlug = exactMatch?.id ?? data.data.animes[0].id;
  console.log(`Using default Hianime slug: ${animeSlug}`);
  return {
    slug: animeSlug,
    useRelativeEpisodeNumber: false // Use absolute episode calculation
  };
}

async function getShowTitleFromTmdb(tmdbShowId) {
    const url = `https://api.themoviedb.org/3/tv/${tmdbShowId}?api_key=${TMDB_API_KEY}`;
    console.log(`Fetching show title from TMDB for ID: ${tmdbShowId}...`);
    const data = await fetchJson(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!data.name) throw new Error('Could not get show title from TMDB.');
    console.log(`TMDB Show Title: ${data.name}`);
    return data.name;
}


async function fetchTmdbSeasonEpisodes(tmdbShowId, seasonNumber) {
  const url = `https://api.themoviedb.org/3/tv/${tmdbShowId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}`;
  const data = await fetchJson(url, { headers: { 'User-Agent': USER_AGENT } });
  return data.episodes || [];
}

async function calculateAbsoluteEpisodeNumber(tmdbShowId, seasonNumber, episodeNumber) {
  console.log(`Calculating absolute episode number for S${seasonNumber}E${episodeNumber}...`);
  let episodesBefore = 0;
  for (let i = 1; i < seasonNumber; i++) {
    const seasonEpisodes = await fetchTmdbSeasonEpisodes(tmdbShowId, i);
    episodesBefore += seasonEpisodes.length;
  }
  const absoluteEp = episodesBefore + episodeNumber;
  console.log(`Absolute episode number: ${absoluteEp}`);
  return absoluteEp;
}

async function fetchEpisodeListForAnimeFromHianime(animeSlug) {
  const url = `https://hianime.pstream.org/api/v2/hianime/anime/${animeSlug}/episodes`;
  console.log(`Fetching Hianime episode list for slug: ${animeSlug}...`);
  const data = await fetchJson(url, { headers: API_HEADERS });
  if (!data.success || !data.data.episodes) {
    throw new Error('Failed to fetch Hianime episode list or no episodes in response.');
  }
  
  // Add debug info about available episodes
  console.log(`Available episodes for ${animeSlug}:`);
  const episodeNumbers = data.data.episodes.map(ep => ep.number).sort((a, b) => a - b);
  console.log(`Episode numbers: ${episodeNumbers.join(', ')}`);
  
  return data.data.episodes;
}

async function fetchEpisodeSources(hianimeFullEpisodeId, server, category) {
  const sourceApiUrl = `https://hianime.pstream.org/api/v2/hianime/episode/sources?animeEpisodeId=${hianimeFullEpisodeId}&server=${server}&category=${category}`;
  console.log(`Fetching sources: ${server}/${category} from ${sourceApiUrl}`);
  try {
    const data = await fetchJson(sourceApiUrl, { headers: API_HEADERS });
    if (!data.success || !data.data.sources || data.data.sources.length === 0) {
      console.warn(`Hianime Script: No sources found from ${server}/${category}.`);
      return null;
    }
    const masterPlaylistUrl = data.data.sources[0].url;
    if (!masterPlaylistUrl || data.data.sources[0].type !== 'hls') {
      console.warn(`Hianime Script: No HLS master playlist URL found for ${server}/${category}.`);
      return null;
    }
    if (!masterPlaylistUrl.includes('netmagcdn.com')) {
        console.log(`Hianime Script: Skipping non-netmagcdn.com link: ${masterPlaylistUrl}`);
        return null;
    }
    return {
        playlistUrl: masterPlaylistUrl,
        headers: data.data.headers || {},
    };
  } catch (error) {
    console.error(`Hianime Script: Error fetching sources for ${server}/${category}: ${error.message}`);
    return null;
  }
}

async function parseM3U8(playlistUrl, m3u8Headers, category) {
  const streams = [];
  let streamCounter = 0;
  try {
    console.log(`Parsing M3U8 from ${playlistUrl}...`);
    const response = await fetch(playlistUrl, { headers: m3u8Headers });
    if (!response.ok) {
      console.warn(`Hianime Script: Failed to fetch M3U8 content from ${playlistUrl} - ${response.status}`);
      return [];
    }
    const masterPlaylistText = await response.text();
    const lines = masterPlaylistText.split(/\r?\n/);
    const masterBaseUrl = playlistUrl.substring(0, playlistUrl.lastIndexOf('/') + 1);
    let variantsFoundInMaster = 0;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
        const streamInfoLine = lines[i];
        let qualityLabel = 'auto';
        const resolutionMatch = streamInfoLine.match(/RESOLUTION=\d+x(\d+)/);
        if (resolutionMatch && resolutionMatch[1]) qualityLabel = resolutionMatch[1] + 'p';
        else {
          const bandwidthMatch = streamInfoLine.match(/BANDWIDTH=(\d+)/);
          if (bandwidthMatch) qualityLabel = Math.round(parseInt(bandwidthMatch[1]) / 1000) + 'k';
        }

        if (i + 1 < lines.length && lines[i+1].trim() && !lines[i+1].startsWith('#')) {
          const mediaPlaylistPath = lines[i+1].trim();
          const mediaPlaylistUrl = new URL(mediaPlaylistPath, masterBaseUrl).href;
          
          streams.push({
            quality: qualityLabel,
            language: category, // dub or sub
            url: mediaPlaylistUrl,
            type: 'hls',
          });
          variantsFoundInMaster++;
        }
      }
    }
    if (variantsFoundInMaster === 0 && masterPlaylistText.includes('#EXTINF:')) { // Is a media playlist
      streams.push({
        quality: 'auto (media playlist)',
        language: category,
        url: playlistUrl,
        type: 'hls',
      });
    }
  } catch (err) {
    console.error(`Hianime Script: Error parsing M3U8 ${playlistUrl}:`, err.message);
  }
  return streams;
}

// Map TMDB seasons to specific Hianime slugs for shows that are split across multiple entries
function getHianimeSlugForSeason(tmdbId, showTitle, seasonNumber) {
  // Special case for Demon Slayer (TMDB ID: 85937)
  if (tmdbId === '85937') {
    console.log(`Using specific season mapping for Demon Slayer, season ${seasonNumber}`);
    const demonSlayerSeasons = {
      1: 'demon-slayer-kimetsu-no-yaiba-47', // Season 1
      2: 'demon-slayer-entertainment-district-arc-17483', // Season 2 (Entertainment District Arc)
      3: 'demon-slayer-kimetsu-no-yaiba-swordsmith-village-arc-18056', // Season 3 (Swordsmith Village Arc)
      4: 'demon-slayer-kimetsu-no-yaiba-hashira-training-arc-19107' // Season 4 (Hashira Training Arc)
    };
    
    if (demonSlayerSeasons[seasonNumber]) {
      return demonSlayerSeasons[seasonNumber];
    }
  }
  
  // Default: return null to use regular title search
  return null;
}

// --- Main Execution ---
async function main() {
  const args = process.argv.slice(2);
  const tmdbIdArg = args.indexOf('--show') !== -1 ? args[args.indexOf('--show') + 1] : null;
  const seasonArg = args.indexOf('--season') !== -1 ? parseInt(args[args.indexOf('--season') + 1], 10) : null;
  const episodeArg = args.indexOf('--episode') !== -1 ? parseInt(args[args.indexOf('--episode') + 1], 10) : null;

  if (!tmdbIdArg || seasonArg === null || episodeArg === null) {
    console.log('Usage: node fetch-hianime-links.js --show <TMDB_ID> --season <S_NUM> --episode <E_NUM>');
    console.log('Example: node fetch-hianime-links.js --show 127532 --season 1 --episode 1');
    process.exit(1);
  }

  console.log(`Fetching Hianime (netmagcdn.com) links for TMDB ID: ${tmdbIdArg}, Season: ${seasonArg}, Episode: ${episodeArg}`);

  try {
    const showTitle = await getShowTitleFromTmdb(tmdbIdArg);
    const animeResult = await searchAnimeOnHianime(showTitle, seasonArg);
    
    // Determine which episode number to use (relative or absolute)
    let episodeToUse;
    if (animeResult.useRelativeEpisodeNumber) {
      console.log(`Using episode number ${episodeArg} directly (not calculating absolute)`);
      episodeToUse = episodeArg;
    } else {
      const absoluteEpNum = await calculateAbsoluteEpisodeNumber(tmdbIdArg, seasonArg, episodeArg);
      episodeToUse = absoluteEpNum;
    }
    
    const hianimeEpisodeList = await fetchEpisodeListForAnimeFromHianime(animeResult.slug);

    const targetHianimeEpisode = hianimeEpisodeList.find(ep => ep.number === episodeToUse);

    if (!targetHianimeEpisode) {
      throw new Error(`Episode S${seasonArg}E${episodeArg} (Ep: ${episodeToUse}) not found in Hianime's list for ${animeResult.slug}.`);
    }
    
    const hianimeFullEpisodeId = targetHianimeEpisode.episodeId; // e.g., "solo-leveling-18718?ep=114721"
    console.log(`Using Hianime full episode ID: ${hianimeFullEpisodeId}`);

    const allStreams = [];

    for (const serverInfo of SERVERS_TO_TRY) {
      const sourceData = await fetchEpisodeSources(hianimeFullEpisodeId, serverInfo.server, serverInfo.category);
      if (sourceData && sourceData.playlistUrl) {
         const m3u8Headers = {
            ...(sourceData.headers || {}),
            'User-Agent': USER_AGENT,
            'Referer': sourceData.headers?.Referer || 'https://megacloud.blog/',
        };
        Object.keys(m3u8Headers).forEach(key => {
            if (m3u8Headers[key] === undefined) delete m3u8Headers[key];
        });

        const parsedStreams = await parseM3U8(sourceData.playlistUrl, m3u8Headers, serverInfo.category);
        if (parsedStreams.length > 0) {
            console.log(`Found ${parsedStreams.length} stream(s) from ${serverInfo.server}/${serverInfo.category} on netmagcdn.com`);
            allStreams.push(...parsedStreams);
        }
      }
    }

    if (allStreams.length === 0) {
      console.log('\nNo netmagcdn.com HLS streams found after checking all servers.');
    } else {
      console.log(`\n--- Found ${allStreams.length} Hianime (netmagcdn.com) HLS Streams ---`);
      const streamsByLanguage = allStreams.reduce((acc, stream) => {
        const lang = stream.language || 'unknown';
        if (!acc[lang]) acc[lang] = [];
        acc[lang].push(stream);
        return acc;
      }, {});

      for (const lang in streamsByLanguage) {
        console.log(`\n  Language: ${lang.toUpperCase()}`);
        streamsByLanguage[lang].sort((a,b) => { // Sort by quality (simple numeric sort on 'p' or 'k')
            const aVal = parseInt(a.quality);
            const bVal = parseInt(b.quality);
            if (isNaN(aVal) && isNaN(bVal)) return 0;
            if (isNaN(aVal)) return 1;
            if (isNaN(bVal)) return -1;
            return bVal - aVal;
        }).forEach(stream => {
          console.log(`    Quality: ${stream.quality.padEnd(25)} URL: ${stream.url}`);
        });
      }
      console.log('\n--------------------------------------------------');
    }

  } catch (error) {
    console.error('\n--- ERROR ---');
    console.error(error.message);
    if (error.stack) console.error(error.stack.split('\n').slice(1).join('\n'));
    console.error('-------------');
    process.exit(1);
  }
}

main(); 