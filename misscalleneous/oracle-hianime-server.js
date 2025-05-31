const express = require('express');
const { getHianimeStreamsForVPS } = require('./hianime-scraper-vps.js'); // Path to your scraper logic

const app = express();
const port = process.env.PORT || 8082; // Use environment variable for port or default to 8082

// Middleware for logging requests
app.use((req, res, next) => {
  console.log(`[OracleServer] Received request: ${req.method} ${req.url} from ${req.ip}`);
  next();
});

app.get('/fetch-hianime', async (req, res) => {
    // const expectedSecret = process.env.HIANIME_ORACLE_SECRET || 'your-secret-key'; 
    // const receivedSecret = req.headers['x-oracle-secret'];
    // if (receivedSecret !== expectedSecret) {
    //     console.warn(`[OracleServer] Unauthorized attempt from IP: ${req.ip}`);
    //     return res.status(403).json({ error: 'Unauthorized' });
    // }

    // MODIFIED: Expect title and absEp from query parameters
    const { tmdbId, season, episode, title, absEp } = req.query;

    if (!tmdbId || !season || !episode || !title || !absEp) {
        console.error('[OracleServer] Bad Request: Missing required query parameters (tmdbId, season, episode, title, absEp).');
        return res.status(400).json({ error: 'Missing required query parameters: tmdbId, season, episode, title, absEp' });
    }

    const seasonNum = parseInt(season, 10);
    const episodeNum = parseInt(episode, 10);
    const absoluteEpisodeNum = parseInt(absEp, 10); // absEp is the absolute episode number

    if (isNaN(seasonNum) || isNaN(episodeNum) || isNaN(absoluteEpisodeNum)) {
        console.error('[OracleServer] Bad Request: Season, episode, or absEp is not a valid number.');
        return res.status(400).json({ error: 'Season, episode, and absEp must be numbers' });
    }

    console.log(`[OracleServer] Processing /fetch-hianime for TMDB: ${tmdbId}, S:${seasonNum}, E:${episodeNum}, Title: '${title}', AbsEp: ${absoluteEpisodeNum}`);

    try {
        // MODIFIED: Pass showTitle and absoluteEpisodeNum to the scraper function
        const streams = await getHianimeStreamsForVPS(tmdbId, seasonNum, episodeNum, title, absoluteEpisodeNum);
        if (streams && streams.length > 0) {
            console.log(`[OracleServer] Successfully fetched ${streams.length} streams. Sending response.`);
        } else {
            console.log('[OracleServer] No streams found by scraper. Sending empty array.');
        }
        res.setHeader('Content-Type', 'application/json');
        res.status(200).json(streams);
    } catch (error) {
        console.error(`[OracleServer] Error processing Hianime request: ${error.message}`);
        console.error(error.stack); 
        res.status(500).json({ error: 'Failed to fetch Hianime streams on Oracle VPS' });
    }
});

// Simple health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('Oracle Hianime Relay Server is healthy!');
});

app.listen(port, '0.0.0.0', () => { // Listen on all available network interfaces
    console.log(`Oracle Hianime Relay Server listening on port ${port} (all interfaces)`);
    console.log(`Accessible at: http://<YOUR_VPS_IP>:${port}/fetch-hianime`);
    console.log('Ensure this port is open in your VPS firewall and security groups.');
});

// Basic error handling for unhandled rejections and uncaught exceptions
process.on('unhandledRejection', (reason, promise) => {
  console.error('[OracleServer] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[OracleServer] Uncaught Exception thrown:', error);
  // It's often recommended to gracefully shut down the server on uncaught exceptions
  // process.exit(1);
}); 