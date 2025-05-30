const https = require('https');

// --- Configuration & Constants ---
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const API_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://pstream.org', 
};

const SERVERS_TO_TRY = [
  { server: 'hd-1', category: 'dub' },
  { server: 'hd-1', category: 'sub' },
  { server: 'hd-2', category: 'dub' },
  { server: 'hd-2', category: 'sub' },
];

// --- Helper Functions (Copied from the original hianime.js) ---

async function fetchJson(url, options = {}, attempt = 1) {
  try {
    const response = await fetch(url, {
      ...options,
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Could not read error text');
      console.error(`[HianimeScraperVPS] API Error: ${response.status} for ${url}. Response: ${errorText.substring(0, 200)}`);
      if (response.status === 403 && attempt < 3) {
        console.warn(`[HianimeScraperVPS] Retrying fetch for ${url} (attempt ${attempt + 1}) after 403...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        return fetchJson(url, options, attempt + 1);
      }
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return response.json();
  } catch (error) {
    console.error(`[HianimeScraperVPS] Fetch error for ${url}:`, error.message);
    throw error;
  }
}

async function searchAnimeOnHianime(title) {
  const searchUrl = `https://hianime.pstream.org/api/v2/hianime/search?q=${encodeURIComponent(title)}`;
  console.log(`[HianimeScraperVPS] Searching for anime: "${title}" using ${searchUrl}`);
  const data = await fetchJson(searchUrl, { headers: API_HEADERS });

  if (!data.success || !data.data.animes || data.data.animes.length === 0) {
    throw new Error(`Anime "${title}" not found on Hianime or no animes array in response.`);
  }
  let animeSlug = data.data.animes.find(anime => anime.name.toLowerCase() === title.toLowerCase())?.id;
  if (!animeSlug && data.data.animes.length > 0) {
    animeSlug = data.data.animes[0].id;
    console.log(`[HianimeScraperVPS] No exact title match for "${title}". Using first result: ${data.data.animes[0].name} (Slug: ${animeSlug})`);
  } else if (!animeSlug) {
     throw new Error(`Anime "${title}" not found on Hianime after checking all results.`);
  }
  console.log(`[HianimeScraperVPS] Found Hianime slug: ${animeSlug} for title "${title}"`);
  return animeSlug;
}

async function fetchEpisodeListForAnimeFromHianime(animeSlug) {
  const url = `https://hianime.pstream.org/api/v2/hianime/anime/${animeSlug}/episodes`;
  const data = await fetchJson(url, { headers: API_HEADERS });
  if (!data.success || !data.data.episodes) {
    throw new Error('Failed to fetch Hianime episode list or no episodes in response.');
  }
  return data.data.episodes;
}

async function fetchEpisodeSources(hianimeFullEpisodeId, server, category) {
  const sourceApiUrl = `https://hianime.pstream.org/api/v2/hianime/episode/sources?animeEpisodeId=${hianimeFullEpisodeId}&server=${server}&category=${category}`;
  try {
    const data = await fetchJson(sourceApiUrl, { headers: API_HEADERS });
    if (!data.success || !data.data.sources || data.data.sources.length === 0) {
      console.warn(`[HianimeScraperVPS] No sources found from ${server}/${category}.`);
      return null;
    }
    const masterPlaylistUrl = data.data.sources[0].url;
    if (!masterPlaylistUrl || data.data.sources[0].type !== 'hls') {
      console.warn(`[HianimeScraperVPS] No HLS master playlist URL found for ${server}/${category}.`);
      return null;
    }
    if (!masterPlaylistUrl.includes('netmagcdn.com')) {
        console.log(`[HianimeScraperVPS] Skipping non-netmagcdn.com link: ${masterPlaylistUrl}`);
        return null;
    }
    return {
        playlistUrl: masterPlaylistUrl,
        headers: data.data.headers || {},
    };
  } catch (error) {
    console.error(`[HianimeScraperVPS] Error fetching sources for ${server}/${category}: ${error.message}`);
    return null;
  }
}

async function parseM3U8(playlistUrl, m3u8Headers, category, tmdbShowId, seasonNumber, episodeNumber) {
  const streams = [];
  let streamCounter = 0;
  try {
    const fetchHeaders = { ...m3u8Headers, 'User-Agent': USER_AGENT };
    if (fetchHeaders.Referer === undefined || fetchHeaders.Referer === null || fetchHeaders.Referer === '') {
        fetchHeaders.Referer = 'https://megacloud.blog/';
    }
    const response = await fetch(playlistUrl, { headers: fetchHeaders });
    if (!response.ok) {
      console.warn(`[HianimeScraperVPS] Failed to fetch M3U8 content from ${playlistUrl} - ${response.status}`);
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
            language: category,
            url: mediaPlaylistUrl,
            type: 'hls',
            provider: 'Hianime', // Important: Set provider for addon.js to correctly identify
            behaviorHints: { notWebReady: true },
            headers: fetchHeaders
          });
          variantsFoundInMaster++;
        }
      }
    }
    if (variantsFoundInMaster === 0 && masterPlaylistText.includes('#EXTINF:')) {
      const streamId = `hianime-${tmdbShowId}-S${seasonNumber}E${episodeNumber}-${category}-auto-${streamCounter++}`;
      streams.push({
        id: streamId,
        title: `Hianime ${category.toUpperCase()} - Auto`,
        quality: 'auto',
        language: category,
        url: playlistUrl,
        type: 'hls',
        provider: 'Hianime',
        behaviorHints: { notWebReady: true },
        headers: fetchHeaders
      });
    }
  } catch (err) {
    console.error(`[HianimeScraperVPS] Error parsing M3U8 ${playlistUrl}:`, err.message);
  }
  return streams;
}

// Main function for this module, to be called by the Oracle VPS server
async function getHianimeStreamsForVPS(tmdbShowId, seasonNumber, episodeNumber, showTitle, absoluteEpNum) {
  if (!tmdbShowId || seasonNumber == null || episodeNumber == null || !showTitle || absoluteEpNum == null) {
    console.error('[HianimeScraperVPS] Missing required parameters: tmdbShowId, seasonNumber, episodeNumber, showTitle, or absoluteEpNum.');
    return [];
  }
  console.log(`[HianimeScraperVPS] Fetching streams for TMDB ID: ${tmdbShowId}, S${seasonNumber}E${episodeNumber}, Title: '${showTitle}', AbsEp: ${absoluteEpNum}`);
  try {
    const animeSlug = await searchAnimeOnHianime(showTitle);
    const hianimeEpisodeList = await fetchEpisodeListForAnimeFromHianime(animeSlug);
    const targetHianimeEpisode = hianimeEpisodeList.find(ep => ep.number === absoluteEpNum);

    if (!targetHianimeEpisode) {
      console.warn(`[HianimeScraperVPS] Episode S${seasonNumber}E${episodeNumber} (Abs: ${absoluteEpNum}) not found in Hianime's list for ${animeSlug} (Title: '${showTitle}').`);
      return [];
    }
    const hianimeFullEpisodeId = targetHianimeEpisode.episodeId;
    console.log(`[HianimeScraperVPS] Using Hianime full episode ID: ${hianimeFullEpisodeId}`);

    const allStreams = [];
    for (const serverInfo of SERVERS_TO_TRY) {
      const sourceData = await fetchEpisodeSources(hianimeFullEpisodeId, serverInfo.server, serverInfo.category);
      if (sourceData && sourceData.playlistUrl) {
        const parsedStreams = await parseM3U8(sourceData.playlistUrl, sourceData.headers, serverInfo.category, tmdbShowId, seasonNumber, episodeNumber);
        if (parsedStreams.length > 0) {
            console.log(`[HianimeScraperVPS] Found ${parsedStreams.length} stream(s) from ${serverInfo.server}/${serverInfo.category}`);
            allStreams.push(...parsedStreams);
        }
      }
    }
    if (allStreams.length === 0) {
      console.log('[HianimeScraperVPS] No HLS streams found after checking all servers.');
    } else {
      console.log(`[HianimeScraperVPS] Successfully fetched ${allStreams.length} HLS streams.`);
    }
    return allStreams;
  } catch (error) {
    console.error('[HianimeScraperVPS] --- ERROR --- ', error.message);
    return [];
  }
}

module.exports = { getHianimeStreamsForVPS }; 