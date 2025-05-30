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


async function searchAnimeOnHianime(title) {
  const searchUrl = `https://hianime.pstream.org/api/v2/hianime/search?q=${encodeURIComponent(title)}`;
  console.log(`Searching for anime: "${title}"...`);
  const data = await fetchJson(searchUrl, { headers: API_HEADERS });

  if (!data.success || !data.data.animes || data.data.animes.length === 0) {
    throw new Error(`Anime "${title}" not found on Hianime or no animes array in response.`);
  }
  const match = data.data.animes.find(anime => anime.name.toLowerCase() === title.toLowerCase());
  const animeSlug = match?.id ?? data.data.animes[0].id;
  console.log(`Found Hianime slug: ${animeSlug}`);
  return animeSlug;
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
    const animeSlug = await searchAnimeOnHianime(showTitle);
    const absoluteEpNum = await calculateAbsoluteEpisodeNumber(tmdbIdArg, seasonArg, episodeArg);
    const hianimeEpisodeList = await fetchEpisodeListForAnimeFromHianime(animeSlug);

    const targetHianimeEpisode = hianimeEpisodeList.find(ep => ep.number === absoluteEpNum);

    if (!targetHianimeEpisode) {
      throw new Error(`Episode S${seasonArg}E${episodeArg} (Abs: ${absoluteEpNum}) not found in Hianime's list for ${animeSlug}.`);
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