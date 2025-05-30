const https = require('https');

// --- Configuration & Constants ---
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const API_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://pstream.org', // Or the specific origin Hianime expects for its API
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
    // Assuming global fetch is available (Node 18+) or polyfilled by the addon environment
    const response = await fetch(url, {
      // The original script used an https.Agent. If 'fetch' is global and from node-fetch,
      // agent configuration might be different or handled by a global agent.
      // For now, keeping it simple. If issues arise, agent might need to be added.
      ...options,
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Could not read error text');
      console.error(`[Hianime] API Error: ${response.status} for ${url}. Response: ${errorText.substring(0, 200)}`);
      if (response.status === 403 && attempt < 3) {
        console.warn(`[Hianime] Retrying fetch for ${url} (attempt ${attempt + 1}) after 403...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        return fetchJson(url, options, attempt + 1);
      }
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return response.json();
  } catch (error) {
    console.error(`[Hianime] Fetch error for ${url}:`, error.message);
    throw error;
  }
}

async function searchAnimeOnHianime(title) {
  const searchUrl = `https://hianime.pstream.org/api/v2/hianime/search?q=${encodeURIComponent(title)}`;
  console.log(`[Hianime] Searching for anime: "${title}" using ${searchUrl}`);
  const data = await fetchJson(searchUrl, { headers: API_HEADERS });

  if (!data.success || !data.data.animes || data.data.animes.length === 0) {
    throw new Error(`Anime "${title}" not found on Hianime or no animes array in response.`);
  }
  // Prioritize exact match, case-insensitive
  let animeSlug = data.data.animes.find(anime => anime.name.toLowerCase() === title.toLowerCase())?.id;
  
  if (!animeSlug && data.data.animes.length > 0) {
    // Fallback to the first result if no exact match
    animeSlug = data.data.animes[0].id;
    console.log(`[Hianime] No exact title match for "${title}". Using first result: ${data.data.animes[0].name} (Slug: ${animeSlug})`);
  } else if (!animeSlug) {
     throw new Error(`Anime "${title}" not found on Hianime after checking all results.`);
  }
  
  console.log(`[Hianime] Found Hianime slug: ${animeSlug} for title "${title}"`);
  return animeSlug;
}

async function getShowTitleFromTmdb(tmdbShowId) {
    const url = `https://api.themoviedb.org/3/tv/${tmdbShowId}?api_key=${TMDB_API_KEY}`;
    console.log(`[Hianime] Fetching show title from TMDB for ID: ${tmdbShowId}`);
    const data = await fetchJson(url, { headers: { 'User-Agent': USER_AGENT } }); // TMDB doesn't need API_HEADERS
    if (!data.name) throw new Error('Could not get show title from TMDB.');
    console.log(`[Hianime] TMDB Show Title: ${data.name}`);
    return data.name;
}

async function fetchTmdbSeasonEpisodes(tmdbShowId, seasonNumber) {
  const url = `https://api.themoviedb.org/3/tv/${tmdbShowId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}`;
  console.log(`[Hianime] Fetching TMDB season ${seasonNumber} episodes for show ${tmdbShowId}`);
  const data = await fetchJson(url, { headers: { 'User-Agent': USER_AGENT } });
  return data.episodes || [];
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
  const url = `https://hianime.pstream.org/api/v2/hianime/anime/${animeSlug}/episodes`;
  console.log(`[Hianime] Fetching Hianime episode list for slug: ${animeSlug}`);
  const data = await fetchJson(url, { headers: API_HEADERS });
  if (!data.success || !data.data.episodes) {
    throw new Error('Failed to fetch Hianime episode list or no episodes in response.');
  }
  return data.data.episodes;
}

async function fetchEpisodeSources(hianimeFullEpisodeId, server, category) {
  const sourceApiUrl = `https://hianime.pstream.org/api/v2/hianime/episode/sources?animeEpisodeId=${hianimeFullEpisodeId}&server=${server}&category=${category}`;
  console.log(`[Hianime] Fetching sources: ${server}/${category} from ${sourceApiUrl}`);
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
    return {
        playlistUrl: masterPlaylistUrl,
        headers: data.data.headers || {}, // Ensure headers is an object
    };
  } catch (error) {
    console.error(`[Hianime] Error fetching sources for ${server}/${category}: ${error.message}`);
    return null;
  }
}

async function parseM3U8(playlistUrl, m3u8Headers, category, tmdbShowId, seasonNumber, episodeNumber) {
  const streams = [];
  let streamCounter = 0;
  try {
    console.log(`[Hianime] Parsing M3U8 from ${playlistUrl}...`);
    // Ensure headers are properly formatted for fetch
    const fetchHeaders = { ...m3u8Headers, 'User-Agent': USER_AGENT };
    if (fetchHeaders.Referer === undefined || fetchHeaders.Referer === null || fetchHeaders.Referer === '') {
        fetchHeaders.Referer = 'https://megacloud.blog/'; // Default referer if not provided
    }

    const response = await fetch(playlistUrl, { headers: fetchHeaders });
    if (!response.ok) {
      console.warn(`[Hianime] Failed to fetch M3U8 content from ${playlistUrl} - ${response.status}`);
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
          
          const streamId = `hianime-${tmdbShowId}-S${seasonNumber}E${episodeNumber}-${category}-${qualityLabel}-${streamCounter++}`;
          streams.push({
            id: streamId,
            title: `Hianime ${category.toUpperCase()} - ${qualityLabel}`,
            quality: qualityLabel,
            language: category, // dub or sub
            url: mediaPlaylistUrl,
            type: 'hls',
            provider: 'Hianime',
            behaviorHints: {
                notWebReady: true, // Common for HLS streams that need specific handling or external players
            },
            headers: fetchHeaders // Pass along the headers needed to play the stream
          });
          variantsFoundInMaster++;
        }
      }
    }
    if (variantsFoundInMaster === 0 && masterPlaylistText.includes('#EXTINF:')) { // Is a media playlist
      const streamId = `hianime-${tmdbShowId}-S${seasonNumber}E${episodeNumber}-${category}-auto-${streamCounter++}`;
      streams.push({
        id: streamId,
        title: `Hianime ${category.toUpperCase()} - Auto`,
        quality: 'auto',
        language: category,
        url: playlistUrl,
        type: 'hls',
        provider: 'Hianime',
        behaviorHints: {
            notWebReady: true,
        },
        headers: fetchHeaders
      });
    }
  } catch (err) {
    console.error(`[Hianime] Error parsing M3U8 ${playlistUrl}:`, err.message);
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

  console.log(`[Hianime] Fetching streams for TMDB ID: ${tmdbShowId}, S${seasonNumber}E${episodeNumber}`);

  try {
    const showTitle = await getShowTitleFromTmdb(tmdbShowId);
    if (!showTitle) {
        console.error(`[Hianime] Could not get show title for TMDB ID ${tmdbShowId}. Cannot proceed.`);
        return [];
    }
    const animeSlug = await searchAnimeOnHianime(showTitle);
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
    console.error('[Hianime] --- ERROR ---');
    console.error(error.message);
    // console.error(error.stack); // Optionally log stack for more details
    return []; // Return empty on error
  }
}

module.exports = { getHianimeStreams }; 