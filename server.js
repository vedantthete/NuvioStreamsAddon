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
    const userRegionPreference = req.query.region;

    if (userSuppliedCookie) {
        // Decode the cookie value from the URL query parameter
        try {
            req.userCookie = decodeURIComponent(userSuppliedCookie);
            console.log(`Using user-supplied cookie from URL. Length: ${req.userCookie.length} characters`);
        } catch (e) {
            console.error('Error decoding cookie from URL parameter:', e.message);
            // Potentially handle error, like ignoring malformed cookie
        }
    }

    // Store region preference if provided
    if (userRegionPreference) {
        req.userRegion = userRegionPreference;
        // Store uppercase version for consistency
        req.userRegion = req.userRegion.toUpperCase();
        console.log(`Received region preference from URL: ${req.userRegion}`);
    }

    // Log the full URL for debugging (mask the cookie value)
    const fullUrl = req.originalUrl || req.url;
    const maskedUrl = fullUrl.replace(/cookie=([^&]+)/, 'cookie=[MASKED]');
    console.log(`Incoming request: ${maskedUrl}`);

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
        const userRegion = req.query.region; // Get region directly from query
        const originalManifest = addonInterface.manifest;
        let personalizedManifest = { ...originalManifest };

        if (userCookie || userRegion) {
            // Create a simple identifier from the cookie and/or region for the manifest ID and Name
            let identifierSource = userCookie || '';
            if (userRegion) identifierSource += `-${userRegion}`;
            const cookieIdentifier = crypto.createHash('md5').update(identifierSource).digest('hex').substring(0, 8);
            
            personalizedManifest.id = `${originalManifest.id}_${cookieIdentifier}`;
            
            let personalizationText = [];
            if (userCookie) personalizationText.push("Cookie");
            if (userRegion) personalizationText.push(`${userRegion} Region`);
            
            personalizedManifest.name = `${originalManifest.name} (${personalizationText.join(', ')})`;
            personalizedManifest.description = `${originalManifest.description} (Using your ${personalizationText.join(' and ')} for enhanced access.)`;
            
            // Add flags to indicate personalization
            if (userCookie) personalizedManifest.isCookiePersonalized = true;
            if (userRegion) personalizedManifest.isRegionPersonalized = true;
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
        // Make cookie available if provided
        if (req.userCookie) {
            global.currentRequestUserCookie = req.userCookie;
            console.log(`[server.js] Setting user cookie for this request (length: ${req.userCookie.length})`);
        }
        
        // Make region preference available if provided
        if (req.userRegion) {
            global.currentRequestRegionPreference = req.userRegion;
            console.log(`[server.js] Setting region preference for this request: ${req.userRegion}`);
        } else {
            // Reset for safety
            global.currentRequestRegionPreference = null;
        }
        
        res.on('finish', () => {
            // Clean up the global variables after the request is handled
            global.currentRequestUserCookie = null;
            global.currentRequestRegionPreference = null;
            console.log(`[server.js] Cleared cookie and region preference after request processing`);
        });
        
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