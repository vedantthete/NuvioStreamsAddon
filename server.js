#!/usr/bin/env node

const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./addon');
// const path = require('path'); // No longer needed for staticDir
// const fs = require('fs'); // No longer needed for staticDir

// Static directory creation is removed as we will omit the static option
// const staticDir = path.join(__dirname, 'static');
// if (!fs.existsSync(staticDir)){
//     fs.mkdirSync(staticDir, { recursive: true });
//     console.log(`Created static directory at: ${staticDir}`);
// }

// Set up the server
serveHTTP(addonInterface, {
    port: process.env.PORT || 7777,
    // static: staticDir, // Removing this option to see if SDK handles it gracefully
    cors: true
}).then(({ url }) => {
    // The `url` returned by serveHTTP is already the full manifest URL
    console.log(`ShowBox Scraper Addon active. Manifest available at: ${url}`);
    console.log(`To install in Stremio, use this Addon Repository URL: ${url}`);
}); 