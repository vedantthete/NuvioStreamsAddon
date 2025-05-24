# ShowBox Scraper Stremio Addon

This Stremio addon provides streaming links from ShowBox/FebBox sources based on TMDB IDs.

## Installation

### Method 1: Install from web (recommended)

1. Start your Stremio client
2. Go to the addons page
3. Select "Community Addons"
4. Paste this URL: `http://localhost:7777/manifest.json` (replace with your actual server URL)
5. Click "Install"
6. Enjoy your streams!

### Method 2: Run locally

```bash
# Clone the repository (if not done already)
git clone <repository-url>
cd <repository-directory>/stremio-addon

# Install dependencies
npm install

# Start the addon
npm start
```

Then, follow Method 1 for installing from web, using `http://localhost:7777/manifest.json` as the URL.

## API Keys

This addon uses two API keys:
- TMDB API Key: For fetching movie/tv information
- ScraperAPI Key: For bypassing anti-bot measures

You may need to replace these keys in `scraper.js` if they expire.

## Usage

1. After installation, search for a movie or TV show in Stremio
2. Select the movie or TV show
3. The addon will automatically search ShowBox for the title and fetch streaming links
4. Select a stream quality from the list

## Development

To modify this addon:

1. Edit files in the project directory
2. Restart the server with `npm start`
3. Test your changes

## Limitations

- TV show episodes are not yet fully supported (future updates will include this)
- Some TMDB IDs might not be found on ShowBox
- Streams are subject to availability from the source

## Legal Notice

This addon is for educational purposes only. Please respect copyright laws and stream only content that you have the right to access. 