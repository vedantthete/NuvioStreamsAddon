const axios = require('axios');
const readline = require('readline');

// Changed to a public share endpoint, which is more relevant to how the addon uses cookies
const FEBBOX_PUBLIC_SHARE_URL = 'https://www.febbox.com/share/cbaV67Kp'; 
// Also test the file player endpoint with a known fid and share_key if provided
const FEBBOX_PLAYER_URL = 'https://www.febbox.com/file/player';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function checkCookieValidity(uiCookie, testFid = null, testShareKey = null) {
  if (!uiCookie || uiCookie.trim() === '') {
    console.error("Error: Cookie cannot be empty.");
    return false;
  }

  console.log(`\n--- Starting FebBox Cookie Check ---`);
  console.log(`Testing with cookie: ${uiCookie.substring(0, 15)}... (length: ${uiCookie.length})`);

  // Check both with and without the oss_group parameter
  const cookieValues = [
    `ui=${uiCookie.trim()}`,
    `ui=${uiCookie.trim()}; oss_group=USA7` // Add a US server group
  ];

  let overallResult = false;
  let extractedFid = null;
  let extractedShareKey = null;

  // Test against the public share URL first
  for (const cookieValue of cookieValues) {
    console.log(`\n--- Testing Public Share Access with ${cookieValue.includes('oss_group') ? 'region' : 'no region'} ---`);
    
    const requestHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Cookie': cookieValue
    };

    console.log(`\n[Public Share Request Details]`);
    console.log(`URL: ${FEBBOX_PUBLIC_SHARE_URL}`);
    console.log(`Headers: ${JSON.stringify(requestHeaders, null, 2)}`);

    try {
      const response = await axios.get(FEBBOX_PUBLIC_SHARE_URL, {
        headers: requestHeaders,
        timeout: 15000,
        maxRedirects: 0,
        validateStatus: function (status) {
          return status >= 200 && status < 500;
        },
      });

      console.log(`\n[Public Share Response Details]`);
      console.log(`Status: ${response.status} ${response.statusText || ''}`);
      
      const responseContentType = response.headers['content-type'] || 'unknown';
      console.log(`Content-Type: ${responseContentType}`);

      // Check for signs of successful access to the share
      if (response.status === 200 && responseContentType.includes('text/html')) {
        // The HTML content (case preserved for parsing)
        const htmlContent = response.data;
        
        // Look for download button, file entries, and other share page elements (case-insensitive)
        const htmlContentLower = htmlContent.toLowerCase();
        if (htmlContentLower.includes('download') && 
            (htmlContentLower.includes('file_name') || htmlContentLower.includes('share_more'))) {
          console.log(`\n--- Result: Cookie appears VALID for accessing public shares ---`);
          console.log(`Found download options and file elements in the share page.`);
          
          // IMPROVED FID EXTRACTION: Look for actual file divs with data-id attributes
          const fidMatches = htmlContent.match(/div\s+class="file[^"]*"\s+data-id="(\d+)"/gi);
          const validFids = [];
          
          if (fidMatches) {
            for (const match of fidMatches) {
              const fidFromMatch = match.match(/data-id="(\d+)"/i);
              if (fidFromMatch && fidFromMatch[1] && fidFromMatch[1] !== '0') {
                validFids.push(fidFromMatch[1]);
              }
            }
          }
          
          // IMPROVED SHARE KEY EXTRACTION: Preserve case and use multiple patterns
          // Try multiple patterns to extract the share key with correct case
          let shareKeyMatch = htmlContent.match(/var\s+share_key\s*=\s*['"]([a-zA-Z0-9]+)['"]/);
          if (!shareKeyMatch) {
            shareKeyMatch = htmlContent.match(/share_key:\s*['"]([a-zA-Z0-9]+)['"]/);
          }
          if (!shareKeyMatch) {
            shareKeyMatch = htmlContent.match(/shareid\s*=\s*['"]([a-zA-Z0-9]+)['"]/);
          }
          // Try extracting from the URL if we can't find it in the HTML
          if (!shareKeyMatch) {
            const urlParts = FEBBOX_PUBLIC_SHARE_URL.split('/');
            const potentialShareKey = urlParts[urlParts.length - 1];
            if (/^[a-zA-Z0-9]+$/.test(potentialShareKey)) {
              extractedShareKey = potentialShareKey;
            }
          } else {
            extractedShareKey = shareKeyMatch[1]; // This preserves the original case
          }
          
          // Report what we found
          if (validFids.length > 0) {
            extractedFid = validFids[0]; // Use the first valid FID
            console.log(`Found ${validFids.length} valid FIDs. Using first: ${extractedFid}`);
          } else {
            console.log(`No valid FIDs found in the share page. This may be a folder-only share.`);
          }
          
          if (extractedShareKey) {
            console.log(`Found Share Key: ${extractedShareKey} (case-sensitive)`);
          } else {
            console.log(`Could not extract a valid Share Key from the page.`);
          }
          
          // If we found both a FID and share key, suggest testing with player
          if (extractedFid && extractedShareKey && !testFid && !testShareKey) {
            console.log(`\nRecommendation: Re-run with the following parameters to test player access:`);
            console.log(`node check_febbox_cookie.js "${uiCookie}" "${extractedFid}" "${extractedShareKey}"`);
          }
          
          overallResult = true;
        } else {
          console.log(`\n--- Result: Cookie may be VALID but public share access inconclusive ---`);
          console.log(`Public share page loaded but couldn't definitively find file elements.`);
          
          // Output first 500 chars of HTML to help diagnose
          console.log("HTML snippet (first 500 chars):");
          console.log(htmlContent.substring(0, 500) + "...");
        }
      } else if (response.status === 302 || response.status === 301) {
        console.log(`Redirect Location: ${response.headers.location || 'not specified'}`);
        if (response.headers.location && 
            (response.headers.location.includes('/login') || 
             response.headers.location.includes('/passport'))) {
          console.log(`\n--- Result: Cookie appears INVALID for public shares (redirected to login) ---`);
        } else {
          console.log(`\n--- Result: Cookie triggered a redirect but not clearly to login ---`);
        }
      } else {
        console.log(`\n--- Result: Unexpected response (${response.status}) for public share ---`);
      }
    } catch (error) {
      console.log(`\n[Public Share Error]`);
      console.error(`Failed to access public share: ${error.message}`);
    }
  }

  // If specific fid and share_key are provided, test the player endpoint
  // Either use the provided test values or the ones we extracted
  const fidToTest = testFid || extractedFid;
  const shareKeyToTest = testShareKey || extractedShareKey;
  
  if (fidToTest && shareKeyToTest) {
    console.log(`\n--- Testing Player Endpoint with FID ${fidToTest} and Share Key ${shareKeyToTest} ---`);
    
    // Test each cookie variant
    for (const cookieValue of cookieValues) {
      const playerRequestHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieValue
      };
      
      const postData = new URLSearchParams();
      postData.append('fid', fidToTest);
      postData.append('share_key', shareKeyToTest);
      
      console.log(`\n[Player Request Details]`);
      console.log(`URL: ${FEBBOX_PLAYER_URL}`);
      console.log(`Headers: ${JSON.stringify(playerRequestHeaders, null, 2)}`);
      console.log(`Post Data: fid=${fidToTest}&share_key=${shareKeyToTest}`);
      
      try {
        const playerResponse = await axios.post(FEBBOX_PLAYER_URL, postData.toString(), {
          headers: playerRequestHeaders,
          timeout: 15000
        });
        
        console.log(`\n[Player Response Details]`);
        console.log(`Status: ${playerResponse.status}`);
        
        if (playerResponse.data) {
          // Check for video source URLs in the response
          if (typeof playerResponse.data === 'string') {
            if (playerResponse.data.includes('sources = [') || 
                playerResponse.data.includes('http') && 
                (playerResponse.data.includes('.mp4') || playerResponse.data.includes('.m3u8'))) {
              console.log(`\n--- Result: Cookie appears VALID for player requests (found video sources) ---`);
              console.log(`Player response contains video source URLs.`);
              
              // Extract a sample of the video sources for verification
              const sourcesMatch = playerResponse.data.match(/var sources = (\[.*?\]);/s);
              if (sourcesMatch) {
                try {
                  const sources = JSON.parse(sourcesMatch[1]);
                  if (sources.length > 0) {
                    console.log(`Found ${sources.length} video sources. First source:`);
                    console.log(`Label: ${sources[0].label || 'N/A'}`);
                    console.log(`URL: ${sources[0].file ? sources[0].file.substring(0, 100) + '...' : 'N/A'}`);
                  }
                } catch (e) {
                  console.log(`Could not parse sources JSON: ${e.message}`);
                }
              }
              
              overallResult = true;
            } else if (playerResponse.data.includes('code') && playerResponse.data.includes('msg')) {
              try {
                const jsonData = JSON.parse(playerResponse.data);
                console.log(`\n--- Result: Player request returned error: ${jsonData.code} - ${jsonData.msg} ---`);
              } catch {
                console.log(`\n--- Result: Player request returned apparent error but couldn't parse JSON ---`);
                console.log(`First 100 chars: ${playerResponse.data.substring(0, 100)}...`);
              }
            } else {
              console.log(`\n--- Result: Player request returned unknown format response ---`);
              console.log(`First 100 chars: ${playerResponse.data.substring(0, 100)}...`);
            }
          } else {
            console.log(`\n--- Result: Player request returned non-string data: ${typeof playerResponse.data} ---`);
          }
        } else {
          console.log(`\n--- Result: Player request returned empty response ---`);
        }
      } catch (error) {
        console.log(`\n[Player Error]`);
        console.error(`Failed to access player: ${error.message}`);
        if (error.response) {
          console.log(`Error status: ${error.response.status}`);
          console.log(`Error data: ${JSON.stringify(error.response.data || {}).substring(0, 200)}...`);
        }
      }
    }
  } else if (!testFid && !testShareKey) {
    console.log(`\nSkipping player test - no valid FID and Share Key found or provided.`);
  }

  // Final summary
  console.log(`\n=== SUMMARY ===`);
  if (overallResult) {
    console.log(`Cookie appears VALID for at least one FebBox operation mode.`);
    console.log(`This cookie should work for stream fetching in the addon.`);
  } else {
    console.log(`Cookie appears INVALID or inconclusive for all tested FebBox operations.`);
    console.log(`This cookie may not work reliably for stream fetching in the addon.`);
  }
  
  return overallResult;
}

if (process.argv.length > 2) {
  const cookieValue = process.argv[2];
  // Optional FID and share_key parameters
  const testFid = process.argv.length > 3 ? process.argv[3] : null;
  const testShareKey = process.argv.length > 4 ? process.argv[4] : null;
  checkCookieValidity(cookieValue, testFid, testShareKey).then(() => rl.close());
} else {
  rl.question('Please enter the FebBox ui cookie value: ', (cookieValue) => {
    rl.question('Optional: Enter a test FID (or press Enter to skip): ', (fid) => {
      if (fid && fid.trim()) {
        rl.question('Enter the share_key for this FID: ', (shareKey) => {
          checkCookieValidity(cookieValue, fid.trim(), shareKey.trim()).then(() => rl.close());
        });
      } else {
        checkCookieValidity(cookieValue).then(() => rl.close());
      }
    });
  });
} 