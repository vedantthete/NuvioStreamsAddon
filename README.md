# Nuvio Streams Addon for Stremio

Welcome to Nuvio Streams! This addon for Stremio fetches direct streaming links for movies and TV shows from a variety of online providers.

Based on community feedback and continued development, this addon aims to offer a customizable and user-friendly streaming alternative.

**This addon is for Stremio users who:**

1.  Prefer direct HTTP streaming links as an alternative to debrid services.
2.  Understand the nature of scrapers (public sources can be unreliable or change).
3.  Are willing to configure settings, like a personal cookie, for the best experience.

**Key Features:**

*   **Multiple Providers:** Access streams from ShowBox, Xprime.tv, HollyMovieHD, SoaperTV, Cuevana, Hianime (for anime), and VidSrc.
*   **Personal Cookie Configuration:** **Extremely Recommended** for ShowBox to get the best performance, avoid shared quotas, and unlock all stream qualities (including 4K HDR/DV).
*   **Provider & Quality Customization:** Tailor the addon to your needs by selecting active providers and setting minimum stream qualities.
*   **No Torrents/P2P:** Nuvio Streams only scrapes direct HTTP streams.
*   **TMDB & IMDb Support:** Works with both ID types.
*   **User-Friendly Configuration:** All settings are managed through the addon's main page.

## Self-Hosting Guide (Beginner Friendly)

This guide will help you set up your own instance of Nuvio Streams, including both the main addon and the Hianime service (for anime content).

### Prerequisites

*   [Node.js](https://nodejs.org/) (LTS version recommended)
*   [npm](https://www.npmjs.com/) (comes with Node.js) or [yarn](https://yarnpkg.com/)
*   Basic familiarity with command line

### Step 1: Get the Code

```bash
git clone <repository-url>
cd nuvio-streams-addon 
```

### Step 2: Install Dependencies

```bash
npm install
# or
yarn install
```

### Step 3: Basic Configuration

Create a `.env` file in the project root by copying the example:
```bash
cp .env.example .env
```

Edit your `.env` file with at least these essential settings:

```
# Required: Get this from https://www.themoviedb.org/settings/api
TMDB_API_KEY=your_tmdb_api_key_here

# Optional: Enable/disable specific providers
ENABLE_CUEVANA_PROVIDER=false
ENABLE_HOLLYMOVIEHD_PROVIDER=true

# Optional: Disable caching if needed
DISABLE_CACHE=false
```

### Step 4: Run the Main Addon

```bash
npm start
# Or your designated start script, e.g., node server.js
```

Your self-hosted addon will typically run on `http://localhost:7000`. The console will show the manifest URL to install it in Stremio.

### Step 5: ShowBox Cookie Setup (Recommended)

ShowBox works best with a personal cookie. You have two options:

**Option A: Using a `cookies.txt` file:**
1. Create a `cookies.txt` file in the project root
2. Add one ShowBox/FebBox cookie token per line
3. Add `cookies.txt` to your `.gitignore` file

**Option B: Using the Configuration UI:**
1. Access your addon in a browser (e.g., `http://localhost:7000`)
2. Use the configuration page to set your cookie

### Step 6: Setting Up Hianime (For Anime Content)

The Hianime provider requires a separate service that handles the communication with Hianime's API. Here's how to set it up:

1. **Navigate to the Hianime Service Directory:**
   ```bash
   cd providers/hianime
   ```

2. **Install Hianime Service Dependencies:**
   ```bash
   npm install
   # or
   yarn install
   ```

3. **Start the Hianime Service:**
   ```bash
   npm start
   ```
   This service will run on port `8082` by default.

4. **Configure the Main Addon to Use Your Hianime Service:**
   
   Return to the main directory and edit your `.env` file to add:
   ```
   # For local testing:
   HIANIME_SERVER=http://localhost:8082/fetch-hianime
   
   # If deploying to a server:
   # HIANIME_SERVER=http://your-server-ip:8082/fetch-hianime
   ```

### Step 7: Advanced Configuration (Optional)

#### Proxy Setup (If Providers Are Blocked in Your Region)

Some providers like ShowBox or Xprime might block your server's IP. You can deploy a simple proxy:

1. Deploy a [simple proxy using Netlify](https://app.netlify.com/start/deploy?repository=https://github.com/p-stream/simple-proxy)
2. Add to your `.env` file:
   ```
   # For ShowBox
   SHOWBOX_PROXY_URL_VALUE=https://your-proxy.netlify.app/?destination=
   
   # For Xprime
   XPRIME_PROXY_URL=https://your-proxy.netlify.app
   XPRIME_USE_PROXY=true
   ```

#### Hianime Caching (Optional)

By default, the Hianime service caches results to improve performance. If you want to disable caching:

1. Create a `.env` file in the `providers/hianime` directory
2. Add: `DISABLE_HIANIME_CACHE=true`

## Provider-Specific Notes

### Hianime - Understanding its Operation

The Hianime provider works in two steps:

1. **Main Addon Step:** Gathers show title and episode information from TMDB
2. **Hianime Service Step:** Communicates with Hianime's API to find and extract stream links

By self-hosting both components as described above, you have full control over the entire process.

## Support Development

If you find Nuvio Streams useful, please consider supporting its development. Your support helps maintain reliable streams, find new providers, and keep things running smoothly.

*   **[Buy Me a Coffee](https://buymeacoffee.com/tapframe)**

You can also follow on GitHub: [https://github.com/tapframe](https://github.com/tapframe)

## Disclaimer

*   Nuvio Streams is an addon that scrapes content from third-party websites. The availability, legality, and quality of the content are the responsibility of these external sites.
*   Ensure you are complying with the terms of service of any websites being accessed and any applicable local laws.
*   This addon is provided for educational and personal use. The developers are not responsible for any misuse. 