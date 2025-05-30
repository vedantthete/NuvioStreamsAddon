require('dotenv').config(); // Load .env file variables
const https = require('https');

// --- Cache Objects ---
const tmdbTitleCache = new Map();
const hianimeSlugCache = new Map(); // Keyed by tmdbShowId
const tmdbSeasonEpisodesCache = new Map();
const hianimeEpisodeListCache = new Map(); // Keyed by animeSlug
const hianimeEpisodeSourceCache = new Map(); // Keyed by hianimeFullEpisodeId_server_category

const CACHE_TTL = {
  TMDB_TITLE: 24 * 60 * 60 * 1000, // 24 hours
  HIANIME_SLUG: 24 * 60 * 60 * 1000, // 24 hours
  TMDB_SEASON_EPISODES: 6 * 60 * 60 * 1000, // 6 hours
  HIANIME_EPISODE_LIST: 1 * 60 * 60 * 1000,  // 1 hour (for ongoing shows)
  HIANIME_EPISODE_SOURCE: 30 * 60 * 1000,   // 30 minutes
};

// --- Configuration & Constants ---
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const API_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://pstream.org',
};
const TMDB_API_KEY = process.env.TMDB_API_KEY || '5b9790d9305dca8713b9a0afad42ea8d'; // Use env var or fallback
const HIAnime_PROXY_URL = process.env.SHOWBOX_PROXY_URL_VALUE; // Read proxy from env

const SERVERS_TO_TRY = [
  { server: 'hd-1', category: 'dub' },
  { server: 'hd-1', category: 'sub' },
  { server: 'hd-2', category: 'dub' },
  { server: 'hd-2', category: 'sub' },
];

// --- Helper Functions ---

async function fetchJson(url, options = {}, attempt = 1) {
  let finalUrl = url;
  const isTmdbRequest = url.includes('api.themoviedb.org');

  if (HIAnime_PROXY_URL && !isTmdbRequest) {
    finalUrl = `${HIAnime_PROXY_URL}${encodeURIComponent(url)}`;
    console.log(`[Hianime] Using proxy for JSON request: ${finalUrl} (Original: ${url})`);
  } else {
    console.log(`[Hianime] Fetching JSON directly: ${url}`);
  }

  try {
    const response = await fetch(finalUrl, {
      ...options,
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Could not read error text');
      console.error(`[Hianime] API Error: ${response.status} for ${finalUrl}. Response: ${errorText.substring(0, 200)}`);
      if (response.status === 403 && attempt < 3 && !isTmdbRequest) { // Retry only for non-TMDB proxied requests on 403
        console.warn(`[Hianime] Retrying fetch for ${finalUrl} (attempt ${attempt + 1}) after 403...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        // Pass original URL to retry, proxy logic will re-apply
        return fetchJson(url, options, attempt + 1);
      }
      throw new Error(`Failed to fetch ${finalUrl}: ${response.status} ${response.statusText}`);
    }
    return response.json();
  } catch (error) {
    console.error(`[Hianime] Fetch error for ${finalUrl}:`, error.message);
    throw error;
  }
}

async function searchAnimeOnHianime(tmdbShowId, title) {
  const cacheKey = tmdbShowId; 
  const cached = hianimeSlugCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL.HIANIME_SLUG)) {
      console.log(`[Hianime] CACHE HIT: Hianime Slug for TMDB ID ${tmdbShowId}`);
      return cached.data;
  }
  const searchUrl = `https://hianime.pstream.org/api/v2/hianime/search?q=${encodeURIComponent(title)}`;
  console.log(`[Hianime] API REQ: Searching for anime: "${title}" using ${searchUrl}`);
  const data = await fetchJson(searchUrl, { headers: API_HEADERS });
  if (!data.success || !data.data.animes || data.data.animes.length === 0) {
    throw new Error(`Anime "${title}" (TMDB: ${tmdbShowId}) not found on Hianime.`);
  }
  let animeSlug = data.data.animes.find(anime => anime.name.toLowerCase() === title.toLowerCase())?.id;
  if (!animeSlug && data.data.animes.length > 0) {
    animeSlug = data.data.animes[0].id;
    console.log(`[Hianime] No exact title match for "${title}". Using first result: ${data.data.animes[0].name} (Slug: ${animeSlug})`);
  } else if (!animeSlug) {
     throw new Error(`Anime "${title}" (TMDB: ${tmdbShowId}) not found after checking all results.`);
  }
  hianimeSlugCache.set(cacheKey, { data: animeSlug, timestamp: Date.now() });
  console.log(`[Hianime] Found Hianime slug: ${animeSlug} for title "${title}"`);
  return animeSlug;
}

async function getShowTitleFromTmdb(tmdbShowId) {
    const cacheKey = tmdbShowId;
    const cached = tmdbTitleCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL.TMDB_TITLE)) {
        console.log(`[Hianime] CACHE HIT: TMDB Title for ${tmdbShowId}`);
        return cached.data;
    }
    const url = `https://api.themoviedb.org/3/tv/${tmdbShowId}?api_key=${TMDB_API_KEY}`;
    console.log(`[Hianime] API REQ: Fetching show title from TMDB for ID: ${tmdbShowId}`);
    const data = await fetchJson(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!data.name) throw new Error('Could not get show title from TMDB.');
    tmdbTitleCache.set(cacheKey, { data: data.name, timestamp: Date.now() });
    console.log(`[Hianime] TMDB Show Title: ${data.name}`);
    return data.name;
}

async function fetchTmdbSeasonEpisodes(tmdbShowId, seasonNumber) {
  const cacheKey = `${tmdbShowId}_S${seasonNumber}`;
  const cached = tmdbSeasonEpisodesCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL.TMDB_SEASON_EPISODES)) {
      console.log(`[Hianime] CACHE HIT: TMDB S${seasonNumber} episodes for ${tmdbShowId}`);
      return cached.data;
  }
  const url = `https://api.themoviedb.org/3/tv/${tmdbShowId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}`;
  console.log(`[Hianime] API REQ: Fetching TMDB S${seasonNumber} episodes for show ${tmdbShowId}`);
  const data = await fetchJson(url, { headers: { 'User-Agent': USER_AGENT } });
  const episodes = data.episodes || [];
  tmdbSeasonEpisodesCache.set(cacheKey, { data: episodes, timestamp: Date.now() });
  return episodes;
}

async function calculateAbsoluteEpisodeNumber(tmdbShowId, seasonNumber, episodeNumber) {
  console.log(`[Hianime] Calculating absolute episode number for S${seasonNumber}E${episodeNumber}...`);
  let episodesBefore = 0;
  for (let i = 1; i < seasonNumber; i++) {
    const seasonEpisodes = await fetchTmdbSeasonEpisodes(tmdbShowId, i);
    episodesBefore += seasonEpisodes.length;
    console.log(`[Hianime] Season ${i} has ${seasonEpisodes.length} episodes. Total before current: ${episodesBefore}`);
  }
  const absoluteEp = episodesBefore + episodeNumber;
  console.log(`[Hianime] Absolute episode number: ${absoluteEp}`);
  return absoluteEp;
}

async function fetchEpisodeListForAnimeFromHianime(animeSlug) {
  const cacheKey = animeSlug;
  const cached = hianimeEpisodeListCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL.HIANIME_EPISODE_LIST)) {
      console.log(`[Hianime] CACHE HIT: Hianime episode list for slug ${animeSlug}`);
      return cached.data;
  }
  const url = `https://hianime.pstream.org/api/v2/hianime/anime/${animeSlug}/episodes`;
  console.log(`[Hianime] API REQ: Fetching Hianime episode list for slug: ${animeSlug}`);
  const data = await fetchJson(url, { headers: API_HEADERS });
  if (!data.success || !data.data.episodes) {
    throw new Error('Failed to fetch Hianime episode list or no episodes in response.');
  }
  hianimeEpisodeListCache.set(cacheKey, { data: data.data.episodes, timestamp: Date.now() });
  return data.data.episodes;
}

async function fetchEpisodeSources(hianimeFullEpisodeId, server, category) {
  const cacheKey = `${hianimeFullEpisodeId}_${server}_${category}`;
  const cached = hianimeEpisodeSourceCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL.HIANIME_EPISODE_SOURCE)) {
      console.log(`[Hianime] CACHE HIT: Episode sources for ${hianimeFullEpisodeId} ${server}/${category}`);
      return cached.data;
  }
  const sourceApiUrl = `https://hianime.pstream.org/api/v2/hianime/episode/sources?animeEpisodeId=${hianimeFullEpisodeId}&server=${server}&category=${category}`;
  console.log(`[Hianime] API REQ: Fetching sources: ${server}/${category} from ${sourceApiUrl}`);
  try {
    const data = await fetchJson(sourceApiUrl, { headers: API_HEADERS });
    if (!data.success || !data.data.sources || data.data.sources.length === 0) {
      console.warn(`[Hianime] No sources found from ${server}/${category}.`);
      return null;
    }
    const masterPlaylistUrl = data.data.sources[0].url;
    if (!masterPlaylistUrl || data.data.sources[0].type !== 'hls') {
      console.warn(`[Hianime] No HLS master playlist URL found for ${server}/${category}.`);
      return null;
    }
    if (!masterPlaylistUrl.includes('netmagcdn.com')) {
        console.log(`[Hianime] Skipping non-netmagcdn.com link: ${masterPlaylistUrl}`);
        return null;
    }
    const sourceData = { playlistUrl: masterPlaylistUrl, headers: data.data.headers || {} };
    hianimeEpisodeSourceCache.set(cacheKey, { data: sourceData, timestamp: Date.now() });
    return sourceData;
  } catch (error) {
    console.error(`[Hianime] Error fetching sources for ${server}/${category}: ${error.message}`);
    return null;
  }
}

async function parseM3U8(playlistUrl, m3u8Headers, category, tmdbShowId, seasonNumber, episodeNumber) {
  const streams = [];
  let streamCounter = 0;
  let finalPlaylistUrl = playlistUrl;

  if (HIAnime_PROXY_URL) {
    finalPlaylistUrl = `${HIAnime_PROXY_URL}${encodeURIComponent(playlistUrl)}`;
    console.log(`[Hianime] Using proxy for M3U8 request: ${finalPlaylistUrl} (Original: ${playlistUrl})`);
  } else {
    console.log(`[Hianime] Fetching M3U8 directly: ${playlistUrl}`);
  }

  try {
    console.log(`[Hianime] Parsing M3U8 from ${finalPlaylistUrl}...`);
    const fetchHeaders = { ...m3u8Headers, 'User-Agent': USER_AGENT };
    if (fetchHeaders.Referer === undefined || fetchHeaders.Referer === null || fetchHeaders.Referer === '') {
        fetchHeaders.Referer = 'https://megacloud.blog/'; 
    }

    const response = await fetch(finalPlaylistUrl, { headers: fetchHeaders }); // Pass original headers for proxied request destination
    if (!response.ok) {
      console.warn(`[Hianime] Failed to fetch M3U8 content from ${finalPlaylistUrl} - ${response.status}`);
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
        if (resolutionMatch && resolutionMatch[1]) qualityLabel = resolutionMatch[1] + 'p';
        else {
          const bandwidthMatch = streamInfoLine.match(/BANDWIDTH=(\d+)/);
          if (bandwidthMatch) qualityLabel = Math.round(parseInt(bandwidthMatch[1]) / 1000) + 'k';
        }

        if (i + 1 < lines.length && lines[i+1].trim() && !lines[i+1].startsWith('#')) {
          const mediaPlaylistPath = lines[i+1].trim();
          // Segments URLs in M3U8 are relative to original M3U8 location
          let mediaPlaylistUrl = new URL(mediaPlaylistPath, masterBaseUrl).href;
          let finalMediaPlaylistUrlForStremio = mediaPlaylistUrl; // This is what Stremio will use

          // If proxy is enabled, the URL Stremio receives should also be proxied
          if (HIAnime_PROXY_URL) {
            finalMediaPlaylistUrlForStremio = `${HIAnime_PROXY_URL}${encodeURIComponent(mediaPlaylistUrl)}`;
          }
          
          const streamId = `hianime-${tmdbShowId}-S${seasonNumber}E${episodeNumber}-${category}-${qualityLabel}-${streamCounter++}`;
          streams.push({
            id: streamId,
            title: `Hianime ${category.toUpperCase()} - ${qualityLabel}`,
            quality: qualityLabel,
            language: category, 
            url: finalMediaPlaylistUrlForStremio, // Stremio will use this (potentially proxied) URL
            // Store original headers, Stremio might need them if it can bypass proxy or for direct play tests
            behaviorHints: {
                notWebReady: true,
                // Pass original headers that the PROXY target (netmagcdn) needs.
                // The proxy itself will handle its own connection to the target using these.
                proxyHeaders: { "request": fetchHeaders }
            },
            type: 'hls',
            provider: 'Hianime',
          });
          variantsFoundInMaster++;
        }
      }
    }
    // Handling for master playlist being a media playlist itself
    if (variantsFoundInMaster === 0 && masterPlaylistText.includes('#EXTINF:')) {
      const streamId = `hianime-${tmdbShowId}-S${seasonNumber}E${episodeNumber}-${category}-auto-${streamCounter++}`;
      let finalPlaylistUrlForStremio = playlistUrl;
      if (HIAnime_PROXY_URL) {
        finalPlaylistUrlForStremio = `${HIAnime_PROXY_URL}${encodeURIComponent(playlistUrl)}`;
      }
      streams.push({
        id: streamId,
        title: `Hianime ${category.toUpperCase()} - Auto`,
        quality: 'auto',
        language: category,
        url: finalPlaylistUrlForStremio,
        behaviorHints: {
            notWebReady: true,
            proxyHeaders: { "request": fetchHeaders }
        },
        type: 'hls',
        provider: 'Hianime',
      });
    }
  } catch (err) {
    console.error(`[Hianime] Error parsing M3U8 ${finalPlaylistUrl}:`, err.message);
  }
  return streams;
}

// Main exported function for the addon
async function getHianimeStreams(tmdbShowId, seasonNumber, episodeNumber) {
  // Hianime is typically for 'series' type content.
  // If your addon strictly uses tmdbType ('movie' or 'tv'), ensure this function is only called for 'tv'.
  if (!tmdbShowId || seasonNumber == null || episodeNumber == null) {
    console.error('[Hianime] Missing required parameters: tmdbShowId, seasonNumber, or episodeNumber.');
    return [];
  }

  console.log(`[Hianime] Processing request for TMDB ID: ${tmdbShowId}, S${seasonNumber}E${episodeNumber}`);

  try {
    const showTitle = await getShowTitleFromTmdb(tmdbShowId);
    if (!showTitle) {
        console.error(`[Hianime] Could not get show title for TMDB ID ${tmdbShowId}. Cannot proceed.`);
        return [];
    }
    const animeSlug = await searchAnimeOnHianime(tmdbShowId, showTitle);
    const absoluteEpNum = await calculateAbsoluteEpisodeNumber(tmdbShowId, seasonNumber, episodeNumber);
    const hianimeEpisodeList = await fetchEpisodeListForAnimeFromHianime(animeSlug);

    const targetHianimeEpisode = hianimeEpisodeList.find(ep => ep.number === absoluteEpNum);

    if (!targetHianimeEpisode) {
      console.warn(`[Hianime] Episode S${seasonNumber}E${episodeNumber} (Abs: ${absoluteEpNum}) not found in Hianime's list for ${animeSlug}.`);
      return [];
    }
    
    const hianimeFullEpisodeId = targetHianimeEpisode.episodeId;
    console.log(`[Hianime] Using Hianime full episode ID: ${hianimeFullEpisodeId}`);

    const allStreams = [];

    for (const serverInfo of SERVERS_TO_TRY) {
      const sourceData = await fetchEpisodeSources(hianimeFullEpisodeId, serverInfo.server, serverInfo.category);
      if (sourceData && sourceData.playlistUrl) {
        const parsedStreams = await parseM3U8(sourceData.playlistUrl, sourceData.headers, serverInfo.category, tmdbShowId, seasonNumber, episodeNumber);
        if (parsedStreams.length > 0) {
            console.log(`[Hianime] Found ${parsedStreams.length} stream(s) from ${serverInfo.server}/${serverInfo.category}`);
            allStreams.push(...parsedStreams);
        }
      }
    }

    if (allStreams.length === 0) {
      console.log('[Hianime] No HLS streams found after checking all servers.');
    } else {
      console.log(`[Hianime] Successfully fetched ${allStreams.length} HLS streams.`);
    }
    return allStreams;

  } catch (error) {
    console.error('[Hianime] --- ERROR Processing Request ---');
    console.error(error.message);
    // For more detailed debugging:
    // if (error.stack) console.error(error.stack);
    return []; // Return empty on error
  }
}

module.exports = { getHianimeStreams }; 