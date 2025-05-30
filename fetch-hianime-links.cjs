#!/usr/bin/env node

// Standalone Node.js script to fetch HLS stream links from Hianime (netmagcdn.com only)
// for a specific TV show episode using its TMDB ID.
// Usage: node fetch-hianime-links.cjs --show <TMDB_ID> --season <S_NUM> --episode <E_NUM>
// Example: node fetch-hianime-links.cjs --show 127532 --season 1 --episode 1

const https = require('https');

// --- Configuration & Constants ---
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const PROXY_URL_BASE = 'https://starlit-valkyrie-39f5ab.netlify.app/?destination='; // Added Proxy
const API_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://pstream.org', // Origin header might be for the proxy or the destination, usually destination
};
const TMDB_API_KEY = '5b9790d9305dca8713b9a0afad42ea8d'; // Public API key

const SERVERS_TO_TRY = [
  { server: 'hd-1', category: 'dub' },
  { server: 'hd-1', category: 'sub' },
  { server: 'hd-2', category: 'dub' },
  { server: 'hd-2', category: 'sub' },
];

// --- Helper Functions ---

async function fetchJson(url, options = {}, attempt = 1, useProxy = false) { // Added useProxy flag
  const finalUrl = useProxy ? `${PROXY_URL_BASE}${encodeURIComponent(url)}` : url;
  console.log(`Fetching JSON from: ${finalUrl}`)
  try {
    const response = await fetch(finalUrl, {
      agent: new https.Agent({ rejectUnauthorized: false }),
       ...options,
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Could not read error text');
      console.error(`API Error: ${response.status} for ${finalUrl}. Response: ${errorText}`);
      if (response.status === 403 && attempt < 3) {
        console.warn(`Retrying fetch for ${finalUrl} (attempt ${attempt + 1}) after 403...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        return fetchJson(url, options, attempt + 1, useProxy); // Pass useProxy in retry
      }
      throw new Error(`Failed to fetch ${finalUrl}: ${response.status} ${response.statusText}`);
    }
    return response.json();
  } catch (error) {
    console.error(`Fetch error for ${finalUrl}:`, error.message);
    throw error;
  }
}


async function searchAnimeOnHianime(title) {
  const searchUrl = `https://hianime.pstream.org/api/v2/hianime/search?q=${encodeURIComponent(title)}`;
  console.log(`Attempting to search anime: "${title}" via Hianime API...`);
  // Use proxy for this Hianime API call
  const data = await fetchJson(searchUrl, { headers: API_HEADERS }, 1, true);

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
    // No proxy for TMDB
    console.log(`Fetching show title from TMDB for ID: ${tmdbShowId}...`);
    const data = await fetchJson(url, { headers: { 'User-Agent': USER_AGENT } }, 1, false);
    if (!data.name) throw new Error('Could not get show title from TMDB.');
    console.log(`TMDB Show Title: ${data.name}`);
    return data.name;
}


async function fetchTmdbSeasonEpisodes(tmdbShowId, seasonNumber) {
  const url = `https://api.themoviedb.org/3/tv/${tmdbShowId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}`;
  // No proxy for TMDB
  const data = await fetchJson(url, { headers: { 'User-Agent': USER_AGENT } }, 1, false);
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
  console.log(`Attempting to fetch Hianime episode list for slug: ${animeSlug}...`);
  // Use proxy for this Hianime API call
  const data = await fetchJson(url, { headers: API_HEADERS }, 1, true);
  if (!data.success || !data.data.episodes) {
    throw new Error('Failed to fetch Hianime episode list or no episodes in response.');
  }
  return data.data.episodes;
}

async function fetchEpisodeSources(hianimeFullEpisodeId, server, category) {
  const sourceApiUrl = `https://hianime.pstream.org/api/v2/hianime/episode/sources?animeEpisodeId=${hianimeFullEpisodeId}&server=${server}&category=${category}`;
  console.log(`Attempting to fetch sources: ${server}/${category} via Hianime API`);
  try {
    // Use proxy for this Hianime API call
    const data = await fetchJson(sourceApiUrl, { headers: API_HEADERS }, 1, true);
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
        playlistUrl: masterPlaylistUrl, // This is the CDN URL, will be proxied in parseM3U8
        headers: data.data.headers || {},
    };
  } catch (error) {
    console.error(`Hianime Script: Error fetching sources for ${server}/${category}: ${error.message}`);
    return null;
  }
}

async function parseM3U8(playlistUrl, m3u8Headers, category) {
  const streams = [];
  // Use proxy for fetching the M3U8 content from CDN
  const proxiedPlaylistUrl = `${PROXY_URL_BASE}${encodeURIComponent(playlistUrl)}`;
  try {
    console.log(`Parsing M3U8 from proxied URL: ${proxiedPlaylistUrl} (Original: ${playlistUrl})...`);
    // Note: m3u8Headers are for the CDN, the proxy might or might not forward them.
    // The proxy itself might require specific headers, but PROXY_URL_BASE doesn't indicate that.
    const response = await fetch(proxiedPlaylistUrl, { 
        headers: { 'User-Agent': USER_AGENT }, // Send basic UA to proxy, it handles destination headers.
        agent: new https.Agent({ rejectUnauthorized: false })
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Could not read error text');
      console.warn(`Hianime Script: Failed to fetch M3U8 content from ${proxiedPlaylistUrl} - ${response.status}. Response: ${errorText}`);
      return [];
    }
    const masterPlaylistText = await response.text();
    const lines = masterPlaylistText.split(/\r?\n/);
    // IMPORTANT: masterBaseUrl must be from the ORIGINAL playlistUrl for resolving relative segments
    const masterBaseUrl = playlistUrl.substring(0, playlistUrl.lastIndexOf('/') + 1);
    let variantsFoundInMaster = 0;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
        const streamInfoLine = lines[i];
        let qualityLabel = 'auto';
        const resolutionMatch = streamInfoLine.match(/RESOLUTION=\d+x(\d+)/);
        // In the original script, resolutionMatch[1] was used, but it should be resolutionMatch[2] for height.
        // Assuming quality is based on height e.g. 720p from 1280x720
        if (resolutionMatch && resolutionMatch[2]) qualityLabel = resolutionMatch[2] + 'p'; 
        else {
          const bandwidthMatch = streamInfoLine.match(/BANDWIDTH=(\d+)/);
          if (bandwidthMatch) qualityLabel = Math.round(parseInt(bandwidthMatch[1]) / 1000) + 'k';
        }

        if (i + 1 < lines.length && lines[i+1].trim() && !lines[i+1].startsWith('#')) {
          const mediaPlaylistPath = lines[i+1].trim();
          // Segments URLs in M3U8 are relative to original M3U8 location, not the proxy
          const mediaPlaylistUrl = new URL(mediaPlaylistPath, masterBaseUrl).href;
          
          streams.push({
            quality: qualityLabel,
            language: category, // dub or sub
            // The final stream URL should also be proxied for playback if players can't handle proxying themselves
            url: `${PROXY_URL_BASE}${encodeURIComponent(mediaPlaylistUrl)}`, 
            originalUrl: mediaPlaylistUrl, // For reference
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
        // The final stream URL should also be proxied
        url: `${PROXY_URL_BASE}${encodeURIComponent(playlistUrl)}`,
        originalUrl: playlistUrl, // For reference
        type: 'hls',
      });
    }
  } catch (err) {
    console.error(`Hianime Script: Error parsing M3U8 ${proxiedPlaylistUrl}:`, err.message);
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
    console.log('Usage: node fetch-hianime-links.cjs --show <TMDB_ID> --season <S_NUM> --episode <E_NUM>');
    console.log('Example: node fetch-hianime-links.cjs --show 127532 --season 1 --episode 1');
    process.exit(1);
  }

  console.log(`Fetching Hianime (netmagcdn.com) links via Proxy for TMDB ID: ${tmdbIdArg}, Season: ${seasonArg}, Episode: ${episodeArg}`);
  console.log(`Using Proxy: ${PROXY_URL_BASE}YOUR_TARGET_URL`);

  try {
    const showTitle = await getShowTitleFromTmdb(tmdbIdArg);
    const animeSlug = await searchAnimeOnHianime(showTitle);
    const absoluteEpNum = await calculateAbsoluteEpisodeNumber(tmdbIdArg, seasonArg, episodeArg);
    const hianimeEpisodeList = await fetchEpisodeListForAnimeFromHianime(animeSlug);

    const targetHianimeEpisode = hianimeEpisodeList.find(ep => ep.number === absoluteEpNum);

    if (!targetHianimeEpisode) {
      throw new Error(`Episode S${seasonArg}E${episodeArg} (Abs: ${absoluteEpNum}) not found in Hianime's list for ${animeSlug}.`);
    }
    
    const hianimeFullEpisodeId = targetHianimeEpisode.episodeId; 
    console.log(`Using Hianime full episode ID: ${hianimeFullEpisodeId}`);

    const allStreams = [];

    for (const serverInfo of SERVERS_TO_TRY) {
      const sourceData = await fetchEpisodeSources(hianimeFullEpisodeId, serverInfo.server, serverInfo.category);
      if (sourceData && sourceData.playlistUrl) {
         // m3u8Headers from sourceData.headers are for the *destination* CDN (netmagcdn)
         // The proxy itself may or may not use/forward them. 
         // For fetching M3U8 via proxy, we mainly rely on User-Agent for the proxy request itself.
         const cdnHeaders = {
            ...(sourceData.headers || {}),
            'User-Agent': USER_AGENT,
            'Referer': sourceData.headers?.Referer || 'https://megacloud.blog/',
        };
        Object.keys(cdnHeaders).forEach(key => {
            if (cdnHeaders[key] === undefined) delete cdnHeaders[key];
        });

        // Pass original CDN headers to parseM3U8, as they might be needed if the proxy forwards them
        // or if we ever bypass the proxy for M3U8 fetching.
        // However, the immediate fetch *to the proxy* for the M3U8 will use basic headers.
        const parsedStreams = await parseM3U8(sourceData.playlistUrl, cdnHeaders, serverInfo.category);
        if (parsedStreams.length > 0) {
            console.log(`Found ${parsedStreams.length} stream(s) from ${serverInfo.server}/${serverInfo.category} on netmagcdn.com (via proxy)`);
            allStreams.push(...parsedStreams);
        }
      }
    }

    if (allStreams.length === 0) {
      console.log('\nNo netmagcdn.com HLS streams found after checking all servers (via proxy).');
    } else {
      console.log(`\n--- Found ${allStreams.length} Hianime (netmagcdn.com) HLS Streams (via Proxy) ---`);
      const streamsByLanguage = allStreams.reduce((acc, stream) => {
        const lang = stream.language || 'unknown';
        if (!acc[lang]) acc[lang] = [];
        acc[lang].push(stream);
        return acc;
      }, {});

      for (const lang in streamsByLanguage) {
        console.log(`\n  Language: ${lang.toUpperCase()}`);
        streamsByLanguage[lang].sort((a,b) => { 
            const aVal = parseInt(a.quality);
            const bVal = parseInt(b.quality);
            if (isNaN(aVal) && isNaN(bVal)) return 0;
            if (isNaN(aVal)) return 1;
            if (isNaN(bVal)) return -1;
            return bVal - aVal;
        }).forEach(stream => {
          // Display both proxied URL for direct use and original URL for reference
          console.log(`    Quality: ${stream.quality.padEnd(20)} URL: ${stream.url}`);
          console.log(`                              Original URL: ${stream.originalUrl}`);
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
