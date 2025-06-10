# 🚀 Nuvio Streams Self-Hosting Documentation

This guide will walk you through self-hosting Nuvio Streams step-by-step, from basic setup to advanced configuration.

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
  - [Cache Settings](#cache-settings)
  - [Global Proxy Configuration](#global-proxy-configuration)
  - [Provider-Specific Proxies](#provider-specific-proxies)
  - [Provider Enablement](#provider-enablement)
  - [API Keys and External Services](#api-keys-and-external-services)
- [Provider Setup Guides](#provider-setup-guides)
  - [ShowBox Configuration](#showbox-configuration)
  - [Hianime Setup](#hianime-setup)
  - [Xprime.tv with ScraperAPI](#xprimetv-with-scraperapi)
  - [Cuevana (Self-Host Only)](#cuevana-self-host-only)
- [Deployment Options](#deployment-options)
- [Troubleshooting](#troubleshooting)
- [Performance Optimization](#performance-optimization)

## 🚀 Quick Start

### Prerequisites

- **Node.js** (v16 or higher recommended)
- **npm** or **yarn**
- **Git**
- **TMDB API Key** (free from [themoviedb.org](https://www.themoviedb.org/settings/api))

### Basic Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/tapframe/NuvioStreamsAddon.git
   cd NuvioStreamsAddon
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create configuration file**
   ```bash
   cp .env.example .env
   ```

4. **Edit your `.env` file with your settings** (see configuration below)

5. **Start the addon**
   ```bash
   npm start
   ```

6. **Access your addon**
   - Open browser: `http://localhost:7000`
   - Install in Stremio using the manifest URL shown in console

## ⚙️ Environment Variables

### Cache Settings

Controls how the addon caches responses for better performance.

```env
# Cache Settings
DISABLE_CACHE=false
DISABLE_STREAM_CACHE=false
USE_REDIS_CACHE=false
REDIS_URL=redis://localhost:6379
```

| Variable | Description | Default | Recommended |
|----------|-------------|---------|-------------|
| `DISABLE_CACHE` | Disable general response caching | `true` | `false` (production) |
| `DISABLE_STREAM_CACHE` | Disable stream link caching | `true` | `false` (production) |
| `USE_REDIS_CACHE` | Use Redis for distributed caching | `false` | `true` (if Redis available) |
| `REDIS_URL` | Redis connection string | - | Your Redis URL |

**💡 Recommendation:** Enable caching in production for better performance and reduced load on providers.

### Global Proxy Configuration

ShowBox often blocks server IPs, so proxies help bypass restrictions.

```env
# Global Proxy Configuration
SHOWBOX_PROXY_URL_VALUE=https://your-proxy-url.netlify.app/?destination=
SHOWBOX_PROXY_URL_ALTERNATE=https://your-alternate-proxy.netlify.app/?destination=
SHOWBOX_USE_ROTATING_PROXY=false
```

| Variable | Description | Required |
|----------|-------------|----------|
| `SHOWBOX_PROXY_URL_VALUE` | Primary proxy URL for ShowBox | Yes (if ShowBox blocked) |
| `SHOWBOX_PROXY_URL_ALTERNATE` | Backup proxy URL | No |
| `SHOWBOX_USE_ROTATING_PROXY` | Rotate between VALUE and ALTERNATE | No |

**🔧 Setup Your Own Proxy:**
1. Deploy: [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/p-stream/simple-proxy)
2. Copy the deployed URL and add `?destination=` at the end
3. Add to your `.env` file

### Provider-Specific Proxies

Individual proxy settings for each provider when needed.

```env
# Provider-specific Proxy URLs
VIDSRC_PROXY_URL=https://your-proxy-url.netlify.app/?destination=
VIDZEE_PROXY_URL=
SOAPERTV_PROXY_URL=
HOLLYMOVIEHD_PROXY_URL=
XPRIME_PROXY_URL=
```

| Variable | Description | Notes |
|----------|-------------|-------|
| `VIDSRC_PROXY_URL` | Proxy for VidSrc provider | Optional |
| `VIDZEE_PROXY_URL` | Proxy for VidZee provider | Optional |
| `SOAPERTV_PROXY_URL` | Proxy for SoaperTV provider | Optional |
| `HOLLYMOVIEHD_PROXY_URL` | Proxy for HollyMovieHD provider | Optional |
| `XPRIME_PROXY_URL` | Proxy for Xprime provider | ⚠️ Deprecated - Use ScraperAPI |

**⚠️ Important:** Netlify proxies no longer work reliably for Xprime.tv. ScraperAPI is recommended if experiencing issues.

### Provider Enablement

Control which providers are active in your instance.

```env
# Provider Enablement
ENABLE_VIDZEE_PROVIDER=true
ENABLE_HOLLYMOVIEHD_PROVIDER=true
ENABLE_XPRIME_PROVIDER=true
ENABLE_CUEVANA_PROVIDER=false
```

| Variable | Description | Default | Notes |
|----------|-------------|---------|-------|
| `ENABLE_VIDZEE_PROVIDER` | Enable VidZee provider | `true` | Good for movies |
| `ENABLE_HOLLYMOVIEHD_PROVIDER` | Enable HollyMovieHD provider | `true` | Movies & TV shows |
| `ENABLE_XPRIME_PROVIDER` | Enable Xprime.tv provider | `true` | Requires ScraperAPI |
| `ENABLE_CUEVANA_PROVIDER` | Enable Cuevana provider | `false` | **Self-host only** |

**🌟 Cuevana Note:** Only available for self-hosted instances, great for Spanish/LATAM content.

### API Keys and External Services

Essential services and API keys required for full functionality.

```env
# API Keys and External Services
TMDB_API_KEY=your_tmdb_api_key_here
USE_SCRAPER_API=true
HIANIME_SERVER=http://localhost:8082/fetch-hianime
```

| Variable | Description | Required | How to Get |
|----------|-------------|----------|------------|
| `TMDB_API_KEY` | The Movie Database API key | **Yes** | [Get free key](https://www.themoviedb.org/settings/api) |
| `USE_SCRAPER_API` | Enable ScraperAPI integration | No (Recommended) | For Xprime.tv when direct access fails |
| `HIANIME_SERVER` | Hianime service endpoint | No | For anime content |

## 🎯 Provider Setup Guides

### ShowBox Configuration

ShowBox is the primary provider but requires special setup for optimal performance.

#### Option 1: Personal Cookie (Recommended)

**Why use a personal cookie?**
- Get your own 100GB monthly quota
- Access all quality levels (including 4K/HDR/DV)
- Faster download speeds
- Streams show ⚡ lightning emoji

**Setup Methods:**

**Method A: cookies.txt file**
```bash
# Create cookies.txt in project root
touch cookies.txt

# Add your ShowBox cookies (one per line)
echo "your_showbox_cookie_here" >> cookies.txt

# Add to .gitignore
echo "cookies.txt" >> .gitignore
```

**Method B: Web Configuration**
1. Start your addon: `npm start`
2. Open: `http://localhost:7000`
3. Click "Configure"
4. Paste your ShowBox cookie
5. Save settings

**How to get ShowBox cookie:**
1. Visit showbox.media in your browser
2. Open Developer Tools (F12)
3. Go to Application/Storage → Cookies
4. Copy the cookie value
5. Paste into your configuration

#### Option 2: Shared Public Instance

Without personal cookie:
- ⚠️ Shared 100GB quota with all users
- ⚠️ Limited to streams under 9GB (no 4K)
- ⚠️ Slower speeds, [SLOW] tag shown

### Hianime Setup

For anime content, Hianime requires a separate service.

#### Step 1: Setup Hianime Service

```bash
# Navigate to Hianime directory
cd providers/hianime

# Install dependencies
npm install

# Start the service
npm start
```

The service will run on port `8082` by default.

#### Step 2: Configure Main Addon

Add to your `.env` file:
```env
# For local setup
HIANIME_SERVER=http://localhost:8082/fetch-hianime

# For remote deployment
HIANIME_SERVER=http://your-server-ip:8082/fetch-hianime
```

#### Step 3: Optional Caching Configuration

Create `.env` file in `providers/hianime/` directory:
```env
# Disable caching if needed
DISABLE_HIANIME_CACHE=true
```

### Xprime.tv with ScraperAPI

Xprime.tv may require ScraperAPI to bypass anti-scraping measures if you're experiencing issues fetching links.

#### Step 1: Get ScraperAPI Key

1. Visit [ScraperAPI.com](https://www.scraperapi.com/)
2. Sign up for free account
3. Get your API key from dashboard

#### Step 2: Configure Addon

**Method A: Environment Variable**
```env
USE_SCRAPER_API=true
SCRAPER_API_KEY=your_scraperapi_key_here
```

**Method B: Web Configuration**
1. Open your addon in browser
2. Go to configuration page
3. Enter ScraperAPI key
4. Enable Xprime provider
5. Save settings

#### Step 3: Enable Provider

```env
ENABLE_XPRIME_PROVIDER=true
```

**Note:** Try using Xprime without ScraperAPI first. If you're not getting any links, then enable ScraperAPI.

### Cuevana (Self-Host Only)

Cuevana is only available for self-hosted instances and works best with unique IPs.

#### Configuration

```env
ENABLE_CUEVANA_PROVIDER=true
```

#### Important Notes

- **Only available for self-hosted instances**
- **Requires unique IP** (not shared hosting)
- **Great for Spanish/LATAM content**
- **Regional restrictions may apply**

## 🚀 Deployment Options

### Local Development

```bash
npm start
# Runs on http://localhost:7000
```

### Production Server

```bash
# Install PM2 for process management
npm install -g pm2

# Start with PM2
pm2 start npm --name "nuvio-streams" -- start

# Save PM2 configuration
pm2 save
pm2 startup
```

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
EXPOSE 7000

CMD ["npm", "start"]
```

```bash
# Build and run
docker build -t nuvio-streams .
docker run -p 7000:7000 --env-file .env nuvio-streams
```

### Environment Variables for Production

```env
# Production optimization
NODE_ENV=production
DISABLE_CACHE=false
DISABLE_STREAM_CACHE=false
USE_REDIS_CACHE=true
REDIS_URL=redis://your-redis-server:6379

# Required
TMDB_API_KEY=your_actual_api_key

# Enable all providers
ENABLE_VIDZEE_PROVIDER=true
ENABLE_HOLLYMOVIEHD_PROVIDER=true
ENABLE_XPRIME_PROVIDER=true
ENABLE_CUEVANA_PROVIDER=true

# Proxy configuration (if needed)
SHOWBOX_PROXY_URL_VALUE=https://your-proxy.netlify.app/?destination=
```

## 🔧 Troubleshooting

### Common Issues

#### ShowBox Links Not Appearing

**Symptoms:** No ShowBox streams found
**Solutions:**
1. Wait and refresh - rate limits cause temporary failures
2. Check if you need a proxy for your region
3. Verify cookie configuration
4. Second/third attempts usually succeed due to caching

#### Provider Blocked/Rate Limited

**Symptoms:** "MESSAGE" responses, timeouts
**Solutions:**
1. Deploy your own proxy (Netlify template)
2. Use different proxy URLs
3. Enable rotating proxies
4. For Xprime: Use ScraperAPI instead

#### Hianime Not Working

**Symptoms:** No anime streams found
**Solutions:**
1. Check if Hianime service is running: `http://localhost:8082/health`
2. Verify `HIANIME_SERVER` URL in `.env`
3. Check Hianime service logs
4. Restart Hianime service

#### Poor Performance

**Symptoms:** Slow responses, timeouts
**Solutions:**
1. Enable caching: `DISABLE_CACHE=false`
2. Setup Redis: `USE_REDIS_CACHE=true`
3. Use personal ShowBox cookie
4. Deploy closer to your users

### Debug Mode

Enable detailed logging:
```env
DEBUG=nuvio:*
LOG_LEVEL=debug
```

### Health Checks

Check addon status:
```bash
# Main addon
curl http://localhost:7000/health

# Hianime service
curl http://localhost:8082/health
```

## ⚡ Performance Optimization

### Caching Strategy

```env
# Enable all caching
DISABLE_CACHE=false
DISABLE_STREAM_CACHE=false

# Use Redis for better performance
USE_REDIS_CACHE=true
REDIS_URL=redis://your-redis:6379
```

### Redis Setup

```bash
# Install Redis (Ubuntu/Debian)
sudo apt update
sudo apt install redis-server

# Start Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Test connection
redis-cli ping
```

### Proxy Optimization

```env
# Use rotating proxies for better reliability
SHOWBOX_USE_ROTATING_PROXY=true
SHOWBOX_PROXY_URL_VALUE=https://proxy1.netlify.app/?destination=
SHOWBOX_PROXY_URL_ALTERNATE=https://proxy2.netlify.app/?destination=
```

### Personal Cookie Benefits

| Without Cookie | With Personal Cookie |
|----------------|---------------------|
| Shared 100GB quota | Personal 100GB quota |
| <9GB file limit | All file sizes |
| [SLOW] speeds | ⚡ Fast speeds |
| Basic qualities | 4K/HDR/DV access |

## 📞 Support

If you need help:

1. **Check logs** - Look for error messages
2. **GitHub Issues** - [Report bugs](https://github.com/tapframe/NuvioStreamsAddon/issues)
3. **Documentation** - Re-read relevant sections
4. **Community** - Help others who might have similar issues

## 🎉 Success!

Once configured, your self-hosted Nuvio Streams will provide:

- ✅ **Reliable streaming** without public instance limitations
- ✅ **All providers** including Cuevana
- ✅ **Personal quotas** and faster speeds
- ✅ **Full control** over configuration and updates
- ✅ **Privacy** - your streaming activity stays private

Happy streaming! 🍿 