const axios = require('axios');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const FormData = require('form-data');

// TMDB API Key
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';

// Create readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(question) {
    return new Promise((resolve) => {
        rl.question(question, resolve);
    });
}

async function getTMDBDetails(tmdbId, type) {
    try {
        console.log(`Fetching ${type} details for TMDB ID: ${tmdbId}`);
        const response = await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}`);
        
        if (type === 'movie') {
            return {
                title: response.data.title,
                original_title: response.data.original_title,
                year: response.data.release_date ? response.data.release_date.split('-')[0] : null,
                slug: generateSlug(response.data.title)
            };
        } else {
            return {
                title: response.data.name,
                original_title: response.data.original_name,
                year: response.data.first_air_date ? response.data.first_air_date.split('-')[0] : null,
                slug: generateSlug(response.data.name)
            };
        }
    } catch (error) {
        console.error(`Error fetching details from TMDB:`, error.message);
        return null;
    }
}

function generateSlug(title) {
    return title.toLowerCase()
        .replace(/[^\w\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-')     // Replace spaces with hyphens
        .replace(/-+/g, '-');     // Replace multiple hyphens with a single hyphen
}

function processEpisode(episode, baseServer, serverName) {
    const videoUrl = `${baseServer}${episode.src}`;
    const subtitles = episode.subs ? episode.subs.map(sub => ({
        label: sub.label,
        url: `${baseServer}${sub.src}`
    })) : [];
    
    return {
        title: episode.show_title || episode.title,
        episode: episode.title,
        type: episode.type,
        quality: episode.label,
        videoUrl: videoUrl,
        server: serverName,
        subtitles: subtitles,
        aired: episode.aired,
        poster: episode.poster ? `${baseServer}${episode.poster}` : null,
        genres: episode.genres
    };
}

// Function to process all available servers
function processAllServers(playlist, servers) {
    const results = [];
    
    // Process main servers (Beta and Beta#3)
    const mainServers = ['Beta', 'Beta#3'];
    
    mainServers.forEach(serverName => {
        if (servers[serverName]) {
            const baseServer = servers[serverName];
            console.log(`✅ Processing server: ${serverName} (${baseServer})`);
            
            playlist.forEach(item => {
                results.push(processEpisode(item, baseServer, serverName));
            });
        }
    });
    
    return results;
}

async function fetchStreamingLinks(details, type, season, episode) {
    try {
        console.log(`\nSearching for ${details.title} (${details.year}) ${type === 'tv' ? `S${season}E${episode}` : ''}`);
        
        // Generate slug in the format "movie-name-year"
        let slug = details.slug;
        if (type === 'movie' && details.year) {
            slug = `${details.slug}-${details.year}`;
        }
        console.log(`Using slug: ${slug}`);
        
        // Create form data for multipart/form-data request
        const formData = new FormData();
        formData.append('v', '8');
        formData.append('z', JSON.stringify([{
            s: slug,
            t: type,
            se: season,
            ep: episode
        }]));
        
        console.log(`Request payload: ${JSON.stringify({
            s: slug,
            t: type,
            se: season,
            ep: episode
        })}`);
        
        const response = await axios({
            method: 'post',
            url: 'https://mp4hydra.org/info2?v=8',
            data: formData,
            headers: {
                ...formData.getHeaders(),
                'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
                'Origin': 'https://mp4hydra.org',
                'Referer': `https://mp4hydra.org/${type}/${slug}`,
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin'
            }
        });
        
        // Log the raw response for debugging
        console.log(`\nResponse received: ${JSON.stringify(response.data, null, 2)}`);
        
        if (response.data && response.data.playlist && response.data.playlist.length > 0) {
            const playlist = response.data.playlist;
            const servers = response.data.servers;
            
            console.log(`\n✅ Found ${playlist.length} videos`);
            console.log(`✅ Available servers: ${Object.keys(servers).join(', ')}`);
            
            // Find the requested episode if specified for TV shows
            if (type === 'tv' && season && episode) {
                // Pad season and episode numbers if needed
                const paddedSeason = season.toString().padStart(2, '0');
                const paddedEpisode = episode.toString().padStart(2, '0');
                const seasonEpisode = `S${paddedSeason}E${paddedEpisode}`;
                
                const targetEpisode = playlist.find(item => item.title.toUpperCase() === seasonEpisode.toUpperCase());
                
                if (!targetEpisode) {
                    console.log(`❌ Could not find ${seasonEpisode}. Showing all available episodes.`);
                } else {
                    console.log(`\n🎯 Found ${seasonEpisode}: ${targetEpisode.show_title || targetEpisode.title}`);
                    // Process the target episode for all servers
                    const results = [];
                    
                    // Process main servers (Beta and Beta#3)
                    const mainServers = ['Beta', 'Beta#3'];
                    
                    mainServers.forEach(serverName => {
                        if (servers[serverName]) {
                            const baseServer = servers[serverName];
                            console.log(`✅ Processing server: ${serverName} (${baseServer})`);
                            results.push(processEpisode(targetEpisode, baseServer, serverName));
                        }
                    });
                    
                    return results;
                }
            }
            
            // For movies or if no specific episode was found, process all servers
            return processAllServers(playlist, servers);
        } else {
            // Try with original title if the first attempt failed
            if (details.title !== details.original_title) {
                console.log(`\nRetrying with original title: ${details.original_title}`);
                const originalSlug = generateSlug(details.original_title);
                let originalFullSlug = originalSlug;
                
                if (type === 'movie' && details.year) {
                    originalFullSlug = `${originalSlug}-${details.year}`;
                }
                
                // Create new form data with original title
                const newFormData = new FormData();
                newFormData.append('v', '8');
                newFormData.append('z', JSON.stringify([{
                    s: originalFullSlug,
                    t: type,
                    se: season,
                    ep: episode
                }]));
                
                const newResponse = await axios({
                    method: 'post',
                    url: 'https://mp4hydra.org/info2?v=8',
                    data: newFormData,
                    headers: {
                        ...newFormData.getHeaders(),
                        'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
                        'Accept': '*/*',
                        'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
                        'Origin': 'https://mp4hydra.org',
                        'Referer': `https://mp4hydra.org/${type}/${originalFullSlug}`,
                        'Sec-Fetch-Dest': 'empty',
                        'Sec-Fetch-Mode': 'cors',
                        'Sec-Fetch-Site': 'same-origin'
                    }
                });
                
                // Log the raw response for debugging
                console.log(`\nResponse with original title: ${JSON.stringify(newResponse.data, null, 2)}`);
                
                if (newResponse.data && newResponse.data.playlist && newResponse.data.playlist.length > 0) {
                    const playlist = newResponse.data.playlist;
                    const servers = newResponse.data.servers;
                    
                    console.log(`\n✅ Found ${playlist.length} videos with original title`);
                    console.log(`✅ Available servers: ${Object.keys(servers).join(', ')}`);
                    
                    // For TV shows, try to find specific episode
                    if (type === 'tv' && season && episode) {
                        // Pad season and episode numbers if needed
                        const paddedSeason = season.toString().padStart(2, '0');
                        const paddedEpisode = episode.toString().padStart(2, '0');
                        const seasonEpisode = `S${paddedSeason}E${paddedEpisode}`;
                        
                        const targetEpisode = playlist.find(item => item.title.toUpperCase() === seasonEpisode.toUpperCase());
                        
                        if (!targetEpisode) {
                            console.log(`❌ Could not find ${seasonEpisode}. Showing all available episodes.`);
                        } else {
                            console.log(`\n🎯 Found ${seasonEpisode}: ${targetEpisode.show_title || targetEpisode.title}`);
                            // Process the target episode for all servers
                            const results = [];
                            
                            // Process main servers (Beta and Beta#3)
                            const mainServers = ['Beta', 'Beta#3'];
                            
                            mainServers.forEach(serverName => {
                                if (servers[serverName]) {
                                    const baseServer = servers[serverName];
                                    console.log(`✅ Processing server: ${serverName} (${baseServer})`);
                                    results.push(processEpisode(targetEpisode, baseServer, serverName));
                                }
                            });
                            
                            return results;
                        }
                    }
                    
                    // Return all episodes/videos for all servers
                    return processAllServers(playlist, servers);
                }
            }
            
            // Try with just the title without year for movies
            if (type === 'movie' && details.year) {
                console.log(`\nRetrying with title only (without year): ${details.title}`);
                const titleOnlySlug = details.slug;
                
                // Create new form data with title only
                const titleOnlyFormData = new FormData();
                titleOnlyFormData.append('v', '8');
                titleOnlyFormData.append('z', JSON.stringify([{
                    s: titleOnlySlug,
                    t: type,
                    se: season,
                    ep: episode
                }]));
                
                const titleOnlyResponse = await axios({
                    method: 'post',
                    url: 'https://mp4hydra.org/info2?v=8',
                    data: titleOnlyFormData,
                    headers: {
                        ...titleOnlyFormData.getHeaders(),
                        'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
                        'Accept': '*/*',
                        'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
                        'Origin': 'https://mp4hydra.org',
                        'Referer': `https://mp4hydra.org/${type}/${titleOnlySlug}`,
                        'Sec-Fetch-Dest': 'empty',
                        'Sec-Fetch-Mode': 'cors',
                        'Sec-Fetch-Site': 'same-origin'
                    }
                });
                
                if (titleOnlyResponse.data && titleOnlyResponse.data.playlist && titleOnlyResponse.data.playlist.length > 0) {
                    const playlist = titleOnlyResponse.data.playlist;
                    const servers = titleOnlyResponse.data.servers;
                    
                    console.log(`\n✅ Found ${playlist.length} videos with title only`);
                    console.log(`✅ Available servers: ${Object.keys(servers).join(', ')}`);
                    
                    // Return all episodes/videos for all servers
                    return processAllServers(playlist, servers);
                }
            }
            
            console.log('❌ No streaming links found');
            return [];
        }
    } catch (error) {
        console.error('❌ Error fetching streaming links:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        return [];
    }
}

async function downloadVideo(videoUrl, filename, type) {
    try {
        console.log(`\nStarting download...`);
        console.log(`📂 Filename: ${filename}`);
        console.log(`📊 Stream type: ${type}`);
        
        if (type === 'application/x-mpegURL') {
            console.log(`📺 HLS streams require special handling. This is likely a segmented stream.`);
            console.log(`🔗 M3U8 URL: ${videoUrl}`);
            console.log(`💡 To download HLS streams, you need tools like ffmpeg:`);
            console.log(`   ffmpeg -headers "Referer: https://mp4hydra.org/" -i "${videoUrl}" -c copy "${filename}"`);
            console.log(`📝 Saving M3U8 URL to file for manual download...`);
            
            const urlFilename = filename.replace('.mp4', '_stream.m3u8.txt');
            fs.writeFileSync(urlFilename, `M3U8 Stream URL:\n${videoUrl}\n\nTo download with ffmpeg:\nffmpeg -headers "Referer: https://mp4hydra.org/" -i "${videoUrl}" -c copy "${filename}"`);
            console.log(`✅ Stream URL saved to ${urlFilename}`);
            return;
        }
        
        const response = await axios.get(videoUrl, {
            headers: {
                'Referer': 'https://mp4hydra.org/',
                'Origin': 'https://mp4hydra.org/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            responseType: 'stream',
            timeout: 60000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        const filePath = path.join(__dirname, filename);
        const writer = fs.createWriteStream(filePath);
        
        let downloadedBytes = 0;
        const totalBytes = parseInt(response.headers['content-length']) || 0;
        
        console.log(`🎯 Final download URL: ${videoUrl}`);
        if (response.headers['content-type']) {
            console.log(`📊 Content-Type: ${response.headers['content-type']}`);
        }
        
        response.data.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            if (totalBytes > 0) {
                const progress = ((downloadedBytes / totalBytes) * 100).toFixed(2);
                process.stdout.write(`\r📥 Downloaded: ${(downloadedBytes / 1024 / 1024).toFixed(2)} MB / ${(totalBytes / 1024 / 1024).toFixed(2)} MB (${progress}%)`);
            } else {
                process.stdout.write(`\r📥 Downloaded: ${(downloadedBytes / 1024 / 1024).toFixed(2)} MB`);
            }
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log(`\n✅ Video downloaded successfully as ${filename}`);
                console.log(`📊 Final size: ${(downloadedBytes / 1024 / 1024).toFixed(2)} MB`);
                resolve();
            });
            writer.on('error', reject);
        });
    } catch (error) {
        console.error(`❌ Error downloading video:`, error.message);
        throw error;
    }
}

async function downloadSubtitle(subtitleUrl, filename) {
    try {
        console.log(`\nDownloading subtitle: ${filename}`);
        
        const response = await axios.get(subtitleUrl, {
            headers: {
                'Referer': 'https://mp4hydra.org/',
                'Origin': 'https://mp4hydra.org/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            responseType: 'text',
            timeout: 30000
        });
        
        fs.writeFileSync(filename, response.data);
        console.log(`✅ Subtitle downloaded successfully as ${filename}`);
        
    } catch (error) {
        console.error(`❌ Error downloading subtitle:`, error.message);
    }
}

async function main() {
    try {
        console.log('=== MP4Hydra Link Finder (TMDB ID Mode) ===\n');
        
        // Only search by TMDB ID
        const contentType = await askQuestion('Content type (tv/movie): ');
        const tmdbId = await askQuestion(`Enter ${contentType} TMDB ID: `);
        
        // Get details from TMDB
        const details = await getTMDBDetails(tmdbId, contentType.toLowerCase());
        
        if (!details) {
            console.log(`❌ Could not fetch details for TMDB ID: ${tmdbId}`);
            rl.close();
            return;
        }
        
        console.log(`\n📽️ Found: ${details.title} (${details.year})`);
        
        let season = null;
        let episode = null;
        
        if (contentType.toLowerCase() === 'tv') {
            season = await askQuestion('Enter season number: ');
            episode = await askQuestion('Enter episode number: ');
        }
        
        const episodes = await fetchStreamingLinks(details, contentType.toLowerCase(), season, episode);
        
        if (episodes.length === 0) {
            console.log('❌ No episodes/videos found.');
            rl.close();
            return;
        }
        
        console.log(`\n🎉 Found ${episodes.length} video links:`);
        episodes.forEach((ep, index) => {
            console.log(`\n${index + 1}. ${ep.title || ep.episode} [${ep.quality}] (${ep.type}) - Server: ${ep.server}`);
            console.log(`   🔗 ${ep.videoUrl}`);
            
            if (ep.subtitles && ep.subtitles.length > 0) {
                console.log(`   💬 Subtitles available: ${ep.subtitles.length}`);
                ep.subtitles.forEach((sub, idx) => {
                    console.log(`      - ${sub.label}: ${sub.url}`);
                });
            }
        });
        
        // Save results to file
        const resultsFilename = `mp4hydra_links_${details.slug}${season && episode ? `_S${season}E${episode}` : ''}.json`;
        fs.writeFileSync(resultsFilename, JSON.stringify(episodes, null, 2));
        console.log(`\n💾 Results saved to ${resultsFilename}`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        rl.close();
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Goodbye!');
    rl.close();
    process.exit(0);
});

main(); 