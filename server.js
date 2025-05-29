#!/usr/bin/env node

const express = require('express');
// const { serveHTTP } = require('stremio-addon-sdk'); // serveHTTP is not directly used with Express in this setup
const addonInterface = require('./addon');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto'); // For generating a simple hash for personalized manifest ID
// body-parser is not strictly needed if we remove the POST /api/set-cookie endpoint and don't have other JSON POST bodies to parse for now.
// const bodyParser = require('body-parser'); 

const app = express();

// REMOVE: User cookies directory and related fs operations
// const USER_COOKIES_DIR = path.join(__dirname, '.user_cookies');
// (async () => { ... })();

// Enable CORS for all routes
app.use(cors());

// REMOVE: bodyParser.json() if no other routes need it.
// app.use(bodyParser.json());

// Serve static files from the 'views' directory (for the landing page)
app.use(express.static(path.join(__dirname, 'views')));

// Serve static files from the 'static' directory (for videos, images, etc.)
app.use('/static', express.static(path.join(__dirname, 'static')));

// Add route to render the main configuration page also at /configure
app.get('/configure', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Middleware to extract user-supplied cookie from request query
app.use(async (req, res, next) => {
    const userSuppliedCookie = req.query.cookie; 
    if (userSuppliedCookie) {
        // Decode the cookie value from the URL query parameter
        try {
            req.userCookie = decodeURIComponent(userSuppliedCookie);
            // console.log(`Using user-supplied cookie from URL: ${req.userCookie.substring(0,30)}...`);
        } catch (e) {
            console.error('Error decoding cookie from URL parameter:', e.message);
            // Potentially handle error, like ignoring malformed cookie
        }
    }
    next();
});

// REMOVE: API endpoint for setting a custom cookie (/api/set-cookie)
// app.post('/api/set-cookie', async (req, res) => { ... });

// REMOVE: API endpoint to verify a cookie exists (/api/check-cookie)
// app.get('/api/check-cookie', async (req, res) => { ... });

// Serve a customized version of manifest.json
app.get('/manifest.json', async (req, res) => {
    try {
        const userCookie = req.query.cookie; // Get cookie directly from query
        const originalManifest = addonInterface.manifest;
        let personalizedManifest = { ...originalManifest };

        if (userCookie) {
            // Create a simple identifier from the cookie for the manifest ID and Name
            // This avoids putting the actual cookie in the manifest ID/Name
            const cookieIdentifier = crypto.createHash('md5').update(userCookie).digest('hex').substring(0, 8);
            
            personalizedManifest.id = `${originalManifest.id}_cookie_${cookieIdentifier}`;
            personalizedManifest.name = `${originalManifest.name} (Personalized)`;
            personalizedManifest.description = `${originalManifest.description} (Using your provided cookie for enhanced access.)`;
            // Add a flag to indicate personalization (optional, for addon logic or Stremio UI if supported)
            personalizedManifest.isCookiePersonalized = true; 
        }
        
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(personalizedManifest, null, 2));
    } catch (error) {
        console.error('Error serving manifest:', error.message, error.stack);
        res.status(500).json({ error: 'Failed to generate manifest', details: error.message });
    }
});

// REMOVE: Route for /setup as cookie configuration will be on index.html client-side
// app.get('/setup', (req, res) => { ... });

// The SDK's router takes care of addon functionality
const { getRouter } = require('stremio-addon-sdk');

// Custom router to make the user-supplied cookie available to the addon sdk handlers
const createCustomRouter = (currentAddonInterface) => {
    const originalRouter = getRouter(currentAddonInterface);
    
    return (req, res, next) => {
        if (req.userCookie) {
            // Make the cookie available to addon.js (and subsequently scraper.js)
            // Using global might have concurrency issues in a high-load server, but for typical addon usage it's simpler.
            // A more robust solution might involve request-scoped context if the SDK supports it.
            global.currentRequestUserCookie = req.userCookie;
            
            res.on('finish', () => {
                // Clean up the global variable after the request is handled
                global.currentRequestUserCookie = null;
            });
        }
        return originalRouter(req, res, next);
    };
};

app.use(createCustomRouter(addonInterface));

const PORT = process.env.PORT || 7777;

app.listen(PORT, () => {
    console.log(`Nuvio Streams Addon landing page available at http://localhost:${PORT}`);
    // console.log(`Cookie setup page available at http://localhost:${PORT}/setup`); // Removed
    const manifestUrl = `http://localhost:${PORT}/manifest.json`;
    console.log(`Default Addon Manifest available at: ${manifestUrl}`);
    console.log(`To generate a personalized manifest, append ?cookie=YOUR_URL_ENCODED_COOKIE to the manifest URL.`);
    console.log(`Example: http://localhost:${PORT}/manifest.json?cookie=ui%3Dyourcookievalue`);
    console.log(`Install example: stremio://localhost:${PORT}/manifest.json?cookie=ui%3Dyourcookievalue`);
}); 