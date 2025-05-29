require('dotenv').config();
const path = require('path');
const fs = require('fs').promises;
const scraper = require('./scraper');

// Extract the main functions we need
const { getStreamsFromTmdbId } = scraper;

// Test configuration
const TEST_CONFIG = {
    // TMDB movie ID for a popular movie (e.g., Interstellar)
    movieTmdbId: '157336',
    // TMDB TV show ID for a popular show (e.g., Breaking Bad)
    tvShowTmdbId: '1396',
    // Season and episode numbers to test for TV shows
    season: 1,
    episode: 1
};

// A simplified version of cookie loading
async function loadAllCookies() {
    try {
        const cookiesPath = path.join(__dirname, 'cookies.txt');
        const cookiesContent = await fs.readFile(cookiesPath, 'utf-8');
        return cookiesContent
            .split('\n')
            .filter(line => line.trim().length > 0)
            .map(cookie => cookie.trim());
    } catch (error) {
        console.error(`Error loading cookies: ${error.message}`);
        return [];
    }
}

// Create a temp file with a single cookie for testing
async function createTempCookieFile(cookie, index) {
    const tempCookiePath = path.join(__dirname, 'cookies.txt.bak');
    const origCookiePath = path.join(__dirname, 'cookies.txt');
    
    // Backup original cookies file
    try {
        await fs.copyFile(origCookiePath, tempCookiePath);
    } catch (error) {
        console.error(`Warning: Could not backup cookies file: ${error.message}`);
    }
    
    // Overwrite cookies.txt with just our test cookie
    try {
        await fs.writeFile(origCookiePath, cookie);
        console.log(`Created test cookie file with just cookie #${index + 1}`);
    } catch (error) {
        console.error(`Error writing test cookie: ${error.message}`);
        throw error;
    }
}

// Restore the original cookies file
async function restoreOriginalCookiesFile() {
    const tempCookiePath = path.join(__dirname, 'cookies.txt.bak');
    const origCookiePath = path.join(__dirname, 'cookies.txt');
    
    try {
        await fs.copyFile(tempCookiePath, origCookiePath);
        await fs.unlink(tempCookiePath);
        console.log("Restored original cookies file");
    } catch (error) {
        console.error(`Warning: Could not restore original cookies file: ${error.message}`);
    }
}

// Test a specific cookie with both movie and TV show
async function testCookie(cookie, index, totalCookies) {
    console.log(`\n======= Testing Cookie #${index + 1}/${totalCookies} =======`);
    console.log(`Cookie: ${cookie.substring(0, 20)}...${cookie.substring(cookie.length - 20)}`);

    // Replace the cookies.txt file with our test cookie
    await createTempCookieFile(cookie, index);
    
    // Reset the cookieCache in the scraper module
    // We're using this approach because loadCookies is not exported
    if (scraper.cookieCache !== undefined) {
        scraper.cookieCache = null;
    }
    if (scraper.cookieIndex !== undefined) {
        scraper.cookieIndex = 0;
    }
    
    try {
        // Test with a movie
        console.log("\n--- Testing with Movie ---");
        console.log(`TMDB ID: ${TEST_CONFIG.movieTmdbId}`);
        console.time('Movie test');
        const movieStreams = await getStreamsFromTmdbId('movie', TEST_CONFIG.movieTmdbId);
        console.timeEnd('Movie test');
        const movieResult = {
            success: movieStreams && movieStreams.length > 0,
            streamCount: movieStreams ? movieStreams.length : 0,
            qualities: movieStreams ? [...new Set(movieStreams.map(s => s.quality))].sort() : [],
            error: null
        };
        console.log(`Result: ${movieResult.success ? 'SUCCESS' : 'FAILED'}`);
        console.log(`Streams found: ${movieResult.streamCount}`);
        if (movieResult.qualities.length > 0) {
            console.log(`Stream qualities: ${movieResult.qualities.join(', ')}`);
        }
        
        // Reset cookie cache before TV test
        if (scraper.cookieCache !== undefined) {
            scraper.cookieCache = null;
        }
        if (scraper.cookieIndex !== undefined) {
            scraper.cookieIndex = 0;
        }
        
        // Test with a TV show
        console.log("\n--- Testing with TV Show ---");
        console.log(`TMDB ID: ${TEST_CONFIG.tvShowTmdbId}, Season: ${TEST_CONFIG.season}, Episode: ${TEST_CONFIG.episode}`);
        console.time('TV test');
        const tvStreams = await getStreamsFromTmdbId('tv', TEST_CONFIG.tvShowTmdbId, TEST_CONFIG.season, TEST_CONFIG.episode);
        console.timeEnd('TV test');
        const tvResult = {
            success: tvStreams && tvStreams.length > 0,
            streamCount: tvStreams ? tvStreams.length : 0,
            qualities: tvStreams ? [...new Set(tvStreams.map(s => s.quality))].sort() : [],
            error: null
        };
        console.log(`Result: ${tvResult.success ? 'SUCCESS' : 'FAILED'}`);
        console.log(`Streams found: ${tvResult.streamCount}`);
        if (tvResult.qualities.length > 0) {
            console.log(`Stream qualities: ${tvResult.qualities.join(', ')}`);
        }

        return {
            index: index + 1,
            cookie: '...' + cookie.substring(Math.max(0, cookie.length - 20)),
            movieResult,
            tvResult,
            overallStatus: movieResult.success || tvResult.success ? 'WORKING' : 'FAILED'
        };
    } catch (error) {
        console.error(`Error testing cookie #${index + 1}: ${error.message}`);
        return {
            index: index + 1,
            cookie: '...' + cookie.substring(Math.max(0, cookie.length - 20)),
            movieResult: { success: false, streamCount: 0, error: error.message },
            tvResult: { success: false, streamCount: 0, error: error.message },
            overallStatus: 'ERROR',
            errorMessage: error.message
        };
    } finally {
        // Restore original cookies file
        await restoreOriginalCookiesFile();
    }
}

// Main function to test all cookies
async function testAllCookies() {
    // Make sure DISABLE_CACHE is set to true for testing
    const originalCacheValue = process.env.DISABLE_CACHE;
    process.env.DISABLE_CACHE = 'false'; // Set to false to avoid excessive API calls during testing
    
    try {
        console.log("Loading cookies from cookies.txt...");
        const cookies = await loadAllCookies();
        console.log(`Found ${cookies.length} cookies to test.`);
        
        if (cookies.length === 0) {
            console.error("No cookies found in cookies.txt");
            return;
        }
        
        const results = [];
        
        for (let i = 0; i < cookies.length; i++) {
            const result = await testCookie(cookies[i], i, cookies.length);
            results.push(result);
        }
        
        // Print summary
        console.log("\n======= COOKIE TEST SUMMARY =======");
        console.log("*--------------------------------*-------------------------*------------------*------------------*");
        console.log("| Cookie #                       | Cookie (end)           | Movie Status     | TV Show Status   |");
        console.log("|--------------------------------|-------------------------|------------------|------------------|");
        
        const workingCount = results.filter(r => r.overallStatus === 'WORKING').length;
        const failedCount = results.filter(r => r.overallStatus === 'FAILED').length;
        const errorCount = results.filter(r => r.overallStatus === 'ERROR').length;
        
        results.forEach(r => {
            const paddedIndex = `${r.index}`.padEnd(30, ' ');
            const paddedCookie = r.cookie.padEnd(22, ' ');
            const movieStatus = r.movieResult.success ? 
                `✅ (${r.movieResult.streamCount})`.padEnd(16, ' ') : 
                '❌'.padEnd(16, ' ');
            const tvStatus = r.tvResult.success ? 
                `✅ (${r.tvResult.streamCount})`.padEnd(16, ' ') : 
                '❌'.padEnd(16, ' ');
            
            console.log(`| ${paddedIndex}| ${paddedCookie}| ${movieStatus}| ${tvStatus}|`);
            
            // Add a debug line to show the actual last characters of each cookie
            if (process.env.DEBUG === 'true') {
                const originalCookie = cookies[r.index - 1];
                console.log(`DEBUG: Cookie #${r.index} actual ending: "${originalCookie.substring(originalCookie.length - 20)}"`);
            }
        });
        
        console.log("*--------------------------------*-------------------------*------------------*------------------*");
        console.log(`\nSUMMARY: ${workingCount} WORKING, ${failedCount} FAILED, ${errorCount} ERROR`);
        
        // Detailed results for cookies with errors
        const cookiesWithErrors = results.filter(r => r.errorMessage);
        if (cookiesWithErrors.length > 0) {
            console.log("\n--- Cookies with Errors ---");
            cookiesWithErrors.forEach(r => {
                console.log(`Cookie #${r.index}: ${r.errorMessage}`);
            });
        }
    } finally {
        // Restore original cache setting
        if (originalCacheValue === undefined) {
            delete process.env.DISABLE_CACHE;
        } else {
            process.env.DISABLE_CACHE = originalCacheValue;
        }
    }
}

// Run the tests
testAllCookies().catch(error => {
    console.error("Error running cookie tests:", error);
    process.exit(1);
}); 