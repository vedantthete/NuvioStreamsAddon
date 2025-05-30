const crypto = require('crypto');
let fetch = require('node-fetch');
if (fetch.default) { // Handle ES module default export if node-fetch v3+ is used
  fetch = fetch.default;
}
const { parse } = require('hls-parser');
const { URL } = require('url');

// Constants from the original scraper
const PROXY_URL = 'https://starlit-valkyrie-39f5ab.netlify.app/?destination=';
const VRF_SECRET_KEY = Buffer.from('c3VwZXJzZWNyZXRrZXk=', 'base64').toString();
const API_BASE = 'https://reyna.bludclart.com/api/source/hollymoviehd';

// Generate VRF hash for authentication
function generateVrf(tmdbId, season = '', episode = '') {
  const msg = `${tmdbId}:${season}:${episode}`;
  const hash = crypto.createHmac('sha256', VRF_SECRET_KEY).update(msg).digest('hex');
  return hash;
}

// Proxy wrapper for fetch, adapted for this module
async function proxiedFetchHolly(url, isJsonExpected = false) {
  const proxiedUrl = `${PROXY_URL}${encodeURIComponent(url)}`;
  console.log(`[HollyMovieHD] Fetching: ${url} (via proxy)`);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.warn(`[HollyMovieHD] Request timed out for ${url} after 3 seconds.`);
    controller.abort();
  }, 3000); // 3-second timeout
  
  try {
    const response = await fetch(proxiedUrl, { signal: controller.signal });
    clearTimeout(timeoutId); // Clear timeout if fetch completes

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch (e) { /* ignore */ }
      throw new Error(`Response not OK: ${response.status} ${response.statusText}. Body: ${errorBody.substring(0, 200)}`);
    }
    const contentType = response.headers.get('content-type');
    if (isJsonExpected) {
        if (contentType && contentType.includes('application/json')) {
            return response.json();
        }
        // If JSON is expected but not received, try to parse text as JSON anyway, or throw
        const textData = await response.text();
        try {
            return JSON.parse(textData);
        } catch (e) {
            console.error(`[HollyMovieHD] Expected JSON but received: ${contentType}. Content: ${textData.substring(0,300)}`);
            throw new Error ('Expected JSON, but received non-JSON content from API');
        }
    }
    return response.text(); // For M3U8 content
  } catch (error) {
    clearTimeout(timeoutId); // Clear timeout if fetch errors
    console.error(`[HollyMovieHD] Fetch error for ${url}:`, error.message);
    throw error;
  }
}

// Function to parse quality from HLS variant resolution or label
function parseQualityFromVariant(variant, index) {
    if (variant.resolution) {
        const height = variant.resolution.height;
        if (height >= 2160) return '2160p';
        if (height >= 1080) return '1080p';
        if (height >= 720) return '720p';
        if (height >= 480) return '480p';
        if (height >= 360) return '360p';
    }
    // Fallback if resolution is not present (though unlikely for variants)
    return `Quality ${index + 1}`; 
}

// Main function to be exported
async function getHollymovieStreams(tmdbId, mediaType = 'movie', season = '', episode = '') {
  console.log(`[HollyMovieHD] Fetching streams for TMDB ID: ${tmdbId} (Type: ${mediaType}${mediaType === 'show' ? `, S:${season} E:${episode}` : ''})`);
  const streams = [];

  try {
    let apiUrl = `${API_BASE}/${tmdbId}`;
    if (mediaType === 'tv') {
      console.log(`[HollyMovieHD] Inside 'tv' block. Season: '${season}', Episode: '${episode}', MediaType: '${mediaType}'`);
      // Ensure season and episode are provided and are not empty strings
      if (season && episode && String(season).trim() !== '' && String(episode).trim() !== '') {
        apiUrl += `/${String(season).trim()}/${String(episode).trim()}`;
      } else {
        console.warn(`[HollyMovieHD] Media type is 'tv' but season or episode is missing/empty. TMDB ID: ${tmdbId}, S: '${season}', E: '${episode}'`);
        return []; // For this provider, specific S/E is required for shows
      }
    }
    const vrf = generateVrf(tmdbId, season, episode);
    apiUrl += `?vrf=${vrf}`;
    
    console.log(`[HollyMovieHD] Requesting initial data from: ${apiUrl}`);
    const initialData = await proxiedFetchHolly(apiUrl, true); // Expect JSON for this first call

    if (!initialData || !initialData.sources || !initialData.sources.length || !initialData.sources[0].file) {
      console.error('[HollyMovieHD] No sources found or invalid structure in API response. Response:', JSON.stringify(initialData, null, 2));
      return [];
    }
    
    const mainPlaylistUrl = initialData.sources[0].file;
    console.log(`[HollyMovieHD] Main Playlist URL from API: ${mainPlaylistUrl}`);
    
    const mainPlaylistContent = await proxiedFetchHolly(mainPlaylistUrl);

    if (typeof mainPlaylistContent !== 'string' || !mainPlaylistContent.trim().startsWith('#EXTM3U')) {
        console.error('[HollyMovieHD] Fetched content for the main playlist is not a valid M3U8 format.');
        console.log(`[HollyMovieHD] Content snippet: ${String(mainPlaylistContent).substring(0, 300)}`);
        // Fallback: provide the main playlist URL directly if parsing fails but URL was obtained
        streams.push({
            url: `${PROXY_URL}${encodeURIComponent(mainPlaylistUrl)}`,
            quality: 'Auto Quality',
            provider: 'HollyMovieHD',
            codecs: [],
            size: 'N/A'
        });
        return streams;
    }

    try {
        const playlist = parse(mainPlaylistContent);
        if (playlist.isMasterPlaylist && playlist.variants && playlist.variants.length > 0) {
            playlist.variants.forEach((variant, index) => {
                let absoluteVariantUri = variant.uri;
                if (!absoluteVariantUri.startsWith('http://') && !absoluteVariantUri.startsWith('https://')) {
                    try {
                        absoluteVariantUri = new URL(variant.uri, mainPlaylistUrl).href;
                    } catch (e) {
                        console.warn(`[HollyMovieHD] Could not resolve relative URI: ${variant.uri} against base ${mainPlaylistUrl}. Skipping.`);
                        return; 
                    }
                }
                const quality = parseQualityFromVariant(variant, index);
                let qualityInfo = quality;
                if (variant.bandwidth) qualityInfo += ` (${(variant.bandwidth / 1000).toFixed(0)} kbps)`;

                streams.push({
                    url: `${PROXY_URL}${encodeURIComponent(absoluteVariantUri)}`,
                    quality: quality, // Standardized quality for sorting
                    // title: qualityInfo, // For Stremio 'name' later
                    provider: 'HollyMovieHD',
                    codecs: [], // M3U8 doesn't typically detail codecs like H.264 etc.
                    size: 'N/A' // Size not available from M3U8 directly
                });
            });
        } else { // Media Playlist or Master without variants
            console.log('[HollyMovieHD] Playlist is not a master playlist with variants, or has no variants. Using main URL.');
            streams.push({
                url: `${PROXY_URL}${encodeURIComponent(mainPlaylistUrl)}`,
                quality: 'Auto Quality',
                provider: 'HollyMovieHD',
                codecs: [],
                size: 'N/A'
            });
        }

        if (streams.length > 0) {
             console.log(`[HollyMovieHD] Extracted ${streams.length} stream options.`);
        } else {
             console.log('[HollyMovieHD] No stream variants extracted from M3U8, but main URL might be usable.');
             // The fallback for non-M3U8 content already added a stream, or the one for Media Playlist
        }

    } catch (parseError) {
        console.error('[HollyMovieHD] Error parsing M3U8 playlist content:', parseError.message);
        console.log('[HollyMovieHD] Content snippet that failed to parse:', mainPlaylistContent.substring(0, 500));
        streams.push({
            url: `${PROXY_URL}${encodeURIComponent(mainPlaylistUrl)}`,
            quality: 'Auto Quality',
            provider: 'HollyMovieHD',
            codecs: [],
            size: 'N/A'
        });
    }
    
  } catch (error) {
    console.error(`[HollyMovieHD] Error in getHollymovieStreams for ${tmdbId}:`, error.message);
    // Ensure we always return an array, even on catastrophic failure
    return []; 
  }
  return streams;
}

module.exports = { getHollymovieStreams }; 