#!/usr/bin/env node
const cheerio = require('cheerio');
// --- Constants ---
let BASEDOM = "https://cloudnestra.com"; // This can be updated by serversLoad
const SOURCE_URL = "https://vidsrc.xyz/embed";
// --- Helper Functions (copied and adapted from src/extractor.ts) ---
async function serversLoad(html) {
    const $ = cheerio.load(html);
    const servers = [];
    const title = $("title").text() ?? "";
    const baseFrameSrc = $("iframe").attr("src") ?? "";
    if (baseFrameSrc) {
        try {
            BASEDOM = new URL(baseFrameSrc.startsWith("//") ? "https" + baseFrameSrc : baseFrameSrc).origin;
        }
        catch (e) {
            console.warn(`Failed to parse base URL from iframe src: ${baseFrameSrc}, using default: ${BASEDOM}`);
        }
    }
    $(".serversList .server").each((index, element) => {
        const server = $(element);
        servers.push({
            name: server.text().trim(),
            dataHash: server.attr("data-hash") ?? null,
        });
    });
    return {
        servers: servers,
        title: title,
    };
}
async function parseMasterM3U8(m3u8Content, masterM3U8Url) {
    const lines = m3u8Content.split('\n').map(line => line.trim());
    const streams = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("#EXT-X-STREAM-INF:")) {
            const infoLine = lines[i];
            let quality = "unknown";
            const resolutionMatch = infoLine.match(/RESOLUTION=(\d+x\d+)/);
            if (resolutionMatch && resolutionMatch[1]) {
                quality = resolutionMatch[1];
            }
            else {
                const bandwidthMatch = infoLine.match(/BANDWIDTH=(\d+)/);
                if (bandwidthMatch && bandwidthMatch[1]) {
                    quality = `${Math.round(parseInt(bandwidthMatch[1]) / 1000)}kbps`;
                }
            }
            if (i + 1 < lines.length && lines[i + 1] && !lines[i + 1].startsWith("#")) {
                const streamUrlPart = lines[i + 1];
                try {
                    const fullStreamUrl = new URL(streamUrlPart, masterM3U8Url).href;
                    streams.push({ quality: quality, url: fullStreamUrl });
                }
                catch (e) {
                    console.error(`Error constructing URL for stream part: ${streamUrlPart} with base: ${masterM3U8Url}`, e);
                    streams.push({ quality: quality, url: streamUrlPart }); // Store partial URL as a fallback
                }
                i++;
            }
        }
    }
    return streams;
}
async function PRORCPhandler(prorcp) {
    try {
        const prorcpUrl = `${BASEDOM}/prorcp/${prorcp}`;
        const prorcpFetch = await fetch(prorcpUrl, {
            headers: {
                "accept": "*/*", "accept-language": "en-US,en;q=0.9", "priority": "u=1",
                "sec-ch-ua": "\"Chromium\";v=\"128\", \"Not;A=Brand\";v=\"24\", \"Google Chrome\";v=\"128\"",
                "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": "\"Windows\"",
                "sec-fetch-dest": "script", "sec-fetch-mode": "no-cors", "sec-fetch-site": "same-origin",
                'Sec-Fetch-Dest': 'iframe', "Referer": `${BASEDOM}/`, "Referrer-Policy": "origin",
            },
        });
        if (!prorcpFetch.ok) {
            console.error(`Failed to fetch prorcp: ${prorcpUrl}, status: ${prorcpFetch.status}`);
            return null;
        }
        const prorcpResponse = await prorcpFetch.text();
        const regex = /file:\s*'([^']*)'/gm;
        const match = regex.exec(prorcpResponse);
        if (match && match[1]) {
            const masterM3U8Url = match[1];
            const m3u8FileFetch = await fetch(masterM3U8Url, {
                headers: { "Referer": prorcpUrl, "Accept": "*/*" }
            });
            if (!m3u8FileFetch.ok) {
                console.error(`Failed to fetch master M3U8: ${masterM3U8Url}, status: ${m3u8FileFetch.status}`);
                return null;
            }
            const m3u8Content = await m3u8FileFetch.text();
            return parseMasterM3U8(m3u8Content, masterM3U8Url);
        }
        console.warn("No master M3U8 URL found in prorcp response for:", prorcpUrl);
        return null;
    }
    catch (error) {
        console.error(`Error in PRORCPhandler for ${BASEDOM}/prorcp/${prorcp}:`, error);
        return null;
    }
}
async function rcpGrabber(html) {
    const regex = /src:\s*'([^']*)'/;
    const match = html.match(regex);
    if (!match || !match[1])
        return null;
    return { metadata: { image: "" }, data: match[1] };
}
function getObject(id) {
    const arr = id.split(':');
    return { id: arr[0], season: arr[1], episode: arr[2] };
}
function getUrl(id, type) {
    if (type === "movie") {
        return `${SOURCE_URL}/movie/${id}`;
    }
    else {
        const obj = getObject(id);
        return `${SOURCE_URL}/tv/${obj.id}/${obj.season}-${obj.episode}`;
    }
}
async function getStreamContent(id, type) {
    const url = getUrl(id, type);
    const embedRes = await fetch(url, { headers: { "Referer": SOURCE_URL } });
    if (!embedRes.ok) {
        console.error(`Failed to fetch embed page ${url}: ${embedRes.status}`);
        return [];
    }
    const embedResp = await embedRes.text();
    const { servers, title } = await serversLoad(embedResp);
    const apiResponse = [];
    for (const server of servers) {
        if (!server.dataHash)
            continue;
        try {
            const rcpUrl = `${BASEDOM}/rcp/${server.dataHash}`;
            const rcpRes = await fetch(rcpUrl, {
                headers: { 'Sec-Fetch-Dest': 'iframe', "Referer": url }
            });
            if (!rcpRes.ok) {
                console.warn(`RCP fetch failed for server ${server.name}: ${rcpRes.status}`);
                continue;
            }
            const rcpHtml = await rcpRes.text();
            const rcpData = await rcpGrabber(rcpHtml);
            if (!rcpData || !rcpData.data) {
                console.warn(`Skipping server ${server.name} due to missing rcp data.`);
                continue;
            }
            if (rcpData.data.startsWith("/prorcp/")) {
                const streamDetails = await PRORCPhandler(rcpData.data.replace("/prorcp/", ""));
                if (streamDetails && streamDetails.length > 0) {
                    apiResponse.push({
                        name: title, image: rcpData.metadata.image, mediaId: id,
                        streams: streamDetails, referer: BASEDOM,
                    });
                }
                else {
                    console.warn(`No stream details from PRORCPhandler for server ${server.name} (${rcpData.data})`);
                }
            }
            else {
                console.warn(`Unhandled rcp data type for server ${server.name}: ${rcpData.data.substring(0, 50)}`);
            }
        }
        catch (e) {
            console.error(`Error processing server ${server.name} (${server.dataHash}):`, e);
        }
    }
    return apiResponse;
}
// --- Main execution logic (conditional) ---
async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error("Usage: node vidsrcextractor.js <id> <type>");
        console.error("Example (movie): node vidsrcextractor.js tt0111161 movie");
        console.error("Example (series): node vidsrcextractor.js tt0944947:1:1 series"); // Game of Thrones S1E1
        process.exit(1);
    }
    const id = args[0];
    const type = args[1];
    if (type !== "movie" && type !== "series") {
        console.error("Invalid type. Must be 'movie' or 'series'.");
        process.exit(1);
    }
    // Basic validation for series ID format
    if (type === "series" && id.split(':').length < 3) {
        console.error("Invalid series ID format. Expected 'ttID:season:episode' (e.g., tt0944947:1:1).");
        process.exit(1);
    }
    console.log(`Fetching streams for ID: ${id}, Type: ${type}`);
    try {
        const results = await getStreamContent(id, type);
        if (results && results.length > 0) {
            console.log("Extracted Data:");
            console.log(JSON.stringify(results, null, 2));
        }
        else {
            console.log("No streams found or an error occurred.");
        }
    }
    catch (error) {
        console.error("Error during extraction process:", error);
    }
}

// Export the function for use in other modules
module.exports = { getStreamContent };

// Run main only if the script is executed directly
if (require.main === module) {
    main().catch(error => {
        console.error("Unhandled error in main execution:", error);
        process.exit(1);
    });
}
