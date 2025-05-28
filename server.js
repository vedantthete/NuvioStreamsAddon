#!/usr/bin/env node

const express = require('express');
const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./addon');
const path = require('path');
const cors = require('cors');

const app = express();

// Enable CORS for all routes
app.use(cors());

// Serve static files from the 'views' directory (for the landing page)
app.use(express.static(path.join(__dirname, 'views')));

// Stremio addon SDK middleware
// The SDK's serveHTTP can be adapted or we can use its core logic with Express
// For simplicity, let's assume serveHTTP can work as a handler or we find an Express-compatible way.

// A simple way to integrate if serveHTTP returns a request handler compatible with Express:
// Or, more typically, you'd use the SDK's router if available, or build one.

// If `addonInterface` is a manifest, and `serveHTTP` is meant to create a full server,
// we need to adjust how it's integrated. Let's try to use the underlying handler if possible
// or create a compatible middleware.

// The `stremio-addon-sdk`'s `serveHTTP` function typically creates its own server.
// To integrate with an existing Express app, we need to use a different approach
// or mount the SDK's handler if it's compatible.
// For now, let's set up the addon handling under a specific path, e.g., /stremio

// This is a conceptual adjustment. The actual integration might differ based on SDK capabilities.
// The `addonInterface` is the manifest and handler definitions.
// `serveHTTP` usually creates a server. We need to use a lower-level function or adapt.

// Let's assume the SDK provides a handler function or we can get it.
// We will serve the manifest.json separately and then the addon routes.

// The app.get('/manifest.json', ...) route was removed in the previous step
// because getRouter from stremio-addon-sdk should handle it.
// If it doesn't, we might need to add it back or adjust the SDK usage.

const { getRouter } = require('stremio-addon-sdk');
const router = getRouter(addonInterface);
app.use(router); // Mount the addon router

const PORT = process.env.PORT || 7777;

app.listen(PORT, () => {
    console.log(`Nuvio Streams Addon landing page available at http://localhost:${PORT}`);
    // The manifest URL will be http://localhost:${PORT}/manifest.json because of the router
    const manifestUrl = `http://localhost:${PORT}/manifest.json`;
    console.log(`Addon Manifest available at: ${manifestUrl}`);
    console.log(`To install in Stremio, open: stremio://${manifestUrl.replace(/^https?:\/\//, '')}`);
}); 